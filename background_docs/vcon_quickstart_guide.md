# vCon Server Quick Start Guide

## Introduction to the Conserver

The vCon Server (also known as "conserver") is a powerful, modular conversation processing and storage system designed to handle advanced analysis and management of conversation data. Built with scalability and flexibility in mind, it provides a comprehensive pipeline for processing, storing, and analyzing conversations through various integrations and modules.

**Key Features:**
- **Modular Architecture**: Configurable processing chains with pluggable links and storage backends
- **Dynamic Module Installation**: Automatically install processing modules from PyPI or GitHub repositories
- **Multiple Storage Options**: Support for PostgreSQL, MongoDB, S3, Elasticsearch, and Milvus vector databases
- **AI Integration**: Built-in support for transcription (Deepgram, Groq) and analysis (OpenAI, Groq)
- **Horizontal Scaling**: Container-based architecture that scales with your needs
- **Webhook Integration**: Real-time notifications and external system integration

The conserver processes conversations through configurable "chains" - sequences of processing "links" that can transcribe audio, analyze content, extract insights, and store results in multiple backend systems simultaneously.

## Environment Requirements

### System Prerequisites

**Hardware Requirements:**
- Minimum 4GB RAM (8GB+ recommended for production)
- 2+ CPU cores
- 20GB+ available disk space
- Network connectivity for external API services

**Software Requirements:**
- **Docker Engine** 20.10+ and **Docker Compose** 2.0+
- **Git** for repository cloning
- **Linux/macOS** (Ubuntu 20.04+ recommended for production)
- **Python 3.12+** (for local development only)

### External Service Accounts

You'll need accounts and API keys for the services you plan to use:

**AI Services (Choose based on your needs):**
- **OpenAI**: For GPT-based analysis and embeddings
- **Deepgram**: For high-quality speech transcription
- **Groq**: For fast inference and transcription

**Storage Services (Optional):**
- **AWS S3**: For file storage and archival
- **PostgreSQL/MongoDB**: For structured data storage
- **Elasticsearch**: For search capabilities
- **Milvus**: For vector embeddings and semantic search

**Monitoring (Optional):**
- **Datadog**: For application monitoring and logging

## Installation

### Option 1: Automated Installation (Recommended)

The fastest way to get started is using the automated installation script:

```bash
# Download the installation script
curl -O https://raw.githubusercontent.com/vcon-dev/vcon-server/main/scripts/install_conserver.sh
chmod +x install_conserver.sh

# Run the installation with your domain
sudo ./install_conserver.sh --domain your-domain.com --email your-email@example.com
```

This script will:
- Install Docker and Docker Compose
- Create the necessary user accounts and directories
- Set up the conserver with production-ready defaults
- Configure persistent data storage
- Generate secure API tokens

### Option 2: Manual Installation

For custom setups or development environments:

**1. Clone the Repository**
```bash
git clone https://github.com/vcon-dev/vcon-server.git
cd vcon-server
```

**2. Create the Docker Network**
```bash
docker network create conserver
```

**3. Set Up Environment Variables**
```bash
cp .env.example .env
# Edit .env with your configuration (see Configuration section)
```

**4. Build and Start Services**
```bash
docker compose build
docker compose up -d
```

**5. Verify Installation**
```bash
# Check that all services are running
docker compose ps

# View logs
docker compose logs -f
```

## Configuration

### Step 1: Environment Variables

Create or edit your `.env` file with the essential settings:

```bash
# Core Settings
REDIS_URL=redis://redis:6379
CONSERVER_CONFIG_FILE=./config.yml
CONSERVER_API_TOKEN=your_secure_api_token_here

# External API Keys (add as needed)
OPENAI_API_KEY=sk-your-openai-key
DEEPGRAM_KEY=your-deepgram-key  
GROQ_API_KEY=gsk-your-groq-key

# Server Configuration
ENV=production
LOG_LEVEL=INFO
HOSTNAME=https://your-domain.com
API_ROOT_PATH=/api

# Optional: Domain for webhooks and callbacks
DNS_HOST=your-domain.com
DNS_REGISTRATION_EMAIL=your-email@example.com
```

