import base64
from pathlib import Path

import pytest

from src.utils.provider_media import (
    RESOLVE_HEADER_DASHSCOPE_OSS_RESOURCE,
    resolve_media_input,
    resolve_media_inputs,
)


PNG_1X1_BASE64 = (
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4//8/AwAI/AL+"
    "X2VINQAAAABJRU5ErkJggg=="
)


class FakeUploader:
    def __init__(self, configured: bool):
        self.is_configured = configured
        self.uploaded_paths = []

    def upload_file(self, local_path: str, sub_path: str = "", custom_filename=None):
        if not self.is_configured:
            return None
        self.uploaded_paths.append((local_path, sub_path))
        filename = custom_filename or Path(local_path).name
        return f"lumenx/{sub_path.strip('/')}/{filename}".replace("//", "/")

    def sign_url_for_api(self, object_key: str):
        return f"https://oss.example/{object_key}"


class FakeUploaderLocalMinio(FakeUploader):
    """Presigned URLs point at local MinIO; cloud APIs cannot fetch them."""

    def __init__(self):
        super().__init__(configured=True)

    def sign_url_for_api(self, object_key: str):
        return f"http://127.0.0.1:9000/comic-storage/{object_key}"

    def object_to_data_uri(self, object_key: str):
        return f"data:image/png;base64,{PNG_1X1_BASE64}"


def _write_output_png(project_root: Path, rel_path: str) -> Path:
    output_root = project_root / "output"
    file_path = output_root / rel_path
    file_path.parent.mkdir(parents=True, exist_ok=True)
    file_path.write_bytes(base64.b64decode(PNG_1X1_BASE64))
    return file_path


def test_gemini_image_local_without_oss_uses_data_uri(tmp_path):
    _write_output_png(tmp_path, "uploads/ref.png")
    ref = "uploads/ref.png"
    uploader = FakeUploader(configured=False)

    resolved = resolve_media_input(
        ref,
        model_name="gemini-3.1-flash-image-preview",
        backend="openai",
        modality="image",
        uploader=uploader,
        project_root=str(tmp_path),
    )

    assert resolved.value.startswith("data:image/png;base64,")


def test_dashscope_image_local_without_oss_uses_data_uri(tmp_path):
    _write_output_png(tmp_path, "uploads/ref.png")
    ref = "uploads/ref.png"
    uploader = FakeUploader(configured=False)

    resolved = resolve_media_input(
        ref,
        model_name="wan2.6-image",
        backend="dashscope",
        modality="image",
        uploader=uploader,
        project_root=str(tmp_path),
    )

    assert resolved.value.startswith("data:image/png;base64,")
    assert resolved.headers == {}
    assert ref == "uploads/ref.png"


@pytest.mark.parametrize("modality", ["audio", "video", "reference_video"])
def test_dashscope_non_image_local_without_oss_uses_temp_url_and_header(tmp_path, modality):
    _write_output_png(tmp_path, "video/ref.mp4")
    uploader = FakeUploader(configured=False)

    def fake_temp_url_resolver(local_path: str) -> str:
        assert local_path.endswith("output/video/ref.mp4")
        return "oss://dashscope-temp/session-file-001"

    resolved = resolve_media_input(
        "video/ref.mp4",
        model_name="wan2.6-i2v",
        backend="dashscope",
        modality=modality,
        uploader=uploader,
        project_root=str(tmp_path),
        dashscope_temp_url_resolver=fake_temp_url_resolver,
    )

    assert resolved.value == "oss://dashscope-temp/session-file-001"
    assert resolved.headers.get(RESOLVE_HEADER_DASHSCOPE_OSS_RESOURCE) == "enable"


def test_dashscope_non_image_local_without_oss_and_without_temp_resolver_fails_fast(tmp_path):
    _write_output_png(tmp_path, "video/ref.mp4")
    uploader = FakeUploader(configured=False)

    with pytest.raises(
        ValueError,
        match="requires OSS or a dashscope_temp_url_resolver",
    ):
        resolve_media_input(
            "video/ref.mp4",
            model_name="wan2.6-i2v",
            backend="dashscope",
            modality="audio",
            uploader=uploader,
            project_root=str(tmp_path),
        )


