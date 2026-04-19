from abc import ABC, abstractmethod
from typing import Dict, Any, Tuple, Optional, List
import base64
import json
import mimetypes
import os
import re
import time
import requests
from http import HTTPStatus
import dashscope
from dashscope import ImageSynthesis
from ..utils import get_logger, log_generation_model
from ..utils.endpoints import get_provider_base_url
from ..utils.media_refs import MEDIA_REF_UNKNOWN, classify_media_ref
from ..utils.oss_utils import OSSImageUploader
from ..utils.provider_media import resolve_media_input
from ..utils.provider_registry import resolve_provider_backend

logger = get_logger(__name__)

# OpenAI-compatible image generation (e.g. Gemini Flash Image via third-party gateway).
# T2I only; I2I is not supported in this integration.
GEMINI_FLASH_IMAGE_PREVIEW_MODEL = "gemini-3.1-flash-image-preview"
SEEDREAM_30_IMAGE_MODEL = "seedream3.0"
# I2I upstream id on gateways that expect Doubao catalog names (UI still uses SEEDREAM_30_IMAGE_MODEL).
SEEDREAM_30_I2I_UPSTREAM_MODEL = "doubao-seedream-3-0-t2i-250415"
# Same code path: IMAGE_OPENAI_* chat/completions with modalities image+text.
IMAGE_CHAT_OPENAI_COMPAT_MODELS = frozenset(
    {GEMINI_FLASH_IMAGE_PREVIEW_MODEL, SEEDREAM_30_IMAGE_MODEL}
)

# OpenAI Images API: POST /v1/images/generations (T2I and I2I when gateway has no /images/edits).
# I2I: same endpoint + JSON extra field for the first reference image (see IMAGE_GENERATIONS_REF_* env).
Z_IMAGE_TURBO_MODEL = "z-image-turbo"
IMAGE_GENERATIONS_OPENAI_COMPAT_MODELS = frozenset({Z_IMAGE_TURBO_MODEL})

# Map Wan-style "WxH" to Gemini/OpenRouter-style aspect_ratio when using image_config.
_WAN_SIZE_TO_ASPECT_RATIO: Dict[str, str] = {
    "1280*1280": "1:1",
    "1024*1024": "1:1",
    "832*1248": "2:3",
    "1248*832": "3:2",
    "864*1184": "3:4",
    "1184*864": "4:3",
    "896*1152": "4:5",
    "1152*896": "5:4",
    "768*1344": "9:16",
    "1344*768": "16:9",
    "1536*672": "21:9",
}


def _chat_completion_response_to_dict(response: Any) -> Dict[str, Any]:
    """
    Normalize OpenAI chat.completion return value to a dict.
    Some gateways return raw JSON strings or objects without model_dump().
    """
    if isinstance(response, dict):
        return response
    if isinstance(response, str):
        raw = response.strip()
        if not raw:
            raise RuntimeError(
                "Chat completion returned an empty response. Check IMAGE_OPENAI_BASE_URL "
                "(often must be https://host/v1), API key, model id, and that the gateway returns JSON."
            )
        try:
            parsed: Any = json.loads(raw)
        except json.JSONDecodeError:
            # Some proxies return plain text (URL, markdown, or one-line body) instead of JSON.
            return {"choices": [{"message": {"content": raw}}]}
        if not isinstance(parsed, dict):
            raise RuntimeError(f"Chat completion JSON must be an object, got {type(parsed)}")
        return parsed
    model_dump = getattr(response, "model_dump", None)
    if callable(model_dump):
        return model_dump()
    dict_fn = getattr(response, "dict", None)
    if callable(dict_fn):
        return dict_fn()
    raise RuntimeError(
        f"Unexpected chat completion response type {type(response)}; "
        "expected dict, JSON str, or object with model_dump()/dict()."
    )


class ImageGenModel(ABC):
    """Abstract base class for image generation models."""
    
    def __init__(self, config: Dict[str, Any]):
        self.config = config

    @abstractmethod
    def generate(self, prompt: str, output_path: str, **kwargs) -> Tuple[str, float]:
        """
        Generates an image from a prompt.
        
        Args:
            prompt: The input text prompt.
            output_path: The path to save the generated image.
            **kwargs: Additional arguments.
            
        Returns:
            A tuple containing:
            - The path to the generated image file.
            - The duration of the API generation process in seconds.
        """
        pass

