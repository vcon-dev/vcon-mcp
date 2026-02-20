# Self-Hosted Supabase Deployment Guide

Deploy vCON MCP with a self-hosted Supabase instance for complete control over your infrastructure.

## Table of Contents

- [Architecture Overview](#architecture-overview)
- [Prerequisites](#prerequisites)
- [1. Create Directory Structure](#1-create-directory-structure)
- [2. Configure Environment Variables](#2-configure-environment-variables)
- [3. Create Supabase Database Files](#3-create-supabase-database-files)
- [4. Create Kong API Gateway Configuration](#4-create-kong-api-gateway-configuration)
- [5. Create Docker Compose File](#5-create-docker-compose-file)
- [6. Start the Stack](#6-start-the-stack)
- [7. Verify Deployment](#7-verify-deployment)
- [8. Pushing vCONs to vCON MCP](#8-pushing-vcons-to-vcon-mcp)
- [9. Configuration Reference](#9-configuration-reference)
- [10. Operations](#10-operations)
- [11. Troubleshooting](#11-troubleshooting)

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              Docker Host                                    │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  External Systems                    vCON MCP Stack                         │
│  ┌────────────────────┐             ┌────────────────────┐                  │
│  │   vCON Ingestion   │────────────▶│     vcon-mcp       │                  │
│  │   Endpoint         │   HTTP      │   Port: 3002       │                  │
│  │                    │   :3002     │                    │                  │
│  └────────────────────┘             └─────────┬──────────┘                  │
│                                               │                             │
│                                               ▼                             │
│                                     ┌────────────────────┐                  │
│                                     │  vcon-supabase-    │                  │
│                                     │  kong (Gateway)    │                  │
│                                     └─────────┬──────────┘                  │
│                                               │                             │
│            ┌──────────────────────────────────┼──────────────────┐          │
│            │                                  │                  │          │
│            ▼                                  ▼                  ▼          │
│  ┌─────────────────┐              ┌─────────────────┐  ┌─────────────────┐  │
│  │  vcon-supabase  │              │  vcon-supabase  │  │  vcon-supabase  │  │
│  │  -auth          │              │  -rest          │  │  -storage       │  │
│  └─────────────────┘              └─────────────────┘  └─────────────────┘  │
│            │                                  │                             │
│            └──────────────────┬───────────────┘                             │
│                               ▼                                             │
│                     ┌─────────────────┐                                     │
│                     │  vcon-supabase  │                                     │
│                     │  -db (Postgres) │                                     │
│                     └─────────────────┘                                     │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

The vCON MCP stack includes:

| Service | Description |
|---------|-------------|
| **vcon-mcp** | Main application server (HTTP MCP transport) |
| **ofelia** | Job scheduler for embedding vCONs |
| **vcon-supabase-db** | PostgreSQL database |
| **vcon-supabase-kong** | API Gateway |
| **vcon-supabase-auth** | GoTrue authentication server |
| **vcon-supabase-rest** | PostgREST database REST API |
| **vcon-supabase-storage** | File storage API |

---

## Prerequisites

- Docker Engine 20.10+ and Docker Compose V2
- At least 4GB RAM available for Docker
- Ports available: `3002` (MCP API) or configurable via Docker Compose port mapping
- Embedding API access (one of the following):
  - Azure OpenAI API
  - OpenAI API
  - Hugging Face API

---

## 1. Create Directory Structure

```bash
mkdir -p ~/vcon-mcp
cd ~/vcon-mcp

# Create volume directories
mkdir -p volumes/{db,api,storage,logs,functions,pooler}
mkdir -p volumes/db/{data,init}
```

---

## 2. Configure Environment Variables

Create `.env` file with your configuration:

```bash
cat > .env << 'EOF'
############
# Secrets
# YOU MUST CHANGE THESE BEFORE GOING INTO PRODUCTION
############

POSTGRES_PASSWORD=your-super-secret-and-long-postgres-password
JWT_SECRET=your-super-secret-jwt-token-with-at-least-32-characters-long
ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyAgCiAgICAicm9sZSI6ICJhbm9uIiwKICAgICJpc3MiOiAic3VwYWJhc2UtZGVtbyIsCiAgICAiaWF0IjogMTY0MTc2OTIwMCwKICAgICJleHAiOiAxNzk5NTM1NjAwCn0.dc_X5iR_VP_qT0zsiyj_I_OZ2T9FtRU2BBNWN8Bu4GE
SERVICE_ROLE_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyAgCiAgICAicm9sZSI6ICJzZXJ2aWNlX3JvbGUiLAogICAgImlzcyI6ICJzdXBhYmFzZS1kZW1vIiwKICAgICJpYXQiOiAxNjQxNzY5MjAwLAogICAgImV4cCI6IDE3OTk1MzU2MDAKfQ.dBOgCXw-qUYQq6dAR0U5uFw1x4L0fNXp1rL2zy7sdBw
DASHBOARD_USERNAME=supabase
DASHBOARD_PASSWORD=this_password_is_insecure_and_should_be_updated

############
# Database - The default values are compatible with Postgres Supabase docker image
############

POSTGRES_HOST=vcon-supabase-db
POSTGRES_DB=postgres
POSTGRES_PORT=5432
# default user is postgres

############
# API Proxy - Configuration for the Kong Reverse proxy.
############

KONG_HTTP_PORT=8443

############
# API - Configuration for PostgREST.
############

PGRST_DB_SCHEMAS=public,storage,graphql_public

############
# Auth - Configuration for the GoTrue authentication server.
############

## General
SITE_URL=http://localhost:3000
ADDITIONAL_REDIRECT_URLS=
JWT_EXPIRY=3600
DISABLE_SIGNUP=false
API_EXTERNAL_URL=http://localhost:8443

## Mailer Config
MAILER_URLPATHS_CONFIRMATION="/auth/v1/verify"
MAILER_URLPATHS_INVITE="/auth/v1/verify"
MAILER_URLPATHS_RECOVERY="/auth/v1/verify"
MAILER_URLPATHS_EMAIL_CHANGE="/auth/v1/verify"

## Email auth
ENABLE_EMAIL_SIGNUP=true
ENABLE_EMAIL_AUTOCONFIRM=true
SMTP_ADMIN_EMAIL=admin@example.com
SMTP_HOST=supabase-mail
SMTP_PORT=2500
SMTP_USER=fake_mail_user
SMTP_PASS=fake_mail_password
SMTP_SENDER_NAME=fake_sender

## Phone auth
ENABLE_PHONE_SIGNUP=false
ENABLE_PHONE_AUTOCONFIRM=true

## Anonymous auth
ENABLE_ANONYMOUS_USERS=false
EOF
```

> **Important**: For production, generate new secrets:
> ```bash
> # Generate secure passwords/secrets
> openssl rand -base64 32
> ```

---

## 3. Create Supabase Database Files

### 3.1 Create `volumes/db/roles.sql`

```bash
cat > volumes/db/roles.sql << 'EOF'
-- NOTE: change to your own passwords for production environments
\set pgpass `echo "$POSTGRES_PASSWORD"`

ALTER USER authenticator WITH PASSWORD :'pgpass';
ALTER USER pgbouncer WITH PASSWORD :'pgpass';
ALTER USER supabase_auth_admin WITH PASSWORD :'pgpass';
ALTER USER supabase_functions_admin WITH PASSWORD :'pgpass';
ALTER USER supabase_storage_admin WITH PASSWORD :'pgpass';
EOF
```

### 3.2 Create `volumes/db/jwt.sql`

```bash
cat > volumes/db/jwt.sql << 'EOF'
\set jwt_secret `echo "$JWT_SECRET"`
\set jwt_exp `echo "$JWT_EXP"`

ALTER DATABASE postgres SET "app.settings.jwt_secret" TO :'jwt_secret';
ALTER DATABASE postgres SET "app.settings.jwt_exp" TO :'jwt_exp';
EOF
```

### 3.3 Create `volumes/db/_supabase.sql`

```bash
cat > volumes/db/_supabase.sql << 'EOF'
\set pguser `echo "$POSTGRES_USER"`

CREATE DATABASE _supabase WITH OWNER :pguser;
EOF
```

### 3.4 Create placeholder SQL files

```bash
# These can be minimal for vCON MCP
echo "SELECT 1;" > volumes/db/realtime.sql
echo "SELECT 1;" > volumes/db/webhooks.sql
echo "SELECT 1;" > volumes/db/logs.sql
echo "SELECT 1;" > volumes/db/pooler.sql
```

---

## 4. Create Kong API Gateway Configuration

Create `volumes/api/kong.yml`:

```bash
cat > volumes/api/kong.yml << 'EOF'
_format_version: '2.1'
_transform: true

###
### Consumers / Users
###
consumers:
  - username: DASHBOARD
  - username: anon
    keyauth_credentials:
      - key: $SUPABASE_ANON_KEY
  - username: service_role
    keyauth_credentials:
      - key: $SUPABASE_SERVICE_KEY

###
### Access Control List
###
acls:
  - consumer: anon
    group: anon
  - consumer: service_role
    group: admin

###
### Dashboard credentials
###
basicauth_credentials:
  - consumer: DASHBOARD
    username: $DASHBOARD_USERNAME
    password: $DASHBOARD_PASSWORD

###
### API Routes
###
services:
  ## Open Auth routes
  - name: auth-v1-open
    url: http://vcon-supabase-auth:9999/verify
    routes:
      - name: auth-v1-open
        strip_path: true
        paths:
          - /auth/v1/verify
    plugins:
      - name: cors
  - name: auth-v1-open-callback
    url: http://vcon-supabase-auth:9999/callback
    routes:
      - name: auth-v1-open-callback
        strip_path: true
        paths:
          - /auth/v1/callback
    plugins:
      - name: cors
  - name: auth-v1-open-authorize
    url: http://vcon-supabase-auth:9999/authorize
    routes:
      - name: auth-v1-open-authorize
        strip_path: true
        paths:
          - /auth/v1/authorize
    plugins:
      - name: cors

  ## Secure Auth routes
  - name: auth-v1
    _comment: 'GoTrue: /auth/v1/* -> http://vcon-supabase-auth:9999/*'
    url: http://vcon-supabase-auth:9999/
    routes:
      - name: auth-v1-all
        strip_path: true
        paths:
          - /auth/v1/
    plugins:
      - name: cors
      - name: key-auth
        config:
          hide_credentials: false
      - name: acl
        config:
          hide_groups_header: true
          allow:
            - admin
            - anon

  ## Secure REST routes
  - name: rest-v1
    _comment: 'PostgREST: /rest/v1/* -> http://vcon-supabase-rest:3000/*'
    url: http://vcon-supabase-rest:3000/
    routes:
      - name: rest-v1-all
        strip_path: true
        paths:
          - /rest/v1/
    plugins:
      - name: cors
      - name: key-auth
        config:
          hide_credentials: true
      - name: acl
        config:
          hide_groups_header: true
          allow:
            - admin
            - anon

  ## Secure GraphQL routes
  - name: graphql-v1
    _comment: 'PostgREST: /graphql/v1/* -> http://vcon-supabase-rest:3000/rpc/graphql'
    url: http://vcon-supabase-rest:3000/rpc/graphql
    routes:
      - name: graphql-v1-all
        strip_path: true
        paths:
          - /graphql/v1
    plugins:
      - name: cors
      - name: key-auth
        config:
          hide_credentials: true
      - name: request-transformer
        config:
          add:
            headers:
              - Content-Profile:graphql_public
      - name: acl
        config:
          hide_groups_header: true
          allow:
            - admin
            - anon

  ## Storage routes
  - name: storage-v1
    _comment: 'Storage: /storage/v1/* -> http://vcon-supabase-storage:5000/*'
    url: http://vcon-supabase-storage:5000/
    routes:
      - name: storage-v1-all
        strip_path: true
        paths:
          - /storage/v1/
    plugins:
      - name: cors

  ## Health check endpoint
  - name: health
    _comment: 'Health check endpoint'
    url: http://vcon-supabase-auth:9999/health
    routes:
      - name: health-check
        strip_path: true
        paths:
          - /health
    plugins:
      - name: cors
EOF
```

---

## 5. Create Docker Compose File

Create `docker-compose.yml`:

```yaml
# vCON MCP with Self-Hosted Supabase
#
# Usage:
#   Start:    docker compose up -d
#   Stop:     docker compose down
#   Logs:     docker compose logs -f
#   Status:   docker compose ps

name: vcon-mcp

services:

  # ===========================================
  # Ofelia Job Scheduler
  # ===========================================
  ofelia:
    container_name: vcon-mcp-ofelia
    image: mcuadros/ofelia:latest
    restart: unless-stopped
    depends_on:
      vcon-mcp:
        condition: service_healthy
    command: daemon --docker
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock:ro

  # ===========================================
  # vCON MCP Server - Main Application
  # ===========================================
  vcon-mcp:
    container_name: vcon-mcp
    image: public.ecr.aws/r4g1k2s3/vcon-dev/vcon-mcp:main
    restart: unless-stopped
    ports:
      - "3002:3000"
    depends_on:
      vcon-supabase-kong:
        condition: service_started
    environment:
      - SUPABASE_URL=http://vcon-supabase-kong:8000
      - SUPABASE_SERVICE_ROLE_KEY=${SERVICE_ROLE_KEY}
      - SUPABASE_ANON_KEY=${ANON_KEY}
      - MCP_HTTP_STATELESS=true
      - MCP_TRANSPORT=http
      - MCP_HTTP_HOST=0.0.0.0
      - MCP_HTTP_PORT=3000
      #
      # Embedding Configuration - Choose ONE provider:
      #
      # Option 1: Azure OpenAI
      - AZURE_OPENAI_EMBEDDING_ENDPOINT=https://your-resource.openai.azure.com
      - AZURE_OPENAI_EMBEDDING_API_VERSION=2023-05-15
      - AZURE_OPENAI_EMBEDDING_API_KEY=your-azure-api-key
      #
      # Option 2: OpenAI (uncomment and configure)
      # - OPENAI_API_KEY=your-openai-api-key
      #
      # Option 3: Hugging Face (uncomment and configure)
      # - HUGGINGFACE_API_KEY=your-huggingface-api-key
      #
      # Tool categories: read, write, schema, analytics, infra
      # Only enable read operations for production deployments
      - MCP_ENABLED_CATEGORIES=read
      - API_KEYS=your-api-key
    labels:
      ofelia.enabled: "true"
      ofelia.job-exec.embed-vcons.schedule: "0 */10 * * *"
      ofelia.job-exec.embed-vcons.command: "/app/docker-entrypoint.sh script embed-vcons --continuous --limit=500"
      ofelia.job-exec.embed-vcons.no-overlap: "true"
    healthcheck:
      test: ["CMD", "wget", "--no-verbose", "--tries=1", "--spider", "http://127.0.0.1:3000/api/v1/health"]
      interval: 30s
      timeout: 10s
      retries: 3

  # ===========================================
  # Supabase Core Services
  # ===========================================

  # PostgreSQL Database
  vcon-supabase-db:
    container_name: vcon-supabase-db
    image: supabase/postgres:15.8.1.085
    restart: unless-stopped
    volumes:
      - ./volumes/db/realtime.sql:/docker-entrypoint-initdb.d/migrations/99-realtime.sql:Z
      - ./volumes/db/webhooks.sql:/docker-entrypoint-initdb.d/init-scripts/98-webhooks.sql:Z
      - ./volumes/db/roles.sql:/docker-entrypoint-initdb.d/init-scripts/99-roles.sql:Z
      - ./volumes/db/jwt.sql:/docker-entrypoint-initdb.d/init-scripts/99-jwt.sql:Z
      - ./volumes/db/data:/var/lib/postgresql/data:Z
      - ./volumes/db/_supabase.sql:/docker-entrypoint-initdb.d/migrations/97-_supabase.sql:Z
      - ./volumes/db/logs.sql:/docker-entrypoint-initdb.d/migrations/99-logs.sql:Z
      - ./volumes/db/pooler.sql:/docker-entrypoint-initdb.d/migrations/99-pooler.sql:Z
      - vcon-db-config:/etc/postgresql-custom
    healthcheck:
      test: ["CMD", "pg_isready", "-U", "postgres", "-h", "localhost"]
      interval: 5s
      timeout: 5s
      retries: 10
    environment:
      POSTGRES_HOST: /var/run/postgresql
      PGPORT: ${POSTGRES_PORT}
      POSTGRES_PORT: ${POSTGRES_PORT}
      PGPASSWORD: ${POSTGRES_PASSWORD}
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}
      PGDATABASE: ${POSTGRES_DB}
      POSTGRES_DB: ${POSTGRES_DB}
      JWT_SECRET: ${JWT_SECRET}
      JWT_EXP: ${JWT_EXPIRY}
    command:
      - postgres
      - -c
      - config_file=/etc/postgresql/postgresql.conf
      - -c
      - log_min_messages=fatal

  # Kong API Gateway
  vcon-supabase-kong:
    container_name: vcon-supabase-kong
    image: kong:2.8.1
    restart: unless-stopped
    ports:
      - "${KONG_HTTP_PORT}:8000/tcp"
    volumes:
      - ./volumes/api/kong.yml:/home/kong/temp.yml:ro,z
    depends_on:
      vcon-supabase-auth:
        condition: service_healthy
    environment:
      KONG_DATABASE: "off"
      KONG_DECLARATIVE_CONFIG: /home/kong/kong.yml
      KONG_DNS_ORDER: LAST,A,CNAME
      KONG_PLUGINS: request-transformer,cors,key-auth,acl,basic-auth,request-termination
      KONG_NGINX_PROXY_PROXY_BUFFER_SIZE: 160k
      KONG_NGINX_PROXY_PROXY_BUFFERS: 64 160k
      SUPABASE_ANON_KEY: ${ANON_KEY}
      SUPABASE_SERVICE_KEY: ${SERVICE_ROLE_KEY}
      DASHBOARD_USERNAME: ${DASHBOARD_USERNAME}
      DASHBOARD_PASSWORD: ${DASHBOARD_PASSWORD}
    entrypoint: bash -c 'eval "echo \"$$(cat ~/temp.yml)\"" > ~/kong.yml && /docker-entrypoint.sh kong docker-start'

  # GoTrue - Authentication Server
  vcon-supabase-auth:
    container_name: vcon-supabase-auth
    image: supabase/gotrue:v2.184.0
    restart: unless-stopped
    depends_on:
      vcon-supabase-db:
        condition: service_healthy
    healthcheck:
      test: ["CMD", "wget", "--no-verbose", "--tries=1", "--spider", "http://localhost:9999/health"]
      timeout: 5s
      interval: 5s
      retries: 3
    environment:
      GOTRUE_API_HOST: 0.0.0.0
      GOTRUE_API_PORT: 9999
      API_EXTERNAL_URL: ${API_EXTERNAL_URL}

      GOTRUE_DB_DRIVER: postgres
      GOTRUE_DB_DATABASE_URL: postgres://supabase_auth_admin:${POSTGRES_PASSWORD}@${POSTGRES_HOST}:${POSTGRES_PORT}/${POSTGRES_DB}

      GOTRUE_SITE_URL: ${SITE_URL}
      GOTRUE_URI_ALLOW_LIST: ${ADDITIONAL_REDIRECT_URLS}
      GOTRUE_DISABLE_SIGNUP: ${DISABLE_SIGNUP}

      GOTRUE_JWT_ADMIN_ROLES: service_role
      GOTRUE_JWT_AUD: authenticated
      GOTRUE_JWT_DEFAULT_GROUP_NAME: authenticated
      GOTRUE_JWT_EXP: ${JWT_EXPIRY}
      GOTRUE_JWT_SECRET: ${JWT_SECRET}

      GOTRUE_EXTERNAL_EMAIL_ENABLED: ${ENABLE_EMAIL_SIGNUP}
      GOTRUE_EXTERNAL_ANONYMOUS_USERS_ENABLED: ${ENABLE_ANONYMOUS_USERS}
      GOTRUE_MAILER_AUTOCONFIRM: ${ENABLE_EMAIL_AUTOCONFIRM}

      GOTRUE_SMTP_ADMIN_EMAIL: ${SMTP_ADMIN_EMAIL}
      GOTRUE_SMTP_HOST: ${SMTP_HOST}
      GOTRUE_SMTP_PORT: ${SMTP_PORT}
      GOTRUE_SMTP_USER: ${SMTP_USER}
      GOTRUE_SMTP_PASS: ${SMTP_PASS}
      GOTRUE_SMTP_SENDER_NAME: ${SMTP_SENDER_NAME}
      GOTRUE_MAILER_URLPATHS_INVITE: ${MAILER_URLPATHS_INVITE}
      GOTRUE_MAILER_URLPATHS_CONFIRMATION: ${MAILER_URLPATHS_CONFIRMATION}
      GOTRUE_MAILER_URLPATHS_RECOVERY: ${MAILER_URLPATHS_RECOVERY}
      GOTRUE_MAILER_URLPATHS_EMAIL_CHANGE: ${MAILER_URLPATHS_EMAIL_CHANGE}

      GOTRUE_EXTERNAL_PHONE_ENABLED: ${ENABLE_PHONE_SIGNUP}
      GOTRUE_SMS_AUTOCONFIRM: ${ENABLE_PHONE_AUTOCONFIRM}

  # PostgREST - Database REST API
  vcon-supabase-rest:
    container_name: vcon-supabase-rest
    image: postgrest/postgrest:v14.1
    restart: unless-stopped
    depends_on:
      vcon-supabase-db:
        condition: service_healthy
    environment:
      PGRST_DB_URI: postgres://authenticator:${POSTGRES_PASSWORD}@${POSTGRES_HOST}:${POSTGRES_PORT}/${POSTGRES_DB}
      PGRST_DB_SCHEMAS: ${PGRST_DB_SCHEMAS}
      PGRST_DB_ANON_ROLE: anon
      PGRST_JWT_SECRET: ${JWT_SECRET}
      PGRST_DB_USE_LEGACY_GUCS: "false"
      PGRST_APP_SETTINGS_JWT_SECRET: ${JWT_SECRET}
      PGRST_APP_SETTINGS_JWT_EXP: ${JWT_EXPIRY}
    command: ["postgrest"]

  # Storage API
  vcon-supabase-storage:
    container_name: vcon-supabase-storage
    image: supabase/storage-api:v1.33.0
    restart: unless-stopped
    volumes:
      - ./volumes/storage:/var/lib/storage:z
    healthcheck:
      test: ["CMD", "wget", "--no-verbose", "--tries=1", "--spider", "http://localhost:5000/status"]
      timeout: 5s
      interval: 5s
      retries: 3
    depends_on:
      vcon-supabase-db:
        condition: service_healthy
      vcon-supabase-rest:
        condition: service_started
    environment:
      ANON_KEY: ${ANON_KEY}
      SERVICE_KEY: ${SERVICE_ROLE_KEY}
      POSTGREST_URL: http://vcon-supabase-rest:3000
      PGRST_JWT_SECRET: ${JWT_SECRET}
      DATABASE_URL: postgres://supabase_storage_admin:${POSTGRES_PASSWORD}@${POSTGRES_HOST}:${POSTGRES_PORT}/${POSTGRES_DB}
      REQUEST_ALLOW_X_FORWARDED_PATH: "true"
      FILE_SIZE_LIMIT: 52428800
      STORAGE_BACKEND: file
      FILE_STORAGE_BACKEND_PATH: /var/lib/storage
      TENANT_ID: stub
      REGION: stub
      GLOBAL_S3_BUCKET: stub
      ENABLE_IMAGE_TRANSFORMATION: "false"

volumes:
  vcon-db-config:
```

---

## 6. Start the Stack

```bash
cd ~/vcon-mcp
docker compose up -d
```

Watch the startup logs:

```bash
docker compose logs -f
```

Wait until all services are healthy (typically 1-2 minutes for first startup).

---

## 7. Verify Deployment

### 7.1 Check Service Status

```bash
docker compose ps
```

All services should show as "healthy" or "running".

### 7.2 Test Health Endpoint

```bash
curl http://localhost:3002/api/v1/health
```

Expected response:

```json
{"status":"ok"}
```

### 7.3 View Logs

```bash
# All services
docker compose logs -f

# Specific service
docker compose logs -f vcon-mcp
```

---

## 8. Pushing vCONs to vCON MCP

vCON MCP exposes an HTTP API for ingesting vCONs. External systems can push vCONs to the endpoint.

### 8.1 API Endpoint

```
POST http://<docker-host>:3002/api/v1/vcons
```

Replace `<docker-host>` with:
- `localhost` if calling from the same machine
- The machine's IP address or hostname if calling from another system

### 8.2 Example: Push a vCON

```bash
curl -X POST http://localhost:3002/api/v1/vcons \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer your-vcon-api-key" \
  -d '{
    "vcon": "0.0.1",
    "uuid": "unique-vcon-id",
    "created_at": "2024-01-15T10:30:00Z",
    "parties": [...],
    "dialog": [...],
    "analysis": [...],
    "attachments": [...]
  }'
```

### 8.3 Webhook Integration

If your vCON ingestion system supports webhooks, configure it to POST vCONs to:

```
http://<docker-host>:3002/api/v1/vcons
```

#### Conserver Integration

For real-time vCON ingestion from [Conserver](https://github.com/vcon-dev/vcon-server), use the `links.webhook` module to push vCONs directly to vCON MCP.

**Example Conserver Configuration:**

```yaml
# conserver.yml
links:
  push_to_vcon_mcp:
    module: links.webhook
    options:
      webhook-urls:
        - http://vcon-mcp:3000/api/v1/vcons

chains:
  call_processing_chain:
    enabled: 1
    ingress_lists:
      - call_ingress
    links:
      - transcribe_openai
      - diarize
      - summarize
      - push_to_vcon_mcp
    storages:
      - postgres
      - elasticsearch
```

**Configuration Notes:**

- The `push_to_vcon_mcp` link uses `links.webhook` to POST vCONs to the MCP endpoint
- Place the webhook link at the end of the chain to push fully processed vCONs (with transcription, diarization, summaries, etc.)

---

## 9. Configuration Reference

### 9.1 Environment Variables

| Variable | Description | Example |
|----------|-------------|---------|
| `SUPABASE_URL` | Internal URL to Kong gateway | `http://vcon-supabase-kong:8000` |
| `SUPABASE_SERVICE_ROLE_KEY` | Service role JWT for admin access | Generated JWT |
| `SUPABASE_ANON_KEY` | Anonymous user JWT | Generated JWT |
| `MCP_ENABLED_CATEGORIES` | Enabled tool categories | `read` (for production) |
| `API_KEYS` | API keys for authentication | Comma-separated keys |

### 9.2 Embedding Provider Configuration

Choose one of the following embedding providers:

#### Azure OpenAI

```yaml
environment:
  - AZURE_OPENAI_EMBEDDING_ENDPOINT=https://your-resource.openai.azure.com
  - AZURE_OPENAI_EMBEDDING_API_VERSION=2023-05-15
  - AZURE_OPENAI_EMBEDDING_API_KEY=your-api-key
```

#### OpenAI

```yaml
environment:
  - OPENAI_API_KEY=your-openai-api-key
```

#### Hugging Face

```yaml
environment:
  - HUGGINGFACE_API_KEY=your-huggingface-api-key
```

### 9.3 MCP Tool Categories

| Category | Description | Production Use |
|----------|-------------|----------------|
| `read` | Query vCONs, search, analytics | ✅ Recommended |
| `write` | Create/update vCONs | Use with caution |
| `schema` | Modify database schema | Not recommended |
| `analytics` | Heavy analytics operations | Use with caution |
| `infra` | Infrastructure management | Not recommended |

### 9.4 Ofelia Job Scheduler

The embedding job runs every 10 minutes to generate embeddings for new vCONs:

```yaml
labels:
  ofelia.enabled: "true"
  ofelia.job-exec.embed-vcons.schedule: "0 */10 * * *"
  ofelia.job-exec.embed-vcons.command: "/app/docker-entrypoint.sh script embed-vcons --continuous --limit=500"
  ofelia.job-exec.embed-vcons.no-overlap: "true"
```

---

## 10. Operations

### 10.1 Common Commands

```bash
# Start services
docker compose up -d

# Stop services
docker compose down

# View logs
docker compose logs -f
docker compose logs -f vcon-mcp

# Restart a specific service
docker compose restart vcon-mcp

# Check service status
docker compose ps

# Execute command in container
docker compose exec vcon-mcp /app/docker-entrypoint.sh script embed-vcons --limit=100
```

### 10.2 Database Backup

```bash
# Create backup
docker compose exec vcon-supabase-db pg_dump -U postgres postgres > backup-$(date +%Y%m%d).sql

# Restore backup
cat backup.sql | docker compose exec -T vcon-supabase-db psql -U postgres postgres
```

### 10.3 Updating Images

```bash
docker compose pull
docker compose up -d
```

### 10.4 Viewing Database

```bash
# Connect to PostgreSQL
docker compose exec vcon-supabase-db psql -U postgres

# List tables
\dt

# Query vCONs
SELECT uuid, created_at FROM vcons LIMIT 10;
```

---

## 11. Troubleshooting

### 11.1 Services Won't Start

**Check port conflicts:**

```bash
sudo netstat -tulpn | grep -E '3002|8443'
# or
sudo lsof -i :3002
```

**Check Docker resources:**

```bash
docker system df
docker stats --no-stream
```

### 11.2 Database Connection Issues

**Check database is healthy:**

```bash
docker compose logs vcon-supabase-db
docker compose exec vcon-supabase-db pg_isready -U postgres
```

**Reset database (WARNING: destroys all data):**

```bash
docker compose down -v
rm -rf volumes/db/data/*
docker compose up -d
```

### 11.3 Kong Gateway Issues

**Check Kong logs:**

```bash
docker compose logs vcon-supabase-kong
```

**Verify Kong config:**

```bash
docker compose exec vcon-supabase-kong kong config parse /home/kong/kong.yml
```

### 11.4 vCON MCP Health Check Fails

**Check application logs:**

```bash
docker compose logs vcon-mcp
```

**Verify Supabase connection:**

```bash
docker compose exec vcon-mcp wget -qO- http://vcon-supabase-kong:8000/health
```

### 11.5 Embedding Job Not Running

**Check Ofelia logs:**

```bash
docker compose logs ofelia
```

**Run embedding manually:**

```bash
docker compose exec vcon-mcp /app/docker-entrypoint.sh script embed-vcons --limit=100
```

---

## Next Steps

- Review [Security Best Practices](./security.md) for production hardening
- Set up [Performance Monitoring](./performance.md)
- Configure [Kubernetes Deployment](./kubernetes.md) for high availability
- Explore [Cloud Provider Options](./cloud.md) for managed infrastructure

