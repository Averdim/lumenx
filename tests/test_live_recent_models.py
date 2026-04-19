"""
Optional live smoke tests for recently added model ids against real gateways.

These calls cost quota and are skipped unless you opt in:

    set RUN_LIVE_NEW_MODELS=1
    pytest tests/test_live_recent_models.py -v

Prerequisites (see .env / .env.example):

- Text (Kongyang / legacy OpenAI): OPENAI_KONGYANG_API_KEY or OPENAI_API_KEY, plus
  OPENAI_KONGYANG_BASE_URL or OPENAI_BASE_URL or KONGYANG_BASE_URL.
- Text (GeekNow, gpt-5.2-geeknow only): OPENAI_GEEKNOW_API_KEY + OPENAI_GEEKNOW_BASE_URL.
- Image (Gemini Flash Image, Seedream, z-image): IMAGE_OPENAI_BASE_URL (or KONGYANG_BASE_URL)
  + IMAGE_OPENAI_API_KEY.

`tests/conftest.py` loads the project root `.env` before these modules import.
"""

from __future__ import annotations

import base64
import os
from pathlib import Path

import pytest

from src.apps.comic_gen.llm_adapter import LLMAdapter
from src.models.image import (
    GEMINI_FLASH_IMAGE_PREVIEW_MODEL,
    SEEDREAM_30_IMAGE_MODEL,
    Z_IMAGE_TURBO_MODEL,
    WanxImageModel,
)

# 1x1 transparent PNG (minimal valid raster).
PNG_1X1_BASE64 = (
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4//8/AwAI/AL+"
    "X2VINQAAAABJRU5ErkJggg=="
)


def _live_switch_on() -> bool:
    return os.getenv("RUN_LIVE_NEW_MODELS", "").strip().lower() in ("1", "true", "yes")


def _kongyang_llm_ready() -> bool:
    key = (os.getenv("OPENAI_KONGYANG_API_KEY") or os.getenv("OPENAI_API_KEY") or "").strip()
    base = (
        (os.getenv("OPENAI_KONGYANG_BASE_URL") or "").strip()
        or (os.getenv("OPENAI_BASE_URL") or "").strip()
        or (os.getenv("KONGYANG_BASE_URL") or "").strip()
    )
    return bool(key and base)


def _geeknow_llm_ready() -> bool:
    return bool(
        (os.getenv("OPENAI_GEEKNOW_API_KEY") or "").strip()
        and (os.getenv("OPENAI_GEEKNOW_BASE_URL") or "").strip()
    )


def _image_openai_ready() -> bool:
    base = (os.getenv("IMAGE_OPENAI_BASE_URL") or os.getenv("KONGYANG_BASE_URL") or "").strip()
    key = (os.getenv("IMAGE_OPENAI_API_KEY") or "").strip()
    return bool(base and key)


def _assert_output_image(path: Path, min_bytes: int = 300) -> None:
    assert path.is_file(), f"Expected output file at {path}"
    raw = path.read_bytes()
    assert len(raw) >= min_bytes, f"Image too small ({len(raw)} bytes); likely not a real render."
    assert raw.startswith(
        (b"\x89PNG\r\n\x1a\n", b"\xff\xd8\xff", b"RIFF")
    ), "Output does not start with PNG / JPEG / RIFF (WebP) signature."


def _tiny_ref_png(tmp_path: Path) -> Path:
    p = tmp_path / "ref_1x1.png"
    p.write_bytes(base64.b64decode(PNG_1X1_BASE64))
    return p


skip_live_off = pytest.mark.skipif(
    not _live_switch_on(),
    reason="Live gateway tests disabled; set RUN_LIVE_NEW_MODELS=1",
)


@pytest.mark.live_recent_models
@skip_live_off
@pytest.mark.skipif(not _kongyang_llm_ready(), reason="Kongyang / legacy OpenAI LLM env not set.")
def test_live_llm_gpt_5_2_kongyang_returns_text(monkeypatch):
    monkeypatch.setenv("DASHSCOPE_API_KEY", os.getenv("DASHSCOPE_API_KEY") or "dummy-for-imports")
    adapter = LLMAdapter()
    text = adapter.chat(
        [
            {
                "role": "user",
                "content": "Reply with exactly the two letters OK and nothing else.",
            }
        ],
        model="gpt-5.2-kongyang",
    )
    assert isinstance(text, str) and text.strip(), f"Empty LLM response: {text!r}"
    assert "OK" in text.upper()


@pytest.mark.live_recent_models
@skip_live_off
@pytest.mark.skipif(not _geeknow_llm_ready(), reason="OPENAI_GEEKNOW_* not set.")
def test_live_llm_gpt_5_2_geeknow_returns_text(monkeypatch):
    monkeypatch.setenv("DASHSCOPE_API_KEY", os.getenv("DASHSCOPE_API_KEY") or "dummy-for-imports")
    adapter = LLMAdapter()
    text = adapter.chat(
        [
            {
                "role": "user",
                "content": "Reply with exactly the two letters OK and nothing else.",
            }
        ],
        model="gpt-5.2-geeknow",
    )
    assert isinstance(text, str) and text.strip(), f"Empty LLM response: {text!r}"
    assert "OK" in text.upper()


