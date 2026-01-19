# =============================================================================
# vCon MCP Server - Multi-stage Docker Build
# =============================================================================
# This Dockerfile creates an optimized production image that supports:
# - Running the MCP server (default)
# - Running scripts via `docker run <image> script <script-name>`
# - Running database migrations via `docker run <image> migrate`
# =============================================================================

# -----------------------------------------------------------------------------
# Stage 1: Build Stage
# -----------------------------------------------------------------------------
FROM node:20-alpine AS builder

WORKDIR /app

# Install build dependencies for native modules
RUN apk add --no-cache python3 make g++

# Copy package files for dependency installation
COPY package.json package-lock.json ./

# Install all dependencies (including devDependencies for build)
RUN npm ci

# Copy source code
COPY tsconfig.json ./
COPY src/ ./src/

# Build TypeScript to JavaScript
RUN npm run build

# -----------------------------------------------------------------------------
# Stage 2: Production Stage
# -----------------------------------------------------------------------------
FROM node:20-alpine AS production

WORKDIR /app

# Build arguments for version information (set by CI/CD)
ARG VCON_MCP_VERSION=dev
ARG VCON_MCP_GIT_COMMIT=unknown
ARG VCON_MCP_BUILD_TIME

# Set version environment variables
ENV VCON_MCP_VERSION=${VCON_MCP_VERSION} \
    VCON_MCP_GIT_COMMIT=${VCON_MCP_GIT_COMMIT} \
    VCON_MCP_BUILD_TIME=${VCON_MCP_BUILD_TIME}

# Install runtime dependencies including bash for supabase CLI
RUN apk add --no-cache dumb-init bash curl

# Create non-root user for security
RUN addgroup -g 1001 -S nodejs \
    && adduser -S vcon -u 1001 -G nodejs

# Copy package files
COPY package.json package-lock.json ./

# Install production dependencies only
RUN npm ci --omit=dev && npm cache clean --force

# Install tsx globally for running scripts
RUN npm install -g tsx

# Install Supabase CLI binary for running migrations
# Download from GitHub releases - using linux-amd64 tar.gz
ARG SUPABASE_CLI_VERSION=2.67.1
RUN curl -fsSL "https://github.com/supabase/cli/releases/download/v${SUPABASE_CLI_VERSION}/supabase_linux_amd64.tar.gz" -o /tmp/supabase.tar.gz \
    && tar -xzf /tmp/supabase.tar.gz -C /usr/local/bin \
    && rm /tmp/supabase.tar.gz \
    && chmod +x /usr/local/bin/supabase

# Copy built artifacts from builder stage
COPY --from=builder /app/dist ./dist

# Copy scripts directory for running utility scripts
COPY scripts/ ./scripts/

# Copy supabase directory for migrations
COPY supabase/ ./supabase/

# Set ownership
RUN chown -R vcon:nodejs /app

# Switch to non-root user
USER vcon

# Environment variables with defaults
ENV NODE_ENV=production \
    MCP_TRANSPORT=http \
    MCP_HTTP_HOST=0.0.0.0 \
    MCP_HTTP_PORT=3000

# Expose HTTP port
EXPOSE 3000

# Healthcheck for HTTP transport
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD wget --no-verbose --tries=1 --spider http://localhost:${MCP_HTTP_PORT}/api/v1/health || exit 1

# Create entrypoint script
COPY --chown=vcon:nodejs <<'EOF' /app/docker-entrypoint.sh
#!/bin/sh
set -e

