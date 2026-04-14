# vCon Intelligence Platform — Python Sidecars

GPU-accelerated services for the hackathon pipeline.

## Whisper Sidecar (port 8100)

Audio transcription via OpenAI Whisper on your RTX 4090.

### Setup

```powershell
cd E:\data\code\claudecode\vcon-mcp\hackathon\sidecar

# Install PyTorch with CUDA first (if not already installed):
pip install torch torchvision torchaudio --index-url https://download.pytorch.org/whl/cu124

# Install remaining dependencies:
pip install -r requirements.txt

# Run:
python whisper_service.py
```

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `WHISPER_MODEL` | `medium` | Whisper model size: `tiny`, `base`, `small`, `medium`, `large-v3` |
| `WHISPER_HOST` | `0.0.0.0` | Bind host |
| `WHISPER_PORT` | `8100` | Bind port |

### Endpoints

- `POST /transcribe` — Upload audio file → `{ "text": "...", "segments": [...] }`
- `GET /health` — Model status + GPU memory info

### VRAM Usage (approximate)

| Model | VRAM | Quality |
|-------|------|---------|
| tiny | ~1 GB | Low |
| base | ~1 GB | Fair |
| small | ~2 GB | Good |
| medium | ~5 GB | Very Good |
| large-v3 | ~10 GB | Best |

Default is `medium` (~5GB) to leave room for LLaMA + embeddings.
