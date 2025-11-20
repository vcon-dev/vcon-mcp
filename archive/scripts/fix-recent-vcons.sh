#!/bin/bash

# Fix vCons with NULL bodies by processing recent vCons incrementally
# This is more practical for large databases than scanning everything

DAYS_BACK=${1:-7}  # Default to last 7 days
REMOTE_URL="https://ijuooeoejxyjmoxrwgzg.supabase.co"
REMOTE_KEY="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImlqdW9vZW9lanh5am1veHJ3Z3pnIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2MDk4MDU5MywiZXhwIjoyMDc2NTU2NTkzfQ.E2b-hAzUIWPg39jTM3noAScqz8xBoEbpUN3hlFnQNus"

echo "======================================================"
echo "Fixing vCons from last $DAYS_BACK days"
echo "======================================================"
echo ""

# Get UUIDs of vCons from the last N days
echo "Step 1: Finding vCons from last $DAYS_BACK days..."
VCON_UUIDS=$(SUPABASE_URL="$REMOTE_URL" SUPABASE_SERVICE_ROLE_KEY="$REMOTE_KEY" \
  psql -X -A -t -c "
    SELECT uuid 
    FROM vcons 
    WHERE created_at >= NOW() - INTERVAL '$DAYS_BACK days'
    ORDER BY created_at DESC
    LIMIT 100
  " 2>/dev/null)

if [ -z "$VCON_UUIDS" ]; then
  echo "No vCons found or database connection failed"
  echo ""
  echo "Falling back to manual UUID list..."
  echo "Please run the script with specific UUIDs:"
  echo ""
  echo "  npx tsx scripts/fix-attachment-bodies.ts <uuid1> <uuid2> ..."
  echo ""
  exit 1
fi

VCON_COUNT=$(echo "$VCON_UUIDS" | wc -l | tr -d ' ')
echo "Found $VCON_COUNT vCons"
echo ""

echo "Step 2: Fixing each vCon..."
FIXED_ATTACHMENTS=0
FIXED_ANALYSIS=0
ERRORS=0

for UUID in $VCON_UUIDS; do
  echo "  Processing $UUID..."
  OUTPUT=$(SUPABASE_URL="$REMOTE_URL" \
           SUPABASE_SERVICE_ROLE_KEY="$REMOTE_KEY" \
           VCON_S3_BUCKET=vcons \
           AWS_REGION=us-east-1 \
           npx tsx scripts/fix-attachment-bodies.ts "$UUID" 2>&1)
  
  # Extract statistics from output
  ATTACHMENTS=$(echo "$OUTPUT" | grep "Attachments fixed:" | awk '{print $3}')
  ANALYSIS=$(echo "$OUTPUT" | grep "Analysis fixed:" | awk '{print $3}')
  HAS_ERROR=$(echo "$OUTPUT" | grep -c "Error:")
  
  if [ -n "$ATTACHMENTS" ]; then
    FIXED_ATTACHMENTS=$((FIXED_ATTACHMENTS + ATTACHMENTS))
  fi
  
  if [ -n "$ANALYSIS" ]; then
    FIXED_ANALYSIS=$((FIXED_ANALYSIS + ANALYSIS))
  fi
  
  if [ "$HAS_ERROR" -gt 0 ]; then
    ERRORS=$((ERRORS + 1))
    echo "    ❌ Error"
  else
    echo "    ✅ Done (att:$ATTACHMENTS, ana:$ANALYSIS)"
  fi
done

echo ""
echo "======================================================"
echo "SUMMARY"
echo "======================================================"
echo "vCons processed:       $VCON_COUNT"
echo "Attachments fixed:     $FIXED_ATTACHMENTS"
echo "Analysis fixed:        $FIXED_ANALYSIS"
echo "Errors:                $ERRORS"
echo "======================================================"

