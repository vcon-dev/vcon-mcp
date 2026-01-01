# =============================================================================
# vCon MCP Server - Multi-stage Docker Build
# =============================================================================
# This Dockerfile creates an optimized production image that supports:
# - Running the MCP server (default)
# - Running scripts via `docker run <image> script <script-name>`
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

# Install runtime dependencies
RUN apk add --no-cache dumb-init

# Create non-root user for security
RUN addgroup -g 1001 -S nodejs \
    && adduser -S vcon -u 1001 -G nodejs

# Copy package files
COPY package.json package-lock.json ./

# Install production dependencies only
RUN npm ci --omit=dev && npm cache clean --force

# Install tsx globally for running scripts
RUN npm install -g tsx

# Copy built artifacts from builder stage
COPY --from=builder /app/dist ./dist

# Copy scripts directory for running utility scripts
COPY scripts/ ./scripts/

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
        echo "  docker run <image> script <name> [args...]   - Run a script from /app/scripts/"
        echo "  docker run <image> tsx <script>              - Run TypeScript directly"
        echo "  docker run <image> node <script>             - Run Node.js directly"
        echo "  docker run <image> help                      - Show this help"
        echo ""
        echo "Available scripts:"
        ls -1 /app/scripts/*.ts 2>/dev/null | xargs -I{} basename {} .ts || echo "No .ts scripts found"
        echo ""
        echo "Environment Variables:"
        echo "  SUPABASE_URL                       - Supabase project URL (required)"
        echo "  SUPABASE_SERVICE_ROLE_KEY          - Supabase service role key (recommended)"
        echo "  SUPABASE_ANON_KEY                  - Supabase anonymous key (alternative)"
        echo "  MCP_TRANSPORT                      - Transport type: http or stdio (default: http)"
        echo "  MCP_HTTP_HOST                      - HTTP host to bind (default: 0.0.0.0)"
        echo "  MCP_HTTP_PORT                      - HTTP port to listen on (default: 3000)"
        echo "  MCP_HTTP_STATELESS                 - Enable multi-client support (default: false)"
        echo "  OPENAI_API_KEY                     - OpenAI API key (for embeddings)"
        echo "  AZURE_OPENAI_EMBEDDING_ENDPOINT    - Azure OpenAI base endpoint (e.g., https://your-resource.openai.azure.com)"
        echo "  AZURE_OPENAI_EMBEDDING_API_KEY     - Azure OpenAI API key"
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
