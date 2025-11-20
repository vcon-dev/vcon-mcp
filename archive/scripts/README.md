# Archived Scripts

This directory contains historical scripts that were used for one-time fixes, migrations, or debugging purposes. These scripts are no longer actively maintained but are preserved for historical reference.

## One-Time Fix Scripts

These scripts were used to repair data issues or perform one-time migrations:

### `fix-attachment-bodies.ts`
**Purpose:** One-time repair for attachment body serialization issues.  
**Status:** Completed. No longer needed.  
**Date Archived:** November 2025

### `fix-all-vcons-incremental.ts`
**Purpose:** Historical S3 body repair utility for legacy vCon data.  
**Status:** Completed. No longer needed.  
**Date Archived:** November 2025

### `fix-recent-vcons.sh`
**Purpose:** One-time fix script for repairing recent vCons with data issues.  
**Status:** Completed. No longer needed.  
**Date Archived:** November 2025

### `diagnose-tenant-ids.ts`
**Purpose:** Diagnostic tool for troubleshooting tenant ID issues during RLS implementation.  
**Status:** Debugging completed. For current tenant debugging, see `docs/guide/debugging-tenant-rls.md`.  
**Date Archived:** November 2025

### `test-tenant-setup.ts`
**Purpose:** Test script for validating tenant setup during initial RLS implementation.  
**Status:** Initial setup completed. For current tenant testing, use proper test suite.  
**Date Archived:** November 2025

## Deprecated Sync Scripts

These scripts were replaced by more maintainable npm script-based approaches:

### `sync-vcons-hourly.sh`
**Purpose:** Automated hourly synchronization of vCons from S3.  
**Replacement:** Use `npm run load:s3:recent` with your preferred scheduler (cron, systemd, etc.).  
**Date Archived:** November 2025

### `install-hourly-sync.sh`
**Purpose:** Installer script for macOS launchd-based hourly sync.  
**Replacement:** Set up your own scheduled task using `npm run load:s3:recent`.  
**Date Archived:** November 2025

### `com.vcon.hourly-sync.plist`
**Purpose:** macOS launchd configuration for hourly sync.  
**Replacement:** Create your own scheduler config for your platform.  
**Date Archived:** November 2025

### `SYNC_SETUP.md`
**Purpose:** Documentation for setting up the deprecated hourly sync system.  
**Replacement:** See main documentation for current data loading approaches.  
**Date Archived:** November 2025

## Migration Information

For detailed information about what to use instead of these archived scripts, see:
- `archive/MIGRATION_FROM_OLD_SCRIPTS.md` - Migration guide from old scripts to current approaches
- `scripts/README.md` - Current active scripts documentation
- `package.json` - Available npm scripts for common operations

## Important Notes

- **Do not rely on these scripts for production use**
- These scripts may not work with current database schema or dependencies
- They are preserved only for historical reference and understanding past issues
- If you need to perform similar operations, consult the current scripts documentation

