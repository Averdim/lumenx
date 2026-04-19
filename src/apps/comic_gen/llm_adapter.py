"""
LLM Adapter - Unified interface for DashScope and OpenAI-compatible APIs.

Text LLM routing uses src.utils.llm_provider_registry (prefix → dashscope | openai_kongyang | openai_geeknow).
Legacy LLM_PROVIDER=openai maps to Kongyang (openai_kongyang) for unmatched model ids.

Configuration via environment variables:
  LLM_PROVIDER=dashscope|openai   (openai → Kongyang fallback for unknown model ids)
  DASHSCOPE_API_KEY=...
  OPENAI_KONGYANG_API_KEY / OPENAI_KONGYANG_BASE_URL (preferred for 空氧)
  Legacy OPENAI_API_KEY / OPENAI_BASE_URL still used for openai_kongyang if KONGYANG_* unset
  OPENAI_GEEKNOW_API_KEY / OPENAI_GEEKNOW_BASE_URL (llm_backend=openai_geeknow)
  OPENAI_MODEL=gpt-5.2
"""
from __future__ import annotations

import os
import logging
from typing import Any, Dict, List, Optional, Tuple

from ...utils import log_generation_model
from ...utils.llm_provider_registry import (
    LLM_BACKEND_OVERRIDE_VALUES,
    get_llm_credentials,
    llm_backend_primary_key_env,
    resolve_llm_backend,
    strip_llm_gateway_route_suffix,
)

logger = logging.getLogger(__name__)


def _normalize_llm_backend_override(raw: Optional[str]) -> Optional[str]:
    """None / auto / '' → None (use registry + fallback). Legacy 'openai' → openai_kongyang."""
    if raw is None:
        return None
    s = str(raw).strip().lower()
    if s == "openai":
        s = "openai_kongyang"
    if not s or s == "auto":
        return None
    if s in LLM_BACKEND_OVERRIDE_VALUES:
        return s
    return None


class LLMAdapter:
    """Unified LLM call interface supporting DashScope and OpenAI-compatible APIs."""

    def __init__(self):
        self._legacy_provider = os.getenv("LLM_PROVIDER", "dashscope").lower()
        self._client_cache: Dict[Tuple[str, str], Any] = {}
        logger.info(
            "LLM Adapter initialized (legacy LLM_PROVIDER=%s; routing uses registry + fallback)",
            self._legacy_provider,
        )

    @property
    def is_configured(self) -> bool:
        return bool(
            os.getenv("DASHSCOPE_API_KEY")
            or os.getenv("OPENAI_API_KEY")
            or os.getenv("OPENAI_KONGYANG_API_KEY")
            or os.getenv("OPENAI_GEEKNOW_API_KEY")
        )

    @staticmethod
    def legacy_provider_label() -> str:
        return os.getenv("LLM_PROVIDER", "dashscope").lower()

    def _get_default_model(self) -> str:
        """Default model id string; routing uses registry on this value."""
        legacy = os.getenv("LLM_PROVIDER", "dashscope").lower()
        if legacy == "openai":
            return os.getenv("OPENAI_MODEL", "gpt-5.2")
        return os.getenv("LLM_DEFAULT_MODEL", "qwen3.5-plus")

    def effective_model(self, model: Optional[str]) -> str:
        """Model id actually sent to the API (explicit override or env default)."""
        return model or self._get_default_model()

    def _get_client(self, base_url: str, api_key: Optional[str]):
        """Lazy OpenAI-compatible client per (base_url, api_key)."""
        cache_key = (base_url, api_key or "")
        if cache_key not in self._client_cache:
            try:
                from openai import OpenAI
            except ImportError:
                raise RuntimeError(
                    "openai package not installed. Run: pip install openai>=1.0.0"
                )
            self._client_cache[cache_key] = OpenAI(
                api_key=api_key,
                base_url=base_url,
            )
        return self._client_cache[cache_key]

    def chat(
        self,
        messages: List[Dict[str, str]],
        model: Optional[str] = None,
        response_format: Optional[Dict[str, str]] = None,
        llm_backend: Optional[str] = None,
    ) -> str:
        """
        Send a chat completion request and return the response content.

        Args:
            messages: List of {"role": ..., "content": ...} dicts
            model: Model name override (uses provider default if None)
            response_format: Optional {"type": "json_object"} constraint
            llm_backend: auto | dashscope | openai_kongyang | openai_geeknow (override; auto uses registry)

        Returns:
            The assistant's response content as a string.

        Raises:
            RuntimeError: If the API call fails.
        """
        model_id = self.effective_model(model)
        override = _normalize_llm_backend_override(llm_backend)
        backend = resolve_llm_backend(model_id, llm_backend_override=override)
        try:
            api_key, base_url = get_llm_credentials(backend)
        except ValueError as e:
            raise RuntimeError(str(e)) from e
        if not api_key:
            need = llm_backend_primary_key_env(backend)
            raise RuntimeError(
                f"LLM backend is {backend!r} but {need} is not set. "
                "Configure keys or set llm_backend / model id so the registry picks a channel you have keys for."
            )

        client = self._get_client(base_url, api_key)

        upstream_model = strip_llm_gateway_route_suffix(model_id)
        kwargs: Dict[str, Any] = {
            "model": upstream_model,
            "messages": messages,
        }
        if response_format:
            kwargs["response_format"] = response_format

        try:
            logger.info(
                "[LLM] chat.completions.create model=%s upstream_model=%s resolved_backend=%s base_url=%s "
                "legacy_LLM_PROVIDER=%s",
                model_id,
                upstream_model,
                backend,
                base_url,
                self._legacy_provider,
            )
            log_generation_model(
                "llm",
                upstream_model,
                f"routed_as={model_id} backend={backend}",
            )
            response = client.chat.completions.create(**kwargs)
            return response.choices[0].message.content
        except Exception as e:
            label = (
                "DashScope"
                if backend == "dashscope"
                else "OpenAI-compatible"
            )
            raise RuntimeError(f"{label} API error: {e}") from e
