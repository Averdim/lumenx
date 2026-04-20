"""Tests for z-image-turbo OpenAI-compatible /images/generations including I2I (JSON ref image)."""

import base64
from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest

from src.models.image import (
    SEEDREAM_30_I2I_UPSTREAM_MODEL,
    SEEDREAM_30_IMAGE_MODEL,
    Z_IMAGE_TURBO_MODEL,
    WanxImageModel,
)

PNG_1X1_BASE64 = (
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4//8/AwAI/AL+"
    "X2VINQAAAABJRU5ErkJggg=="
)


@pytest.fixture
def wanx_image_model():
    return WanxImageModel({"params": {"i2i_model_name": Z_IMAGE_TURBO_MODEL}})


def test_z_image_i2i_uses_generations_json_with_base64_ref(tmp_path: Path, wanx_image_model, monkeypatch):
    ref = tmp_path / "ref.png"
    ref.write_bytes(base64.b64decode(PNG_1X1_BASE64))
    out = tmp_path / "out.png"

    captured: dict = {}

    def fake_post(url, headers=None, files=None, data=None, json=None, timeout=None):
        captured["url"] = url
        captured["json"] = json
        captured["files"] = files
        mock = MagicMock()
        mock.ok = True
        mock.json.return_value = {"data": [{"url": "https://cdn.example.com/edited.png"}]}
        mock.text = ""
        return mock

    monkeypatch.setenv("IMAGE_OPENAI_BASE_URL", "https://gw.example/v1")
    monkeypatch.setenv("IMAGE_OPENAI_API_KEY", "sk-test")
    monkeypatch.delenv("IMAGE_GENERATIONS_REF_IMAGE_FIELD", raising=False)
    monkeypatch.delenv("IMAGE_GENERATIONS_REF_IMAGE_MODE", raising=False)

    with patch("src.models.image.requests.post", side_effect=fake_post):
        with patch.object(wanx_image_model, "_download_image") as dl:
            wanx_image_model.generate(
                "make it warmer",
                str(out),
                ref_image_path=str(ref),
            )
            dl.assert_called_once()

    assert captured["url"] == "https://gw.example/v1/images/generations"
    assert captured["files"] is None
    body = captured["json"]
    assert body["model"] == Z_IMAGE_TURBO_MODEL
    assert body["prompt"] == "make it warmer"
    assert isinstance(body.get("image"), str) and len(body["image"]) > 32


def test_z_image_t2i_generations_no_ref_field(tmp_path: Path, wanx_image_model, monkeypatch):
    out = tmp_path / "out.png"
    captured: dict = {}

    def fake_post(url, headers=None, files=None, data=None, json=None, timeout=None):
        captured["url"] = url
        captured["json"] = json
        mock = MagicMock()
        mock.ok = True
        mock.json.return_value = {"data": [{"url": "https://cdn.example.com/t2i.png"}]}
        mock.text = ""
        return mock

    monkeypatch.setenv("IMAGE_OPENAI_BASE_URL", "https://gw.example/v1")
    monkeypatch.setenv("IMAGE_OPENAI_API_KEY", "sk-test")

    wanx_image_model.params["model_name"] = Z_IMAGE_TURBO_MODEL
    with patch("src.models.image.requests.post", side_effect=fake_post):
        with patch.object(wanx_image_model, "_download_image"):
            wanx_image_model.generate("a red cube", str(out))

    assert captured["url"] == "https://gw.example/v1/images/generations"
    assert "image" not in captured["json"]


def test_seedream_i2i_uses_generations_and_doubao_upstream_model(tmp_path: Path, monkeypatch):
    ref = tmp_path / "ref.png"
    ref.write_bytes(base64.b64decode(PNG_1X1_BASE64))
    out = tmp_path / "out_seedream.png"
    model = WanxImageModel({"params": {"i2i_model_name": SEEDREAM_30_IMAGE_MODEL}})
    captured: dict = {}

    def fake_post(url, headers=None, files=None, data=None, json=None, timeout=None):
        captured["url"] = url
        captured["json"] = json
        mock = MagicMock()
        mock.ok = True
        mock.json.return_value = {"data": [{"url": "https://cdn.example.com/seedream.png"}]}
        mock.text = ""
        return mock

    monkeypatch.setenv("IMAGE_OPENAI_BASE_URL", "https://gw.example/v1")
    monkeypatch.setenv("IMAGE_OPENAI_API_KEY", "sk-test")
    monkeypatch.delenv("IMAGE_GENERATIONS_REF_IMAGE_FIELD", raising=False)
    monkeypatch.delenv("IMAGE_GENERATIONS_REF_IMAGE_MODE", raising=False)

    with patch("src.models.image.requests.post", side_effect=fake_post):
        with patch.object(model, "_download_image") as dl:
            model.generate(
                "keep composition",
                str(out),
                ref_image_path=str(ref),
                model_name=SEEDREAM_30_IMAGE_MODEL,
            )
            dl.assert_called_once()

    assert captured["url"] == "https://gw.example/v1/images/generations"
    body = captured["json"]
    assert body["model"] == SEEDREAM_30_I2I_UPSTREAM_MODEL
    assert isinstance(body.get("image"), str) and len(body["image"]) > 32