class WanxImageModel(ImageGenModel):
    def __init__(self, config):
        super().__init__(config)
        self.params = config.get('params', {})

    @property
    def api_key(self):
        api_key = os.getenv("DASHSCOPE_API_KEY")
        if not api_key:
            logger.warning("Dashscope API Key not found in config or environment variables.")
        return api_key

    def generate(self, prompt: str, output_path: str, ref_image_path: str = None, ref_image_paths: list = None, model_name: str = None, **kwargs) -> Tuple[str, float]:
        # Determine model based on whether reference image is provided
        # Support both single path (legacy) and list of paths
        dashscope.api_key = self.api_key

        all_ref_paths = []
        if ref_image_path:
            all_ref_paths.append(ref_image_path)
        if ref_image_paths:
            all_ref_paths.extend(ref_image_paths)
            
        # Remove duplicates
        all_ref_paths = list(set(all_ref_paths))
        # Model selection priority: explicit model_name > config params > defaults
        if model_name:
            final_model_name = model_name
        elif all_ref_paths:
            # For I2I, use i2i_model_name if configured, otherwise default to wan2.5-i2i-preview
            final_model_name = self.params.get('i2i_model_name', 'wan2.5-i2i-preview')
        else:
            # For T2I, use model_name if configured, otherwise default to wan2.6-t2i
            final_model_name = self.params.get('model_name', 'wan2.6-t2i')

        if all_ref_paths:
            logger.info(f"Using I2I model: {final_model_name} with {len(all_ref_paths)} reference images")
        else:
            logger.info(f"Using T2I model: {final_model_name}")

        size = kwargs.pop('size', self.params.get('size', '1280*1280'))
        n = kwargs.pop('n', self.params.get('n', 1))
        negative_prompt = kwargs.pop('negative_prompt', None)
        # model_name is already handled above, remove from kwargs if present
        kwargs.pop('model_name', None)
        
        # Determine reference image limit based on model
        if final_model_name in IMAGE_GENERATIONS_OPENAI_COMPAT_MODELS and all_ref_paths:
            ref_limit = 1
        elif final_model_name in ("wan2.6-image", *IMAGE_CHAT_OPENAI_COMPAT_MODELS):
            ref_limit = 4
        else:
            ref_limit = 3
        if len(all_ref_paths) > ref_limit:
            logger.warning(f"Limiting reference images from {len(all_ref_paths)} to {ref_limit} for model {final_model_name}")
            all_ref_paths = all_ref_paths[:ref_limit]
        
        logger.info(f"Starting image generation...")
        logger.info(f"Prompt: {prompt}")
        logger.info(f"Model: {final_model_name}, Size: {size}, N: {n}")

        try:
            api_start_time = time.time()
            # OpenAI-compatible POST /v1/images/generations (T2I; I2I adds ref image in JSON if refs present)
            if final_model_name in IMAGE_GENERATIONS_OPENAI_COMPAT_MODELS:
                image_url = self._generate_openai_images_generations(
                    prompt,
                    size,
                    negative_prompt,
                    final_model_name,
                    n,
                    ref_image_paths=all_ref_paths if all_ref_paths else None,
                )
            # OpenAI-compatible chat image (separate env from LLM / DashScope)
            elif final_model_name in IMAGE_CHAT_OPENAI_COMPAT_MODELS:
                api_model_name = None
                if final_model_name == SEEDREAM_30_IMAGE_MODEL and all_ref_paths:
                    api_model_name = SEEDREAM_30_I2I_UPSTREAM_MODEL
                image_url = self._generate_openai_compatible_chat_image(
                    prompt,
                    size,
                    negative_prompt,
                    final_model_name,
                    ref_image_paths=all_ref_paths if all_ref_paths else None,
                    api_model_name=api_model_name,
                )
            # Use HTTP API for wan2.6 models (SDK not supported yet)
            elif final_model_name == 'wan2.6-t2i':
                image_url = self._generate_wan26_http(prompt, size, n, negative_prompt)
            elif final_model_name == 'wan2.6-image':
                # wan2.6-image for I2I (requires reference images)
                image_url = self._generate_wan26_image_http(prompt, size, n, negative_prompt, all_ref_paths)
            else:
                # Use SDK for other models
                image_url = self._generate_sdk(prompt, final_model_name, size, n, negative_prompt, all_ref_paths,
                                               kwargs)

            api_end_time = time.time()
            api_duration = api_end_time - api_start_time

            logger.info(f"Generation success. Image URL: {image_url}")
            logger.info(f"API duration: {api_duration:.2f}s")
            
            # Download image
            self._download_image(image_url, output_path)
            return output_path, api_duration

        except Exception as e:
            import traceback
            logger.error(f"Error during generation: {e}")
            logger.error(traceback.format_exc())
            raise

    def _image_openai_base_url(self) -> Optional[str]:
        return os.getenv("IMAGE_OPENAI_BASE_URL") or os.getenv("KONGYANG_BASE_URL")

    def _image_openai_api_key(self) -> Optional[str]:
        return os.getenv("IMAGE_OPENAI_API_KEY")

    def _wan_size_to_openai_images_size(self, size: str) -> str:
        """
        Map Wan-style `WxH` (or `WxH` with x) to OpenAI Images API `1024x1024` / `1792x1024` / `1024x1792`.
        Unknown sizes default to square.
        """
        if not size:
            return "1024x1024"
        s = size.strip().lower().replace("*", "x")
        if s in ("1024x1024", "1792x1024", "1024x1792"):
            return s
        if "x" not in s:
            return "1024x1024"
        parts = s.split("x", 1)
        try:
            w, h = int(parts[0].strip()), int(parts[1].strip())
        except (ValueError, IndexError):
            return "1024x1024"
        if w <= 0 or h <= 0:
            return "1024x1024"
        r = w / h
        if r >= 1.25:
            return "1792x1024"
        if r <= 0.8:
            return "1024x1792"
        return "1024x1024"

    def _openai_images_generations_response_to_image_url(self, data: Dict[str, Any]) -> str:
        items = data.get("data")
        if not isinstance(items, list) or not items:
            raise RuntimeError(f"No image data in images/generations response: {data!r}")
        first = items[0]
        if not isinstance(first, dict):
            raise RuntimeError(f"Unexpected images/generations data[0] type: {type(first)}")
        url = first.get("url")
        if isinstance(url, str) and url.strip():
            return url.strip()
        b64 = first.get("b64_json") or first.get("base64")
        if isinstance(b64, str) and b64.strip():
            return f"data:image/png;base64,{b64.strip()}"
        raise RuntimeError(f"images/generations item has no url or b64_json: {first!r}")

    def _generate_openai_images_generations(
        self,
        prompt: str,
        size: str,
        negative_prompt: Optional[str],
        final_model_name: str,
        n: int,
        ref_image_paths: Optional[List[str]] = None,
    ) -> str:
        base_url = self._image_openai_base_url()
        api_key = self._image_openai_api_key()
        if not base_url or not api_key:
            raise RuntimeError(
                "OpenAI-compatible images/generations requires IMAGE_OPENAI_BASE_URL "
                "(or KONGYANG_BASE_URL) and IMAGE_OPENAI_API_KEY."
            )
        full_prompt = (prompt or "").strip()
        if negative_prompt and str(negative_prompt).strip():
            full_prompt = f"{full_prompt}\n\nNegative prompt: {str(negative_prompt).strip()}"
        openai_size = self._wan_size_to_openai_images_size(size)
        try:
            nn = int(n) if n is not None else 1
        except (TypeError, ValueError):
            nn = 1
        nn = max(1, min(nn, 4))
        body: Dict[str, Any] = {
            "model": final_model_name,
            "prompt": full_prompt,
            "n": nn,
            "size": openai_size,
            "response_format": "url",
        }
        if ref_image_paths:
            ref_field = (os.getenv("IMAGE_GENERATIONS_REF_IMAGE_FIELD") or "image").strip() or "image"
            ref_mode = (os.getenv("IMAGE_GENERATIONS_REF_IMAGE_MODE") or "base64").strip().lower()
            image_bytes, _fname, mime = self._load_reference_image_bytes_for_openai_post(
                ref_image_paths[0], model_name=final_model_name
            )
            if ref_mode in ("url", "image_url"):
                resolved = self._resolve_wan26_reference_image(
                    ref_image_paths[0], model_name=final_model_name
                )
                if not resolved or not (
                    resolved.startswith("http://") or resolved.startswith("https://")
                ):
                    raise RuntimeError(
                        "IMAGE_GENERATIONS_REF_IMAGE_MODE=url requires the first reference "
                        "to resolve to an http(s) URL (signed OSS URL, etc.)."
                    )
                url_field = (os.getenv("IMAGE_GENERATIONS_REF_IMAGE_URL_FIELD") or ref_field).strip() or ref_field
                body[url_field] = resolved
            elif ref_mode in ("data_uri", "data-url", "datauri"):
                b64 = base64.b64encode(image_bytes).decode("ascii")
                body[ref_field] = f"data:{mime};base64,{b64}"
            else:
                # default: raw base64 string (common on OpenAI-compatible JSON gateways)
                body[ref_field] = base64.b64encode(image_bytes).decode("ascii")
            logger.info(
                "OpenAI images/generations I2I: attaching reference in JSON field %r (mode=%s)",
                ref_field,
                ref_mode,
            )

        post_url = base_url.rstrip("/") + "/images/generations"
        log_suffix = " +1 ref" if ref_image_paths else ""
        logger.info(
            "Calling OpenAI-compatible images/generations (%s, size=%s%s)...",
            final_model_name,
            openai_size,
            log_suffix,
        )
        log_generation_model("image", final_model_name, f"endpoint=images/generations size={openai_size}")
        r = requests.post(
            post_url,
            headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
            json=body,
            timeout=300,
        )
        if not r.ok:
            raise RuntimeError(f"images/generations HTTP {r.status_code}: {r.text[:800]}")
        try:
            payload = r.json()
        except json.JSONDecodeError as e:
            raise RuntimeError(f"images/generations returned non-JSON: {r.text[:500]}") from e
        if not isinstance(payload, dict):
            raise RuntimeError(f"images/generations JSON must be an object, got {type(payload)}")
        return self._openai_images_generations_response_to_image_url(payload)

    def _load_reference_image_bytes_for_openai_post(
        self, path: str, model_name: str
    ) -> Tuple[bytes, str, str]:
        """
        Resolve a reference path to raw bytes for OpenAI-compatible image APIs.
        Returns (image_bytes, filename, content_type).
        """
        resolved = self._resolve_wan26_reference_image(path, model_name=model_name)
        if not resolved:
            raise RuntimeError(f"Could not resolve reference image for OpenAI images API: {path}")

        if resolved.startswith("data:"):
            try:
                header, b64_part = resolved.split(",", 1)
            except ValueError as e:
                raise RuntimeError(f"Malformed data URI for reference image: {path}") from e
            mime = "image/png"
            if header.startswith("data:") and ";" in header[5:]:
                mime_candidate = header[5:].split(";", 1)[0].strip()
                if mime_candidate:
                    mime = mime_candidate
            try:
                raw = base64.b64decode(b64_part, validate=False)
            except Exception as e:
                raise RuntimeError(f"Invalid base64 in data URI for reference image: {path}") from e
            ext = mimetypes.guess_extension(mime) or ".png"
            return raw, f"reference{ext}", mime

        if resolved.startswith("http://") or resolved.startswith("https://"):
            r = requests.get(resolved, timeout=120)
            if not r.ok:
                raise RuntimeError(
                    f"Failed to download reference image ({r.status_code}): {resolved[:120]}..."
                )
            ctype = (r.headers.get("Content-Type") or "").split(";")[0].strip() or "image/png"
            ext = mimetypes.guess_extension(ctype) or ".png"
            return r.content, f"reference{ext}", ctype

        if os.path.isfile(resolved):
            mime, _ = mimetypes.guess_type(resolved)
            mime = mime or "image/png"
            ext = mimetypes.guess_extension(mime) or os.path.splitext(resolved)[1] or ".png"
            with open(resolved, "rb") as f:
                return f.read(), os.path.basename(resolved) or f"reference{ext}", mime

        if os.path.isfile(path):
            mime, _ = mimetypes.guess_type(path)
            mime = mime or "image/png"
            with open(path, "rb") as f:
                return f.read(), os.path.basename(path) or "reference.png", mime

        raise RuntimeError(
            f"Reference image is not a downloadable URL, data URI, or local file: {path!r} "
            f"(resolved={resolved!r})"
        )

    def _wan_size_to_gemini_image_config(self, size: str) -> Optional[Dict[str, Any]]:
        """Map Wan `WxH` size string to gateway image_config (aspect_ratio), if known."""
        if not size:
            return None
        ar = _WAN_SIZE_TO_ASPECT_RATIO.get(size.strip())
        if ar:
            return {"aspect_ratio": ar}
        if "*" in size:
            try:
                w_str, h_str = size.split("*", 1)[:2]
                w, h = int(w_str.strip()), int(h_str.strip())
                if w > 0 and h > 0:
                    # Approximate nearest named ratio (simple float compare)
                    r = w / h
                    candidates = [
                        (1.0, "1:1"),
                        (2 / 3, "2:3"),
                        (3 / 2, "3:2"),
                        (3 / 4, "3:4"),
                        (4 / 3, "4:3"),
                        (4 / 5, "4:5"),
                        (5 / 4, "5:4"),
                        (9 / 16, "9:16"),
                        (16 / 9, "16:9"),
                        (21 / 9, "21:9"),
                    ]
                    best = min(candidates, key=lambda ch: abs(ch[0] - r))
                    return {"aspect_ratio": best[1]}
            except (ValueError, ZeroDivisionError):
                pass
        return None

    def _generate_openai_compatible_chat_image(
        self,
        prompt: str,
        size: str,
        negative_prompt: Optional[str],
        final_model_name: str,
        ref_image_paths: Optional[List[str]] = None,
        *,
        api_model_name: Optional[str] = None,
    ) -> str:
        """
        Text-to-image or image-to-image via OpenAI-compatible POST /chat/completions.
        Expects IMAGE_OPENAI_BASE_URL (or KONGYANG_BASE_URL) and IMAGE_OPENAI_API_KEY.
        With ref_image_paths, sends multimodal user content (image_url parts + text).
        Returns an http(s) URL or a data: URI for _download_image / _write_data_uri_to_path.

        final_model_name: logical/UI model id (routing, ref resolution).
        api_model_name: if set, sent as `model` to the API (e.g. Seedream I2I upstream id).
        """
        api_model = (api_model_name or final_model_name).strip()
        base_url = self._image_openai_base_url()
        api_key = self._image_openai_api_key()
        if not base_url or not api_key:
            raise RuntimeError(
                "Gemini image generation requires IMAGE_OPENAI_BASE_URL (or KONGYANG_BASE_URL) "
                "and IMAGE_OPENAI_API_KEY (kept separate from OPENAI_* LLM settings)."
            )

        user_text = prompt
        if negative_prompt:
            user_text = f"{prompt}\n\nNegative prompt: {negative_prompt}"

        image_cfg = self._wan_size_to_gemini_image_config(size)
        extra_body: Dict[str, Any] = {
            "modalities": ["image", "text"],
        }
        if image_cfg:
            extra_body["image_config"] = image_cfg

        from openai import OpenAI

        client = OpenAI(
            api_key=api_key,
            base_url=base_url.rstrip("/"),
            timeout=300.0,
            max_retries=2,
        )

        if ref_image_paths:
            content_parts: List[Dict[str, Any]] = []
            for path in ref_image_paths:
                resolved = self._resolve_wan26_reference_image(path, model_name=final_model_name)
                if resolved:
                    content_parts.append({"type": "image_url", "image_url": {"url": resolved}})
            if not content_parts:
                raise RuntimeError(
                    "Gemini I2I requires at least one resolvable reference image "
                    "(OSS URL, https URL, or local file path)."
                )
            content_parts.append({"type": "text", "text": user_text})
            messages = [{"role": "user", "content": content_parts}]
            logger.info(
                "Calling OpenAI-compatible chat completions for image editing (I2I) with %s reference(s)...",
                len(content_parts) - 1,
            )
        else:
            messages = [{"role": "user", "content": user_text}]
            logger.info("Calling OpenAI-compatible chat completions for image generation...")

        payload = {
            "model": api_model,
            "messages": messages,
            **extra_body,
        }
        log_generation_model(
            "image",
            api_model,
            f"endpoint=chat/completions mode={'i2i' if ref_image_paths else 't2i'} routed_as={final_model_name}",
        )
        try:
            response = client.chat.completions.create(
                model=api_model,
                messages=messages,
                extra_body=extra_body,
            )
            data = _chat_completion_response_to_dict(response)
        except TypeError:
            # Older openai package without extra_body
            post_url = base_url.rstrip("/") + "/chat/completions"
            r = requests.post(
                post_url,
                headers={
                    "Authorization": f"Bearer {api_key}",
                    "Content-Type": "application/json",
                },
                json=payload,
                timeout=300,
            )
            r.raise_for_status()
            data = r.json()
        fr = (data.get("choices") or [{}])[0].get("finish_reason")
        if fr == "content_filter":
            raise RuntimeError("Image generation was blocked by content policy (finish_reason=content_filter).")

        return self._parse_openai_chat_image_response(data)

    def _parse_openai_chat_image_response(self, data: Dict[str, Any]) -> str:
        """Extract first image as URL or data: URI from chat.completion JSON."""
        choices = data.get("choices") or []
        if not choices:
            raise RuntimeError(f"No choices in chat completion: {data}")

        msg = choices[0].get("message") or {}
        images = msg.get("images")
        if isinstance(images, list):
            for img in images:
                if not isinstance(img, dict):
                    continue
                iu = img.get("image_url") or {}
                if isinstance(iu, dict):
                    url = iu.get("url")
                    if url:
                        return url

        content = msg.get("content")
        if isinstance(content, list):
            # Multimodal segments (e.g. type image_url)
            for part in content:
                if not isinstance(part, dict):
                    continue
                if part.get("type") == "image_url":
                    iu = part.get("image_url") or {}
                    if isinstance(iu, dict) and iu.get("url"):
                        return iu["url"]
                inline = part.get("inline_data") or part.get("inlineData")
                if isinstance(inline, dict) and inline.get("data"):
                    mime = inline.get("mime_type") or inline.get("mimeType") or "image/png"
                    b64 = inline["data"]
                    return f"data:{mime};base64,{b64}"

        if isinstance(content, str) and content.strip():
            return self._extract_image_url_or_data_uri_from_text(content)

        raise RuntimeError("Could not extract image URL or base64 from chat completion response.")

    def _extract_image_url_or_data_uri_from_text(self, text: str) -> str:
        """Handle Markdown image, plain https URL, or raw data: URI in assistant text."""
        m = re.search(r"!\[[^\]]*\]\((data:image/[^)]+)\)", text)
        if m:
            return m.group(1).strip()
        m = re.search(r"!\[[^\]]*\]\((https?://[^)\s]+)\)", text)
        if m:
            return m.group(1).strip()
        m = re.search(r"(data:image/[\w.+-]+;base64,[A-Za-z0-9+/=\s]+)", text)
        if m:
            return re.sub(r"\s+", "", m.group(1))
        m = re.search(r"(https?://[^\s<>\"']+\.(?:png|jpg|jpeg|webp)(?:\?[^\s<>\"']*)?)", text, re.I)
        if m:
            return m.group(1)
        raise RuntimeError("Assistant message had no recognizable image URL or data URI in content.")

    def _write_data_uri_to_path(self, data_uri: str, output_path: str) -> None:
        m = re.match(r"data:(image/[\w.+-]+);base64,(.+)", data_uri, re.DOTALL)
        if not m:
            raise ValueError(f"Unsupported data URI prefix: {data_uri[:80]}...")
        b64 = re.sub(r"\s+", "", m.group(2))
        raw = base64.b64decode(b64)
        os.makedirs(os.path.dirname(output_path) or ".", exist_ok=True)
        temp_path = output_path + ".tmp"
        with open(temp_path, "wb") as f:
            f.write(raw)
        os.rename(temp_path, output_path)

    def _generate_wan26_http(self, prompt: str, size: str, n: int, negative_prompt: str = None) -> str:
        """Generate image using Wan 2.6 T2I via HTTP API (synchronous)."""
        base = get_provider_base_url("DASHSCOPE")
        url = f"{base}/api/v1/services/aigc/multimodal-generation/generation"
        
        headers = {
            "Content-Type": "application/json",
            "Authorization": f"Bearer {self.api_key}"
        }
        
        payload = {
            "model": "wan2.6-t2i",
            "input": {
                "messages": [
                    {
                        "role": "user",
                        "content": [
                            {
                                "text": prompt
                            }
                        ]
                    }
                ]
            },
            "parameters": {
                "prompt_extend": False,  # Disable auto prompt rewriting for consistency
                "watermark": False,
                "n": n,
                "size": size
            }
        }
        
        # Add negative_prompt if provided
        if negative_prompt:
            payload["parameters"]["negative_prompt"] = negative_prompt
        
        logger.info(f"Calling Wan 2.6 T2I HTTP API...")
        logger.info(f"Payload: {payload}")
        log_generation_model("image", "wan2.6-t2i", "endpoint=dashscope multimodal-generation")
        response = requests.post(url, headers=headers, json=payload, timeout=300)  # 5 minutes for slow API responses
        
        logger.info(f"Response status: {response.status_code}")
        logger.info(f"Response body: {response.text[:500]}...")
        
        if response.status_code != 200:
            error_data = response.json() if response.text else {}
            error_msg = error_data.get('message', response.text)
            raise RuntimeError(f"Wan 2.6 API failed: {error_msg}")
        
        result = response.json()
        
        # Extract image URL from response
        # Response format: output.choices[].message.content[].image
        choices = result.get('output', {}).get('choices', [])
        if not choices:
            raise RuntimeError(f"No choices in response: {result}")
        
        # Get first image from first choice
        first_choice = choices[0]
        content = first_choice.get('message', {}).get('content', [])
        if not content:
            raise RuntimeError(f"No content in choice: {first_choice}")
        
        image_url = content[0].get('image')
        if not image_url:
            raise RuntimeError(f"No image URL in content: {content}")
        
        return image_url

    def _generate_wan26_image_http(self, prompt: str, size: str, n: int, negative_prompt: str = None, ref_image_paths: list = None) -> str:
        """Generate image using Wan 2.6 Image via HTTP API (asynchronous with polling)."""
        base = get_provider_base_url("DASHSCOPE")
        create_url = f"{base}/api/v1/services/aigc/image-generation/generation"
        
        headers = {
            "Content-Type": "application/json",
            "Authorization": f"Bearer {self.api_key}",
            "X-DashScope-Async": "enable"  # Required for async mode
        }
        
        # Build content array with reference images and prompt text
        content = []
        
        # Add reference images (upload to OSS first if local paths)
        if ref_image_paths:
            # Limit is already handled in generate(), but we keep a safety slice here
            # This method is specifically for wan2.6-image which supports 4 images
            ref_limit = 4
            for path in ref_image_paths[:ref_limit]:
                image_input = self._resolve_wan26_reference_image(path)
                if image_input:
                    content.append({"image": image_input})

        if ref_image_paths and not content:
            raise RuntimeError(
                "Wan 2.6 Image requires at least one usable reference image. "
                "Please provide a valid local image, public URL, or configure OSS."
            )

        content.append({"text": prompt})
        
        payload = {
            "model": "wan2.6-image",
            "input": {
                "messages": [
                    {
                        "role": "user",
                        "content": content
                    }
                ]
            },
            "parameters": {
                "prompt_extend": False,  # Disable auto prompt rewriting for consistency
                "watermark": False,
                "n": n,
                "size": size,
                "enable_interleave": False  # Image editing mode (I2I)
            }
        }
        
        # Add negative_prompt if provided
        if negative_prompt:
            payload["parameters"]["negative_prompt"] = negative_prompt
        
        logger.info(f"Calling Wan 2.6 Image HTTP API (async)...")
        logger.info(f"Payload: {payload}")
        log_generation_model("image", "wan2.6-image", "endpoint=dashscope image-generation async")
        # Step 1: Create task
        response = requests.post(create_url, headers=headers, json=payload, timeout=120)  # 2 minutes for task creation
        
        logger.info(f"Create task response status: {response.status_code}")
        logger.info(f"Create task response body: {response.text[:500]}")
        
        if response.status_code != 200:
            error_data = response.json() if response.text else {}
            error_msg = error_data.get('message', response.text)
            raise RuntimeError(f"Wan 2.6 Image task creation failed: {error_msg}")
        
        result = response.json()
        task_id = result.get('output', {}).get('task_id')
        if not task_id:
            raise RuntimeError(f"No task_id in response: {result}")
        
        logger.info(f"Task created: {task_id}")
        
        # Step 2: Poll for task completion
        poll_url = f"{base}/api/v1/tasks/{task_id}"
        poll_headers = {
            "Authorization": f"Bearer {self.api_key}"
        }
        
        max_wait_time = 600  # 10 minutes max wait (I2I can take longer)
        poll_interval = 10   # Poll every 10 seconds
        elapsed = 0
        
        while elapsed < max_wait_time:
            time.sleep(poll_interval)
            elapsed += poll_interval
            
            poll_response = requests.get(poll_url, headers=poll_headers, timeout=30)
            
            if poll_response.status_code != 200:
                logger.warning(f"Poll request failed: {poll_response.status_code}")
                continue
            
            poll_result = poll_response.json()
            task_status = poll_result.get('output', {}).get('task_status')
            
            logger.info(f"Task {task_id} status: {task_status} (elapsed: {elapsed}s)")
            
            if task_status == 'SUCCEEDED':
                # Extract image URL from choices
                choices = poll_result.get('output', {}).get('choices', [])
                if not choices:
                    raise RuntimeError(f"No choices in completed task: {poll_result}")
                
                first_choice = choices[0]
                content = first_choice.get('message', {}).get('content', [])
                if not content:
                    raise RuntimeError(f"No content in choice: {first_choice}")
                
                image_url = content[0].get('image')
                if not image_url:
                    raise RuntimeError(f"No image URL in content: {content}")
                
                logger.info(f"Task completed. Image URL: {image_url}")
                return image_url
            
            elif task_status == 'FAILED':
                # Log full response for debugging
                logger.error(f"Task {task_id} failed. Full response: {poll_result}")
                
                # Try to extract error message from various possible fields
                error_msg = (
                    poll_result.get('output', {}).get('message', '') or
                    poll_result.get('output', {}).get('code', '') or
                    poll_result.get('message', '') or
                    poll_result.get('code', '') or
                    'Unknown error - check logs for full response'
                )
                
                raise RuntimeError(f"Wan 2.6 Image task failed: {error_msg}")

            
            elif task_status in ['CANCELED', 'UNKNOWN']:
                raise RuntimeError(f"Wan 2.6 Image task {task_status}: {poll_result}")
            
            # PENDING or RUNNING - continue polling
        
        raise RuntimeError(f"Wan 2.6 Image task timed out after {max_wait_time}s")

    def _resolve_wan26_reference_image(self, path: str, model_name: str = "wan2.6-image") -> str:
        uploader = OSSImageUploader()
        backend = self._resolve_provider_backend_for_model(model_name)

        try:
            resolved = resolve_media_input(
                path,
                model_name=model_name,
                modality="image",
                backend=backend,
                uploader=uploader,
            )
            return resolved.value
        except ValueError as e:
            ref_type = classify_media_ref(path)
            if ref_type == MEDIA_REF_UNKNOWN and os.path.isabs(path) and os.path.exists(path):
                # Compatibility fallback: only for legacy absolute local paths
                # outside managed `output/` media refs.
                if uploader.is_configured:
                    object_key = uploader.upload_file(path, sub_path="temp/ref_images")
                    if object_key:
                        signed_url = uploader.sign_url_for_api(object_key)
                        if signed_url:
                            return signed_url

                return self._encode_local_image_as_data_uri(path)

            logger.warning(f"Reference image could not be resolved: {path}, reason: {e}")
            return None

    def _resolve_provider_backend_for_model(self, model_name: str) -> str:
        try:
            return resolve_provider_backend(model_name)
        except (KeyError, ValueError):
            # Keep image flows resilient for models not yet registered.
            return "dashscope"
        except Exception as e:
            logger.warning(
                f"Unexpected error resolving provider backend for model {model_name}: {e}. "
                "Falling back to dashscope."
            )
            return "dashscope"

    def _encode_local_image_as_data_uri(self, path: str) -> str:
        mime_type, _ = mimetypes.guess_type(path)
        if not mime_type:
            mime_type = "image/png"

        with open(path, "rb") as image_file:
            encoded = base64.b64encode(image_file.read()).decode("ascii")

        return f"data:{mime_type};base64,{encoded}"

    def _generate_sdk(self, prompt: str, model_name: str, size: str, n: int, negative_prompt: str, all_ref_paths: list, kwargs: dict) -> str:
        """Generate image using Dashscope SDK (for older models)."""
        call_args = {
            "model": model_name,
            "prompt": prompt,
            "n": n,
            "size": size,
        }
        
        # Add negative_prompt if provided
        if negative_prompt:
            call_args["negative_prompt"] = negative_prompt
        
        # Add remaining kwargs
        call_args.update(kwargs)
        
        logger.info(f"SDK call_args: {dict((k, v) for k, v in call_args.items() if k != 'images')}")
        # Model selection priority: explicit model_name > config params > defaults

        # Handle Reference Images for I2I
        if all_ref_paths:
            ref_image_urls = []
            uploader = OSSImageUploader()
            for path in all_ref_paths:
                if os.path.exists(path):
                    # Upload to OSS and get signed URL
                    if uploader.is_configured:
                        object_key = uploader.upload_file(path, sub_path="temp/ref_images")
                        if object_key:
                            signed_url = uploader.sign_url_for_api(object_key)
                            ref_image_urls.append(signed_url)
                            logger.info(f"Reference image uploaded, signed URL: {signed_url[:80]}...")
                        else:
                            raise RuntimeError(f"Failed to upload reference image to OSS: {path}")
                    else:
                        logger.warning(f"OSS not configured, cannot upload reference image: {path}")
                elif path.startswith("http"):
                    # Already a URL
                    ref_image_urls.append(path)
                else:
                    # Check if it's an OSS Object Key using the utility function
                    from ..utils.oss_utils import is_object_key
                    if is_object_key(path):
                        if uploader.is_configured:
                            signed_url = uploader.sign_url_for_api(path)
                            ref_image_urls.append(signed_url)
                            logger.info(f"Reference image (Object Key), signed URL: {signed_url[:80]}...")
                        else:
                            raise ValueError(f"OSS not configured but Object Key provided: {path}")
                    else:
                        raise ValueError(f"Reference image not found: {path}")
            
            logger.info(f"DEBUG: ref_image_urls count: {len(ref_image_urls)}")
            
            # Limit is already handled in generate(), but we keep a safety slice here
            ref_limit = 4 if model_name == 'wan2.6-image' else 3
            if len(ref_image_urls) > ref_limit:
                logger.warning(f"Limiting reference images from {len(ref_image_urls)} to {ref_limit}")
                ref_image_urls = ref_image_urls[:ref_limit]
            
            call_args['images'] = ref_image_urls

        # Call Dashscope SDK
        log_generation_model("image", model_name, "endpoint=dashscope ImageSynthesis SDK")
        rsp = ImageSynthesis.call(**call_args)
        
        logger.info(f"SDK response: {rsp}")

        if rsp.status_code != HTTPStatus.OK:
            logger.error(f"Task failed with status code: {rsp.status_code}, code: {rsp.code}, message: {rsp.message}")
            raise RuntimeError(f"Task failed: {rsp.message}")

        # Extract Image URL
        if hasattr(rsp, 'output'):
            logger.info(f"Response Output: {rsp.output}")
            results = rsp.output.get('results')
            url = rsp.output.get('url')
            
            if results and len(results) > 0:
                 first_result = results[0]
                 if isinstance(first_result, dict):
                     image_url = first_result.get('url')
                 else:
                     image_url = getattr(first_result, 'url', None)
            elif url:
                 image_url = url
            else:
                 logger.error(f"Unexpected response structure. Output: {rsp.output}")
                 raise RuntimeError("Could not find image URL in response.")
        else:
             logger.error(f"Response has no output. Response: {rsp}")
             raise RuntimeError("Response has no output.")
        
        return image_url

    def _download_image(self, url: str, output_path: str):
        logger.info(f"Downloading image to {output_path}...")

        if url.startswith("data:"):
            self._write_data_uri_to_path(url, output_path)
            logger.info("Wrote image from data URI.")
            return

        # Setup retry strategy
        from requests.adapters import HTTPAdapter
        from requests.packages.urllib3.util.retry import Retry
        
        retry_strategy = Retry(
            total=5,
            backoff_factor=1,
            status_forcelist=[429, 500, 502, 503, 504],
            allowed_methods=["HEAD", "GET", "OPTIONS"]
        )
        adapter = HTTPAdapter(max_retries=retry_strategy)
        http = requests.Session()
        http.mount("https://", adapter)
        http.mount("http://", adapter)

        temp_path = output_path + ".tmp"
        try:
            response = http.get(url, stream=True, timeout=60, verify=False) # verify=False to avoid some SSL issues
            response.raise_for_status()
            
            # Ensure directory exists
            os.makedirs(os.path.dirname(output_path), exist_ok=True)
            
            with open(temp_path, 'wb') as f:
                for chunk in response.iter_content(chunk_size=8192):
                    f.write(chunk)
            
            # Atomic rename
            os.rename(temp_path, output_path)
            logger.info("Download complete.")
            
        except Exception as e:
            logger.error(f"Failed to download image: {e}")
            if os.path.exists(temp_path):
                os.remove(temp_path)
            raise
