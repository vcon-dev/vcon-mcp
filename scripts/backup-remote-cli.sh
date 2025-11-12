#!/bin/bash

# Backup remote Supabase database to local using Supabase CLI
# This uses the built-in `supabase db dump` command which is faster and more reliable

set -e

echo "💾 Backing up remote database using Supabase CLI"
echo "=================================================="
echo ""

# Check if linked project exists
if ! supabase projects list 2>/dev/null | grep -q "●"; then
    echo "❌ Error: No linked Supabase project found"
    echo "   Link your project first: supabase link --project-ref ijuooeoejxyjmoxrwgzg"
    exit 1
fi

# Set backup file name with timestamp
BACKUP_FILE="backup_$(date +%Y%m%d_%H%M%S).sql"
BACKUP_DIR="./backups"

# Create backups directory if it doesn't exist
mkdir -p "$BACKUP_DIR"

FULL_BACKUP_PATH="$BACKUP_DIR/$BACKUP_FILE"

echo "📤 Dumping data from remote database..."
echo "   Output: $FULL_BACKUP_PATH"
echo ""

# Dump data only (not schema, since we already have migrations)
supabase db dump \
    --linked \
    --data-only \
    --schema public \
    -f "$FULL_BACKUP_PATH"

if [ $? -eq 0 ]; then
    echo ""
    echo "✅ Backup completed successfully!"
    echo "   File: $FULL_BACKUP_PATH"
    echo ""
    echo "📊 File size: $(du -h "$FULL_BACKUP_PATH" | cut -f1)"
    echo ""
    echo "To restore to local database:"
    echo "  psql postgresql://postgres:postgres@127.0.0.1:54322/postgres -f $FULL_BACKUP_PATH"
    echo ""
    echo "Or use the restore script:"
    echo "  ./scripts/restore-backup.sh $FULL_BACKUP_PATH"
else
    echo ""
    echo "❌ Backup failed!"
    exit 1
fi