def test_dashscope_local_uses_oss_signed_url_when_configured(tmp_path):
    _write_output_png(tmp_path, "uploads/ref.png")
    uploader = FakeUploader(configured=True)

    resolved = resolve_media_input(
        "uploads/ref.png",
        model_name="wan2.6-image",
        backend="dashscope",
        modality="image",
        uploader=uploader,
        project_root=str(tmp_path),
    )

    assert resolved.value.startswith("https://oss.example/lumenx/temp/provider_media/")
    assert resolved.headers == {}
    assert uploader.uploaded_paths


def test_dashscope_image_local_uses_data_uri_when_presigned_host_is_localhost(tmp_path):
    """DashScope cannot download http://127.0.0.1/...; fall back to embedding pixels."""
    _write_output_png(tmp_path, "uploads/ref.png")
    uploader = FakeUploaderLocalMinio()

    resolved = resolve_media_input(
        "uploads/ref.png",
        model_name="wan2.6-image",
        backend="dashscope",
        modality="image",
        uploader=uploader,
        project_root=str(tmp_path),
    )

    assert resolved.value.startswith("data:image/png;base64,")
    assert uploader.uploaded_paths


def test_dashscope_object_key_uses_data_uri_when_presigned_host_is_localhost():
    uploader = FakeUploaderLocalMinio()
    ref = "lumenx/assets/characters/ref.png"

    resolved = resolve_media_input(
        ref,
        model_name="wan2.6-image",
        backend="dashscope",
        modality="image",
        uploader=uploader,
        oss_base_path="lumenx",
    )

    assert resolved.value == f"data:image/png;base64,{PNG_1X1_BASE64}"


def test_vendor_kling_image_local_uses_plain_base64(tmp_path):
    _write_output_png(tmp_path, "uploads/ref.png")
    uploader = FakeUploader(configured=False)

    resolved = resolve_media_input(
        "uploads/ref.png",
        model_name="kling-v1",
        backend="vendor",
        modality="image",
        uploader=uploader,
        project_root=str(tmp_path),
    )

    assert not resolved.value.startswith("data:")
    assert resolved.value == PNG_1X1_BASE64
    assert resolved.headers == {}


def test_vendor_vidu_image_local_requires_url_capability(tmp_path):
    _write_output_png(tmp_path, "uploads/ref.png")
    uploader = FakeUploader(configured=False)

    with pytest.raises(ValueError, match="requires a URL-compatible media source"):
        resolve_media_input(
            "uploads/ref.png",
            model_name="vidu-q3",
            backend="vendor",
            modality="image",
            uploader=uploader,
            project_root=str(tmp_path),
        )


def test_vendor_vidu_image_local_with_oss_uses_signed_url(tmp_path):
    _write_output_png(tmp_path, "uploads/ref.png")
    uploader = FakeUploader(configured=True)

    resolved = resolve_media_input(
        "uploads/ref.png",
        model_name="vidu-q3",
        backend="vendor",
        modality="image",
        uploader=uploader,
        project_root=str(tmp_path),
    )

    assert resolved.value.startswith("https://oss.example/lumenx/temp/provider_media/")


def test_resolver_does_not_mutate_input_refs(tmp_path):
    _write_output_png(tmp_path, "uploads/ref.png")
    uploader = FakeUploader(configured=False)
    refs = ["uploads/ref.png"]
    original = list(refs)

    resolved = resolve_media_inputs(
        refs,
        model_name="wan2.6-image",
        backend="dashscope",
        modality="image",
        uploader=uploader,
        project_root=str(tmp_path),
    )

    assert refs == original
    assert len(resolved) == 1
    assert resolved[0].value.startswith("data:image/png;base64,")
