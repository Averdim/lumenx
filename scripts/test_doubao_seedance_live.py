#!/usr/bin/env python3
"""
Live integration test: Doubao SeeDance (Volcengine Ark) I2V using project DoubaoModel.

Usage (from repo root):
  python scripts/test_doubao_seedance_live.py

Requires:
  - ARK_API_KEY in .env or environment
  - pip install 'volcengine-python-sdk[ark]' requests

Options:
  --model   Override endpoint model id (default: env ARK_SEEDANCE_MODEL or doubao-seedance-2-0-260128)
  --image   Path to reference image (PNG/JPEG); default: 16x16 embedded PNG (Ark requires min side >= 14px)
  --out     Output mp4 path (default: output/video/doubao_live_test_<ts>.mp4)
"""
from __future__ import annotations

import argparse
import base64
import logging
import os
import sys
import time
from pathlib import Path

# Repo root = parent of scripts/
_ROOT = Path(__file__).resolve().parents[1]
if str(_ROOT) not in sys.path:
    sys.path.insert(0, str(_ROOT))

logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
logger = logging.getLogger("doubao_live")


# 16x16 RGB PNG — Ark rejects images smaller than 14px per side (e.g. 1x1 placeholders).
_PNG_DEFAULT_REF = base64.b64decode(
    "iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAIAAACQkWg2AAAAFklEQVR42mNwcAggCTGMahjVMHw1AACFstABNKoVUgAAAABJRU5ErkJggg=="
)


def _default_ref_image() -> Path:
    out = _ROOT / "output" / "video_inputs" / "_doubao_live_test_ref.png"
    out.parent.mkdir(parents=True, exist_ok=True)
    # Always refresh so runs after older 1x1 defaults still get a valid image.
    out.write_bytes(_PNG_DEFAULT_REF)
    return out


def main() -> int:
    parser = argparse.ArgumentParser(description="Live Ark Seedance I2V via DoubaoModel")
    parser.add_argument(
        "--model",
        default=os.getenv("ARK_SEEDANCE_MODEL", "doubao-seedance-2-0-260128"),
        help="Ark endpoint model id",
    )
    parser.add_argument("--image", type=Path, help="Reference image path")
    parser.add_argument("--out", type=Path, help="Output mp4 path")
    parser.add_argument("--duration", type=int, default=5, help="Seconds (passed into prompt suffix)")
    parser.add_argument("--resolution", default="720p", help="e.g. 480p, 720p, 1080p")
    parser.add_argument(
        "--prompt",
        default="slow camera push in, subtle ambient motion, cinematic lighting",
        help="Motion / scene prompt",
    )
    args = parser.parse_args()

    try:
        from dotenv import load_dotenv
    except ImportError:
        logger.warning("python-dotenv not installed; using process env only")
    else:
        load_dotenv(_ROOT / ".env")

    api_key = (os.getenv("ARK_API_KEY") or "").strip()
    if not api_key:
        logger.error("ARK_API_KEY is not set. Add it to .env or export ARK_API_KEY.")
        return 2

    logger.info("ARK_API_KEY is set (length=%s)", len(api_key))

    img_path = Path(args.image).resolve() if args.image else _default_ref_image()
    if not img_path.is_file():
        logger.error("Reference image not found: %s", img_path)
        return 2

    ts = int(time.time())
    out_path = args.out
    if not out_path:
        out_path = _ROOT / "output" / "video" / f"doubao_live_test_{ts}.mp4"
    out_path = Path(out_path).resolve()
    out_path.parent.mkdir(parents=True, exist_ok=True)

    from src.models.doubao import DoubaoModel

    model = DoubaoModel({"params": {"model_name": args.model}})
    if model.client is None:
        logger.error("Ark client is None. Install: pip install 'volcengine-python-sdk[ark]'")
        return 2

    logger.info("Model id: %s", args.model)
    logger.info("Reference image: %s", img_path)
    logger.info("Output: %s", out_path)

    try:
        _, duration_s = model.generate(
            prompt=args.prompt,
            output_path=str(out_path),
            img_path=str(img_path),
            model=args.model,
            duration=args.duration,
            resolution=args.resolution,
        )
    except Exception as e:
        logger.exception("Doubao generate failed: %s", e)
        return 1

    size = out_path.stat().st_size if out_path.is_file() else 0
    logger.info("Done in %.1fs, file size=%s bytes — %s", duration_s, size, out_path)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
