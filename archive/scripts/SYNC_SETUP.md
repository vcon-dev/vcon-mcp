# Automated Hourly vCon Sync Setup

This guide helps you set up automated hourly syncing of vCons from S3 to your remote Supabase database.

## Overview

The sync runs every hour and loads vCons from the last 3 hours (to handle gaps if your laptop was offline). It uses macOS's `launchd` system for reliable background execution.

## Files

- `sync-vcons-hourly.sh` - The sync script
- `com.vcon.hourly-sync.plist` - The launchd configuration
- `logs/` - Directory for sync logs (created automatically)

## Installation

### 1. Make the script executable

```bash
chmod +x /Users/thomashowe/Documents/GitHub/vcon-mcp/scripts/sync-vcons-hourly.sh
```

### 2. Test the script manually

```bash
cd /Users/thomashowe/Documents/GitHub/vcon-mcp
./scripts/sync-vcons-hourly.sh
```

Check the output and verify it works correctly.

### 3. Install the launchd job

```bash
# Copy the plist to LaunchAgents directory
cp scripts/com.vcon.hourly-sync.plist ~/Library/LaunchAgents/

# Load the job
launchctl load ~/Library/LaunchAgents/com.vcon.hourly-sync.plist
```

### 4. Verify it's running

```bash
# Check if the job is loaded
launchctl list | grep vcon

# View recent logs
tail -f logs/vcon-sync-$(date +%Y%m%d).log
```

## Management Commands

### Check status
```bash
launchctl list | grep vcon
```

### Stop the sync (temporarily)
```bash
launchctl stop com.vcon.hourly-sync
```

### Start the sync
```bash
launchctl start com.vcon.hourly-sync
```

### Unload (disable completely)
```bash
launchctl unload ~/Library/LaunchAgents/com.vcon.hourly-sync.plist
```

### Reload (after making changes)
```bash
launchctl unload ~/Library/LaunchAgents/com.vcon.hourly-sync.plist
launchctl load ~/Library/LaunchAgents/com.vcon.hourly-sync.plist
```

### Trigger manually (without waiting for schedule)
```bash
launchctl start com.vcon.hourly-sync
```

## Viewing Logs

### Today's sync log
```bash
tail -f logs/vcon-sync-$(date +%Y%m%d).log
```

### All logs
```bash
ls -lh logs/
```

### Last 50 lines of today's log
```bash
tail -50 logs/vcon-sync-$(date +%Y%m%d).log
```

### View stdout/stderr
```bash
tail -f logs/vcon-sync-stdout.log
tail -f logs/vcon-sync-stderr.log
```

## Configuration

### Change sync frequency

Edit the `StartInterval` in `com.vcon.hourly-sync.plist`:

```xml
<!-- Every 2 hours = 7200 seconds -->
<key>StartInterval</key>
<integer>7200</integer>

<!-- Every 30 minutes = 1800 seconds -->
<key>StartInterval</key>
<integer>1800</integer>
```

Then reload:
```bash
launchctl unload ~/Library/LaunchAgents/com.vcon.hourly-sync.plist
cp scripts/com.vcon.hourly-sync.plist ~/Library/LaunchAgents/
launchctl load ~/Library/LaunchAgents/com.vcon.hourly-sync.plist
```

### Change time window

Set `SYNC_HOURS` environment variable in the script or when running:

```bash
# In the script
SYNC_HOURS=6  # Load last 6 hours

# Or as environment variable
SYNC_HOURS=6 ./scripts/sync-vcons-hourly.sh
```

## Troubleshooting

### Job not running

1. Check if it's loaded:
   ```bash
   launchctl list | grep vcon
   ```

2. Check for errors:
   ```bash
   tail -100 logs/vcon-sync-stderr.log
   ```

3. Try running manually:
   ```bash
   ./scripts/sync-vcons-hourly.sh
   ```

### Permission issues

Ensure the script is executable:
```bash
chmod +x scripts/sync-vcons-hourly.sh
```

### Credentials not found

Verify your `.env` file has:
```bash
REMOTE_SUPABASE_URL="https://..."
REMOTE_SUPABASE_KEY="eyJ..."
```

### Too many duplicate errors

This is normal if the job runs frequently. The script loads the last 3 hours to handle gaps, so there will be overlap. Duplicates are automatically skipped.

## How It Works

1. **Every hour** (or your configured interval), launchd triggers the script
2. The script loads the last **3 hours** of vCons from S3
3. Duplicates are automatically skipped using UUID tracking
4. Results are logged to `logs/vcon-sync-YYYYMMDD.log`
5. If the laptop was offline, the next sync will catch up (due to the 3-hour window)

## Laptop Sleep/Wake Behavior

- The job will NOT run when your laptop is asleep
- When the laptop wakes up, launchd will run any missed jobs
- The 3-hour window ensures you catch up on missed vCons

## Uninstalling

```bash
# Unload the job
launchctl unload ~/Library/LaunchAgents/com.vcon.hourly-sync.plist

# Remove the plist file
rm ~/Library/LaunchAgents/com.vcon.hourly-sync.plist

# Optionally remove logs
rm -rf logs/vcon-sync-*
```

## Advanced: Run on specific schedule (e.g., business hours only)

Replace `StartInterval` with `StartCalendarInterval` in the plist:

```xml
<!-- Run every hour between 9 AM and 6 PM -->
<key>StartCalendarInterval</key>
<array>
    <dict>
        <key>Hour</key>
        <integer>9</integer>
        <key>Minute</key>
        <integer>0</integer>
    </dict>
    <dict>
        <key>Hour</key>
        <integer>10</integer>
        <key>Minute</key>
        <integer>0</integer>
    </dict>
    <!-- Add more hours as needed -->
    <dict>
        <key>Hour</key>
        <integer>18</integer>
        <key>Minute</key>
        <integer>0</integer>
    </dict>
</array>
```

## Monitoring

Set up a simple monitoring dashboard:

```bash
# Create a quick status script
cat > scripts/sync-status.sh << 'EOF'
#!/bin/bash
echo "=== vCon Sync Status ==="
echo "Last run:"
ls -lht logs/vcon-sync-*.log | head -1
echo ""
echo "Summary of last run:"
tail -20 logs/vcon-sync-$(date +%Y%m%d).log | grep -A 10 "LOAD SUMMARY" || echo "No summary found yet"
echo ""
echo "launchd status:"
launchctl list | grep vcon
EOF

chmod +x scripts/sync-status.sh
```

Then run `./scripts/sync-status.sh` anytime to check status.

