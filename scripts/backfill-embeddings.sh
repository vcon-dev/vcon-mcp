#!/bin/bash

# Backfill Embeddings Script
# Continuously calls the embed-vcons npm tool until all text units are embedded
# Usage: ./scripts/backfill-embeddings.sh [batch_size] [delay_seconds]

set -e

# Load .env file if it exists (safer method)
if [ -f .env ]; then
  echo "📝 Loading environment from .env file..."
  set -a
  source .env
  set +a
fi

# Configuration
BATCH_SIZE=${1:-500}  # Default 500 items per batch
DELAY=${2:-2}         # Default 2 seconds between batches

# Check required environment variables
if [ -z "$SUPABASE_URL" ] || [ -z "$SUPABASE_SERVICE_ROLE_KEY" ]; then
  echo "❌ Error: Required environment variables not set"
  echo "   SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required"
  echo "   Create a .env file or export these variables"
  exit 1
fi

if [ -z "$OPENAI_API_KEY" ] && [ -z "$HF_API_TOKEN" ]; then
  echo "❌ Error: No embedding provider configured"
  echo "   Set either OPENAI_API_KEY or HF_API_TOKEN"
  exit 1
fi

echo "🚀 Starting embedding backfill..."
echo "   Batch size: $BATCH_SIZE"
echo "   Delay between batches: ${DELAY}s"
if [ -n "$OPENAI_API_KEY" ]; then
  echo "   Provider: OpenAI (text-embedding-3-small)"
else
  echo "   Provider: Hugging Face (all-MiniLM-L6-v2)"
fi
echo ""

TOTAL_EMBEDDED=0
BATCH_COUNT=0

while true; do
  BATCH_COUNT=$((BATCH_COUNT + 1))
  
  echo "📦 Batch $BATCH_COUNT: Processing up to $BATCH_SIZE text units..."
  
  # Run the npm embedding tool and capture output
  OUTPUT=$(npx tsx scripts/embed-vcons.ts --mode=backfill --limit=$BATCH_SIZE 2>&1)
  EXIT_CODE=$?
  
  # Check if the command succeeded
  if [ $EXIT_CODE -ne 0 ]; then
    echo "❌ Error running embedding tool:"
    echo "$OUTPUT"
    exit 1
  fi
  
  # Show abbreviated output (skip the verbose initialization logs)
  echo "$OUTPUT" | grep -E "(Finding text units|Found [0-9]+ text units|Generating embeddings|Processing batch|RESULTS|Embedded|Errors)" | sed 's/^/   /' || true
  
  # Extract the embedded count from the output
  # Look for the line that says "✅ Embedded:  N"
  EMBEDDED=$(echo "$OUTPUT" | grep "✅ Embedded:" | awk '{print $3}' || echo "0")
  ERRORS=$(echo "$OUTPUT" | grep "❌ Errors:" | awk '{print $3}' || echo "0")
  
  # Default to 0 if parsing failed
  EMBEDDED=${EMBEDDED:-0}
  ERRORS=${ERRORS:-0}
  
  TOTAL_EMBEDDED=$((TOTAL_EMBEDDED + EMBEDDED))
  
  echo "   ✅ Embedded: $EMBEDDED"
  if [ "$ERRORS" -gt 0 ]; then
    echo "   ⚠️  Errors: $ERRORS"
  fi
  echo "   📊 Total embedded so far: $TOTAL_EMBEDDED"
  
  # If no items were embedded, we're done
  if [ "$EMBEDDED" -eq 0 ]; then
    echo ""
    echo "🎉 Backfill complete!"
    echo "   Total text units embedded: $TOTAL_EMBEDDED"
    echo "   Batches processed: $BATCH_COUNT"
    break
  fi
  
  # Wait before next batch (rate limiting)
  echo "   ⏳ Waiting ${DELAY}s before next batch..."
  echo ""
  sleep "$DELAY"
done

