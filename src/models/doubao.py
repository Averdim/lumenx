import os
import time
import logging
import base64
import ipaddress
from typing import Any, Dict, List, Optional, Tuple
from urllib.parse import urlparse

from .base import VideoGenModel
from ..utils.media_refs import (
    MEDIA_REF_LOCAL_PATH,
    MEDIA_REF_OBJECT_KEY,
    MEDIA_REF_REMOTE_URL,
    classify_media_ref,
    resolve_local_media_path,
)
from ..utils.oss_utils import OSSImageUploader

# Try to import Ark, handle if not installed (though user said they installed it)
try:
    from volcenginesdkarkruntime import Ark
except ImportError:
    Ark = None

logger = logging.getLogger(__name__)

class DoubaoModel(VideoGenModel):
    def __init__(self, config: dict):
        super().__init__(config)
        self.api_key = os.getenv("ARK_API_KEY")
        self.model_name = config.get('params', {}).get('model_name', 'doubao-seedance-2-0-260128')
        
        if not self.api_key:
            logger.warning("ARK_API_KEY not found in environment variables.")
            
        if Ark:
            self.client = Ark(
                base_url="https://ark.cn-beijing.volces.com/api/v3",
                api_key=self.api_key
            )
        else:
            self.client = None
            logger.error("volcenginesdkarkruntime not installed. pip install 'volcengine-python-sdk[ark]'")

    def _encode_image_to_base64(self, image_path: str) -> str:
        with open(image_path, "rb") as image_file:
            return base64.b64encode(image_file.read()).decode('utf-8')

    @staticmethod
    def _mime_for_path(path: str) -> str:
        ext = os.path.splitext(path)[1].lower()
        if ext == ".png":
            return "image/png"
        if ext in (".jpg", ".jpeg"):
            return "image/jpeg"
        if ext == ".webp":
            return "image/webp"
        return "image/jpeg"

    def _path_to_data_url(self, local_path: str) -> str:
        base64_image = self._encode_image_to_base64(local_path)
        mime = self._mime_for_path(local_path)
        return f"data:{mime};base64,{base64_image}"

    @staticmethod
    def _url_unreachable_by_cloud_api(url: str) -> bool:
        if not url or not isinstance(url, str):
            return False
        try:
            parsed = urlparse(url.strip())
            host = (parsed.hostname or "").strip().lower()
            if not host:
                return False
            if host == "localhost" or host.endswith(".local"):
                return True
            if host in ("127.0.0.1", "::1"):
                return True
            try:
                ip = ipaddress.ip_address(host)
                return bool(ip.is_private or ip.is_loopback or ip.is_link_local)
            except ValueError:
                return False
        except Exception:
            return False

    def _remote_url_to_data_url(self, url: str) -> str:
        import requests

        response = requests.get(url, timeout=20)
        response.raise_for_status()
        mime = response.headers.get("Content-Type", "").split(";")[0].strip().lower()
        if not mime.startswith("image/"):
            mime = "image/png"
        encoded = base64.b64encode(response.content).decode("ascii")
        return f"data:{mime};base64,{encoded}"

    def _resolve_reference_image_url(self, img_path: str = None, img_url: str = None) -> str:
        uploader = OSSImageUploader()

        # 1) Explicit local path from pipeline download
        if img_path and os.path.isfile(img_path):
            return self._path_to_data_url(img_path)

        def _resolve_ref(ref: str) -> str:
            if not ref:
                return None
            if ref.startswith("data:"):
                return ref
            if ref.startswith("file://"):
                local_path = ref[7:]
                if os.path.isfile(local_path):
                    return self._path_to_data_url(local_path)
                return None

            ref_type = classify_media_ref(ref)
            if ref_type == MEDIA_REF_LOCAL_PATH:
                local_path = resolve_local_media_path(ref)
                if local_path and os.path.isfile(local_path):
                    return self._path_to_data_url(local_path)
                return None

            if ref_type == MEDIA_REF_OBJECT_KEY:
                if not uploader.is_configured:
                    return None
                signed_url = uploader.sign_url_for_api(ref)
                if signed_url and not self._url_unreachable_by_cloud_api(signed_url):
                    return signed_url
                return uploader.object_to_data_uri(ref)

            if ref_type == MEDIA_REF_REMOTE_URL:
                if not self._url_unreachable_by_cloud_api(ref):
                    return ref
                try:
                    # Localhost/LAN URLs are unreachable by Ark; inline as data URI instead.
                    return self._remote_url_to_data_url(ref)
                except Exception:
                    return None

            return None

        # 2) Resolve img_path/img_url as generic refs
        resolved = _resolve_ref(img_path) if img_path else None
        if resolved:
            return resolved
        return _resolve_ref(img_url) if img_url else None

    @staticmethod
    def _is_seedance_2_model(model_id: str) -> bool:
        m = (model_id or "").lower()
        return "seedance-2-0" in m or "doubao-seedance-2-0" in m

    @staticmethod
    def _seedance2_image_roles(seedance_mode: Optional[str], num_images: int) -> List[Optional[str]]:
        mode = (seedance_mode or "first_frame").strip()
        if mode == "first_last_frame":
            if num_images != 2:
                raise ValueError("first_last_frame requires exactly 2 images")
            return ["first_frame", "last_frame"]
        if mode == "multimodal_ref":
            return ["reference_image"] * num_images
        if num_images == 1:
            return [None]
        raise ValueError(f"Inconsistent Seedance mode {mode} with {num_images} images")

    def _resolve_image_inputs(self, image_inputs: List[Dict[str, Any]]) -> List[str]:
        resolved: List[str] = []
        for item in image_inputs:
            u = self._resolve_reference_image_url(
                img_path=item.get("img_path"),
                img_url=item.get("img_url"),
            )
            if not u:
                raise ValueError("Failed to resolve an input image for Doubao SeeDance")
            resolved.append(u)
        return resolved

    def _poll_task_and_download(self, task_id: str, output_path: str) -> None:
        while True:
            get_result = self.client.content_generation.tasks.get(task_id=task_id)
            status = get_result.status

            if status == "succeeded":
                logger.info("Doubao task succeeded.")
                video_url = None
                if hasattr(get_result, "content") and get_result.content:
                    if hasattr(get_result.content, "video_url"):
                        video_url = get_result.content.video_url

                if not video_url:
                    logger.warning(f"Could not parse video URL from result: {get_result}")
                    raise ValueError("No video URL found in response")

                self._download_video(video_url, output_path)
                return

            if status == "failed":
                logger.error(f"Doubao task failed: {get_result.error}")
                raise RuntimeError(f"Doubao generation failed: {get_result.error}")

            time.sleep(2)

    def generate(self, prompt: str, output_path: str, **kwargs) -> Tuple[str, float]:
        """
        Generate video using Doubao SeeDance via Ark SDK (image-to-video).

        kwargs:
            img_url / img_path: Legacy single image (used when image_inputs is absent).
            image_inputs: Optional list of {"img_path": ..., "img_url": ...} in order (Seedance 2.0).
            seedance_i2v_mode: first_frame | first_last_frame | multimodal_ref (Seedance 2.0).
            generate_audio: Passed to Ark for Seedance 2.0 (default False).
            model, duration, resolution: As before.
        """
        if not self.client:
            raise RuntimeError(
                "Ark client not initialized. Install: pip install 'volcengine-python-sdk[ark]'"
            )

        model_id = (kwargs.get("model") or self.model_name or "").strip() or self.model_name
        duration = int(kwargs.get("duration") or 5)
        resolution = (kwargs.get("resolution") or "720p").strip().lower()
        generate_audio = bool(kwargs.get("generate_audio"))

        image_inputs: Optional[List[Dict[str, Any]]] = kwargs.get("image_inputs")
        if not image_inputs:
            img_url = kwargs.get("img_url")
            img_path = kwargs.get("img_path")
            if img_url or img_path:
                image_inputs = [{"img_path": img_path, "img_url": img_url}]
        if not image_inputs:
            raise ValueError("Doubao SeeDance requires at least one input image.")

        logger.info(f"Calling Doubao {model_id} with prompt: {prompt}")
        start_time = time.time()

        try:
            if self._is_seedance_2_model(model_id):
                resolved_list = self._resolve_image_inputs(image_inputs)
                roles = self._seedance2_image_roles(
                    kwargs.get("seedance_i2v_mode"), len(resolved_list)
                )
                content: List[Dict[str, Any]] = [{"type": "text", "text": prompt}]
                for url, role in zip(resolved_list, roles):
                    block: Dict[str, Any] = {
                        "type": "image_url",
                        "image_url": {"url": url},
                    }
                    if role:
                        block["role"] = role
                    content.append(block)

                create_result = self.client.content_generation.tasks.create(
                    model=model_id,
                    content=content,
                    generate_audio=generate_audio,
                    ratio="adaptive",
                    duration=duration,
                    watermark=False,
                )
                task_id = create_result.id
                logger.info(f"Doubao Task ID: {task_id}")
                self._poll_task_and_download(task_id, output_path)
            else:
                img_url = kwargs.get("img_url")
                img_path = kwargs.get("img_path")
                final_image_url = self._resolve_reference_image_url(
                    img_path=img_path, img_url=img_url
                )
                if not final_image_url:
                    raise ValueError(
                        "Doubao SeeDance requires an input image (img_url or img_path)."
                    )
                create_result = self.client.content_generation.tasks.create(
                    model=model_id,
                    content=[
                        {
                            "type": "text",
                            "text": (
                                f"{prompt} --resolution {resolution} --duration {duration} "
                                f"--camerafixed false --watermark false"
                            ),
                        },
                        {"type": "image_url", "image_url": {"url": final_image_url}},
                    ],
                )
                task_id = create_result.id
                logger.info(f"Doubao Task ID: {task_id}")
                self._poll_task_and_download(task_id, output_path)

        except Exception as e:
            logger.error(f"Error calling Doubao API: {e}")
            raise

        api_duration = time.time() - start_time
        return output_path, api_duration

    def _download_video(self, url: str, output_path: str):
        import requests
        logger.info(f"Downloading video from {url} to {output_path}...")
        response = requests.get(url, stream=True)
        response.raise_for_status()
        with open(output_path, 'wb') as f:
            for chunk in response.iter_content(chunk_size=8192):
                f.write(chunk)
        logger.info("Download complete.")
