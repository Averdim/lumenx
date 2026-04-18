"""
Text/chat LLM routing: model id prefix → backend (dashscope vs openai-compatible).

Registry takes precedence over legacy LLM_PROVIDER when prefix matches.
Unmatched model ids fall back to LLM_PROVIDER then dashscope.

See .env.example for LLM_PROVIDER / OPENAI_* vs DASHSCOPE_API_KEY.
"""
from __future__ import annotations

import os
from typing import Mapping, Optional, Tuple

from .endpoints import get_provider_base_url
from .provider_registry import ProviderFamilyConfig, ProviderRegistry

DEFAULT_LLM_FAMILIES: Tuple[ProviderFamilyConfig, ...] = (
    # Longer prefixes first (same length order is stable for dict iteration; register distinct lengths).
    ProviderFamilyConfig(
        model_family="custom-",
        backend_default="openai",
        credential_sources={"openai": ("OPENAI_API_KEY",), "dashscope": ("DASHSCOPE_API_KEY",)},
        supported_modalities=("llm",),
    ),
    ProviderFamilyConfig(
        model_family="deepseek",
        backend_default="openai",
        credential_sources={"openai": ("OPENAI_API_KEY",), "dashscope": ("DASHSCOPE_API_KEY",)},
        supported_modalities=("llm",),
    ),
    ProviderFamilyConfig(
        model_family="gpt-",
        backend_default="openai",
        credential_sources={"openai": ("OPENAI_API_KEY",), "dashscope": ("DASHSCOPE_API_KEY",)},
        supported_modalities=("llm",),
    ),
    ProviderFamilyConfig(
        model_family="qwen",
        backend_default="dashscope",
        credential_sources={"dashscope": ("DASHSCOPE_API_KEY",), "openai": ("OPENAI_API_KEY",)},
        supported_modalities=("llm",),
    ),
    ProviderFamilyConfig(
        model_family="o3",
        backend_default="openai",
        credential_sources={"openai": ("OPENAI_API_KEY",), "dashscope": ("DASHSCOPE_API_KEY",)},
        supported_modalities=("llm",),
    ),
    ProviderFamilyConfig(
        model_family="o1",
        backend_default="openai",
        credential_sources={"openai": ("OPENAI_API_KEY",), "dashscope": ("DASHSCOPE_API_KEY",)},
        supported_modalities=("llm",),
    ),
)

_llm_registry: Optional[ProviderRegistry] = None


def get_llm_provider_registry() -> ProviderRegistry:
    global _llm_registry
    if _llm_registry is None:
        _llm_registry = ProviderRegistry(DEFAULT_LLM_FAMILIES)
    return _llm_registry


def get_llm_chat_base_url(backend: str) -> str:
    """OpenAI-compatible chat base URL for text LLM (dashscope compatible-mode or custom gateway)."""
    b = (backend or "").strip().lower()
    if b == "openai":
        return (os.getenv("OPENAI_BASE_URL") or "https://api.openai.com/v1").rstrip("/")
    if b == "dashscope":
        return f"{get_provider_base_url('DASHSCOPE')}/compatible-mode/v1"
    raise ValueError(f"Unknown LLM backend: {backend!r}")


def resolve_llm_backend(
    model_name: str,
    env: Optional[Mapping[str, str]] = None,
    llm_backend_override: Optional[str] = None,
) -> str:
    """
    Resolve which credential channel to use for a chat model id.

    llm_backend_override: 'dashscope' | 'openai' forces routing; 'auto'/None/'' uses registry + fallback.
    """
    o = (llm_backend_override or "").strip().lower()
    if o in ("dashscope", "openai"):
        return o
    env_map = env if env is not None else os.environ
    normalized = (model_name or "").strip().lower()
    if not normalized:
        return _fallback_llm_backend(env_map)

    try:
        return get_llm_provider_registry().resolve_backend(model_name, env_map)
    except KeyError:
        return _fallback_llm_backend(env_map)


def _fallback_llm_backend(env_map: Mapping[str, str]) -> str:
    legacy = (env_map.get("LLM_PROVIDER") or "dashscope").strip().lower()
    if legacy == "openai":
        return "openai"
    return "dashscope"


def get_llm_credentials(backend: str) -> Tuple[str, str]:
    """Return (api_key, base_url) for the resolved backend."""
    b = (backend or "").strip().lower()
    if b == "dashscope":
        return (os.getenv("DASHSCOPE_API_KEY") or "", get_llm_chat_base_url("dashscope"))
    if b == "openai":
        return (os.getenv("OPENAI_API_KEY") or "", get_llm_chat_base_url("openai"))
    raise ValueError(f"Unknown LLM backend: {backend!r}")
