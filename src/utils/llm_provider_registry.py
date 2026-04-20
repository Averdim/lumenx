"""
Text/chat LLM routing: model id prefix → backend (dashscope vs openai-compatible).

Registry takes precedence over legacy LLM_PROVIDER when prefix matches.
gemini* → openai_kongyang (空氧). gpt-5.2-kongyang / gpt-5-2-geeknow → 对应网关（见 strip_llm_gateway_route_suffix）。
Unmatched model ids fall back to LLM_PROVIDER then dashscope.

See .env.example: text OpenAI-compatible uses openai_kongyang (OPENAI_KONGYANG_*; legacy OPENAI_* fallback)
or openai_geeknow (OPENAI_GEEKNOW_*), vs DASHSCOPE_API_KEY.
"""
from __future__ import annotations

import os
from typing import Mapping, Optional, Tuple

from .endpoints import get_provider_base_url
from .provider_registry import ProviderFamilyConfig, ProviderRegistry

# Forced llm_backend values (bypass prefix registry). Generic "openai" removed — use openai_kongyang / openai_geeknow.
LLM_BACKEND_OVERRIDE_VALUES = frozenset({"dashscope", "openai_kongyang", "openai_geeknow"})

# Suffixes on model id for UI routing only; stripped before chat.completions (upstream e.g. gpt-5.2 空氧 / gpt-5-2 GeekNow).
_LLM_GATEWAY_ROUTE_SUFFIXES: Tuple[str, ...] = ("-kongyang", "-geeknow")


def strip_llm_gateway_route_suffix(model_id: str) -> str:
    """Remove routing-only suffix so gateways receive the catalog model name (e.g. gpt-5.2 or gpt-5-2)."""
    s = (model_id or "").strip()
    low = s.lower()
    for suf in _LLM_GATEWAY_ROUTE_SUFFIXES:
        if low.endswith(suf):
            return s[: len(s) - len(suf)]
    return s


