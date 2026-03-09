"""
LLaMA Inference Sidecar (via Groq)
====================================
FastAPI service that provides LLM-powered analysis for the vCon pipeline.
Uses Groq's API (free tier) running Llama models for fast inference.

Endpoints:
  POST /analyze   — sentiment + summary + topics from transcript text
  POST /query     — RAG-style Q&A with context chunks and citations
  GET  /health    — API status

Default: port 8200, model llama-3.1-8b-instant (configurable via GROQ_MODEL)
"""

import os
import json
import time
import logging
from typing import Optional

from groq import Groq
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import uvicorn

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------

GROQ_API_KEY = os.environ.get("GROQ_API_KEY", "")
GROQ_MODEL = os.environ.get("GROQ_MODEL", "llama-3.1-8b-instant")
HOST = os.environ.get("LLAMA_HOST", "0.0.0.0")
PORT = int(os.environ.get("LLAMA_PORT", "8200"))

# ---------------------------------------------------------------------------
# Logging
# ---------------------------------------------------------------------------

logging.basicConfig(
    level=logging.INFO,
    format="[llama-sidecar] %(asctime)s %(levelname)s %(message)s",
    datefmt="%H:%M:%S",
)
log = logging.getLogger("llama-sidecar")

# ---------------------------------------------------------------------------
# App
# ---------------------------------------------------------------------------

