#!/bin/bash

# Backfill Embeddings Script
# Continuously calls the embed-vcons function until all text units are embedded
# Usage: ./scripts/backfill-embeddings.sh [batch_size] [delay_seconds]

set -e

# Configuration
BATCH_SIZE=${1:-500}  # Default 500 items per batch
DELAY=${2:-2}         # Default 2 seconds between batches
ENDPOINT="${SUPABASE_URL:-http://127.0.0.1:54321}/functions/v1/embed-vcons"
ANON_KEY="${SUPABASE_ANON_KEY:-eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0}"

echo "🚀 Starting embedding backfill..."
echo "   Batch size: $BATCH_SIZE"
echo "   Delay between batches: ${DELAY}s"
echo "   Endpoint: $ENDPOINT"
echo ""

TOTAL_EMBEDDED=0
BATCH_COUNT=0

while true; do
  BATCH_COUNT=$((BATCH_COUNT + 1))
  
  echo "📦 Batch $BATCH_COUNT: Processing up to $BATCH_SIZE text units..."
  
  # Call the function
  RESPONSE=$(curl -sS "$ENDPOINT?mode=backfill&limit=$BATCH_SIZE" \
    -H "Authorization: Bearer $ANON_KEY")
  
  # Parse the response
  EMBEDDED=$(echo "$RESPONSE" | jq -r '.embedded // 0')
  ERRORS=$(echo "$RESPONSE" | jq -r '.errors // 0')
  ERROR_MSG=$(echo "$RESPONSE" | jq -r '.error // ""')
  
  if [ -n "$ERROR_MSG" ]; then
    echo "❌ Error: $ERROR_MSG"
    exit 1
  fi
  
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

