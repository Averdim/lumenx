"""Tests for text LLM provider prefix routing."""
import os

from src.utils.llm_provider_registry import (
    get_llm_chat_base_url,
    resolve_llm_backend,
)


def test_resolve_qwen_to_dashscope(monkeypatch):
    monkeypatch.delenv("LLM_PROVIDER", raising=False)
    assert resolve_llm_backend("qwen-plus") == "dashscope"
    assert resolve_llm_backend("qwen3.5-plus") == "dashscope"


def test_resolve_gpt_to_openai(monkeypatch):
    monkeypatch.delenv("LLM_PROVIDER", raising=False)
    assert resolve_llm_backend("gpt-5.2") == "openai"


def test_resolve_unknown_fallback_to_legacy_llm_provider(monkeypatch):
    monkeypatch.setenv("LLM_PROVIDER", "openai")
    assert resolve_llm_backend("unknown-foo-model") == "openai"
    monkeypatch.setenv("LLM_PROVIDER", "dashscope")
    assert resolve_llm_backend("unknown-foo-model") == "dashscope"


def test_override_forces_backend(monkeypatch):
    monkeypatch.setenv("LLM_PROVIDER", "openai")
    assert resolve_llm_backend("qwen-plus", llm_backend_override="openai") == "openai"
    assert resolve_llm_backend("gpt-5.2", llm_backend_override="dashscope") == "dashscope"


def test_get_llm_chat_base_url_openai_default():
    old = os.environ.get("OPENAI_BASE_URL")
    try:
        os.environ.pop("OPENAI_BASE_URL", None)
        assert "api.openai.com" in get_llm_chat_base_url("openai")
    finally:
        if old is not None:
            os.environ["OPENAI_BASE_URL"] = old


def test_get_llm_chat_base_url_dashscope():
    u = get_llm_chat_base_url("dashscope")
    assert "compatible-mode" in u
    assert "dashscope" in u.lower() or "aliyuncs" in u
