#!/bin/bash

# Start Jaeger OpenTelemetry Backend
# Starts the Jaeger all-in-one container for testing OpenTelemetry observability
# Usage: ./jaeger/start-jaeger.sh

set -e

# Get the directory where this script is located (jaeger subdirectory)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

echo "🚀 Starting Jaeger OpenTelemetry backend..."

# Check if Docker is available
if ! command -v docker &> /dev/null; then
    echo "❌ Error: Docker is not installed or not in PATH"
    echo "   Please install Docker: https://docs.docker.com/get-docker/"
    exit 1
fi

# Check if docker-compose is available (or docker compose)
if docker compose version &> /dev/null; then
    DOCKER_COMPOSE="docker compose"
elif command -v docker-compose &> /dev/null; then
    DOCKER_COMPOSE="docker-compose"
else
    echo "❌ Error: docker-compose is not available"
    echo "   Please install docker-compose or use Docker with compose plugin"
    exit 1
fi

# Change to jaeger directory (where docker-compose.yml is located)
cd "$SCRIPT_DIR"

# Check if container is already running
if docker ps --format '{{.Names}}' | grep -q "^jaeger-otel-backend$"; then
    echo "ℹ️  Jaeger container is already running"
    echo ""
    echo "📊 Jaeger UI: http://localhost:16686"
    echo "📡 OTLP Endpoint: http://localhost:4318"
    exit 0
fi

# Start the container
echo "   Starting container..."
$DOCKER_COMPOSE up -d jaeger

# Wait for container to be healthy
echo "   Waiting for Jaeger to be ready..."
for i in {1..30}; do
    if docker ps --format '{{.Names}}' | grep -q "^jaeger-otel-backend$"; then
        if docker inspect jaeger-otel-backend --format '{{.State.Health.Status}}' 2>/dev/null | grep -q "healthy"; then
            echo "✅ Jaeger is ready!"
            break
        fi
    fi
    sleep 1
done

# Verify container is running
if ! docker ps --format '{{.Names}}' | grep -q "^jaeger-otel-backend$"; then
    echo "❌ Error: Failed to start Jaeger container"
    echo "   Check logs with: docker logs jaeger-otel-backend"
    exit 1
fi

echo ""
echo "✅ Jaeger OpenTelemetry backend is running!"
echo ""
echo "📊 Jaeger UI: http://localhost:16686"
echo "📡 OTLP Endpoint: http://localhost:4318"
echo ""
echo "💡 Configure your server with:"
echo "   OTEL_ENABLED=true"
echo "   OTEL_EXPORTER_TYPE=otlp"
echo "   OTEL_ENDPOINT=http://localhost:4318"
echo ""
echo "🛑 To stop Jaeger, run: ./jaeger/stop-jaeger.sh"

