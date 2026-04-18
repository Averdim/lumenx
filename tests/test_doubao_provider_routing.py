"""Tests: process_video_task routes doubao- / seedance* models to DoubaoModel (Ark)."""

from types import SimpleNamespace

from src.apps.comic_gen.models import VideoTask
from src.apps.comic_gen.pipeline import ComicGenPipeline


def _build_pipeline(task: VideoTask, wanx_model) -> ComicGenPipeline:
    pipeline = ComicGenPipeline.__new__(ComicGenPipeline)
    script = SimpleNamespace(
        id=task.project_id,
        video_tasks=[task],
        characters=[],
        scenes=[],
        props=[],
        updated_at=0,
    )
    pipeline.scripts = {task.project_id: script}
    pipeline._save_data = lambda: None
    pipeline._download_temp_image = lambda _: "/tmp/downloaded-doubao.png"
    pipeline._kling_model = None
    pipeline._vidu_model = None
    pipeline._doubao_model = None
    pipeline.video_generator = SimpleNamespace(model=wanx_model)
    pipeline.get_script = lambda script_id: pipeline.scripts.get(script_id)
    return pipeline


def test_pipeline_routes_doubao_prefix_to_ark_adapter(monkeypatch):
    task = VideoTask(
        id="task-doubao-1",
        project_id="script-1",
        image_url="https://example.com/ref.png",
        prompt="camera pan",
        model="doubao-seedance-2-0-260128",
    )

    calls = {}

    class FakeDoubaoModel:
        def __init__(self, config):
            calls["init_config"] = config

        def generate(self, **kwargs):
            calls["doubao_kwargs"] = kwargs
            return kwargs["output_path"], 0.0

    class FakeWanxModel:
        def generate(self, **kwargs):
            calls["wanx_kwargs"] = kwargs
            raise AssertionError("Wanx should not run when Doubao model is selected")

    monkeypatch.setattr("src.models.doubao.DoubaoModel", FakeDoubaoModel)

    pipeline = _build_pipeline(task, FakeWanxModel())
    pipeline.process_video_task("script-1", "task-doubao-1")

    assert "doubao_kwargs" in calls
    assert "wanx_kwargs" not in calls
    assert calls["doubao_kwargs"]["model"] == "doubao-seedance-2-0-260128"
    assert calls["doubao_kwargs"]["img_path"] == "/tmp/downloaded-doubao.png"
    assert calls["doubao_kwargs"]["duration"] == 5
    assert calls["doubao_kwargs"]["generate_audio"] is False
    assert calls["doubao_kwargs"]["image_inputs"] is not None
    assert len(calls["doubao_kwargs"]["image_inputs"]) == 1
    assert calls["doubao_kwargs"]["seedance_i2v_mode"] is None
    assert task.status == "completed"


def test_pipeline_routes_seedance_15_pro_to_ark_adapter(monkeypatch):
    task = VideoTask(
        id="task-seedance-15",
        project_id="script-1",
        image_url="https://example.com/ref.png",
        prompt="camera pan",
        model="doubao-seedance-1-5-pro-251215",
    )

    calls = {}

    class FakeDoubaoModel:
        def __init__(self, config):
            calls["init_config"] = config

        def generate(self, **kwargs):
            calls["doubao_kwargs"] = kwargs
            return kwargs["output_path"], 0.0

    class FakeWanxModel:
        def generate(self, **kwargs):
            raise AssertionError("Wanx should not run when Doubao model is selected")

    monkeypatch.setattr("src.models.doubao.DoubaoModel", FakeDoubaoModel)

    pipeline = _build_pipeline(task, FakeWanxModel())
    pipeline.process_video_task("script-1", "task-seedance-15")

    assert calls["doubao_kwargs"]["model"] == "doubao-seedance-1-5-pro-251215"
    assert calls["doubao_kwargs"]["img_path"] == "/tmp/downloaded-doubao.png"
    assert task.status == "completed"


def test_pipeline_routes_seedance_prefix_to_ark_adapter(monkeypatch):
    task = VideoTask(
        id="task-seedance-2",
        project_id="script-1",
        image_url="https://example.com/ref.png",
        prompt="motion",
        model="seedance-2-0-custom-id",
    )

    calls = {}

    class FakeDoubaoModel:
        def __init__(self, config):
            pass

        def generate(self, **kwargs):
            calls["doubao_kwargs"] = kwargs
            return kwargs["output_path"], 0.0

    class FakeWanxModel:
        def generate(self, **kwargs):
            raise AssertionError("Wanx should not run")

    monkeypatch.setattr("src.models.doubao.DoubaoModel", FakeDoubaoModel)

    pipeline = _build_pipeline(task, FakeWanxModel())
    pipeline.process_video_task("script-1", "task-seedance-2")

    assert calls["doubao_kwargs"]["model"] == "seedance-2-0-custom-id"
    assert task.status == "completed"


def test_pipeline_passes_ordered_image_inputs_for_seedance_multimodal(monkeypatch):
    task = VideoTask(
        id="task-seedance-multi",
        project_id="script-1",
        image_url="https://example.com/a.png",
        prompt="motion",
        model="doubao-seedance-2-0-260128",
        reference_image_urls=["https://example.com/b.png"],
        seedance_i2v_mode="multimodal_ref",
    )

    calls = {}

    class FakeDoubaoModel:
        def __init__(self, config):
            pass

        def generate(self, **kwargs):
            calls["doubao_kwargs"] = kwargs
            return kwargs["output_path"], 0.0

    class FakeWanxModel:
        def generate(self, **kwargs):
            raise AssertionError("Wanx should not run")

    monkeypatch.setattr("src.models.doubao.DoubaoModel", FakeDoubaoModel)

    pipeline = _build_pipeline(task, FakeWanxModel())
    n = [0]

    def _dl(url: str) -> str:
        n[0] += 1
        return f"resolved-{n[0]}"

    pipeline._download_temp_image = _dl

    pipeline.process_video_task("script-1", "task-seedance-multi")

    inputs = calls["doubao_kwargs"]["image_inputs"]
    assert len(inputs) == 2
    assert inputs[0]["img_url"] == "resolved-1"
    assert inputs[1]["img_url"] == "resolved-2"
    assert calls["doubao_kwargs"]["seedance_i2v_mode"] == "multimodal_ref"
    assert task.status == "completed"
