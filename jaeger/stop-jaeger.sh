#!/bin/bash

# Stop Jaeger OpenTelemetry Backend
# Stops and removes the Jaeger all-in-one container
# Usage: ./jaeger/stop-jaeger.sh

set -e

# Get the directory where this script is located (jaeger subdirectory)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

echo "🛑 Stopping Jaeger OpenTelemetry backend..."

# Check if docker-compose is available (or docker compose)
if docker compose version &> /dev/null; then
    DOCKER_COMPOSE="docker compose"
elif command -v docker-compose &> /dev/null; then
    DOCKER_COMPOSE="docker-compose"
else
    echo "❌ Error: docker-compose is not available"
    exit 1
fi

# Change to jaeger directory (where docker-compose.yml is located)
cd "$SCRIPT_DIR"

# Check if container is running
if ! docker ps --format '{{.Names}}' | grep -q "^jaeger-otel-backend$"; then
    echo "ℹ️  Jaeger container is not running"
    # Try to remove if it exists but is stopped
    if docker ps -a --format '{{.Names}}' | grep -q "^jaeger-otel-backend$"; then
        echo "   Removing stopped container..."
        $DOCKER_COMPOSE rm -f jaeger
    fi
    exit 0
fi

# Stop and remove the container
echo "   Stopping container..."
$DOCKER_COMPOSE stop jaeger
$DOCKER_COMPOSE rm -f jaeger

echo ""
echo "✅ Jaeger has been stopped and removed"

