#!/bin/bash

# Hourly vCon Sync Script
# Automatically loads recent vCons from S3 to remote Supabase
# Designed to handle intermittent connectivity

set -e

# Configuration
PROJECT_DIR="/Users/thomashowe/Documents/GitHub/vcon-mcp"
LOG_DIR="$PROJECT_DIR/logs"
LOG_FILE="$LOG_DIR/vcon-sync-$(date +%Y%m%d).log"
LOCK_FILE="/tmp/vcon-sync.lock"

# Hours to sync (3 hours to handle gaps if laptop was offline)
SYNC_HOURS=${SYNC_HOURS:-3}

# Create log directory if it doesn't exist
mkdir -p "$LOG_DIR"

# Function to log with timestamp
log() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1" | tee -a "$LOG_FILE"
}

# Function to cleanup on exit
cleanup() {
    rm -f "$LOCK_FILE"
}
trap cleanup EXIT

# Check if another instance is running
if [ -f "$LOCK_FILE" ]; then
    log "Another sync is already running. Exiting."
    exit 0
fi

# Create lock file
touch "$LOCK_FILE"

log "=========================================="
log "Starting vCon hourly sync"
log "Syncing last $SYNC_HOURS hours"
log "=========================================="

# Change to project directory
cd "$PROJECT_DIR"

# Load environment variables from .env
if [ -f .env ]; then
    export $(grep -v '^#' .env | grep REMOTE_SUPABASE | xargs)
    log "Loaded REMOTE_SUPABASE credentials from .env"
else
    log "ERROR: .env file not found"
    exit 1
fi

# Check if credentials are set
if [ -z "$REMOTE_SUPABASE_URL" ] || [ -z "$REMOTE_SUPABASE_KEY" ]; then
    log "ERROR: REMOTE_SUPABASE_URL or REMOTE_SUPABASE_KEY not set in .env"
    exit 1
fi

# Clean quotes from environment variables
export SUPABASE_URL=$(echo $REMOTE_SUPABASE_URL | tr -d '"')
export SUPABASE_SERVICE_ROLE_KEY=$(echo $REMOTE_SUPABASE_KEY | tr -d '"')
export VCON_S3_BUCKET=vcons

log "Database: $SUPABASE_URL"
log "S3 Bucket: $VCON_S3_BUCKET"

# Run the sync
log "Executing sync..."
if npx tsx scripts/load-legacy-vcons.ts --hours=$SYNC_HOURS >> "$LOG_FILE" 2>&1; then
    log "✅ Sync completed successfully"
    
    # Extract summary from last few lines
    tail -20 "$LOG_FILE" | grep -A 10 "LOAD SUMMARY" >> "$LOG_FILE" 2>&1 || true
    
    exit 0
else
    log "❌ Sync failed with exit code $?"
    exit 1
fi

