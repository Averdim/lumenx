from src.models.doubao import DoubaoModel, MEDIA_REF_OBJECT_KEY


def _new_model() -> DoubaoModel:
    return DoubaoModel.__new__(DoubaoModel)


def test_resolve_reference_image_object_key_falls_back_to_data_uri(monkeypatch):
    model = _new_model()

    class FakeUploader:
        is_configured = True

        def sign_url_for_api(self, object_key: str):
            return f"http://127.0.0.1:9000/comic-storage/{object_key}?X-Amz-Signature=abc"

        def object_to_data_uri(self, object_key: str):
            return "data:image/png;base64,ZmFrZQ=="

    monkeypatch.setattr("src.models.doubao.OSSImageUploader", lambda: FakeUploader())
    monkeypatch.setattr("src.models.doubao.classify_media_ref", lambda _: MEDIA_REF_OBJECT_KEY)

    resolved = model._resolve_reference_image_url(img_path="comic_gen/temp/ref.png")

    assert resolved.startswith("data:image/png;base64,")


def test_resolve_reference_image_localhost_url_uses_data_uri(monkeypatch):
    model = _new_model()

    monkeypatch.setattr(
        model,
        "_remote_url_to_data_url",
        lambda url: "data:image/png;base64,bG9jYWw=",
    )

    resolved = model._resolve_reference_image_url(
        img_url="http://127.0.0.1:9000/comic-storage/ref.png"
    )

    assert resolved.startswith("data:image/png;base64,")


def test_resolve_reference_image_public_url_passes_through():
    model = _new_model()

    resolved = model._resolve_reference_image_url(
        img_url="https://example.com/path/ref.png"
    )

    assert resolved == "https://example.com/path/ref.png"
