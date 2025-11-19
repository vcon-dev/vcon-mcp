#!/bin/bash

# Restore a Supabase backup file to local database

set -e

if [ -z "$1" ]; then
    echo "Usage: $0 <backup_file.sql>"
    echo ""
    echo "Example:"
    echo "  $0 ./backups/backup_20251112_120000.sql"
    exit 1
fi

BACKUP_FILE="$1"

if [ ! -f "$BACKUP_FILE" ]; then
    echo "❌ Error: Backup file not found: $BACKUP_FILE"
    exit 1
fi

echo "📥 Restoring backup to local database"
echo "======================================"
echo ""
echo "Backup file: $BACKUP_FILE"
echo "Database: postgresql://postgres:postgres@127.0.0.1:54322/postgres"
echo ""

# Check if local Supabase is running
if ! pg_isready -h 127.0.0.1 -p 54322 -U postgres >/dev/null 2>&1; then
    echo "❌ Error: Local Supabase database is not running"
    echo "   Start it with: supabase start"
    exit 1
fi

echo "⚠️  WARNING: This will restore data to your local database"
echo "   Make sure you want to proceed!"
echo ""
read -p "Continue? (yes/no): " confirm

if [ "$confirm" != "yes" ] && [ "$confirm" != "y" ]; then
    echo "❌ Restore cancelled"
    exit 0
fi

echo ""
echo "Restoring..."

# Restore the backup
psql postgresql://postgres:postgres@127.0.0.1:54322/postgres -f "$BACKUP_FILE"

if [ $? -eq 0 ]; then
    echo ""
    echo "✅ Restore completed successfully!"
else
    echo ""
    echo "❌ Restore failed!"
    exit 1
fi





