"""Moondream 2 — local vision model. Runs on CPU (int8) inside the Space.

Lazy-loaded on first use so the FastAPI server starts fast and the model
weights only sit in RAM when actually needed.

Two main calls used by the loop:
  - describe(image, question) -> str       free-form perception
  - point(image, label)        -> [{"x":int,"y":int,"label":str}, ...]

Coordinates are normalised back to pixels of the supplied screenshot.
"""
from __future__ import annotations
import asyncio
import io
import threading
from typing import Any
from PIL import Image

from ..config import settings

_lock = threading.Lock()
_model: Any = None
_tokenizer: Any = None


def _load() -> tuple[Any, Any]:
    global _model, _tokenizer
    with _lock:
        if _model is not None:
            return _model, _tokenizer
        # Imported lazily so `uvicorn --reload` startup stays cheap and so
        # users running just the API (no eyes) don't pay the torch import cost.
        from transformers import AutoModelForCausalLM, AutoTokenizer
        import torch  # noqa: F401  (registers cpu backend)

        path = settings.moondream_dir
        _tokenizer = AutoTokenizer.from_pretrained(path, trust_remote_code=True)
        _model = AutoModelForCausalLM.from_pretrained(
            path,
            trust_remote_code=True,
            torch_dtype="auto",
            device_map="cpu",
        )
        return _model, _tokenizer


def _to_image(image: bytes | Image.Image) -> Image.Image:
    if isinstance(image, Image.Image):
        return image
    return Image.open(io.BytesIO(image)).convert("RGB")


async def describe(image: bytes | Image.Image, question: str) -> str:
    """Free-form perception. Cheap, ~2–4 s on free CPU."""
    def _run() -> str:
        model, tok = _load()
        img = _to_image(image)
        enc = model.encode_image(img)
        return model.answer_question(enc, question, tok).strip()

    return await asyncio.to_thread(_run)


async def point(image: bytes | Image.Image, label: str) -> list[dict]:
    """Native Moondream `point` skill. Returns pixel coords for `label`."""
    def _run() -> list[dict]:
        model, _tok = _load()
        img = _to_image(image)
        w, h = img.size
        # Moondream's `point()` returns normalised coords in [0,1].
        pts = model.point(img, label)["points"]
        return [
            {"x": int(p["x"] * w), "y": int(p["y"] * h), "label": label}
            for p in pts
        ]

    return await asyncio.to_thread(_run)


async def detect(image: bytes | Image.Image, label: str) -> list[dict]:
    """Bounding boxes for `label`. Useful for forms / lists."""
    def _run() -> list[dict]:
        model, _tok = _load()
        img = _to_image(image)
        w, h = img.size
        objs = model.detect(img, label)["objects"]
        out = []
        for o in objs:
            out.append({
                "x_min": int(o["x_min"] * w), "y_min": int(o["y_min"] * h),
                "x_max": int(o["x_max"] * w), "y_max": int(o["y_max"] * h),
                "label": label,
            })
        return out

    return await asyncio.to_thread(_run)
