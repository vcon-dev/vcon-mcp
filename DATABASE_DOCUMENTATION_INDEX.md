# vCon Database Documentation Index

**Created**: November 19, 2025  
**Purpose**: Guide for LLMs and AI systems to understand and interact with the vCon database

---

## Overview

This project includes comprehensive documentation designed specifically for LLMs and AI systems to understand how the vCon database is organized, how it works, and how to build applications that interact with it.

The vCon database implements the IETF vCon (Virtual Conversation) specification in a PostgreSQL database with advanced features like semantic search, multi-tenant isolation, and GDPR compliance.

---

## Documentation Structure

### 1. Complete Architecture Guide
**File**: `DATABASE_ARCHITECTURE_FOR_LLMS.md`  
**Size**: ~48KB  
**Purpose**: Comprehensive deep-dive into database architecture

**Contents**:
- Overview of vCon and database technology stack
- Complete data model explanation
- Detailed table reference (12 tables)
- Index and performance strategies
- Search capabilities (keyword, semantic, hybrid, tag-based)
- Multi-tenant architecture with RLS
- Data relationships and foreign keys
- Query patterns and best practices
- Extensions (embeddings, caching, S3 sync)
- GDPR compliance features

**Best For**: Understanding the complete system architecture, designing new features, troubleshooting complex issues

---

### 2. Quick Start Guide
**File**: `DATABASE_QUICKSTART_FOR_LLMS.md`  
**Size**: ~25KB  
**Purpose**: Rapid onboarding with practical code examples

**Contents**:
- 5-minute TL;DR overview
- Complete code examples for:
  - Creating a vCon (TypeScript and SQL)
  - Retrieving vCons
  - All 4 search types
  - Updating vCons
  - Deleting vCons
  - Multi-tenant setup
- Critical field name reference
- Common error patterns and solutions
- Performance tips
- Testing script template

**Best For**: Getting started quickly, finding code snippets, avoiding common mistakes

---

### 3. Visual Schema Reference
**File**: `DATABASE_SCHEMA_VISUAL.md`  
**Size**: ~20KB  
**Purpose**: Visual diagrams and quick lookup reference

**Contents**:
- Complete entity relationship diagram (ASCII art)
- Table structures with all fields
- Relationship summary
- Unique constraints
- Data type reference (enums, arrays, JSONB, vectors)
- Index strategy overview
- RLS policy structure
- Search RPC function signatures
- Common query patterns (SQL)
- Database statistics queries
- Performance monitoring queries
- Migration history

**Best For**: Quick lookup, understanding relationships, finding SQL patterns

---

## How to Use This Documentation

### For Building Applications

1. **Start with Quick Start**: Read `DATABASE_QUICKSTART_FOR_LLMS.md` to understand basic operations
2. **Reference Visual Schema**: Use `DATABASE_SCHEMA_VISUAL.md` for table structures and relationships
3. **Deep Dive When Needed**: Consult `DATABASE_ARCHITECTURE_FOR_LLMS.md` for complex features

### For Understanding the System

1. **Read Architecture First**: `DATABASE_ARCHITECTURE_FOR_LLMS.md` provides complete context
2. **Visual Reference**: `DATABASE_SCHEMA_VISUAL.md` helps visualize relationships
3. **Code Examples**: `DATABASE_QUICKSTART_FOR_LLMS.md` shows practical usage

### For Troubleshooting

1. **Check Quick Start Errors**: Common errors and solutions in `DATABASE_QUICKSTART_FOR_LLMS.md`
2. **Review Schema**: Confirm field names and constraints in `DATABASE_SCHEMA_VISUAL.md`
3. **Understand Design**: Read relevant sections in `DATABASE_ARCHITECTURE_FOR_LLMS.md`

---

## Key Concepts Summary

### What is vCon?

vCon (Virtual Conversation) is an IETF standard for representing conversations in a portable, interoperable format. It's like "PDF for conversations" - a standardized container for:
- Conversations from any medium (voice, video, text, email)
- Participants with identity and privacy controls
- AI analysis results (transcripts, summaries, sentiment)
- Attachments (documents, images, files)
- Privacy markers for consent and redaction

### Database Architecture

The vCon database is a **normalized relational database** (not a document database):
- **8 core tables**: vcons, parties, dialog, analysis, attachments, groups, party_history, vcon_embeddings
- **4 extension tables**: vcon_tags_mv, privacy_requests, embedding_queue, s3_sync_tracking
- **25+ strategic indexes** for performance
- **Row Level Security (RLS)** for multi-tenant isolation
- **pgvector extension** for semantic search
- **pg_trgm extension** for fuzzy text search

### Key Features

1. **Multiple Search Types**:
   - Keyword search (full-text with trigram matching)
   - Semantic search (AI-powered vector similarity)
   - Hybrid search (combines keyword and semantic)
   - Tag-based filtering

2. **Multi-Tenant Support**:
   - Row Level Security (RLS) on all tables
   - Tenant ID extracted from vCon attachments
   - JWT or app setting based tenant context

3. **Performance**:
   - Strategic indexes for fast queries
   - Optional Redis caching (20-50x faster reads)
   - Materialized view for tag queries
   - HNSW index for vector search

4. **IETF Compliance**:
   - Implements draft-ietf-vcon-vcon-core-00
   - Correct field names (e.g., `schema` not `schema_version`)
   - Required fields enforced (e.g., `analysis.vendor`)
   - Proper data types (e.g., `body` as TEXT)

5. **Extensions**:
   - Async embedding generation
   - S3 sync for external storage
   - GDPR compliance features
   - Privacy request tracking

---

## Common Mistakes to Avoid

These are documented in detail in the guides, but here's a quick reference:

