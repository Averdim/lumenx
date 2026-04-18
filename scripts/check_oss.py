import os

import boto3
from botocore.config import Config
from botocore.exceptions import ClientError
from dotenv import load_dotenv

load_dotenv()


def _endpoint_url():
    raw = os.getenv("MINIO_ENDPOINT", "").strip()
    if not raw:
        return None
    if raw.startswith("http://") or raw.startswith("https://"):
        return raw.rstrip("/")
    use_ssl = os.getenv("MINIO_USE_SSL", "false").lower() in ("1", "true", "yes")
    scheme = "https" if use_ssl else "http"
    return f"{scheme}://{raw.rstrip('/')}"


endpoint_url = _endpoint_url()
access_key = os.getenv("MINIO_ACCESS_KEY")
secret_key = os.getenv("MINIO_SECRET_KEY")
bucket_name = os.getenv("MINIO_BUCKET")
base_path = (os.getenv("MINIO_BASE_PATH") or os.getenv("OSS_BASE_PATH", "lumenx")).strip("'\"/")

if not all([endpoint_url, access_key, secret_key, bucket_name]):
    print("Set MINIO_ENDPOINT, MINIO_ACCESS_KEY, MINIO_SECRET_KEY, MINIO_BUCKET")
    raise SystemExit(1)

cfg = Config(signature_version="s3v4", s3={"addressing_style": "path"})
client = boto3.client(
    "s3",
    endpoint_url=endpoint_url,
    region_name=os.getenv("MINIO_REGION", "us-east-1"),
    aws_access_key_id=access_key,
    aws_secret_access_key=secret_key,
    config=cfg,
)

test_key = f"{base_path}/assets/characters/593da220-e315-4aac-9016-2e2b243912b1_fullbody_d452dadb-c703-419e-85c2-fc48dc75275a.png"

try:
    client.head_object(Bucket=bucket_name, Key=test_key)
    exists = True
except ClientError:
    exists = False

print(f"Checking key: {test_key}")
print(f"Exists: {exists}")

if not exists:
    print("\nListing first 5 objects with prefix:")
    resp = client.list_objects_v2(Bucket=bucket_name, Prefix=base_path + "/", MaxKeys=5)
    for obj in resp.get("Contents", []) or []:
        print(f"  {obj['Key']}")
