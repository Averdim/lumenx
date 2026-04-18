"""
Tests for Gemini Flash Image (OpenAI-compatible chat/completions) T2I path in WanxImageModel.

- `tests/conftest.py` loads the project root `.env` (same as backend), so live tests pick up
  `IMAGE_OPENAI_BASE_URL` / `KONGYANG_BASE_URL` and `IMAGE_OPENAI_API_KEY` without manual export.
- Default tests use mocks (no network, no real API keys).
- Optional live test runs only when those gateway variables are present in `.env` or the environment.
"""

import base64
import os
from pathlib import Path
from unittest.mock import MagicMock

import pytest

from src.models.image import (
    GEMINI_FLASH_IMAGE_PREVIEW_MODEL,
    WanxImageModel,
    _chat_completion_response_to_dict,
)

PNG_1X1_BASE64 = (
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4//8/AwAI/AL+"
    "X2VINQAAAABJRU5ErkJggg=="
)


def _gemini_image_gateway_configured() -> bool:
    """Match `WanxImageModel` env: IMAGE_OPENAI_BASE_URL or KONGYANG_BASE_URL, plus IMAGE_OPENAI_API_KEY."""
    base = os.getenv("IMAGE_OPENAI_BASE_URL") or os.getenv("KONGYANG_BASE_URL")
    return bool(base and os.getenv("IMAGE_OPENAI_API_KEY"))


@pytest.fixture
def wanx_image_model():
    return WanxImageModel({"params": {}})


def test_chat_completion_response_plain_text_wraps_as_message_content():
    """Gateways that return a raw URL or text instead of JSON."""
    data = _chat_completion_response_to_dict("https://cdn.example.com/out.png")
    assert data["choices"][0]["message"]["content"] == "https://cdn.example.com/out.png"


def test_chat_completion_response_empty_string_raises():
    with pytest.raises(RuntimeError, match="empty response"):
        _chat_completion_response_to_dict("")


def test_parse_openai_chat_image_response_images_array(wanx_image_model):
    data = {
        "choices": [
            {
                "message": {
                    "images": [{"image_url": {"url": "https://example.com/gen.png"}}],
                }
            }
        ]
    }
    url = wanx_image_model._parse_openai_chat_image_response(data)
    assert url == "https://example.com/gen.png"


def test_parse_openai_chat_image_response_content_image_url_parts(wanx_image_model):
    data = {
        "choices": [
            {
                "message": {
                    "content": [
                        {"type": "image_url", "image_url": {"url": "https://cdn.example.com/a.png"}},
                    ],
                }
            }
        ]
    }
    url = wanx_image_model._parse_openai_chat_image_response(data)
    assert url == "https://cdn.example.com/a.png"


def test_parse_openai_chat_image_response_inline_base64(wanx_image_model):
    data = {
        "choices": [
            {
                "message": {
                    "content": [
                        {
                            "inline_data": {
                                "mime_type": "image/png",
                                "data": PNG_1X1_BASE64,
                            },
                        },
                    ],
                }
            }
        ]
    }
    uri = wanx_image_model._parse_openai_chat_image_response(data)
    assert uri.startswith("data:image/png;base64,")
    assert PNG_1X1_BASE64 in uri


def test_gemini_t2i_generate_mocked_openai_client(tmp_path, monkeypatch):
    """End-to-end for model id: env + mock OpenAI + stub download."""
    monkeypatch.setenv("IMAGE_OPENAI_BASE_URL", "https://api.example.com/v1")
    monkeypatch.setenv("IMAGE_OPENAI_API_KEY", "sk-test-key")
    monkeypatch.setenv("DASHSCOPE_API_KEY", "ds-test")

    fake_response = {
        "choices": [
            {
                "message": {
                    "images": [{"image_url": {"url": "https://cdn.example.com/out.png"}}],
                }
            }
        ]
    }

    class FakeCompletions:
        def create(self, **kwargs):
            m = MagicMock()
            m.model_dump.return_value = fake_response
            return m

    class FakeChat:
        completions = FakeCompletions()

    class FakeOpenAI:
        def __init__(self, **kwargs):
            self.chat = FakeChat()

    monkeypatch.setattr("openai.OpenAI", FakeOpenAI)

    captured = {}

    def fake_download(self, url, output_path):
        captured["url"] = url
        Path(output_path).parent.mkdir(parents=True, exist_ok=True)
        Path(output_path).write_bytes(base64.b64decode(PNG_1X1_BASE64))

    monkeypatch.setattr(WanxImageModel, "_download_image", fake_download)

    model = WanxImageModel({"params": {}})
    out_path = tmp_path / "gemini_out.png"
    path, duration = model.generate(
        "a simple test prompt",
        str(out_path),
        model_name=GEMINI_FLASH_IMAGE_PREVIEW_MODEL,
        size="1024*1024",
    )

    assert Path(path).exists()
    assert Path(path).stat().st_size > 0
    assert captured["url"] == "https://cdn.example.com/out.png"
    assert duration >= 0


