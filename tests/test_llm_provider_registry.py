"""Tests for text LLM provider prefix routing."""
import os

from src.utils.llm_provider_registry import (
    get_llm_chat_base_url,
    get_llm_credentials,
    llm_backend_primary_key_env,
    resolve_llm_backend,
    strip_llm_gateway_route_suffix,
)


def test_resolve_qwen_to_dashscope(monkeypatch):
    monkeypatch.delenv("LLM_PROVIDER", raising=False)
    assert resolve_llm_backend("qwen-plus") == "dashscope"
    assert resolve_llm_backend("qwen3.5-plus") == "dashscope"


def test_resolve_gpt_to_kongyang(monkeypatch):
    monkeypatch.delenv("LLM_PROVIDER", raising=False)
    assert resolve_llm_backend("gpt-5.2") == "openai_kongyang"


def test_resolve_gpt52_gateway_suffixes(monkeypatch):
    monkeypatch.delenv("LLM_PROVIDER", raising=False)
    assert resolve_llm_backend("gpt-5.2-kongyang") == "openai_kongyang"
    assert resolve_llm_backend("gpt-5-2-geeknow") == "openai_geeknow"


def test_strip_llm_gateway_route_suffix():
    assert strip_llm_gateway_route_suffix("gpt-5.2-kongyang") == "gpt-5.2"
    assert strip_llm_gateway_route_suffix("gpt-5-2-geeknow") == "gpt-5-2"
    assert strip_llm_gateway_route_suffix("gpt-5.2") == "gpt-5.2"
    assert strip_llm_gateway_route_suffix("GPT-5-2-GeekNow") == "GPT-5-2"


def test_resolve_gemini_to_kongyang(monkeypatch):
    """gemini* prefix matches before LLM_PROVIDER fallback."""
    monkeypatch.delenv("LLM_PROVIDER", raising=False)
    assert resolve_llm_backend("gemini2.5-flash") == "openai_kongyang"
    monkeypatch.setenv("LLM_PROVIDER", "dashscope")
    assert resolve_llm_backend("gemini2.5-flash") == "openai_kongyang"


def test_resolve_unknown_fallback_to_legacy_llm_provider(monkeypatch):
    monkeypatch.setenv("LLM_PROVIDER", "openai")
    assert resolve_llm_backend("unknown-foo-model") == "openai_kongyang"
    monkeypatch.setenv("LLM_PROVIDER", "dashscope")
    assert resolve_llm_backend("unknown-foo-model") == "dashscope"


def test_override_forces_backend(monkeypatch):
    monkeypatch.setenv("LLM_PROVIDER", "openai")
    assert resolve_llm_backend("qwen-plus", llm_backend_override="openai_kongyang") == "openai_kongyang"
    assert resolve_llm_backend("gpt-5.2", llm_backend_override="dashscope") == "dashscope"


def test_override_openai_named_gateways(monkeypatch):
    monkeypatch.delenv("LLM_PROVIDER", raising=False)
    assert resolve_llm_backend("gpt-5.2", llm_backend_override="openai_kongyang") == "openai_kongyang"
    assert resolve_llm_backend("qwen-plus", llm_backend_override="openai_geeknow") == "openai_geeknow"


def test_override_legacy_openai_maps_to_kongyang(monkeypatch):
    monkeypatch.delenv("LLM_PROVIDER", raising=False)
    assert resolve_llm_backend("gpt-5.2", llm_backend_override="openai") == "openai_kongyang"


def test_llm_backend_primary_key_env():
    assert "OPENAI_KONGYANG_API_KEY" in llm_backend_primary_key_env("openai_kongyang")
    assert llm_backend_primary_key_env("openai_geeknow") == "OPENAI_GEEKNOW_API_KEY"


def test_get_llm_credentials_named_openai_gateways(monkeypatch):
    monkeypatch.setenv("OPENAI_KONGYANG_API_KEY", "sk-test")
    monkeypatch.setenv("OPENAI_KONGYANG_BASE_URL", "https://kong.example/v1")
    key, base = get_llm_credentials("openai_kongyang")
    assert key == "sk-test"
    assert base == "https://kong.example/v1"


def test_get_llm_chat_base_url_kongyang_requires_env(monkeypatch):
    monkeypatch.delenv("OPENAI_KONGYANG_BASE_URL", raising=False)
    monkeypatch.delenv("OPENAI_BASE_URL", raising=False)
    try:
        get_llm_chat_base_url("openai_kongyang")
    except ValueError as e:
        assert "OPENAI_KONGYANG_BASE_URL" in str(e) or "OPENAI_BASE_URL" in str(e)
    else:
        raise AssertionError("expected ValueError")


def test_kongyang_base_url_falls_back_to_legacy_openai_base_url(monkeypatch):
    monkeypatch.delenv("OPENAI_KONGYANG_BASE_URL", raising=False)
    monkeypatch.setenv("OPENAI_BASE_URL", "https://legacy.example/v1")
    assert get_llm_chat_base_url("openai_kongyang") == "https://legacy.example/v1"


def test_kongyang_key_falls_back_to_legacy_openai_api_key(monkeypatch):
    monkeypatch.delenv("OPENAI_KONGYANG_API_KEY", raising=False)
    monkeypatch.delenv("OPENAI_KONGYANG_BASE_URL", raising=False)
    monkeypatch.setenv("OPENAI_API_KEY", "sk-legacy")
    monkeypatch.setenv("OPENAI_BASE_URL", "https://legacy.example/v1")
    key, base = get_llm_credentials("openai_kongyang")
    assert key == "sk-legacy"
    assert base == "https://legacy.example/v1"


def test_get_llm_chat_base_url_dashscope():
    u = get_llm_chat_base_url("dashscope")
    assert "compatible-mode" in u
    assert "dashscope" in u.lower() or "aliyuncs" in u