app = FastAPI(title="LLaMA Sidecar (Groq)", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

client: Groq | None = None


@app.on_event("startup")
async def startup():
    global client
    if not GROQ_API_KEY:
        log.warning("GROQ_API_KEY not set — service will return errors on requests")
        return
    client = Groq(api_key=GROQ_API_KEY)
    log.info(f"Groq client initialized, model: {GROQ_MODEL}")


# ---------------------------------------------------------------------------
# Request / Response models
# ---------------------------------------------------------------------------

class AnalyzeRequest(BaseModel):
    text: str
    vcon_uuid: Optional[str] = None

class AnalyzeResponse(BaseModel):
    sentiment: float          # -1.0 to 1.0
    sentiment_label: str      # negative / neutral / positive
    summary: str
    topics: list[str]
    key_phrases: list[str]
    processing_time_seconds: float

class QueryRequest(BaseModel):
    question: str
    context_chunks: list[dict]   # [{ "text": "...", "vcon_uuid": "...", "source": "..." }]
    max_tokens: int = 1024

class QueryResponse(BaseModel):
    answer: str
    citations: list[dict]        # [{ "vcon_uuid": "...", "excerpt": "..." }]
    confidence: float
    processing_time_seconds: float


# ---------------------------------------------------------------------------
# POST /analyze
# ---------------------------------------------------------------------------

ANALYZE_SYSTEM_PROMPT = """You are an expert conversation analyst. Given a transcript or conversation text, provide a structured analysis.

You MUST respond with valid JSON only — no markdown, no explanation, no preamble. Use this exact schema:

{
  "sentiment": <float from -1.0 (very negative) to 1.0 (very positive)>,
  "sentiment_label": "<negative|neutral|positive>",
  "summary": "<2-3 sentence summary of the conversation>",
  "topics": ["<topic1>", "<topic2>", ...],
  "key_phrases": ["<phrase1>", "<phrase2>", ...]
}

Rules:
- sentiment must be a number between -1.0 and 1.0
- sentiment_label: negative if < -0.2, positive if > 0.2, neutral otherwise
- topics: 2-5 main topics discussed
- key_phrases: 3-6 notable phrases or terms from the conversation
- summary: concise, factual, 2-3 sentences"""


@app.post("/analyze", response_model=AnalyzeResponse)
async def analyze(req: AnalyzeRequest):
    if client is None:
        raise HTTPException(503, "Groq client not initialized — check GROQ_API_KEY")

    if not req.text.strip():
        raise HTTPException(400, "Empty text")

    t0 = time.time()

    try:
        # Truncate very long transcripts to stay within token limits
        text = req.text[:12000] if len(req.text) > 12000 else req.text

        response = client.chat.completions.create(
            model=GROQ_MODEL,
            messages=[
                {"role": "system", "content": ANALYZE_SYSTEM_PROMPT},
                {"role": "user", "content": f"Analyze this conversation:\n\n{text}"},
            ],
            temperature=0.1,
            max_tokens=1024,
            response_format={"type": "json_object"},
        )

        raw = response.choices[0].message.content
        result = json.loads(raw)
        elapsed = time.time() - t0

        # Normalize and validate
        sentiment = max(-1.0, min(1.0, float(result.get("sentiment", 0))))
        if sentiment < -0.2:
            label = "negative"
        elif sentiment > 0.2:
            label = "positive"
        else:
            label = "neutral"

        log.info(f"Analyzed {len(text)} chars in {elapsed:.1f}s — "
                 f"sentiment={sentiment:.2f} ({label}), "
                 f"{len(result.get('topics', []))} topics")

        return AnalyzeResponse(
            sentiment=sentiment,
            sentiment_label=result.get("sentiment_label", label),
            summary=result.get("summary", "No summary available."),
            topics=result.get("topics", [])[:5],
            key_phrases=result.get("key_phrases", [])[:6],
            processing_time_seconds=round(elapsed, 2),
        )

    except json.JSONDecodeError as e:
        log.error(f"JSON parse error from Groq: {e}")
        raise HTTPException(500, f"LLM returned invalid JSON: {str(e)}")
    except Exception as e:
        log.error(f"Analysis failed: {e}")
        raise HTTPException(500, f"Analysis failed: {str(e)}")


# ---------------------------------------------------------------------------
# POST /query  (RAG-style Q&A)
# ---------------------------------------------------------------------------

QUERY_SYSTEM_PROMPT = """You are a conversation intelligence assistant. Answer the user's question using ONLY the provided context chunks from vCon conversation records.

Rules:
- Base your answer strictly on the provided context
- Cite specific conversations by their vcon_uuid when making claims
- If the context doesn't contain enough information, say so clearly
- Be concise and direct

You MUST respond with valid JSON only — no markdown, no explanation:

{
  "answer": "<your answer text, referencing vCon UUIDs where relevant>",
  "citations": [
    {"vcon_uuid": "<uuid>", "excerpt": "<short relevant quote from that conversation>"}
  ],
  "confidence": <float 0.0 to 1.0, how confident you are the answer is well-supported>
}"""


@app.post("/query", response_model=QueryResponse)
async def query(req: QueryRequest):
    if client is None:
        raise HTTPException(503, "Groq client not initialized — check GROQ_API_KEY")

    if not req.question.strip():
        raise HTTPException(400, "Empty question")

    t0 = time.time()

    try:
        # Format context chunks
        context_parts = []
        for i, chunk in enumerate(req.context_chunks[:10]):  # Limit to 10 chunks
            uuid = chunk.get("vcon_uuid", f"unknown-{i}")
            source = chunk.get("source", "unknown")
            text = chunk.get("text", "")[:2000]  # Truncate individual chunks
            context_parts.append(
                f"[vCon {uuid}] (source: {source})\n{text}"
            )

        context_text = "\n\n---\n\n".join(context_parts)

        response = client.chat.completions.create(
            model=GROQ_MODEL,
            messages=[
                {"role": "system", "content": QUERY_SYSTEM_PROMPT},
                {"role": "user", "content": (
                    f"Context from conversation records:\n\n{context_text}\n\n"
                    f"---\n\nQuestion: {req.question}"
                )},
            ],
            temperature=0.2,
            max_tokens=req.max_tokens,
            response_format={"type": "json_object"},
        )

        raw = response.choices[0].message.content
        result = json.loads(raw)
        elapsed = time.time() - t0

        confidence = max(0.0, min(1.0, float(result.get("confidence", 0.5))))

        log.info(f"Query answered in {elapsed:.1f}s — "
                 f"confidence={confidence:.2f}, "
                 f"{len(result.get('citations', []))} citations")

        return QueryResponse(
            answer=result.get("answer", "Unable to answer from the provided context."),
            citations=result.get("citations", [])[:5],
            confidence=confidence,
            processing_time_seconds=round(elapsed, 2),
        )

    except json.JSONDecodeError as e:
        log.error(f"JSON parse error from Groq: {e}")
        raise HTTPException(500, f"LLM returned invalid JSON: {str(e)}")
    except Exception as e:
        log.error(f"Query failed: {e}")
        raise HTTPException(500, f"Query failed: {str(e)}")


# ---------------------------------------------------------------------------
# GET /health
# ---------------------------------------------------------------------------

@app.get("/health")
async def health():
    return {
        "status": "ok" if client is not None else "no_api_key",
        "model": GROQ_MODEL,
        "provider": "groq",
        "api_key_set": bool(GROQ_API_KEY),
    }


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    log.info(f"Starting LLaMA sidecar (Groq) on {HOST}:{PORT}")
    log.info(f"Model: {GROQ_MODEL}, API key: {'set' if GROQ_API_KEY else 'NOT SET'}")
    uvicorn.run(app, host=HOST, port=PORT, log_level="info")
