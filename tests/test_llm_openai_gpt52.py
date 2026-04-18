"""
Tests for text LLM via OpenAI-compatible gateway (e.g. 空氧) with GPT-5.2.

- `tests/conftest.py` loads the project root `.env`, so live tests pick up
  `LLM_PROVIDER`, `OPENAI_BASE_URL`, `OPENAI_API_KEY`, `OPENAI_MODEL` without manual export.
- Default tests use mocks (no network, no real API keys).
- Optional live test runs only when `LLM_PROVIDER=openai` and gateway variables are set.
  Run manually: pytest tests/test_llm_openai_gpt52.py -k live -v
"""

import os
from unittest.mock import MagicMock

import pytest

from src.apps.comic_gen.llm_adapter import LLMAdapter


def _llm_openai_text_gateway_configured() -> bool:
    """Match production: openai provider + key + base URL (model can default to gpt-5.2 in code)."""
    if os.getenv("LLM_PROVIDER", "dashscope").lower() != "openai":
        return False
    return bool(os.getenv("OPENAI_API_KEY") and os.getenv("OPENAI_BASE_URL"))


def test_llm_openai_chat_mocked_gpt52(monkeypatch):
    """LLMAdapter.chat uses OPENAI_MODEL (default gpt-5.2) and returns assistant text."""
    monkeypatch.setenv("LLM_PROVIDER", "openai")
    monkeypatch.setenv("OPENAI_API_KEY", "sk-test")
    monkeypatch.setenv("OPENAI_BASE_URL", "https://api.example.com/v1")
    monkeypatch.delenv("OPENAI_MODEL", raising=False)

    captured = {}

    class FakeCompletions:
        def create(self, **kwargs):
            captured.update(kwargs)
            resp = MagicMock()
            resp.choices = [MagicMock()]
            resp.choices[0].message.content = "pong"
            return resp

    class FakeChat:
        completions = FakeCompletions()

    class FakeOpenAI:
        def __init__(self, **kwargs):
            self._kwargs = kwargs

        @property
        def chat(self):
            return FakeChat()

    monkeypatch.setattr("openai.OpenAI", FakeOpenAI)

    adapter = LLMAdapter()
    assert adapter.is_configured
    out = adapter.chat([{"role": "user", "content": "ping"}])

    assert out == "pong"
    assert captured.get("model") == "gpt-5.2"
    msgs = captured.get("messages")
    assert msgs and msgs[0]["content"] == "ping"


def test_llm_openai_chat_mocked_explicit_openai_model(monkeypatch):
    monkeypatch.setenv("LLM_PROVIDER", "openai")
    monkeypatch.setenv("OPENAI_API_KEY", "sk-test")
    monkeypatch.setenv("OPENAI_BASE_URL", "https://api.example.com/v1")
    monkeypatch.setenv("OPENAI_MODEL", "gpt-5.2")

    captured = {}

    class FakeCompletions:
        def create(self, **kwargs):
            captured["model"] = kwargs.get("model")
            resp = MagicMock()
            resp.choices = [MagicMock()]
            resp.choices[0].message.content = "ok"
            return resp

    class FakeChat:
        completions = FakeCompletions()

    class FakeOpenAI:
        def __init__(self, **kwargs):
            pass

        @property
        def chat(self):
            return FakeChat()

    monkeypatch.setattr("openai.OpenAI", FakeOpenAI)

    adapter = LLMAdapter()
    assert adapter.chat([{"role": "user", "content": "hi"}], model=None) == "ok"
    assert captured.get("model") == "gpt-5.2"


def test_llm_openai_chat_mocked_model_override(monkeypatch):
    monkeypatch.setenv("LLM_PROVIDER", "openai")
    monkeypatch.setenv("OPENAI_API_KEY", "sk-test")
    monkeypatch.setenv("OPENAI_BASE_URL", "https://api.example.com/v1")
    monkeypatch.setenv("OPENAI_MODEL", "gpt-5.2")

    captured = {}

    class FakeCompletions:
        def create(self, **kwargs):
            captured["model"] = kwargs.get("model")
            resp = MagicMock()
            resp.choices = [MagicMock()]
            resp.choices[0].message.content = "x"
            return resp

    class FakeChat:
        completions = FakeCompletions()

    class FakeOpenAI:
        def __init__(self, **kwargs):
            pass

        @property
        def chat(self):
            return FakeChat()

    monkeypatch.setattr("openai.OpenAI", FakeOpenAI)

    adapter = LLMAdapter()
    adapter.chat([{"role": "user", "content": "x"}], model="qwen-plus")
    assert captured.get("model") == "qwen-plus"


@pytest.mark.skipif(
    not _llm_openai_text_gateway_configured(),
    reason=(
        "Set LLM_PROVIDER=openai, OPENAI_API_KEY, OPENAI_BASE_URL in .env "
        "(OPENAI_MODEL optional; defaults to gpt-5.2 per llm_adapter)."
    ),
)
def _skip_if_gateway_no_channel(exc: BaseException) -> None:
    """
    空氧 / New API 等网关在分组下无可用 distributor 时常返回 503，这不是本仓库逻辑错误。
    """
    msg = str(exc)
    if (
        "503" in msg
        or "无可用渠道" in msg
        or "distributor" in msg.lower()
        or "new_api_error" in msg.lower()
    ):
        pytest.skip(f"Gateway has no available channel for this model (retry later or check model id): {msg[:400]}")


def test_gpt52_openai_live_chat_optional():
    """
    Calls the real gateway (costs quota). Run manually:
      pytest tests/test_llm_openai_gpt52.py -k live -v
    """
    adapter = LLMAdapter()
    assert adapter.is_configured
    try:
        text = adapter.chat(
            [{"role": "user", "content": "Reply with exactly: OK"}],
            model=os.getenv("OPENAI_MODEL") or None,
        )
    except RuntimeError as e:
        _skip_if_gateway_no_channel(e)
        raise
    assert isinstance(text, str)
    assert len(text.strip()) > 0