def test_gemini_i2i_unresolved_refs_raises(wanx_image_model, monkeypatch):
    """I2I with Gemini when no reference resolves should error clearly."""
    monkeypatch.setenv("DASHSCOPE_API_KEY", "x")
    monkeypatch.setenv("IMAGE_OPENAI_BASE_URL", "https://api.example.com/v1")
    monkeypatch.setenv("IMAGE_OPENAI_API_KEY", "sk-test")
    monkeypatch.setattr(WanxImageModel, "_resolve_wan26_reference_image", lambda self, path, model_name=None: None)
    with pytest.raises(RuntimeError, match="at least one resolvable reference"):
        wanx_image_model.generate(
            "prompt",
            "/tmp/out.png",
            ref_image_path="/nonexistent/ref.png",
            model_name=GEMINI_FLASH_IMAGE_PREVIEW_MODEL,
            size="1024*1024",
        )


def test_gemini_i2i_multimodal_mocked(tmp_path, monkeypatch):
    """I2I passes image_url + text in user message content."""
    monkeypatch.setenv("DASHSCOPE_API_KEY", "ds-test")
    monkeypatch.setenv("IMAGE_OPENAI_BASE_URL", "https://api.example.com/v1")
    monkeypatch.setenv("IMAGE_OPENAI_API_KEY", "sk-test-key")

    captured_messages = {}

    class FakeCompletions:
        def create(self, **kwargs):
            captured_messages["messages"] = kwargs.get("messages")
            m = MagicMock()
            m.model_dump.return_value = {
                "choices": [{"message": {"images": [{"image_url": {"url": "https://cdn.example.com/edited.png"}}]}}]
            }
            return m

    class FakeChat:
        completions = FakeCompletions()

    class FakeOpenAI:
        def __init__(self, **kwargs):
            self.chat = FakeChat()

    monkeypatch.setattr("openai.OpenAI", FakeOpenAI)

    def fake_download(self, url, output_path):
        Path(output_path).parent.mkdir(parents=True, exist_ok=True)
        Path(output_path).write_bytes(base64.b64decode(PNG_1X1_BASE64))

    monkeypatch.setattr(WanxImageModel, "_download_image", fake_download)
    monkeypatch.setattr(
        WanxImageModel,
        "_resolve_wan26_reference_image",
        lambda self, path, model_name=None: "https://ref.example.com/in.png",
    )

    model = WanxImageModel({"params": {}})
    out_path = tmp_path / "gemini_i2i.png"
    model.generate(
        "make it cinematic",
        str(out_path),
        ref_image_path="ignored",
        model_name=GEMINI_FLASH_IMAGE_PREVIEW_MODEL,
        size="1024*1024",
    )

    msgs = captured_messages.get("messages")
    assert msgs and len(msgs) == 1
    content = msgs[0].get("content")
    assert isinstance(content, list)
    assert content[0].get("type") == "image_url"
    assert "ref.example.com" in content[0]["image_url"]["url"]
    assert content[-1].get("type") == "text"
    assert "cinematic" in content[-1].get("text", "")


@pytest.mark.skipif(
    not _gemini_image_gateway_configured(),
    reason="Set IMAGE_OPENAI_API_KEY and IMAGE_OPENAI_BASE_URL (or KONGYANG_BASE_URL) in .env to run live test.",
)
def test_gemini_flash_image_live_generation_optional(tmp_path, monkeypatch):
    """
    Calls the real gateway (costs quota). Run manually:
      pytest tests/test_gemini_flash_image_openai.py -k live -v
    """
    monkeypatch.setenv("DASHSCOPE_API_KEY", os.getenv("DASHSCOPE_API_KEY") or "dummy")

    model = WanxImageModel({"params": {}})
    out_path = tmp_path / "live_gemini.png"
    path, duration = model.generate(
        "A small red circle on white background, flat icon style.",
        str(out_path),
        model_name=GEMINI_FLASH_IMAGE_PREVIEW_MODEL,
        size="1024*1024",
    )
    assert Path(path).exists()
    assert Path(path).stat().st_size > 100
    assert duration >= 0