### Step 2: Basic Configuration File

Create a `config.yml` file to define your processing pipeline. Here's a starter configuration:

**Simple Webhook-Only Setup:**
```yaml
links:
  webhook_notify:
    module: links.webhook
    options:
      webhook-urls:
        - https://your-system.com/vcon-received

chains:
  simple_chain:
    links:
      - webhook_notify
    ingress_lists:
      - incoming_calls
    enabled: 1
```

**Full Processing Pipeline:**
```yaml
links:
  # Transcribe audio using Groq Whisper
  transcribe:
    module: links.groq_whisper
    options:
      minimum_duration: 30
      API_KEY: ${GROQ_API_KEY}
      Content-Type: "audio/flac"

  # Analyze conversation with OpenAI
  analyze:
    module: links.analyze
    options:
      OPENAI_API_KEY: ${OPENAI_API_KEY}
      prompt: "Summarize this conversation and identify key topics, sentiment, and action items."
      analysis_type: summary
      model: 'gpt-4'

  # Send results via webhook
  notify:
    module: links.webhook
    options:
      webhook-urls:
        - https://your-system.com/processed-vcon

storages:
  # Store in PostgreSQL
  postgres:
    module: storage.postgres
    options:
      user: ${DB_USER}
      password: ${DB_PASSWORD}
      host: ${DB_HOST}
      port: "5432"
      database: vcons

chains:
  full_processing:
    links:
      - transcribe
      - analyze  
      - notify
    storages:
      - postgres
    ingress_lists:
      - new_conversations
    enabled: 1
```

### Step 3: Start Processing

**1. Restart Services with New Configuration**
```bash
docker compose down
docker compose up -d
```

**2. Submit a Test Conversation**

You can submit conversations via the API:

```bash
# Submit a vCon for processing
curl -X POST "http://localhost:8000/api/vcon" \
  -H "x-conserver-api-token: your_secure_api_token_here" \
  -H "Content-Type: application/json" \
  -H "ingress_list: new_conversations" \
  -d @your_vcon_file.json
```

**3. Monitor Processing**

Check the logs to see your conversation moving through the processing pipeline:

```bash
# View all service logs
docker compose logs -f

# View just the conserver logs
docker compose logs -f conserver

# View API logs
docker compose logs -f api
```

### Step 4: Scale for Production

When you're ready for higher throughput:

```bash
# Scale the processing workers
docker compose up --scale conserver=4 -d

# Monitor resource usage
docker stats
```

## Next Steps

**Customize Your Pipeline:**
- Add more processing links for sentiment analysis, topic extraction, or custom business logic
- Configure additional storage backends for redundancy
- Set up monitoring and alerting

**Explore Advanced Features:**
- Dynamic module installation from PyPI or GitHub
- Vector embeddings with Milvus for semantic search
- Multi-tenant authentication with ingress-specific API keys
- Webhook authentication and retry logic

**Production Considerations:**
- Set up persistent volumes for data storage
- Configure SSL/TLS termination
- Implement backup strategies for your databases
- Set up monitoring with Datadog or similar tools

For detailed configuration options, see the complete vCon Server Configuration Guide.

For troubleshooting and advanced deployment scenarios, refer to the main README documentation.

---

**Need Help?** 
- Check the logs: `docker compose logs -f`
- Verify your configuration: Look for startup errors in the conserver logs
- Test connectivity: Ensure your external APIs are accessible and credentials are correct

## Additional Resources

- **GitHub Repository**: https://github.com/vcon-dev/vcon-server
- **vCon Specification**: https://datatracker.ietf.org/doc/draft-ietf-vcon-vcon/
- **Docker Documentation**: https://docs.docker.com/
- **Docker Compose Documentation**: https://docs.docker.com/compose/