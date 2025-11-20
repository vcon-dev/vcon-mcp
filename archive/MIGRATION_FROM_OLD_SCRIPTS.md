# Migration from Old Scripts

This guide documents scripts that have been archived and what to use instead.

## Overview

As part of a refactoring effort in November 2025, several one-time fix scripts, deprecated sync scripts, and historical diagnostic tools were moved to `archive/scripts/`. This document helps you understand what happened to each script and what to use going forward.

## Archived Scripts and Replacements

### One-Time Fix Scripts

These scripts were used to repair specific data issues and are no longer needed.

#### `fix-attachment-bodies.ts`

**Purpose:** Fixed attachment body serialization issues in the database.

**Status:** ✅ Completed. Issue resolved.

**Migration:** No action needed. If you encounter similar serialization issues, check current data validation in `src/db/schemas.ts` and `src/tools/create-vcon.ts`.

#### `fix-all-vcons-incremental.ts`

**Purpose:** Historical S3 body repair utility for legacy vCon data migration.

**Status:** ✅ Completed. Legacy data migrated.

**Migration:** For loading vCons from S3, use:
```bash
npm run load:s3           # Load with default settings
npm run load:s3:recent    # Load last 24 hours
```

Or directly:
```bash
npx tsx scripts/load-legacy-vcons.ts --hours=168
```

#### `fix-recent-vcons.sh`

**Purpose:** One-time fix script for repairing recent vCons with data issues.

**Status:** ✅ Completed. Issues resolved.

**Migration:** If you need to reload recent vCons from S3, use:
```bash
npm run load:s3:recent
```

### Deprecated Sync Scripts

These scripts provided automated synchronization but have been superseded by better approaches.

#### `sync-vcons-hourly.sh`

**Purpose:** Automated hourly synchronization of vCons from S3 to database.

**Status:** ⚠️ Deprecated. Replaced by npm script approach.

**Migration:** Set up your own scheduler (cron, systemd, Task Scheduler, etc.) to run:

**macOS/Linux with cron:**
```bash
# Edit crontab
crontab -e

# Add hourly sync (run at minute 0 of every hour)
0 * * * * cd /path/to/vcon-mcp && npm run load:s3:recent >> /path/to/logs/vcon-sync.log 2>&1
```

**Linux with systemd:**

Create `/etc/systemd/system/vcon-sync.service`:
```ini
[Unit]
Description=vCon Hourly Sync
After=network.target

[Service]
Type=oneshot
WorkingDirectory=/path/to/vcon-mcp
ExecStart=/usr/bin/npm run load:s3:recent
User=your-user
Environment="SUPABASE_URL=https://..."
Environment="SUPABASE_SERVICE_ROLE_KEY=..."
```

Create `/etc/systemd/system/vcon-sync.timer`:
```ini
[Unit]
Description=Run vCon sync hourly

[Timer]
OnCalendar=hourly
Persistent=true

[Install]
WantedBy=timers.target
```

Enable:
```bash
sudo systemctl daemon-reload
sudo systemctl enable vcon-sync.timer
sudo systemctl start vcon-sync.timer
```

**Windows with Task Scheduler:**
```powershell
$action = New-ScheduledTaskAction -Execute "npm" -Argument "run load:s3:recent" -WorkingDirectory "C:\path\to\vcon-mcp"
$trigger = New-ScheduledTaskTrigger -Once -At 12am -RepetitionInterval (New-TimeSpan -Hours 1)
Register-ScheduledTask -TaskName "vCon Hourly Sync" -Action $action -Trigger $trigger
```

#### `install-hourly-sync.sh`

**Purpose:** Installer script for macOS launchd-based hourly sync.

**Status:** ⚠️ Deprecated.

**Migration:** See `sync-vcons-hourly.sh` migration guide above for platform-specific scheduler setup.

#### `com.vcon.hourly-sync.plist`

**Purpose:** macOS launchd configuration for hourly sync.

**Status:** ⚠️ Deprecated.

**Migration:** Create your own launchd plist or use cron. Example:

