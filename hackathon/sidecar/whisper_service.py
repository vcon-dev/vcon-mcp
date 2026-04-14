"""
Whisper Audio Transcription Sidecar
====================================
FastAPI service that accepts audio file uploads and returns transcriptions
using OpenAI Whisper running locally on GPU.

Endpoint contract (matches SIPREC adapter + ingest.html expectations):
  POST /transcribe  — multipart file upload → { "text": "...", "segments": [...] }
  GET  /health      — model status + GPU info

Default: port 8100, Whisper 'medium' model (configurable via WHISPER_MODEL env var)
"""

import os
import sys
import time
import tempfile
import logging
from pathlib import Path

import torch
import whisper
from fastapi import FastAPI, File, UploadFile, Form, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
import uvicorn

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------

WHISPER_MODEL = os.environ.get("WHISPER_MODEL", "medium")
HOST = os.environ.get("WHISPER_HOST", "0.0.0.0")
PORT = int(os.environ.get("WHISPER_PORT", "8100"))
DEVICE = "cuda" if torch.cuda.is_available() else "cpu"

# ---------------------------------------------------------------------------
# Logging
# ---------------------------------------------------------------------------

logging.basicConfig(
    level=logging.INFO,
    format="[whisper-sidecar] %(asctime)s %(levelname)s %(message)s",
    datefmt="%H:%M:%S",
)
log = logging.getLogger("whisper-sidecar")

# ---------------------------------------------------------------------------
# App
# ---------------------------------------------------------------------------

app = FastAPI(title="Whisper Sidecar", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# Global model reference — loaded once at startup
model: whisper.Whisper | None = None
model_load_time: float = 0.0


@app.on_event("startup")
async def load_model():
    global model, model_load_time
    log.info(f"Loading Whisper '{WHISPER_MODEL}' model on {DEVICE}...")
    t0 = time.time()
    model = whisper.load_model(WHISPER_MODEL, device=DEVICE)
    model_load_time = time.time() - t0
    log.info(f"Model loaded in {model_load_time:.1f}s")

    if DEVICE == "cuda":
        mem_alloc = torch.cuda.memory_allocated() / 1024**3
        mem_total = torch.cuda.get_device_properties(0).total_memory / 1024**3
        log.info(f"GPU memory: {mem_alloc:.1f} / {mem_total:.1f} GB")


# ---------------------------------------------------------------------------
# POST /transcribe
# ---------------------------------------------------------------------------

@app.post("/transcribe")
async def transcribe(
    file: UploadFile = File(...),
    model_name: str = Form(default=None, alias="model"),
    language: str = Form(default=None),
):
    """
    Accepts an audio file (WAV, MP3, OGG, WEBM, M4A, etc.) and returns
    the Whisper transcription.

    Form fields:
      - file: audio file (required)
      - model: ignored (we use the pre-loaded model), kept for API compat
      - language: optional language hint (e.g. "en")
    """
    if model is None:
        raise HTTPException(503, "Model not loaded yet")

    # Save upload to a temp file (Whisper needs a file path)
    suffix = Path(file.filename or "audio.wav").suffix or ".wav"
    with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
        content = await file.read()
        tmp.write(content)
        tmp_path = tmp.name

    try:
        log.info(f"Transcribing: {file.filename} ({len(content)} bytes)")
        t0 = time.time()

        # Build transcribe options
        options = {}
        if language:
            options["language"] = language

        result = model.transcribe(tmp_path, **options)
        elapsed = time.time() - t0

        # Build segment list
        segments = []
        for seg in result.get("segments", []):
            segments.append({
                "id": seg["id"],
                "start": round(seg["start"], 2),
                "end": round(seg["end"], 2),
                "text": seg["text"].strip(),
            })

        log.info(f"Done in {elapsed:.1f}s — {len(segments)} segments, "
                 f"language={result.get('language', '?')}")

        return {
            "text": result["text"].strip(),
            "segments": segments,
            "language": result.get("language"),
            "duration_seconds": round(segments[-1]["end"], 2) if segments else 0,
            "processing_time_seconds": round(elapsed, 2),
        }

    except Exception as e:
        log.error(f"Transcription failed: {e}")
        raise HTTPException(500, f"Transcription failed: {str(e)}")

    finally:
        # Clean up temp file
        try:
            os.unlink(tmp_path)
        except OSError:
            pass


# ---------------------------------------------------------------------------
# GET /health
# ---------------------------------------------------------------------------

@app.get("/health")
async def health():
    gpu_info = {}
    if torch.cuda.is_available():
        gpu_info = {
            "device": torch.cuda.get_device_name(0),
            "memory_allocated_gb": round(torch.cuda.memory_allocated() / 1024**3, 2),
            "memory_total_gb": round(torch.cuda.get_device_properties(0).total_memory / 1024**3, 2),
        }

    return {
        "status": "ok" if model is not None else "loading",
        "model": WHISPER_MODEL,
        "device": DEVICE,
        "model_load_time_seconds": round(model_load_time, 1),
        "gpu": gpu_info,
    }


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    log.info(f"Starting Whisper sidecar on {HOST}:{PORT}")
    log.info(f"Model: {WHISPER_MODEL}, Device: {DEVICE}")
    uvicorn.run(app, host=HOST, port=PORT, log_level="info")
