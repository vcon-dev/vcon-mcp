# vCon Intelligence Platform — Hackathon Setup

## Prerequisites

- Docker Desktop (for MongoDB, Neo4j, Mosquitto, ChromaDB)
- Node.js 20+ (for vCon MCP server)
- Python 3.11+ (for sidecar services — later)
- NVIDIA GPU drivers + CUDA (for Whisper/LLaMA — later)

## Step 1: Start Infrastructure

```powershell
cd E:\data\code\claudecode\vcon-mcp\hackathon
docker compose up -d
```

Verify all services are running:
```powershell
docker compose ps
```

Expected:
| Service    | Port(s)         | Status  |
|------------|-----------------|---------|
| mongodb    | 27017           | Running |
| neo4j      | 7474, 7687      | Running |
| mosquitto  | 1883, 9001      | Running |
| chromadb   | 8000            | Running |

Access points:
- Neo4j Browser: http://localhost:7474 (neo4j / vcon2026)
- ChromaDB API: http://localhost:8000/api/v1
- MQTT Broker: mqtt://localhost:1883
- MQTT WebSocket: ws://localhost:9001

## Step 2: Configure Environment

```powershell
cd E:\data\code\claudecode\vcon-mcp
Copy-Item hackathon\.env.hackathon .env
```

## Step 3: Install MQTT Dependency

```powershell
npm install mqtt
npm install -D @types/mqtt
```

## Step 4: Start the MCP Server (HTTP mode)

```powershell
npm run dev
```

Server starts at http://localhost:3000 with:
- REST API: http://localhost:3000/api/v1/vcons
- Health: http://localhost:3000/api/v1/health
- MCP transport: http://localhost:3000/mcp

## Step 5: Test MQTT Bridge

In a separate terminal, subscribe to all vCon events:
```powershell
docker exec vcon-mosquitto mosquitto_sub -t "vcon/enterprise/#" -v
```

Then create a vCon via REST API:
```powershell
$body = @{
    subject = "Test call from hackathon"
    parties = @(
        @{ name = "Alice"; tel = "+15551234567" }
        @{ name = "Bob"; mailto = "bob@example.com" }
    )
} | ConvertTo-Json -Depth 5

Invoke-RestMethod -Uri "http://localhost:3000/api/v1/vcons" `
    -Method POST `
    -ContentType "application/json" `
    -Body $body
```

You should see the MQTT event appear in the subscriber terminal.

## Directory Structure

```
hackathon/
├── docker-compose.yml          # Infrastructure services
├── mosquitto/
│   └── mosquitto.conf          # MQTT broker config
├── .env.hackathon              # Environment variables
├── plugins/
│   ├── mqtt-bridge/            # BASE 2: UNS event bridge
│   ├── neo4j-consumer/         # BASE 5: Graph mapping
│   ├── siprec-adapter/         # BASE 1: Folder drop ingestion
│   ├── teams-adapter/          # BASE 4: MS Teams extractor
│   ├── whatsapp-adapter/       # WOW 2: WhatsApp parser
│   ├── jsonld-enrichment/      # WOW 1: JSON-LD-ex transformer
│   └── pii-redactor/           # PII detection/masking
├── sidecar/                    # Python FastAPI services (Whisper, LLaMA)
├── dashboard/                  # React real-time dashboard
└── sample-data/                # Demo vCons, SIPREC files, WhatsApp exports
```

## Build Order

1. ✅ Infrastructure (Docker) + MQTT Bridge Plugin
2. ⬜ Neo4j Consumer Plugin
3. ⬜ SIPREC Adapter Plugin (folder watcher)
4. ⬜ JSON-LD-ex Enrichment Plugin (deep semantic interop)
5. ⬜ WhatsApp Adapter Plugin
6. ⬜ Teams Adapter Plugin
7. ⬜ Python Sidecar (Whisper + LLaMA)
8. ⬜ RAG/CRAG Engine
9. ⬜ Real-Time Dashboard
10. ⬜ Integration Testing + Demo Flow
