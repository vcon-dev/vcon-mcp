# vCon Server Configuration Guide

This guide covers how to configure the vCon Server for processing conversation data through customizable chains, links, and storage backends.

## Table of Contents
- [Overview](#overview)
- [Environment Variables](#environment-variables)
- [Main Configuration File](#main-configuration-file)
- [Configuration Sections](#configuration-sections)
- [Dynamic Module Installation](#dynamic-module-installation)
- [Authentication Configuration](#authentication-configuration)
- [Docker Configuration](#docker-configuration)
- [Examples](#examples)

## Overview

The vCon Server uses a combination of environment variables and YAML configuration files to define its behavior. The main configuration flow is:

1. **Environment Variables** - Set basic connectivity and authentication
2. **Main Config File** - Define processing chains, links, and storage
3. **Docker Configuration** - Container orchestration and networking

## Environment Variables

Environment variables are typically set in a `.env` file or through your deployment environment.

### Core Settings

```bash
# Redis Configuration (Required)
REDIS_URL=redis://redis:6379

# Main configuration file path
CONSERVER_CONFIG_FILE=./config.yml

# API Authentication
CONSERVER_API_TOKEN=your_api_token_here
CONSERVER_HEADER_NAME=x-conserver-api-token

# Optional: Read API tokens from file (one per line)
CONSERVER_API_TOKEN_FILE=/path/to/api_tokens.txt
```

### Service Configuration

```bash
# Server Settings
HOSTNAME=http://localhost:8000
ENV=dev
LOG_LEVEL=DEBUG
API_ROOT_PATH=/api

# Logging
LOGGING_CONFIG_FILE=./logging.conf

# Processing Settings
TICK_INTERVAL=5000
```

### External Service API Keys

```bash
# AI Services
OPENAI_API_KEY=your_openai_key
DEEPGRAM_KEY=your_deepgram_key
GROQ_API_KEY=your_groq_key

# Storage Services
VCON_STORAGE=postgresql://user:pass@host:port/db

# Search Services
WEVIATE_HOST=localhost:8000
WEVIATE_API_KEY=your_weviate_key
```

### Data Management

```bash
# Redis Settings
VCON_SORTED_SET_NAME=vcons
VCON_SORTED_FORCE_RESET=true

# Expiration Settings (in seconds)
VCON_INDEX_EXPIRY=86400      # 1 day
VCON_REDIS_EXPIRY=3600       # 1 hour

# UUID Generation
UUID8_DOMAIN_NAME=your-domain.com
```

## Main Configuration File

The main configuration is defined in a YAML file (default: `config.yml`). This file defines the processing pipeline structure.

### Basic Structure

```yaml
# Optional: Dynamic module imports
imports:
  module_name:
    module: actual.module.path
    pip_name: package-name

# Processing components
links:
  link_name:
    module: links.module_name
    options:
      key: value

# Data storage backends
storages:
  storage_name:
    module: storage.backend
    options:
      connection_string: value

# Processing pipelines
chains:
  chain_name:
    links:
      - link1
      - link2
    storages:
      - storage1
    ingress_lists:
      - input_queue
    egress_lists:
      - output_queue
    enabled: 1

# External API authentication
ingress_auth:
  queue_name: "api-key"
  # or multiple keys:
  queue_name:
    - "api-key-1"
    - "api-key-2"
```

## Configuration Sections

### 1. Imports Section

Dynamically load modules at startup:

```yaml
imports:
  # PyPI package with different module name
  custom_utility:
    module: custom_utils
    pip_name: custom-utils-package
  
  # GitHub repository
  github_helper:
    module: github_helper
    pip_name: git+https://github.com/username/helper-repo.git
  
  # Module name matches pip package
  requests_import:
    module: requests
    # pip_name not needed since it matches module name
  
  # Legacy format (still supported)
  legacy_module: some.legacy.module
```

### 2. Links Section

Define processing components:

```yaml
links:
  # Transcription with Deepgram
  deepgram_transcribe:
    module: links.deepgram_link
    options:
      DEEPGRAM_KEY: ${DEEPGRAM_KEY}
      minimum_duration: 30
      api:
        model: "nova-2"
        smart_format: true
        detect_language: true

  # AI Analysis with OpenAI
  ai_analyze:
    module: links.analyze
    options:
      OPENAI_API_KEY: ${OPENAI_API_KEY}
      prompt: "Summarize this conversation..."
      analysis_type: summary
      model: 'gpt-4'

  # Webhook notifications
  webhook_notify:
    module: links.webhook
    options:
      webhook-urls:
        - https://your-webhook.com/endpoint
      auth_header: "Bearer your-token"

  # Custom PyPI package
  custom_link:
    module: my_custom_module
    pip_name: my-custom-package
    options:
      api_key: secret_key
```

### 3. Storage Section

Configure data persistence:

```yaml
storages:
  # PostgreSQL
  postgres:
    module: storage.postgres
    options:
      user: postgres
      password: your_password
      host: your_host
      port: "5432"
      database: postgres

  # Amazon S3
  s3:
    module: storage.s3
    options:
      aws_access_key_id: your_key
      aws_secret_access_key: your_secret
      aws_bucket: your_bucket

  # MongoDB
  mongo:
    module: storage.mongo
    options:
      url: mongodb://root:example@mongo:27017/
      database: conserver
      collection: vcons

  # Milvus Vector Database
  milvus:
    module: storage.milvus
    options:
      host: "localhost"
      port: "19530"
      collection_name: "vcons"
      embedding_model: "text-embedding-3-small"
      embedding_dim: 1536
      api_key: "your-openai-api-key"
```

### 4. Chains Section

Define processing pipelines:

```yaml
chains:
  # Main processing chain
  main_chain:
    links:
      - deepgram_transcribe
      - ai_analyze
      - webhook_notify
    storages:
      - postgres
      - s3
    ingress_lists:
      - main_input
    egress_lists:
      - processed_output
    enabled: 1

  # Fast processing for short calls
  quick_chain:
    links:
      - webhook_notify
    ingress_lists:
      - quick_input
    enabled: 1

  # Disabled chain
  experimental_chain:
    links:
      - experimental_link
    ingress_lists:
      - test_input
    enabled: 0  # Disabled
```

## Dynamic Module Installation

The server supports automatic installation of modules from PyPI or GitHub:

### For Links

```yaml
links:
  # GitHub repository
  github_link:
    module: github_module
    pip_name: git+https://github.com/username/repo.git@main
    options:
      debug: true

  # Private GitHub repo
  private_link:
    module: private_module
    pip_name: git+https://token:github_token@github.com/username/private-repo.git
    options:
      config_param: value

  # Version pinning
  versioned_link:
    module: my_module
    pip_name: my-package==1.2.3
    options:
      setting: value
```

### Version Management Best Practices

```yaml
# Development
dev_link:
  module: dev_module
  pip_name: git+https://github.com/username/repo.git@develop

# Staging
staging_link:
  module: staging_module
  pip_name: staging-package>=1.0.0,<2.0.0

# Production (exact pinning)
prod_link:
  module: prod_module
  pip_name: prod-package==1.2.3
```

## Authentication Configuration

### Internal API Authentication

Set the main API token:

```bash
# Environment variable
CONSERVER_API_TOKEN=your_internal_token

# Or file-based (one token per line)
CONSERVER_API_TOKEN_FILE=/path/to/tokens.txt
```

### External Partner Authentication

Configure limited access for external APIs:

```yaml
ingress_auth:
  # Single API key per ingress list
  customer_data: "partner-api-key-123"
  
  # Multiple API keys per ingress list
  support_calls:
    - "partner1-key"
    - "partner2-key"
  
  # Another partner with different access
  integration_data: "integration-partner-key"
```

**Usage:**
- Internal APIs use the main `CONSERVER_API_TOKEN`
- External partners use scoped keys for specific ingress lists
- External endpoints: `/vcon/external-ingress?ingress_list=customer_data`

## Docker Configuration

### Environment Setup

```yaml
# docker-compose.yml
version: "3.3"
services:
  conserver:
    build:
      dockerfile: ./docker/Dockerfile
      context: .
    env_file:
      - .env
    volumes:
      - .:/app
    depends_on:
      - redis
    networks:
      - conserver

  api:
    build:
      dockerfile: ./docker/Dockerfile
      context: .
    ports:
      - "${CONSERVER_EXTERNAL_PORT:-8000}:8000"
    env_file:
      - .env
    depends_on:
      - redis
    networks:
      - conserver

  redis:
    image: "redis/redis-stack:latest"
    ports:
      - "${REDIS_EXTERNAL_PORT:-8001}:8001"
    environment:
      REDIS_ARGS: --save 20 1 --notify-keyspace-events Ex --dir /data --appendonly yes
    volumes:
      - /opt/vcon-data/redis:/data
    networks:
      - conserver
```

### Production Volumes

```yaml
volumes:
  # Persistent Redis data
  - /opt/vcon-data/redis:/data
  
  # Configuration files
  - ./config.yml:/app/config.yml:ro
  - ./.env:/app/.env:ro
```

## Examples

### Complete Configuration Example

```yaml
# config.yml
imports:
  openai_wrapper:
    module: openai_helpers
    pip_name: openai-helpers>=1.0.0

links:
  transcribe:
    module: links.deepgram_link
    options:
      DEEPGRAM_KEY: ${DEEPGRAM_KEY}
      minimum_duration: 60
      api:
        model: "nova-2"
        smart_format: true

  summarize:
    module: links.analyze
    options:
      OPENAI_API_KEY: ${OPENAI_API_KEY}
      prompt: "Create a brief summary of this conversation"
      analysis_type: summary
      model: 'gpt-4'

  webhook_store:
    module: links.webhook
    options:
      webhook-urls:
        - https://your-system.com/vcon-webhook

storages:
  main_db:
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
      - summarize
      - webhook_store
    storages:
      - main_db
    ingress_lists:
      - new_calls
    egress_lists:
      - processed_calls
    enabled: 1

  quick_processing:
    links:
      - webhook_store
    ingress_lists:
      - urgent_calls
    enabled: 1

ingress_auth:
  new_calls: "partner-abc-123"
  urgent_calls:
    - "partner-xyz-456"
    - "partner-def-789"
```

### Environment File Example

```bash
# .env
REDIS_URL=redis://redis:6379
CONSERVER_CONFIG_FILE=./config.yml
CONSERVER_API_TOKEN=main-server-token-12345

# API Keys
OPENAI_API_KEY=sk-your-openai-key
DEEPGRAM_KEY=your-deepgram-key

# Database
DB_USER=vcon_user
DB_PASSWORD=secure_password
DB_HOST=postgres.example.com

# Server
ENV=production
LOG_LEVEL=INFO
API_ROOT_PATH=/api
```

### Minimal Configuration

```yaml
# Simple webhook-only setup
links:
  webhook:
    module: links.webhook
    options:
      webhook-urls:
        - https://your-endpoint.com/webhook

chains:
  simple:
    links:
      - webhook
    ingress_lists:
      - input
    enabled: 1
```

## Configuration Validation

The server will validate configuration on startup:

1. **Required environment variables** - Redis URL, config file path
2. **Chain integrity** - All referenced links and storages must exist
3. **Module availability** - All modules must be importable or installable
4. **Authentication consistency** - API keys must be properly configured

Check logs on startup for any configuration errors or warnings.

## Troubleshooting

### Common Configuration Issues

1. **Module Import Errors**
   - Check `pip_name` spelling and availability
   - Verify GitHub URLs and access tokens
   - Ensure Python version compatibility

2. **Chain Processing Issues**
   - Verify all links in chain are defined
   - Check storage backend connectivity
   - Ensure ingress queues are populated

3. **Authentication Problems**
   - Verify API tokens are set correctly
   - Check `ingress_auth` mappings
   - Ensure external partners use correct endpoints

4. **Storage Connection Issues**
   - Verify database credentials and connectivity
   - Check S3 permissions and bucket access
   - Test Redis connectivity

For detailed troubleshooting, enable DEBUG logging:

```bash
LOG_LEVEL=DEBUG
```

This will provide detailed information about configuration loading, module imports, and processing flow.