DEFAULT_LLM_FAMILIES: Tuple[ProviderFamilyConfig, ...] = (
    # Longer prefixes first (same length order is stable for dict iteration; register distinct lengths).
    ProviderFamilyConfig(
        model_family="gpt-5-2-geeknow",
        backend_default="openai_geeknow",
        credential_sources={
            "openai_geeknow": ("OPENAI_GEEKNOW_API_KEY",),
            "openai_kongyang": ("OPENAI_KONGYANG_API_KEY", "OPENAI_API_KEY"),
            "dashscope": ("DASHSCOPE_API_KEY",),
        },
        supported_modalities=("llm",),
    ),
    ProviderFamilyConfig(
        model_family="gpt-5.2-kongyang",
        backend_default="openai_kongyang",
        credential_sources={
            "openai_kongyang": ("OPENAI_KONGYANG_API_KEY", "OPENAI_API_KEY"),
            "openai_geeknow": ("OPENAI_GEEKNOW_API_KEY",),
            "dashscope": ("DASHSCOPE_API_KEY",),
        },
        supported_modalities=("llm",),
    ),
    ProviderFamilyConfig(
        model_family="custom-",
        backend_default="openai_kongyang",
        credential_sources={
            "openai_kongyang": ("OPENAI_KONGYANG_API_KEY", "OPENAI_API_KEY"),
            "dashscope": ("DASHSCOPE_API_KEY",),
        },
        supported_modalities=("llm",),
    ),
    ProviderFamilyConfig(
        model_family="deepseek",
        backend_default="openai_kongyang",
        credential_sources={
            "openai_kongyang": ("OPENAI_KONGYANG_API_KEY", "OPENAI_API_KEY"),
            "dashscope": ("DASHSCOPE_API_KEY",),
        },
        supported_modalities=("llm",),
    ),
    ProviderFamilyConfig(
        model_family="gpt-",
        backend_default="openai_kongyang",
        credential_sources={
            "openai_kongyang": ("OPENAI_KONGYANG_API_KEY", "OPENAI_API_KEY"),
            "dashscope": ("DASHSCOPE_API_KEY",),
        },
        supported_modalities=("llm",),
    ),
    ProviderFamilyConfig(
        model_family="gemini",
        backend_default="openai_kongyang",
        credential_sources={
            "openai_kongyang": ("OPENAI_KONGYANG_API_KEY", "OPENAI_API_KEY"),
            "dashscope": ("DASHSCOPE_API_KEY",),
        },
        supported_modalities=("llm",),
    ),
    ProviderFamilyConfig(
        model_family="qwen",
        backend_default="dashscope",
        credential_sources={
            "dashscope": ("DASHSCOPE_API_KEY",),
            "openai_kongyang": ("OPENAI_KONGYANG_API_KEY", "OPENAI_API_KEY"),
        },
        supported_modalities=("llm",),
    ),
    ProviderFamilyConfig(
        model_family="o3",
        backend_default="openai_kongyang",
        credential_sources={
            "openai_kongyang": ("OPENAI_KONGYANG_API_KEY", "OPENAI_API_KEY"),
            "dashscope": ("DASHSCOPE_API_KEY",),
        },
        supported_modalities=("llm",),
    ),
    ProviderFamilyConfig(
        model_family="o1",
        backend_default="openai_kongyang",
        credential_sources={
            "openai_kongyang": ("OPENAI_KONGYANG_API_KEY", "OPENAI_API_KEY"),
            "dashscope": ("DASHSCOPE_API_KEY",),
        },
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
    if b == "openai_kongyang":
        base = (
            (os.getenv("OPENAI_KONGYANG_BASE_URL") or "").strip().rstrip("/")
            or (os.getenv("OPENAI_BASE_URL") or "").strip().rstrip("/")
        )
        if not base:
            raise ValueError(
                "openai_kongyang requires OPENAI_KONGYANG_BASE_URL or legacy OPENAI_BASE_URL"
            )
        return base
    if b == "openai_geeknow":
        base = (os.getenv("OPENAI_GEEKNOW_BASE_URL") or "").strip().rstrip("/")
        if not base:
            raise ValueError("openai_geeknow requires OPENAI_GEEKNOW_BASE_URL")
        return base
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

    llm_backend_override: 'dashscope' | 'openai_kongyang' | 'openai_geeknow' forces routing;
    'auto'/None/'' uses registry + fallback.
    """
    o = (llm_backend_override or "").strip().lower()
    if o == "openai":
        o = "openai_kongyang"
    if o in LLM_BACKEND_OVERRIDE_VALUES:
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
        return "openai_kongyang"
    return "dashscope"


def llm_backend_primary_key_env(backend: str) -> str:
    """Env var name(s) cited when API key is missing."""
    b = (backend or "").strip().lower()
    if b == "dashscope":
        return "DASHSCOPE_API_KEY"
    if b == "openai_kongyang":
        return "OPENAI_KONGYANG_API_KEY or OPENAI_API_KEY (legacy)"
    if b == "openai_geeknow":
        return "OPENAI_GEEKNOW_API_KEY"
    return "LLM API key"


def get_llm_credentials(backend: str) -> Tuple[str, str]:
    """Return (api_key, base_url) for the resolved backend."""
    b = (backend or "").strip().lower()
    if b == "dashscope":
        return (os.getenv("DASHSCOPE_API_KEY") or "", get_llm_chat_base_url("dashscope"))
    if b == "openai_kongyang":
        key = (os.getenv("OPENAI_KONGYANG_API_KEY") or os.getenv("OPENAI_API_KEY") or "").strip()
        return (key, get_llm_chat_base_url("openai_kongyang"))
    if b == "openai_geeknow":
        return (os.getenv("OPENAI_GEEKNOW_API_KEY") or "", get_llm_chat_base_url("openai_geeknow"))
    raise ValueError(f"Unknown LLM backend: {backend!r}")