### Field Name Mistakes
- ❌ `analysis.schema_version` → ✅ `analysis.schema`
- ❌ `analysis.vendor` optional → ✅ `analysis.vendor` REQUIRED
- ❌ `analysis.body` as JSONB → ✅ `analysis.body` as TEXT

### Data Type Mistakes
- ❌ Setting default encoding values → ✅ Explicitly set or leave NULL
- ❌ `parties` as `parties[]` → ✅ `parties` as `INTEGER[]`

### Query Mistakes
- ❌ No LIMIT on queries → ✅ Always use LIMIT
- ❌ Using LIKE for full-text → ✅ Use search RPCs
- ❌ Missing indexes → ✅ Filter by indexed fields

---

## Technology Stack

- **Database**: PostgreSQL 15+
- **Extensions**: 
  - pgvector (semantic search)
  - pg_trgm (fuzzy text search)
  - uuid-ossp (UUID generation)
- **Vector Dimensions**: 384 (optimized for OpenAI text-embedding-3-small)
- **Caching**: Optional Redis
- **Platform**: Supabase (PostgreSQL hosting)
- **Client Libraries**: 
  - @supabase/supabase-js (JavaScript/TypeScript)
  - Direct PostgreSQL clients

---

## Database Statistics (Example)

The database is designed to scale to:
- Millions of vCons
- Billions of dialog messages
- Hundreds of millions of embeddings
- Multiple tenants with isolation

Performance characteristics:
- UUID lookups: < 10ms
- Keyword search: 50-500ms
- Semantic search: 100-1000ms (depends on corpus size)
- Hybrid search: 200-1500ms
- Tag filtering: < 50ms (via materialized view)

With Redis caching:
- Cached reads: < 5ms (20-50x improvement)

---

## Quick Reference: Table List

### Core Tables (IETF Spec)
1. `vcons` - Main conversation container
2. `parties` - Participants
3. `dialog` - Conversation segments
4. `analysis` - AI/ML results
5. `attachments` - Files and metadata
6. `groups` - vCon aggregation
7. `party_history` - Party events

### Extension Tables
8. `vcon_embeddings` - Semantic search vectors
9. `vcon_tags_mv` - Materialized view for tags
10. `privacy_requests` - GDPR compliance
11. `embedding_queue` - Async processing
12. `s3_sync_tracking` - External storage

---

## Quick Reference: RPC Functions

### Search Functions
- `search_vcons_keyword()` - Full-text keyword search
- `search_vcons_semantic()` - Vector similarity search
- `search_vcons_hybrid()` - Combined search
- `search_vcons_by_tags()` - Tag-based filtering

### Utility Functions
- `get_current_tenant_id()` - Get tenant context
- `extract_tenant_from_attachments()` - Extract tenant ID
- `populate_tenant_ids_batch()` - Batch populate tenant IDs

---

## Related Documentation

### In This Repository
- `README.md` - Project overview and features
- `BUILD_GUIDE.md` - Step-by-step implementation
- `supabase/migrations/` - Database migration files
- `src/types/vcon.ts` - TypeScript type definitions
- `src/db/queries.ts` - Query implementation
- `docs/guide/` - User guides

### IETF Specifications
- `background_docs/draft-ietf-vcon-vcon-core-00.txt` - Official vCon spec
- `background_docs/draft-howe-vcon-consent-00.txt` - Privacy and consent
- `background_docs/draft-howe-vcon-lifecycle-00.txt` - Lifecycle management

---

## Getting Help

### Documentation Priority

1. **Quick question about field names or data types?**  
   → Check `DATABASE_SCHEMA_VISUAL.md`

2. **Need code examples?**  
   → See `DATABASE_QUICKSTART_FOR_LLMS.md`

3. **Understanding a feature or design decision?**  
   → Read relevant section in `DATABASE_ARCHITECTURE_FOR_LLMS.md`

4. **Want to see production code?**  
   → Check `src/db/queries.ts` and test scripts in `scripts/`

### Example Code Locations

- Creating vCons: `src/db/queries.ts` - `createVCon()`
- Searching: `src/tools/search-tools.ts`
- Tags: `src/tools/tag-tools.ts`
- Multi-tenant: `src/config/tenant-config.ts`

### Test Scripts

Run these to understand how the database works:
- `scripts/test-database-tools.ts` - Basic CRUD operations
- `scripts/test-search-tools.ts` - Search functionality
- `scripts/test-semantic-search.ts` - Semantic search
- `scripts/test-tags.ts` - Tag system

---

## Version Information

- **Database Schema Version**: 0.3.0 (IETF vCon spec version)
- **Documentation Created**: November 19, 2025
- **Latest Migration**: `20251119140000_sync_most_recent_first.sql`
- **Vector Dimension**: 384 (migrated from 1536)

---

## Maintenance

### Keeping Documentation Current

When making database changes:
1. Update migration files in `supabase/migrations/`
2. Update type definitions in `src/types/vcon.ts`
3. Update these LLM documentation files if structure changes
4. Run tests to verify changes

### Documentation Updates Needed When:
- Adding new tables
- Adding new fields to existing tables
- Changing indexes
- Adding new RPC functions
- Changing multi-tenant configuration
- Updating search algorithms

---

## Summary

These three documentation files provide everything an LLM or AI system needs to:
- Understand the vCon database architecture
- Write applications that interact with the database
- Query and search conversation data
- Implement multi-tenant applications
- Optimize performance
- Comply with IETF specifications
- Handle privacy and GDPR requirements

**Start with**: `DATABASE_QUICKSTART_FOR_LLMS.md`  
**Reference**: `DATABASE_SCHEMA_VISUAL.md`  
**Deep dive**: `DATABASE_ARCHITECTURE_FOR_LLMS.md`

Happy coding! 🚀