`~/Library/LaunchAgents/com.vcon.hourly-sync.plist`:
```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.vcon.hourly-sync</string>
    <key>ProgramArguments</key>
    <array>
        <string>/usr/local/bin/npm</string>
        <string>run</string>
        <string>load:s3:recent</string>
    </array>
    <key>WorkingDirectory</key>
    <string>/path/to/vcon-mcp</string>
    <key>StartCalendarInterval</key>
    <dict>
        <key>Minute</key>
        <integer>0</integer>
    </dict>
    <key>StandardOutPath</key>
    <string>/path/to/logs/vcon-sync.log</string>
    <key>StandardErrorPath</key>
    <string>/path/to/logs/vcon-sync-error.log</string>
    <key>EnvironmentVariables</key>
    <dict>
        <key>SUPABASE_URL</key>
        <string>https://your-project.supabase.co</string>
        <key>SUPABASE_SERVICE_ROLE_KEY</key>
        <string>your-key-here</string>
    </dict>
</dict>
</plist>
```

Load with:
```bash
launchctl load ~/Library/LaunchAgents/com.vcon.hourly-sync.plist
```

#### `SYNC_SETUP.md`

**Purpose:** Documentation for the deprecated hourly sync system.

**Status:** ⚠️ Deprecated. Information superseded by this guide.

**Migration:** See scheduler setup examples above for your platform.

### Historical Diagnostic Tools

These scripts were used for one-time debugging or initial setup.

#### `diagnose-tenant-ids.ts`

**Purpose:** Diagnostic tool for troubleshooting tenant ID issues during RLS implementation.

**Status:** ✅ Debugging completed.

**Migration:** For current tenant debugging, see:
- `docs/guide/debugging-tenant-rls.md` - Current debugging guide
- `docs/guide/rls-multi-tenant.md` - RLS configuration guide

If you need to check tenant IDs, query directly:
```bash
psql $DATABASE_URL -c "SELECT uuid, tenant_id FROM vcons WHERE tenant_id IS NULL LIMIT 10;"
```

Or use the database status tools:
```bash
npm run db:status
```

#### `test-tenant-setup.ts`

**Purpose:** Test script for validating tenant setup during initial RLS implementation.

**Status:** ✅ Initial setup completed.

**Migration:** For testing tenant functionality, use the proper test suite:
```bash
npm test                  # Run all tests
npm run test:db          # Test database tools
```

For manual tenant testing, see `docs/guide/debugging-tenant-rls.md`.

## New npm Scripts Reference

All active scripts are now accessible via npm commands for better discoverability:

### Database Operations

```bash
npm run db:status         # Comprehensive database status
npm run db:check          # Quick vCon count
npm run db:analyze        # Daily count analysis
npm run db:backup         # Backup database
npm run db:restore        # Restore from backup
```

### Data Loading

```bash
npm run load:s3           # Load from S3 (default)
npm run load:s3:recent    # Load last 24 hours
npm run load:local        # Load from local directory
npm run sync:vcons        # Continuous sync mode
```

### Embeddings

```bash
npm run embeddings:backfill   # Backfill missing embeddings
npm run embeddings:generate   # Generate locally
npm run embeddings:check      # Check coverage
```

### Testing

```bash
npm run test:db           # Test database tools
npm run test:mcp          # Test MCP tools
npm run test:search       # Test search
npm run test:tags         # Test tags
```

### Migrations

```bash
npm run migrate:rls       # Enable Row Level Security
npm run migrate:remote    # Migrate data to remote
```

For complete documentation, see:
- [scripts/README.md](../scripts/README.md) - Complete scripts documentation
- [README.md](../README.md) - Main project readme with quick reference

## Questions?

If you have questions about migrated scripts or need help setting up new workflows:

1. Check [scripts/README.md](../scripts/README.md) for current script documentation
2. Check [archive/scripts/README.md](scripts/README.md) for archived script details
3. Review the examples in this guide for your platform
4. Open a GitHub issue if you need additional guidance

## Summary

- **One-time fixes** → Issues resolved, no action needed
- **Hourly sync** → Use npm scripts with your platform's scheduler
- **Diagnostics** → Use current documentation and test suite
- **All operations** → Available as npm scripts for easy access

The refactoring makes scripts more discoverable, maintainable, and consistent across different workflows.

