import base64
import mimetypes
import os
import time
from typing import Optional

import boto3
from botocore.config import Config
from botocore.exceptions import ClientError

from . import get_logger
from .media_refs import classify_media_ref, MEDIA_REF_LOCAL_PATH, MEDIA_REF_OBJECT_KEY

logger = get_logger(__name__)

# Default prefix inside the bucket (object key prefix)
DEFAULT_OSS_BASE_PATH = "lumenx"
SIGN_URL_EXPIRES_DISPLAY = 7200  # 2 hours for frontend display
SIGN_URL_EXPIRES_API = 1800  # 30 minutes for AI API calls


def _minio_region() -> str:
    return os.getenv("MINIO_REGION", "us-east-1")


def _build_minio_endpoint_url() -> Optional[str]:
    raw = os.getenv("MINIO_ENDPOINT", "").strip()
    if not raw:
        return None
    if raw.startswith("http://") or raw.startswith("https://"):
        return raw.rstrip("/")
    use_ssl = os.getenv("MINIO_USE_SSL", "false").lower() in ("1", "true", "yes")
    scheme = "https" if use_ssl else "http"
    return f"{scheme}://{raw.rstrip('/')}"


def _build_minio_public_endpoint_url() -> Optional[str]:
    """
    Optional public base URL for presigned GET URLs (e.g. frp/ngrok pointing at MinIO).

    Uploads still use MINIO_ENDPOINT (LAN); cloud APIs (DashScope, etc.) must fetch
    objects via a URL they can reach — set this to that host.
    """
    raw = os.getenv("MINIO_PUBLIC_ENDPOINT", "").strip()
    if not raw:
        return None
    if raw.startswith("http://") or raw.startswith("https://"):
        return raw.rstrip("/")
    use_ssl = os.getenv("MINIO_PUBLIC_USE_SSL", "true").lower() in ("1", "true", "yes")
    scheme = "https" if use_ssl else "http"
    return f"{scheme}://{raw.rstrip('/')}"


def is_oss_configured() -> bool:
    """True when MinIO (S3-compatible) endpoint, credentials, and bucket are set."""
    return all(
        [
            _build_minio_endpoint_url(),
            os.getenv("MINIO_ACCESS_KEY"),
            os.getenv("MINIO_SECRET_KEY"),
            os.getenv("MINIO_BUCKET"),
        ]
    )


def get_oss_base_path() -> str:
    """Prefix for object keys (MINIO_BASE_PATH, else legacy OSS_BASE_PATH)."""
    return (
        os.getenv("MINIO_BASE_PATH")
        or os.getenv("OSS_BASE_PATH", DEFAULT_OSS_BASE_PATH)
    ).rstrip("/")


def is_object_key(value: str) -> bool:
    """
    Check if a string value is an object key (not a full URL or local path).
    """
    return (
        classify_media_ref(value, oss_base_path=get_oss_base_path())
        == MEDIA_REF_OBJECT_KEY
    )


def is_local_path(value: str) -> bool:
    """Check if a string is a local file path (relative or absolute)."""
    return (
        classify_media_ref(value, oss_base_path=get_oss_base_path())
        == MEDIA_REF_LOCAL_PATH
    )


