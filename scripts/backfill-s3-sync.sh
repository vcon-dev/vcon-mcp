#!/bin/bash

# Backfill S3 Sync Script
# Repeatedly calls the sync-to-s3 Edge Function to process all vCons from the past N days

set -e

# Configuration
SUPABASE_URL="${SUPABASE_URL}"
SERVICE_ROLE_KEY="${SUPABASE_SERVICE_ROLE_KEY}"
API_KEY="${SUPABASE_API_KEY:-${SUPABASE_ANON_KEY}}"

# Parameters
SINCE_DAYS="${1:-7}"  # Days to go back (default: 7)
BATCH_SIZE="${2:-50}"  # Batch size per request (default: 50)
DELAY="${3:-2}"  # Delay between batches in seconds (default: 2)

# Colors for output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

# Check if required environment variables are set
if [ -z "$SERVICE_ROLE_KEY" ]; then
  echo -e "${RED}Error: SUPABASE_SERVICE_ROLE_KEY environment variable is required${NC}"
  echo "Usage: SUPABASE_SERVICE_ROLE_KEY=your_key ./scripts/backfill-s3-sync.sh [days] [batch_size] [delay]"
  exit 1
fi

if [ -z "$SUPABASE_URL" ]; then
  echo -e "${RED}Error: SUPABASE_URL environment variable is required${NC}"
  echo "Usage: SUPABASE_URL=your_url SUPABASE_SERVICE_ROLE_KEY=your_key ./scripts/backfill-s3-sync.sh [days] [batch_size] [delay]"
  exit 1
fi

if [ -z "$API_KEY" ]; then
  echo -e "${RED}Error: SUPABASE_API_KEY or SUPABASE_ANON_KEY environment variable is required${NC}"
  echo "Usage: SUPABASE_API_KEY=your_key SUPABASE_SERVICE_ROLE_KEY=your_key ./scripts/backfill-s3-sync.sh [days] [batch_size] [delay]"
  exit 1
fi

echo -e "${GREEN}Starting S3 sync backfill...${NC}"
echo "  Days to backfill: $SINCE_DAYS"
echo "  Batch size: $BATCH_SIZE"
echo "  Delay between batches: ${DELAY}s"
echo ""

total_synced=0
total_embedded=0
total_errors=0
batch_num=0

while true; do
  batch_num=$((batch_num + 1))
  
  echo -e "${YELLOW}[Batch $batch_num]${NC} Syncing up to $BATCH_SIZE vCons from the past $SINCE_DAYS days..."
  
  # Call the Edge Function
  http_code=$(curl -s -o /tmp/sync_response.json -w "%{http_code}" -X GET \
    "${SUPABASE_URL}/functions/v1/sync-to-s3?since_days=${SINCE_DAYS}&limit=${BATCH_SIZE}" \
    -H "Authorization: Bearer ${SERVICE_ROLE_KEY}" \
    -H "apikey: ${API_KEY}")
  
  response=$(cat /tmp/sync_response.json 2>/dev/null || echo "")
  rm -f /tmp/sync_response.json
  
  # Check HTTP status code
  if [ "$http_code" != "200" ]; then
    echo -e "${RED}HTTP Error: $http_code${NC}"
    echo "Response: $response"
    echo ""
    echo "Continuing after 5 second delay..."
    sleep 5
    continue
  fi
  
  # Check if response is valid JSON
  if ! echo "$response" | grep -q "^{"; then
    echo -e "${YELLOW}Warning: Invalid JSON response${NC}"
    echo "Response: $response"
    echo ""
    echo "Continuing after 5 second delay..."
    sleep 5
    continue
  fi
  
  # Parse JSON response (requires jq)
  if command -v jq &> /dev/null; then
    # Check if jq can parse the response
    if ! echo "$response" | jq . >/dev/null 2>&1; then
      echo -e "${YELLOW}Warning: Failed to parse JSON response${NC}"
      echo "Response: $response"
      echo ""
      echo "Continuing after 5 second delay..."
      sleep 5
      continue
    fi
    
    synced=$(echo "$response" | jq -r '.synced // 0' 2>/dev/null || echo "0")
    embedded=$(echo "$response" | jq -r '.embedded // 0' 2>/dev/null || echo "0")
    errors=$(echo "$response" | jq -r '.errors // 0' 2>/dev/null || echo "0")
    total_processed=$(echo "$response" | jq -r '.total_processed // 0' 2>/dev/null || echo "0")
    message=$(echo "$response" | jq -r '.message // ""' 2>/dev/null || echo "")
    error_msg=$(echo "$response" | jq -r '.error // ""' 2>/dev/null || echo "")
    
    if [ -n "$error_msg" ] && [ "$error_msg" != "null" ] && [ "$error_msg" != "" ]; then
      echo -e "${RED}Error: $error_msg${NC}"
      echo "Response: $response"
      echo ""
      echo "Continuing after 5 second delay..."
      sleep 5
      continue
    fi
    
    if [ "$synced" = "0" ] && [ "$total_processed" = "0" ]; then
      if [ -n "$message" ] && [ "$message" != "null" ] && [ "$message" != "" ]; then
        echo -e "${GREEN}✓ $message${NC}"
      else
        echo -e "${GREEN}✓ No more vCons to sync${NC}"
      fi
      break
    fi
    
    total_synced=$((total_synced + synced))
    total_embedded=$((total_embedded + embedded))
    total_errors=$((total_errors + errors))
    
    echo -e "  ${GREEN}✓ Synced: $synced${NC} | Embedded: $embedded | Errors: $errors | Total processed: $total_processed"
    
    # If we processed fewer than the batch size, we're done
    if [ "$total_processed" -lt "$BATCH_SIZE" ]; then
      echo -e "${GREEN}✓ All vCons processed (processed $total_processed < batch size $BATCH_SIZE)${NC}"
      break
    fi
    
    # Wait before next batch
    if [ "$DELAY" -gt 0 ]; then
      echo "  Waiting ${DELAY}s before next batch..."
      sleep "$DELAY"
    fi
  else
    # Fallback if jq is not available
    echo "Response: $response"
    if echo "$response" | grep -q '"synced":0'; then
      echo -e "${GREEN}✓ No more vCons to sync${NC}"
      break
    fi
    echo "  (Install 'jq' for better output parsing)"
    
    if [ "$DELAY" -gt 0 ]; then
      sleep "$DELAY"
    fi
  fi
done

echo ""
echo -e "${GREEN}═══════════════════════════════════════${NC}"
echo -e "${GREEN}Backfill Complete!${NC}"
echo -e "${GREEN}═══════════════════════════════════════${NC}"
echo "  Total batches: $batch_num"
echo "  Total synced: $total_synced"
echo "  Total embedded: $total_embedded"
echo "  Total errors: $total_errors"
echo ""

