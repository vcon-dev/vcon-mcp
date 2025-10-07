# vCon MCP Server - Technical Reference

This directory contains technical reference documentation for IETF vCon specification compliance.

## Reference Documents

### [QUICK_REFERENCE.md](QUICK_REFERENCE.md)
**Purpose:** Quick lookup for critical vCon spec corrections  
**Audience:** All developers  
**Time:** 5 minutes

A concise checklist of the 7 critical corrections needed for IETF vCon spec compliance. Use this as a quick reference when implementing or reviewing code.

### [IMPLEMENTATION_CORRECTIONS.md](IMPLEMENTATION_CORRECTIONS.md)
**Purpose:** Detailed analysis of spec inconsistencies and how to fix them  
**Audience:** Implementers, reviewers  
**Time:** 15 minutes

Complete documentation of all known issues in common vCon implementations and how this project addresses them. Essential reading for anyone building or migrating vCon code.

### [CORRECTED_SCHEMA.md](CORRECTED_SCHEMA.md)
**Purpose:** SQL schema with all corrections applied  
**Audience:** Database administrators, backend developers  
**Time:** 20 minutes

The correct PostgreSQL schema for vCon data storage, including all field name corrections, proper types, and constraints. Use this as the authoritative database schema.

### [MIGRATION_GUIDE.md](MIGRATION_GUIDE.md)
**Purpose:** Step-by-step guide for migrating existing vCon implementations  
**Audience:** Teams with existing vCon code  
**Time:** 30 minutes + migration time

Instructions for updating existing codebases that use incorrect field names or types. Includes automated fixes, manual corrections, and verification steps.

## Common Use Cases

### "I'm implementing vCon for the first time"
1. Read [QUICK_REFERENCE.md](QUICK_REFERENCE.md) - Know what to avoid
2. Follow main [BUILD_GUIDE.md](../../BUILD_GUIDE.md) - Step-by-step implementation
3. Reference [CORRECTED_SCHEMA.md](CORRECTED_SCHEMA.md) - Database schema

### "I'm migrating existing vCon code"
1. Read [IMPLEMENTATION_CORRECTIONS.md](IMPLEMENTATION_CORRECTIONS.md) - Identify issues
2. Follow [MIGRATION_GUIDE.md](MIGRATION_GUIDE.md) - Migration steps
3. Use [QUICK_REFERENCE.md](QUICK_REFERENCE.md) - Verification checklist

### "I'm reviewing vCon code"
1. Check [QUICK_REFERENCE.md](QUICK_REFERENCE.md) - Quick verification
2. Reference [IMPLEMENTATION_CORRECTIONS.md](IMPLEMENTATION_CORRECTIONS.md) - Known issues
3. Verify against [CORRECTED_SCHEMA.md](CORRECTED_SCHEMA.md) - Database compliance

### "I'm troubleshooting vCon issues"
1. Check [IMPLEMENTATION_CORRECTIONS.md](IMPLEMENTATION_CORRECTIONS.md) - Common mistakes
2. Use [QUICK_REFERENCE.md](QUICK_REFERENCE.md) - Field name checklist
3. Verify [CORRECTED_SCHEMA.md](CORRECTED_SCHEMA.md) - Schema correctness

## Key Corrections Summary

This implementation fixes 7 critical issues found in many vCon implementations:

1. ✅ **Analysis Schema Field** - Uses `schema` not `schema_version`
2. ✅ **Analysis Vendor Requirement** - `vendor` is required, not optional
3. ✅ **Analysis Body Type** - `body` is string type, not object
4. ✅ **Party UUID Field** - Added per spec Section 4.2.12
5. ✅ **Encoding Defaults** - No default values, explicit only
6. ✅ **Dialog Type Constraints** - Must be one of 4 valid types
7. ✅ **Dialog New Fields** - Added `session_id`, `application`, `message_id`

## IETF Specification

All corrections are based on:
- **Specification:** `draft-ietf-vcon-vcon-core-00`
- **Location:** `../background_docs/draft-ietf-vcon-vcon-core-00.txt`
- **Working Group:** https://datatracker.ietf.org/wg/vcon/

## Related Documentation

- **[Main README](../../README.md)** - Project overview and quick start
- **[BUILD_GUIDE.md](../../BUILD_GUIDE.md)** - Complete build instructions
- **[GETTING_STARTED.md](../../GETTING_STARTED.md)** - User guide
- **[Background Docs](../background_docs/)** - IETF specifications

---

*These reference documents ensure 100% IETF vCon specification compliance.*

