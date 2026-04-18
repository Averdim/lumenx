"""
LLM Adapter - Unified interface for DashScope and OpenAI-compatible APIs.

Text LLM routing uses src.utils.llm_provider_registry (model prefix → dashscope | openai).
Legacy LLM_PROVIDER applies when no registry prefix matches.

Configuration via environment variables:
  LLM_PROVIDER=dashscope|openai   (fallback only when model id unmatched)
  DASHSCOPE_API_KEY=...
  OPENAI_API_KEY=...
  OPENAI_BASE_URL=https://api.openai.com/v1
  OPENAI_MODEL=gpt-5.2
"""
from __future__ import annotations

import os
import logging
from typing import Any, Dict, List, Optional, Tuple

from ...utils.llm_provider_registry import (
    get_llm_credentials,
    resolve_llm_backend,
)

logger = logging.getLogger(__name__)


def _normalize_llm_backend_override(raw: Optional[str]) -> Optional[str]:
    """None / auto / '' → None (use registry + fallback)."""
    if raw is None:
        return None
    s = str(raw).strip().lower()
    if not s or s == "auto":
        return None
    if s in ("dashscope", "openai"):
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
        return bool(os.getenv("DASHSCOPE_API_KEY")) or bool(os.getenv("OPENAI_API_KEY"))

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
            llm_backend: auto | dashscope | openai (project override; auto uses registry)

        Returns:
            The assistant's response content as a string.

        Raises:
            RuntimeError: If the API call fails.
        """
        model_id = self.effective_model(model)
        override = _normalize_llm_backend_override(llm_backend)
        backend = resolve_llm_backend(model_id, llm_backend_override=override)
        api_key, base_url = get_llm_credentials(backend)
        if not api_key:
            need = "DASHSCOPE_API_KEY" if backend == "dashscope" else "OPENAI_API_KEY"
            raise RuntimeError(
                f"LLM backend is {backend!r} but {need} is not set. "
                "Configure keys or set llm_backend / model id so the registry picks a channel you have keys for."
            )

        client = self._get_client(base_url, api_key)

        kwargs: Dict[str, Any] = {
            "model": model_id,
            "messages": messages,
        }
        if response_format:
            kwargs["response_format"] = response_format

        try:
            logger.info(
                "[LLM] chat.completions.create model=%s resolved_backend=%s base_url=%s "
                "legacy_LLM_PROVIDER=%s",
                model_id,
                backend,
                base_url,
                self._legacy_provider,
            )
            response = client.chat.completions.create(**kwargs)
            return response.choices[0].message.content
        except Exception as e:
            label = "DashScope" if backend == "dashscope" else "OpenAI-compatible"
            raise RuntimeError(f"{label} API error: {e}") from e
