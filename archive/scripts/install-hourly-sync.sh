#!/bin/bash

# Quick installer for hourly vCon sync

set -e

echo "🚀 Installing hourly vCon sync job..."
echo ""

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$PROJECT_DIR"

# Step 1: Make script executable
echo "1️⃣  Making sync script executable..."
chmod +x scripts/sync-vcons-hourly.sh
echo "   ✅ Done"
echo ""

# Step 2: Create logs directory
echo "2️⃣  Creating logs directory..."
mkdir -p logs
echo "   ✅ Done"
echo ""

# Step 3: Test the script
echo "3️⃣  Testing sync script (this may take a minute)..."
if ./scripts/sync-vcons-hourly.sh; then
    echo "   ✅ Test successful!"
else
    echo "   ❌ Test failed. Please check the error above."
    exit 1
fi
echo ""

# Step 4: Install launchd job
echo "4️⃣  Installing launchd job..."
cp scripts/com.vcon.hourly-sync.plist ~/Library/LaunchAgents/
echo "   ✅ Copied to ~/Library/LaunchAgents/"
echo ""

# Step 5: Load the job
echo "5️⃣  Loading launchd job..."
launchctl load ~/Library/LaunchAgents/com.vcon.hourly-sync.plist 2>&1 || echo "   (Note: Job may already be loaded)"
echo "   ✅ Done"
echo ""

# Step 6: Verify
echo "6️⃣  Verifying installation..."
if launchctl list | grep -q "com.vcon.hourly-sync"; then
    echo "   ✅ Job is loaded and running!"
else
    echo "   ⚠️  Job may not be loaded. Try manually:"
    echo "      launchctl load ~/Library/LaunchAgents/com.vcon.hourly-sync.plist"
fi
echo ""

echo "=========================================="
echo "✅ Installation complete!"
echo "=========================================="
echo ""
echo "The sync will run every hour automatically."
echo ""
echo "📊 To view logs:"
echo "   tail -f logs/vcon-sync-\$(date +%Y%m%d).log"
echo ""
echo "🔧 To manage the job:"
echo "   launchctl list | grep vcon              # Check status"
echo "   launchctl start com.vcon.hourly-sync    # Run now"
echo "   launchctl stop com.vcon.hourly-sync     # Stop"
echo "   launchctl unload ~/Library/LaunchAgents/com.vcon.hourly-sync.plist  # Disable"
echo ""
echo "📖 For full documentation, see:"
echo "   scripts/SYNC_SETUP.md"
echo ""