class OSSImageUploader:
    """
    S3-compatible (MinIO) uploader: private bucket + presigned GET URLs.

    - Upload files and return object keys (not full URLs)
    - Generate presigned URLs on demand
    """

    _instance = None

    def __new__(cls):
        if cls._instance is None:
            cls._instance = super().__new__(cls)
            cls._instance._initialized = False
            cls._instance._url_cache = {}
        return cls._instance

    def __init__(self):
        if self._initialized:
            return

        endpoint_url = _build_minio_endpoint_url()
        self.access_key_id = os.getenv("MINIO_ACCESS_KEY")
        self.access_key_secret = os.getenv("MINIO_SECRET_KEY")
        self.bucket_name = os.getenv("MINIO_BUCKET")
        self.base_path = get_oss_base_path()
        self._endpoint_url = endpoint_url
        public_endpoint = _build_minio_public_endpoint_url()
        self._public_endpoint_url = public_endpoint
        self._client_presign = None  # same creds, public host — for presigned URLs only

        print(
            f"DEBUG: MinIO init - Key={'***' if self.access_key_id else 'None'}, "
            f"Endpoint={endpoint_url}, Bucket={self.bucket_name}, Base={self.base_path}"
        )
        if public_endpoint and public_endpoint != endpoint_url:
            print(f"DEBUG: MinIO public presign endpoint: {public_endpoint}")

        self._client = None
        self.bucket = None

        if not all([endpoint_url, self.access_key_id, self.access_key_secret, self.bucket_name]):
            logger.warning("MinIO not fully configured. Object storage upload will be disabled.")
            print("DEBUG: MinIO init - FAILED: missing credentials or endpoint")
        else:
            try:
                cfg = Config(
                    signature_version="s3v4",
                    s3={"addressing_style": "path"},
                    connect_timeout=5,
                    read_timeout=60,
                )
                self._client = boto3.client(
                    "s3",
                    endpoint_url=endpoint_url,
                    region_name=_minio_region(),
                    aws_access_key_id=self.access_key_id,
                    aws_secret_access_key=self.access_key_secret,
                    config=cfg,
                )
                self.bucket = self._client
                logger.info(
                    f"MinIO S3 client ready: bucket={self.bucket_name}, base_path={self.base_path}"
                )
                print(f"DEBUG: MinIO init - SUCCESS: bucket={self.bucket_name}")

                if public_endpoint and public_endpoint != endpoint_url:
                    self._client_presign = boto3.client(
                        "s3",
                        endpoint_url=public_endpoint,
                        region_name=_minio_region(),
                        aws_access_key_id=self.access_key_id,
                        aws_secret_access_key=self.access_key_secret,
                        config=cfg,
                    )
                    logger.info(
                        "MinIO presigned URLs will use MINIO_PUBLIC_ENDPOINT (for remote APIs)."
                    )
            except Exception as e:
                logger.error(f"Failed to initialize MinIO client: {e}")
                print(f"DEBUG: MinIO init - ERROR: {e}")
                self._client = None
                self.bucket = None

        self._initialized = True

    @classmethod
    def reset_instance(cls):
        cls._instance = None

    @property
    def is_configured(self) -> bool:
        return self._client is not None

    def _build_object_key(self, sub_path: str, filename: str) -> str:
        parts = [self.base_path]
        if sub_path:
            parts.append(sub_path.strip("/"))
        parts.append(filename)
        return "/".join(parts)

    def upload_file(
        self, local_path: str, sub_path: str = "", custom_filename: str = None
    ) -> Optional[str]:
        if not self._client:
            logger.warning("MinIO not configured, cannot upload file.")
            return None

        if not os.path.exists(local_path):
            logger.error(f"File not found: {local_path}")
            return None

        try:
            filename = custom_filename or os.path.basename(local_path)
            object_key = self._build_object_key(sub_path, filename)

            logger.info(f"Uploading to MinIO: {local_path} -> {object_key}")

            with open(local_path, "rb") as f:
                self._client.put_object(Bucket=self.bucket_name, Key=object_key, Body=f)

            logger.info(f"Upload success: {object_key}")
            return object_key

        except Exception as e:
            logger.error(f"MinIO upload error: {e}")
            return None

    def generate_signed_url(self, object_key: str, expires: int = SIGN_URL_EXPIRES_DISPLAY) -> str:
        if not self._client:
            logger.warning("MinIO not configured, cannot generate signed URL.")
            return ""

        try:
            cache_key = (object_key, expires)
            now = time.time()
            if cache_key in self._url_cache:
                cached_url, timestamp = self._url_cache[cache_key]
                if now - timestamp < (expires - 600):
                    return cached_url

            presign_client = self._client_presign or self._client
            url = presign_client.generate_presigned_url(
                "get_object",
                Params={"Bucket": self.bucket_name, "Key": object_key},
                ExpiresIn=expires,
            )

            self._url_cache[cache_key] = (url, now)
            return url
        except Exception as e:
            logger.error(f"Failed to generate presigned URL for {object_key}: {e}")
            return ""

    def sign_url_for_display(self, object_key: str) -> str:
        return self.generate_signed_url(object_key, SIGN_URL_EXPIRES_DISPLAY)

    def sign_url_for_api(self, object_key: str) -> str:
        return self.generate_signed_url(object_key, SIGN_URL_EXPIRES_API)

    def object_exists(self, object_key: str) -> bool:
        if not self._client:
            return False
        try:
            self._client.head_object(Bucket=self.bucket_name, Key=object_key)
            return True
        except ClientError:
            return False
        except Exception:
            return False

    def object_to_data_uri(self, object_key: str) -> Optional[str]:
        """
        Read an object from MinIO/S3 and return a data URI for cloud APIs that
        cannot fetch presigned URLs pointing at localhost or private networks.
        """
        if not self._client:
            return None
        try:
            resp = self._client.get_object(Bucket=self.bucket_name, Key=object_key)
            body = resp["Body"].read()
            mime = resp.get("ContentType") or mimetypes.guess_type(object_key)[0] or "image/png"
            if not str(mime).startswith("image/"):
                mime = "image/png"
            b64 = base64.b64encode(body).decode("ascii")
            return f"data:{mime};base64,{b64}"
        except Exception as e:
            logger.error(f"Failed to read object as data URI {object_key}: {e}")
            return None

    def upload_image(self, local_image_path: str, sub_path: str = "assets") -> Optional[str]:
        return self.upload_file(local_image_path, sub_path)

    def upload_video(self, local_video_path: str, sub_path: str = "video") -> Optional[str]:
        return self.upload_file(local_video_path, sub_path)

    def get_oss_url(self, object_key: str, use_public_url: bool = False) -> str:
        if use_public_url:
            logger.warning("Public URLs are deprecated. Using presigned URL instead.")
        return self.sign_url_for_display(object_key)


def sign_oss_urls_in_data(data, uploader: OSSImageUploader = None):
    """
    Recursively traverse data and convert object keys to presigned URLs.
    """
    if uploader is None:
        uploader = OSSImageUploader()

    if not uploader.is_configured:
        return data

    def process_value(value):
        if isinstance(value, str):
            if is_object_key(value):
                signed_url = uploader.sign_url_for_display(value)
                return signed_url if signed_url else value
            return value
        elif isinstance(value, dict):
            return {k: process_value(v) for k, v in value.items()}
        elif isinstance(value, list):
            return [process_value(item) for item in value]
        else:
            return value

    return process_value(data)


def convert_local_path_to_object_key(local_path: str, project_id: str = None) -> str:
    base_path = get_oss_base_path()

    if local_path.startswith("output/"):
        local_path = local_path[7:]

    if project_id:
        return f"{base_path}/{project_id}/{local_path}"
    else:
        return f"{base_path}/{local_path}"