@pytest.mark.live_recent_models
@skip_live_off
@pytest.mark.skipif(not _kongyang_llm_ready(), reason="Kongyang / legacy OpenAI LLM env not set.")
@pytest.mark.parametrize(
    "model_id",
    ["gemini-3-flash-preview", "gemini-3-pro-preview"],
)
def test_live_llm_gemini_3_preview_returns_text(model_id: str, monkeypatch):
    monkeypatch.setenv("DASHSCOPE_API_KEY", os.getenv("DASHSCOPE_API_KEY") or "dummy-for-imports")
    adapter = LLMAdapter()
    text = adapter.chat(
        [
            {
                "role": "user",
                "content": "用一句话中文回答：确认你已收到请求。",
            }
        ],
        model=model_id,
    )
    assert isinstance(text, str) and len(text.strip()) >= 2, f"Empty or trivial response: {text!r}"


@pytest.mark.live_recent_models
@skip_live_off
@pytest.mark.skipif(not _image_openai_ready(), reason="IMAGE_OPENAI_* (or KONGYANG_BASE_URL) not set.")
def test_live_t2i_gemini_flash_image_writes_png(tmp_path, monkeypatch):
    monkeypatch.setenv("DASHSCOPE_API_KEY", os.getenv("DASHSCOPE_API_KEY") or "dummy")
    out = tmp_path / "live_t2i_gemini.png"
    model = WanxImageModel({"params": {}})
    path, duration = model.generate(
        "A single solid red circle centered on a white background, flat vector style, no text.",
        str(out),
        model_name=GEMINI_FLASH_IMAGE_PREVIEW_MODEL,
        size="1024*1024",
    )
    _assert_output_image(Path(path))
    assert duration >= 0


@pytest.mark.live_recent_models
@skip_live_off
@pytest.mark.skipif(not _image_openai_ready(), reason="IMAGE_OPENAI_* (or KONGYANG_BASE_URL) not set.")
def test_live_t2i_seedream_writes_png(tmp_path, monkeypatch):
    monkeypatch.setenv("DASHSCOPE_API_KEY", os.getenv("DASHSCOPE_API_KEY") or "dummy")
    out = tmp_path / "live_t2i_seedream.png"
    model = WanxImageModel({"params": {}})
    path, duration = model.generate(
        "A single solid blue square centered on a light gray background, flat vector style, no text.",
        str(out),
        model_name=SEEDREAM_30_IMAGE_MODEL,
        size="1024*1024",
    )
    _assert_output_image(Path(path))
    assert duration >= 0


@pytest.mark.live_recent_models
@skip_live_off
@pytest.mark.skipif(not _image_openai_ready(), reason="IMAGE_OPENAI_* (or KONGYANG_BASE_URL) not set.")
def test_live_t2i_z_image_turbo_writes_png(tmp_path, monkeypatch):
    monkeypatch.setenv("DASHSCOPE_API_KEY", os.getenv("DASHSCOPE_API_KEY") or "dummy")
    out = tmp_path / "live_t2i_zimage.png"
    model = WanxImageModel({"params": {}})
    path, duration = model.generate(
        "A green triangle on white background, simple flat icon, no text.",
        str(out),
        model_name=Z_IMAGE_TURBO_MODEL,
        size="1024*1024",
    )
    _assert_output_image(Path(path))
    assert duration >= 0


@pytest.mark.live_recent_models
@skip_live_off
@pytest.mark.skipif(not _image_openai_ready(), reason="IMAGE_OPENAI_* (or KONGYANG_BASE_URL) not set.")
def test_live_i2i_gemini_flash_image_writes_png(tmp_path, monkeypatch):
    monkeypatch.setenv("DASHSCOPE_API_KEY", os.getenv("DASHSCOPE_API_KEY") or "dummy")
    ref = _tiny_ref_png(tmp_path)
    out = tmp_path / "live_i2i_gemini.png"
    model = WanxImageModel({"params": {}})
    path, duration = model.generate(
        "Keep composition; shift overall hue slightly toward warm orange. No text.",
        str(out),
        ref_image_path=str(ref),
        model_name=GEMINI_FLASH_IMAGE_PREVIEW_MODEL,
        size="1024*1024",
    )
    _assert_output_image(Path(path))
    assert duration >= 0


@pytest.mark.live_recent_models
@skip_live_off
@pytest.mark.skipif(not _image_openai_ready(), reason="IMAGE_OPENAI_* (or KONGYANG_BASE_URL) not set.")
def test_live_i2i_seedream_writes_png(tmp_path, monkeypatch):
    monkeypatch.setenv("DASHSCOPE_API_KEY", os.getenv("DASHSCOPE_API_KEY") or "dummy")
    ref = _tiny_ref_png(tmp_path)
    out = tmp_path / "live_i2i_seedream.png"
    model = WanxImageModel({"params": {}})
    path, duration = model.generate(
        "Keep composition; shift overall hue slightly toward cool cyan. No text.",
        str(out),
        ref_image_path=str(ref),
        model_name=SEEDREAM_30_IMAGE_MODEL,
        size="1024*1024",
    )
    _assert_output_image(Path(path))
    assert duration >= 0


@pytest.mark.live_recent_models
@skip_live_off
@pytest.mark.skipif(not _image_openai_ready(), reason="IMAGE_OPENAI_* (or KONGYANG_BASE_URL) not set.")
def test_live_i2i_z_image_turbo_writes_png(tmp_path, monkeypatch):
    monkeypatch.setenv("DASHSCOPE_API_KEY", os.getenv("DASHSCOPE_API_KEY") or "dummy")
    ref = _tiny_ref_png(tmp_path)
    out = tmp_path / "live_i2i_zimage.png"
    model = WanxImageModel({"params": {}})
    path, duration = model.generate(
        "Same layout; make the image slightly higher contrast. No text.",
        str(out),
        ref_image_path=str(ref),
        model_name=Z_IMAGE_TURBO_MODEL,
        size="1024*1024",
    )
    _assert_output_image(Path(path))
    assert duration >= 0