case "$1" in
    migrate)
        shift
        echo "🔄 Running database migrations..."
        
        # Check for required environment variable
        if [ -z "$SUPABASE_DB_URL" ]; then
            echo ""
            echo "❌ Error: SUPABASE_DB_URL environment variable is required"
            echo ""
            echo "Usage:"
            echo "  docker run -e SUPABASE_DB_URL='postgresql://...' <image> migrate"
            echo ""
            echo "The database URL format:"
            echo "  postgresql://postgres.[PROJECT_REF]:[PASSWORD]@aws-0-[REGION].pooler.supabase.com:6543/postgres"
            echo ""
            echo "You can find this in your Supabase Dashboard:"
            echo "  Settings → Database → Connection string (URI)"
            echo ""
            exit 1
        fi
        
        cd /app
        echo "📁 Using migrations from /app/supabase/migrations/"
        echo "🗄️  Connecting to database..."
        echo ""
        
        # Run supabase db push with the provided database URL
        exec supabase db push --db-url "$SUPABASE_DB_URL" "$@"
        ;;
    migrate-status)
        shift
        echo "📊 Checking migration status..."
        
        if [ -z "$SUPABASE_DB_URL" ]; then
            echo "❌ Error: SUPABASE_DB_URL environment variable is required"
            exit 1
        fi
        
        cd /app
        exec supabase migration list --db-url "$SUPABASE_DB_URL" "$@"
        ;;
    script)
        shift
        SCRIPT_NAME="$1"
        shift
        if [ -f "/app/scripts/${SCRIPT_NAME}.ts" ]; then
            exec tsx "/app/scripts/${SCRIPT_NAME}.ts" "$@"
        elif [ -f "/app/scripts/${SCRIPT_NAME}" ]; then
            exec tsx "/app/scripts/${SCRIPT_NAME}" "$@"
        else
            echo "Error: Script '${SCRIPT_NAME}' not found in /app/scripts/"
            echo "Available scripts:"
            ls -1 /app/scripts/*.ts 2>/dev/null | xargs -I{} basename {} .ts || echo "No .ts scripts found"
            exit 1
        fi
        ;;
    tsx)
        shift
        exec tsx "$@"
        ;;
    node)
        shift
        exec node "$@"
        ;;
    help)
        echo "vCon MCP Server Docker Image"
        echo ""
        echo "Usage:"
        echo "  docker run <image>                           - Start the MCP server"
        echo "  docker run <image> migrate                   - Run database migrations"
        echo "  docker run <image> migrate-status            - Check migration status"
        echo "  docker run <image> script <name> [args...]   - Run a script from /app/scripts/"
        echo "  docker run <image> tsx <script>              - Run TypeScript directly"
        echo "  docker run <image> node <script>             - Run Node.js directly"
        echo "  docker run <image> help                      - Show this help"
        echo ""
        echo "Migration Commands:"
        echo "  migrate        - Push all pending migrations to the database"
        echo "  migrate-status - List all migrations and their status"
        echo ""
        echo "  Required environment variable for migrations:"
        echo "    SUPABASE_DB_URL - PostgreSQL connection string"
        echo "    Example: postgresql://postgres.[PROJECT_REF]:[PASSWORD]@aws-0-[REGION].pooler.supabase.com:6543/postgres"
        echo ""
        echo "Available scripts:"
        ls -1 /app/scripts/*.ts 2>/dev/null | xargs -I{} basename {} .ts || echo "No .ts scripts found"
        echo ""
        echo "Environment Variables:"
        echo "  SUPABASE_URL                       - Supabase project URL (required)"
        echo "  SUPABASE_SERVICE_ROLE_KEY          - Supabase service role key (recommended)"
        echo "  SUPABASE_ANON_KEY                  - Supabase anonymous key (alternative)"
        echo "  SUPABASE_DB_URL                    - Database URL for migrations"
        echo "  MCP_TRANSPORT                      - Transport type: http or stdio (default: http)"
        echo "  MCP_HTTP_HOST                      - HTTP host to bind (default: 0.0.0.0)"
        echo "  MCP_HTTP_PORT                      - HTTP port to listen on (default: 3000)"
        echo "  MCP_HTTP_STATELESS                 - Enable multi-client support (default: false)"
        echo "  OPENAI_API_KEY                     - OpenAI API key (for embeddings)"
        echo "  AZURE_OPENAI_EMBEDDING_ENDPOINT    - Azure OpenAI base endpoint (e.g., https://your-resource.openai.azure.com)"
        echo "  AZURE_OPENAI_EMBEDDING_API_KEY     - Azure OpenAI API key"
        echo ""
        echo "Version Information (set by CI/CD):"
        echo "  VCON_MCP_VERSION                   - CalVer version (e.g., 2026.01.18)"
        echo "  VCON_MCP_GIT_COMMIT                - Git commit short hash"
        echo "  VCON_MCP_BUILD_TIME                - ISO timestamp of build"
        echo ""
        echo "Current Version: ${VCON_MCP_VERSION:-dev} (${VCON_MCP_GIT_COMMIT:-unknown})"
        exit 0
        ;;
    *)
        exec dumb-init node /app/dist/index.js "$@"
        ;;
esac
EOF

RUN chmod +x /app/docker-entrypoint.sh

ENTRYPOINT ["/app/docker-entrypoint.sh"]
CMD []
