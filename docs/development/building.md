# vCon MCP Server - Step-by-Step Build Guide

> **Complete guide to building an IETF vCon-compliant MCP Server from scratch**

## 📋 Table of Contents

1. [Prerequisites](#prerequisites)
2. [Project Overview](#project-overview)
3. [Phase 1: Environment Setup](#phase-1-environment-setup)
4. [Phase 2: Database Setup](#phase-2-database-setup)
5. [Phase 3: Project Structure](#phase-3-project-structure)
6. [Phase 4: Core Implementation](#phase-4-core-implementation)
7. [Phase 5: MCP Server](#phase-5-mcp-server)
8. [Phase 6: Testing & Validation](#phase-6-testing--validation)
9. [Phase 7: Deployment](#phase-7-deployment)
10. [Troubleshooting](#troubleshooting)
11. [Next Steps](#next-steps)

---

## Prerequisites

### Required Knowledge
- ✅ TypeScript/JavaScript programming
- ✅ Node.js and npm/yarn
- ✅ PostgreSQL basics
- ✅ REST APIs and JSON
- ✅ Git version control

### Required Software
- ✅ **Node.js** 18.x or higher ([Download](https://nodejs.org/))
- ✅ **npm** or **yarn** package manager
- ✅ **Git** ([Download](https://git-scm.com/))
- ✅ **Code editor** (VS Code recommended)
- ✅ **Supabase account** ([Sign up](https://supabase.com/))

### Time Estimate
- **Total:** 4-6 hours for first-time implementation
- **Experienced developers:** 2-3 hours

---

## Project Overview

### What We're Building

An **MCP (Model Context Protocol) Server** that:
- Stores and manages IETF vCon (Virtual Conversation) data
- Provides tools for AI assistants to interact with vCons
- Ensures full compliance with `draft-ietf-vcon-vcon-core-00`
- Uses Supabase (PostgreSQL) as the database backend

### Key Features
- ✅ Create, read, update, delete vCons
- ✅ Add dialog, analysis, and attachments
- ✅ Search and query vCon data
- ✅ Privacy and consent management
- ✅ Spec-compliant data validation
- ✅ MCP tools for AI integration

### Architecture

```
┌─────────────────┐
│   AI Assistant  │ (Claude, etc.)
└────────┬────────┘
         │ MCP Protocol
┌────────▼────────┐
│   MCP Server    │ (This project)
└────────┬────────┘
         │ Supabase Client
┌────────▼────────┐
│    Supabase     │ (PostgreSQL + REST API)
└─────────────────┘
```

---

## Phase 1: Environment Setup

### Step 1.1: Create Project Directory

```bash
# Create project directory
mkdir vcon-mcp-server
cd vcon-mcp-server

# Initialize git repository
git init
```

### Step 1.2: Initialize Node.js Project

```bash
# Create package.json
npm init -y
```

### Step 1.3: Install Dependencies

```bash
# Core dependencies
npm install @modelcontextprotocol/sdk @supabase/supabase-js zod

# Development dependencies
npm install -D typescript @types/node tsx vitest eslint \
  @typescript-eslint/eslint-plugin @typescript-eslint/parser
```

**What each package does:**
- `@modelcontextprotocol/sdk` - MCP server framework
- `@supabase/supabase-js` - Supabase client library
- `zod` - Schema validation library
- `typescript` - TypeScript compiler
- `tsx` - TypeScript execution for development
- `vitest` - Testing framework

### Step 1.4: Configure TypeScript

Create `tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "lib": ["ES2022"],
    "outDir": "./dist",
    "rootDir": "./src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "moduleResolution": "bundler",
    "resolveJsonModule": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist", "tests"]
}
```

### Step 1.5: Update package.json Scripts

Add these scripts to your `package.json`:

```json
{
  "type": "module",
  "scripts": {
    "build": "tsc",
    "dev": "tsx watch src/index.ts",
    "test": "vitest",
    "test:compliance": "vitest run tests/vcon-compliance.test.ts",
    "lint": "eslint src/**/*.ts"
  }
}
```

### Step 1.6: Create .env.example

Create `.env.example`:

```bash
# Supabase Configuration
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_ANON_KEY=your-anon-key-here

# Optional: For service role operations
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
```

### Step 1.7: Create .gitignore

Create `.gitignore`:

```
# Node
node_modules/
npm-debug.log*
package-lock.json

# TypeScript
dist/
*.tsbuildinfo

# Environment variables
.env
.env.local

# IDE
.vscode/
.idea/
.DS_Store

# Testing
coverage/

# Logs
*.log
```

### ✅ Phase 1 Checkpoint

Verify your setup:

```bash
# Check Node.js version
node --version  # Should be 18.x or higher

# Check TypeScript
npx tsc --version

# Verify package.json
cat package.json

# Check dependencies
npm list
```

---

## Phase 2: Database Setup

### Step 2.1: Create Supabase Project

1. Go to [supabase.com](https://supabase.com/)
2. Click "New Project"
3. Fill in:
   - **Name:** vcon-mcp-server
   - **Database Password:** (Generate strong password)
   - **Region:** (Choose closest to you)
4. Click "Create new project"
5. Wait 2-3 minutes for provisioning

### Step 2.2: Get Supabase Credentials

1. Go to Project Settings → API
2. Copy:
   - **Project URL** → SUPABASE_URL
   - **anon/public key** → SUPABASE_ANON_KEY

Create `.env` file:

```bash
SUPABASE_URL=https://xxxxxxxxxxxxx.supabase.co
SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
```

### Step 2.3: Run Database Schema

1. Go to SQL Editor in Supabase dashboard
2. Copy the entire schema from `CORRECTED_SCHEMA.md`
3. Paste into SQL Editor
4. Click "Run" to execute

**Key tables created:**
- `vcons` - Main vCon records
- `parties` - Conversation participants
- `dialog` - Conversation content (recordings, text, etc.)
- `analysis` - AI/ML analysis results
- `attachments` - File attachments
- `party_history` - Party event timeline

### Step 2.4: Verify Database Schema

Run these verification queries in SQL Editor:

```sql
-- Check tables exist
SELECT tablename FROM pg_tables 
WHERE schemaname = 'public'
ORDER BY tablename;

-- Check analysis table has 'schema' field (not 'schema_version')
SELECT column_name, data_type, is_nullable 
FROM information_schema.columns
WHERE table_name = 'analysis'
ORDER BY ordinal_position;

-- Verify vendor is NOT NULL
SELECT column_name, is_nullable
FROM information_schema.columns
WHERE table_name = 'analysis' 
AND column_name = 'vendor';
-- Should show 'NO' for is_nullable

-- Verify dialog type constraint exists
SELECT constraint_name, check_clause
FROM information_schema.check_constraints
WHERE constraint_name = 'dialog_type_check';

-- Check that encoding fields have no default values
SELECT column_name, column_default
FROM information_schema.columns
WHERE table_name IN ('dialog', 'analysis', 'attachments')
AND column_name = 'encoding';
-- All should show NULL for column_default
```

**Expected results:**
- ✅ 8+ tables created
- ✅ `analysis.schema` exists (NOT `schema_version`)
- ✅ `analysis.vendor` is NOT NULL
- ✅ `analysis.body` is TEXT type
- ✅ No DEFAULT values on encoding fields
- ✅ Dialog type constraint exists

### Step 2.5: Set Up Row Level Security (Optional)

For multi-tenant applications, enable RLS:

```sql
-- Enable RLS on all tables
ALTER TABLE vcons ENABLE ROW LEVEL SECURITY;
ALTER TABLE parties ENABLE ROW LEVEL SECURITY;
ALTER TABLE dialog ENABLE ROW LEVEL SECURITY;
ALTER TABLE analysis ENABLE ROW LEVEL SECURITY;
ALTER TABLE attachments ENABLE ROW LEVEL SECURITY;

-- Example policy: Users can only access their own vCons
CREATE POLICY "Users can view own vcons"
  ON vcons FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can create own vcons"
  ON vcons FOR INSERT
  WITH CHECK (auth.uid() = user_id);
```

### ✅ Phase 2 Checkpoint

Verify database setup:

```bash
# Test connection with a simple query
node -e "
import { createClient } from '@supabase/supabase-js';
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);
const { data, error } = await supabase.from('vcons').select('count');
console.log('Connection test:', error ? 'FAILED' : 'SUCCESS');
"
```

---

## Phase 3: Project Structure

### Step 3.1: Create Directory Structure

```bash
# Create all directories
mkdir -p src/{types,tools,resources,prompts,db,utils}
mkdir -p tests
mkdir -p scripts
```

### Step 3.2: Verify Structure

Your project should now look like this:

```
vcon-mcp-server/
├── src/
│   ├── types/          # TypeScript type definitions
│   ├── tools/          # MCP tool implementations
│   ├── resources/      # MCP resource handlers
│   ├── prompts/        # MCP prompt templates
│   ├── db/            # Database client and queries
│   └── utils/         # Utility functions
├── tests/             # Test files
├── scripts/           # Build and maintenance scripts
├── package.json
├── tsconfig.json
├── .env
├── .env.example
└── .gitignore
```

### ✅ Phase 3 Checkpoint

```bash
# Verify directory structure
ls -R src/
```

---

## Phase 4: Core Implementation

### Step 4.1: Create vCon Types

Create `src/types/vcon.ts`:

```typescript
/**
 * IETF vCon Core Types - Compliant with draft-ietf-vcon-vcon-core-00
 * CRITICAL: Uses corrected field names per specification
 */

export type VConVersion = '0.3.0';
export type Encoding = 'base64url' | 'json' | 'none';
export type DialogType = 'recording' | 'text' | 'transfer' | 'incomplete';

// Section 4.2 - Party Object
export interface Party {
  tel?: string;
  sip?: string;
  stir?: string;
  mailto?: string;
  name?: string;
  did?: string;
  validation?: string;
  jcard?: object;
  gmlpos?: string;
  civicaddress?: object;
  timezone?: string;
  uuid?: string;  // Section 4.2.12 - REQUIRED FIELD
}

// Section 4.3 - Dialog Object
export interface Dialog {
  type: DialogType;
  start?: string;
  duration?: number;
  parties?: number | number[] | (number | number[])[];
  originator?: number;
  mediatype?: string;
  filename?: string;
  body?: string;
  encoding?: Encoding;
  url?: string;
  content_hash?: string | string[];
  disposition?: 'no-answer' | 'congestion' | 'failed' | 'busy' | 'hung-up' | 'voicemail-no-message';
  session_id?: string;      // Section 4.3.10
  application?: string;     // Section 4.3.13
  message_id?: string;      // Section 4.3.14
}

// Section 4.5 - Analysis Object
// ⚠️ CRITICAL: This is the CORRECTED version
export interface Analysis {
  type: string;
  dialog?: number | number[];
  mediatype?: string;
  filename?: string;
  vendor: string;        // ✅ REQUIRED per spec Section 4.5.5
  product?: string;
  schema?: string;       // ✅ CORRECT: Not 'schema_version'
  body?: string;         // ✅ CORRECT: String, not object
  encoding?: Encoding;
  url?: string;
  content_hash?: string | string[];
}

// Section 4.4 - Attachment Object
export interface Attachment {
  type?: string;
  start?: string;
  party?: number;
  dialog?: number;
  mediatype?: string;
  filename?: string;
  body?: string;
  encoding?: Encoding;
  url?: string;
  content_hash?: string | string[];
}

// Section 4.1 - Main vCon Object
export interface VCon {
  vcon: VConVersion;
  uuid: string;
  extensions?: string[];      // Section 4.1.3
  must_support?: string[];    // Section 4.1.4
  created_at: string;
  updated_at?: string;
  subject?: string;
  redacted?: {
    uuid?: string;
    type?: string;
    url?: string;
    content_hash?: string | string[];
  };
  appended?: {
    uuid?: string;
    url?: string;
    content_hash?: string | string[];
  };
  group?: Array<{
    uuid?: string;
    body?: string;
    encoding?: 'json';
    url?: string;
    content_hash?: string | string[];
  }>;
  parties: Party[];
  dialog?: Dialog[];
  analysis?: Analysis[];
  attachments?: Attachment[];
}

// Validation helper functions
export function isValidDialogType(type: string): type is DialogType {
  return ['recording', 'text', 'transfer', 'incomplete'].includes(type);
}

export function isValidEncoding(encoding: string): encoding is Encoding {
  return ['base64url', 'json', 'none'].includes(encoding);
}
```

**💡 Key Points:**
- ✅ Uses `schema` not `schema_version` in Analysis
- ✅ `vendor` is required (no `?`) in Analysis
- ✅ `body` is `string` type (not `object`)
- ✅ Includes `uuid` field in Party
- ✅ Includes new fields: `session_id`, `application`, `message_id`

### Step 4.2: Create Database Client

Create `src/db/client.ts`:

```typescript
import { createClient, SupabaseClient } from '@supabase/supabase-js';

let supabase: SupabaseClient | null = null;

export function getSupabaseClient(): SupabaseClient {
  if (!supabase) {
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_ANON_KEY;

    if (!url || !key) {
      throw new Error(
        'Missing Supabase credentials. Set SUPABASE_URL and SUPABASE_ANON_KEY environment variables.'
      );
    }

    supabase = createClient(url, key);
  }

  return supabase;
}

export function closeSupabaseClient(): void {
  supabase = null;
}
```

### Step 4.3: Create Database Queries

Create `src/db/queries.ts`:

```typescript
import { SupabaseClient } from '@supabase/supabase-js';
import { VCon, Analysis, Dialog, Party } from '../types/vcon';

export class VConQueries {
  constructor(private supabase: SupabaseClient) {}

  async createVCon(vcon: VCon): Promise<{ uuid: string }> {
    // Insert main vcon
    const { data: vconData, error: vconError } = await this.supabase
      .from('vcons')
      .insert({
        uuid: vcon.uuid,
        vcon_version: vcon.vcon,
        subject: vcon.subject,
        created_at: vcon.created_at,
        updated_at: vcon.updated_at,
        extensions: vcon.extensions,
        must_support: vcon.must_support,
      })
      .select('id, uuid')
      .single();

    if (vconError) throw vconError;

    // Insert parties
    if (vcon.parties.length > 0) {
      const partiesData = vcon.parties.map((party, index) => ({
        vcon_id: vconData.id,
        party_index: index,
        tel: party.tel,
        sip: party.sip,
        mailto: party.mailto,
        name: party.name,
        did: party.did,
        uuid: party.uuid,  // ✅ Corrected field
        validation: party.validation,
      }));

      const { error: partiesError } = await this.supabase
        .from('parties')
        .insert(partiesData);

      if (partiesError) throw partiesError;
    }

    return { uuid: vconData.uuid };
  }

  async addAnalysis(vconUuid: string, analysis: Analysis): Promise<void> {
    const { data: vcon, error: vconError } = await this.supabase
      .from('vcons')
      .select('id')
      .eq('uuid', vconUuid)
      .single();

    if (vconError) throw vconError;

    // Get next analysis index
    const { data: existingAnalysis } = await this.supabase
      .from('analysis')
      .select('analysis_index')
      .eq('vcon_id', vcon.id)
      .order('analysis_index', { ascending: false })
      .limit(1);

    const nextIndex = existingAnalysis?.length 
      ? existingAnalysis[0].analysis_index + 1 
      : 0;

    // ✅ CORRECTED: Use 'schema' not 'schema_version'
    const { error: analysisError } = await this.supabase
      .from('analysis')
      .insert({
        vcon_id: vcon.id,
        analysis_index: nextIndex,
        type: analysis.type,
        dialog_indices: Array.isArray(analysis.dialog) 
          ? analysis.dialog 
          : (analysis.dialog ? [analysis.dialog] : null),
        mediatype: analysis.mediatype,
        filename: analysis.filename,
        vendor: analysis.vendor,    // ✅ REQUIRED field
        product: analysis.product,
        schema: analysis.schema,    // ✅ Correct field name
        body: analysis.body,        // ✅ TEXT type
        encoding: analysis.encoding,
        url: analysis.url,
        content_hash: analysis.content_hash,
      });

    if (analysisError) throw analysisError;
  }

  async getVCon(uuid: string): Promise<VCon> {
    // Get main vcon
    const { data: vconData, error: vconError } = await this.supabase
      .from('vcons')
      .select('*')
      .eq('uuid', uuid)
      .single();

    if (vconError) throw vconError;

    // Get parties
    const { data: parties } = await this.supabase
      .from('parties')
      .select('*')
      .eq('vcon_id', vconData.id)
      .order('party_index');

    // Get dialog
    const { data: dialogs } = await this.supabase
      .from('dialog')
      .select('*')
      .eq('vcon_id', vconData.id)
      .order('dialog_index');

    // Get analysis - ✅ Queries 'schema' not 'schema_version'
    const { data: analysis } = await this.supabase
      .from('analysis')
      .select('*')
      .eq('vcon_id', vconData.id)
      .order('analysis_index');

    // Reconstruct vCon
    return {
      vcon: vconData.vcon_version as '0.3.0',
      uuid: vconData.uuid,
      extensions: vconData.extensions,
      must_support: vconData.must_support,
      created_at: vconData.created_at,
      updated_at: vconData.updated_at,
      subject: vconData.subject,
      parties: parties?.map(p => ({
        tel: p.tel,
        sip: p.sip,
        mailto: p.mailto,
        name: p.name,
        did: p.did,
        uuid: p.uuid,
        validation: p.validation,
      })) || [],
      dialog: dialogs?.map(d => ({
        type: d.type,
        start: d.start_time,
        duration: d.duration_seconds,
        parties: d.parties,
        originator: d.originator,
        mediatype: d.mediatype,
        body: d.body,
        encoding: d.encoding,
        session_id: d.session_id,
        application: d.application,
        message_id: d.message_id,
      })),
      analysis: analysis?.map(a => ({
        type: a.type,
        dialog: a.dialog_indices,
        vendor: a.vendor,
        product: a.product,
        schema: a.schema,  // ✅ Correct field name
        body: a.body,
        encoding: a.encoding,
      })),
    };
  }

  async searchVCons(filters: {
    subject?: string;
    partyName?: string;
    startDate?: string;
    endDate?: string;
  }): Promise<VCon[]> {
    let query = this.supabase
      .from('vcons')
      .select('*');

    if (filters.subject) {
      query = query.ilike('subject', `%${filters.subject}%`);
    }

    if (filters.startDate) {
      query = query.gte('created_at', filters.startDate);
    }

    if (filters.endDate) {
      query = query.lte('created_at', filters.endDate);
    }

    const { data, error } = await query;
    if (error) throw error;

    // Fetch full vCons for results
    return Promise.all(
      data.map(v => this.getVCon(v.uuid))
    );
  }
}
```

### Step 4.4: Create Validation Utilities

Create `src/utils/validation.ts`:

```typescript
import { VCon, Analysis, Dialog } from '../types/vcon';

export class VConValidator {
  private errors: string[] = [];

  validate(vcon: VCon): { valid: boolean; errors: string[] } {
    this.errors = [];

    this.validateVersion(vcon);
    this.validateUUID(vcon.uuid);
    this.validateParties(vcon.parties);
    if (vcon.dialog) this.validateDialogs(vcon.dialog);
    if (vcon.analysis) this.validateAnalysis(vcon.analysis);

    return {
      valid: this.errors.length === 0,
      errors: this.errors
    };
  }

  private validateVersion(vcon: VCon): void {
    if (vcon.vcon !== '0.3.0') {
      this.errors.push(`Invalid vcon version: ${vcon.vcon}`);
    }
  }

  private validateUUID(uuid: string): void {
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(uuid)) {
      this.errors.push(`Invalid UUID format: ${uuid}`);
    }
  }

  private validateParties(parties: any[]): void {
    if (parties.length === 0) {
      this.errors.push('vCon must have at least one party');
    }
  }

  private validateDialogs(dialogs: Dialog[]): void {
    dialogs.forEach((dialog, i) => {
      const validTypes = ['recording', 'text', 'transfer', 'incomplete'];
      if (!validTypes.includes(dialog.type)) {
        this.errors.push(`Dialog ${i} has invalid type: ${dialog.type}`);
      }
    });
  }

  private validateAnalysis(analyses: Analysis[]): void {
    analyses.forEach((analysis, i) => {
      // ✅ CRITICAL: vendor is required
      if (!analysis.vendor) {
        this.errors.push(`Analysis ${i} missing required field: vendor`);
      }
    });
  }
}

export function validateVCon(vcon: VCon) {
  return new VConValidator().validate(vcon);
}
```

### ✅ Phase 4 Checkpoint

Verify your implementation:

```bash
# Compile TypeScript
npm run build

# Should compile without errors
# Check dist/ directory was created
ls dist/
```

---

## Phase 5: MCP Server

### Step 5.1: Create MCP Tool Definitions

Create `src/tools/vcon-crud.ts`:

```typescript
import { z } from 'zod';

// ✅ CORRECTED: Analysis schema with proper field names
export const AnalysisSchema = z.object({
  type: z.string(),
  dialog: z.union([z.number(), z.array(z.number())]).optional(),
  vendor: z.string(),              // ✅ REQUIRED
  product: z.string().optional(),
  schema: z.string().optional(),   // ✅ Correct field name
  body: z.string().optional(),     // ✅ String type
  encoding: z.enum(['base64url', 'json', 'none']).optional(),
});

export const PartySchema = z.object({
  tel: z.string().optional(),
  mailto: z.string().optional(),
  name: z.string().optional(),
  uuid: z.string().uuid().optional(),  // ✅ Added
});

export const DialogSchema = z.object({
  type: z.enum(['recording', 'text', 'transfer', 'incomplete']),
  start: z.string().optional(),
  body: z.string().optional(),
  encoding: z.enum(['base64url', 'json', 'none']).optional(),
  session_id: z.string().optional(),
  application: z.string().optional(),
  message_id: z.string().optional(),
});

// MCP Tool: Create vCon
export const createVConTool = {
  name: 'create_vcon',
  description: 'Create a new vCon compliant with IETF spec',
  inputSchema: {
    type: 'object',
    properties: {
      subject: { type: 'string' },
      parties: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            name: { type: 'string' },
            tel: { type: 'string' },
            mailto: { type: 'string' },
            uuid: { type: 'string' },
          }
        },
        minItems: 1
      }
    },
    required: ['parties']
  }
};

// MCP Tool: Add Analysis
export const addAnalysisTool = {
  name: 'add_analysis',
  description: 'Add analysis to a vCon',
  inputSchema: {
    type: 'object',
    properties: {
      vcon_uuid: { type: 'string', format: 'uuid' },
      analysis: {
        type: 'object',
        properties: {
          type: { type: 'string' },
          vendor: { type: 'string' },    // ✅ REQUIRED
          product: { type: 'string' },
          schema: { type: 'string' },    // ✅ Correct name
          body: { type: 'string' },      // ✅ String type
          encoding: {
            type: 'string',
            enum: ['base64url', 'json', 'none']
          }
        },
        required: ['type', 'vendor']     // ✅ vendor required
      }
    },
    required: ['vcon_uuid', 'analysis']
  }
};

// MCP Tool: Get vCon
export const getVConTool = {
  name: 'get_vcon',
  description: 'Retrieve a vCon by UUID',
  inputSchema: {
    type: 'object',
    properties: {
      uuid: { type: 'string', format: 'uuid' }
    },
    required: ['uuid']
  }
};

// MCP Tool: Search vCons
export const searchVConsTool = {
  name: 'search_vcons',
  description: 'Search vCons by criteria',
  inputSchema: {
    type: 'object',
    properties: {
      subject: { type: 'string' },
      party_name: { type: 'string' },
      start_date: { type: 'string', format: 'date-time' },
      end_date: { type: 'string', format: 'date-time' }
    }
  }
};
```

### Step 5.2: Create MCP Server

Create `src/index.ts`:

```typescript
#!/usr/bin/env node

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { getSupabaseClient } from './db/client.js';
import { VConQueries } from './db/queries.js';
import { validateVCon } from './utils/validation.js';
import {
  createVConTool,
  addAnalysisTool,
  getVConTool,
  searchVConsTool,
} from './tools/vcon-crud.js';
import { VCon, Analysis } from './types/vcon.js';

// Initialize MCP server
const server = new Server(
  {
    name: 'vcon-mcp-server',
    version: '1.0.0',
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// Initialize database
const supabase = getSupabaseClient();
const queries = new VConQueries(supabase);

// List available tools
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      createVConTool,
      addAnalysisTool,
      getVConTool,
      searchVConsTool,
    ],
  };
});

// Handle tool calls
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    switch (name) {
      case 'create_vcon': {
        const vcon: VCon = {
          vcon: '0.3.0',
          uuid: crypto.randomUUID(),
          created_at: new Date().toISOString(),
          subject: args.subject,
          parties: args.parties,
        };

        // Validate before saving
        const validation = validateVCon(vcon);
        if (!validation.valid) {
          return {
            content: [{
              type: 'text',
              text: `Validation failed: ${validation.errors.join(', ')}`,
            }],
            isError: true,
          };
        }

        const result = await queries.createVCon(vcon);
        return {
          content: [{
            type: 'text',
            text: `Created vCon with UUID: ${result.uuid}`,
          }],
        };
      }

      case 'add_analysis': {
        const analysis: Analysis = args.analysis;
        
        // ✅ Ensure vendor is provided
        if (!analysis.vendor) {
          return {
            content: [{
              type: 'text',
              text: 'Error: vendor is required in analysis',
            }],
            isError: true,
          };
        }

        await queries.addAnalysis(args.vcon_uuid, analysis);
        return {
          content: [{
            type: 'text',
            text: `Added analysis to vCon ${args.vcon_uuid}`,
          }],
        };
      }

      case 'get_vcon': {
        const vcon = await queries.getVCon(args.uuid);
        return {
          content: [{
            type: 'text',
            text: JSON.stringify(vcon, null, 2),
          }],
        };
      }

      case 'search_vcons': {
        const results = await queries.searchVCons({
          subject: args.subject,
          partyName: args.party_name,
          startDate: args.start_date,
          endDate: args.end_date,
        });
        return {
          content: [{
            type: 'text',
            text: JSON.stringify(results, null, 2),
          }],
        };
      }

      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  } catch (error) {
    return {
      content: [{
        type: 'text',
        text: `Error: ${error.message}`,
      }],
      isError: true,
    };
  }
});

// Start server
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('vCon MCP Server running on stdio');
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
```

### Step 5.3: Test the Server

```bash
# Run in development mode
npm run dev

# In another terminal, test with MCP Inspector
npx @modelcontextprotocol/inspector node dist/index.js
```

### ✅ Phase 5 Checkpoint

The server should:
- ✅ Start without errors
- ✅ List 4 tools (create, add_analysis, get, search)
- ✅ Accept tool calls
- ✅ Return proper responses

---

## Phase 6: Testing & Validation

### Step 6.1: Create Compliance Tests

Create `tests/vcon-compliance.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { VCon, Analysis } from '../src/types/vcon';
import { validateVCon } from '../src/utils/validation';

describe('IETF vCon Spec Compliance', () => {
  it('should use "schema" not "schema_version"', () => {
    const analysis: Analysis = {
      type: 'test',
      vendor: 'TestVendor',
      schema: 'v1.0',  // ✅ Correct
      body: 'test',
      encoding: 'none'
    };

    expect(analysis.schema).toBe('v1.0');
    expect((analysis as any).schema_version).toBeUndefined();
  });

  it('should require vendor in analysis', () => {
    const vcon: VCon = {
      vcon: '0.3.0',
      uuid: crypto.randomUUID(),
      created_at: new Date().toISOString(),
      parties: [{ name: 'Test' }],
      analysis: [{
        type: 'test',
        body: 'test',
        encoding: 'none'
      } as any]
    };

    const result = validateVCon(vcon);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('vendor'))).toBe(true);
  });

  it('should accept string body in analysis', () => {
    const analysis: Analysis = {
      type: 'transcript',
      vendor: 'TestVendor',
      body: 'Plain text content',  // ✅ String
      encoding: 'none'
    };

    expect(typeof analysis.body).toBe('string');
  });

  it('should support party uuid field', () => {
    const vcon: VCon = {
      vcon: '0.3.0',
      uuid: crypto.randomUUID(),
      created_at: new Date().toISOString(),
      parties: [{
        name: 'Test',
        uuid: crypto.randomUUID()  // ✅ uuid field
      }]
    };

    expect(vcon.parties[0].uuid).toBeDefined();
    expect(validateVCon(vcon).valid).toBe(true);
  });
});
```

### Step 6.2: Run Tests

```bash
# Run all tests
npm test

# Run compliance tests only
npm run test:compliance
```

### Step 6.3: Verify No Incorrect Field Names

```bash
# Search for incorrect field names in code
grep -r "schema_version" src/
# Should return NO results

grep -r "vendor?" src/types/
# Should return NO results (vendor should not be optional)
```

### ✅ Phase 6 Checkpoint

All tests should pass:
- ✅ No `schema_version` in codebase
- ✅ `vendor` is required in Analysis type
- ✅ `body` accepts string values
- ✅ All validation tests pass

---

## Phase 7: Deployment

### Step 7.1: Build for Production

```bash
# Clean and build
rm -rf dist/
npm run build

# Verify build
ls dist/
```

### Step 7.2: Configure MCP Client

Add to your MCP client configuration (e.g., Claude Desktop):

**macOS:** `~/Library/Application Support/Claude/claude_desktop_config.json`
**Windows:** `%APPDATA%\Claude\claude_desktop_config.json`

```json
{
  "mcpServers": {
    "vcon": {
      "command": "node",
      "args": ["/absolute/path/to/vcon-mcp-server/dist/index.js"],
      "env": {
        "SUPABASE_URL": "https://xxxxx.supabase.co",
        "SUPABASE_ANON_KEY": "eyJhbGciOiJIUzI1NiI..."
      }
    }
  }
}
```

### Step 7.3: Test with AI Assistant

Restart your AI assistant and try:

```
Create a new vCon with parties Alice and Bob
```

### ✅ Phase 7 Checkpoint

The AI should:
- ✅ See the vCon tools
- ✅ Successfully create vCons
- ✅ Add analysis with correct field names
- ✅ Retrieve and search vCons

---

## Troubleshooting

### Issue: TypeScript Compilation Errors

**Symptom:** Errors about missing types or incorrect field names

**Solution:**
```bash
# Reinstall dependencies
rm -rf node_modules package-lock.json
npm install

# Check TypeScript version
npx tsc --version  # Should be 5.x

# Verify tsconfig.json is correct
cat tsconfig.json
```

### Issue: Database Connection Fails

**Symptom:** "Missing Supabase credentials" error

**Solution:**
```bash
# Verify .env file exists and has correct values
cat .env

# Test connection
node -e "
require('dotenv').config();
console.log('URL:', process.env.SUPABASE_URL ? '✓' : '✗');
console.log('KEY:', process.env.SUPABASE_ANON_KEY ? '✓' : '✗');
"
```

### Issue: "schema_version does not exist" Error

**Symptom:** Database error about unknown column

**Solution:**
```sql
-- Verify database schema is correct
SELECT column_name FROM information_schema.columns
WHERE table_name = 'analysis';

-- Should show 'schema' NOT 'schema_version'
```

If incorrect, re-run the corrected schema from `CORRECTED_SCHEMA.md`.

### Issue: Vendor Validation Fails

**Symptom:** "vendor is required" error

**Solution:**
- ✅ Always include `vendor` in analysis objects
- ✅ Check that Analysis type doesn't have `vendor?` (with question mark)
- ✅ Verify tool schema marks vendor as required

### Issue: MCP Server Doesn't Start

**Symptom:** Server crashes on startup

**Solution:**
```bash
# Check for syntax errors
npm run build

# Run with detailed logging
NODE_ENV=development npm run dev

# Verify MCP SDK version
npm list @modelcontextprotocol/sdk
```

---

## Next Steps

### Enhancements to Consider

1. **Add More Tools**
   - Update vCon
   - Delete vCon
   - Add dialog
   - Add attachments
   - Export vCon to JWS/JWE

2. **Add Resources**
   - `vcon://uuid` URI scheme
   - List recent vCons
   - vCon templates

3. **Add Prompts**
   - Summarize conversation
   - Extract action items
   - Compliance check

4. **Advanced Features**
   - Privacy redaction
   - Consent management
   - Group vCons
   - Digital signatures (JWS)
   - Encryption (JWE)

5. **Performance**
   - Caching layer
   - Batch operations
   - Pagination
   - Indexes optimization

6. **Security**
   - Row Level Security
   - API rate limiting
   - Input sanitization
   - Audit logging

### Learning Resources

- **IETF vCon Spec:** `background_docs/draft-ietf-vcon-vcon-core-00.txt`
- **MCP Documentation:** https://modelcontextprotocol.io/
- **Supabase Docs:** https://supabase.com/docs
- **Implementation Guide:** `CLAUDE_CODE_INSTRUCTIONS.md`
- **Quick Reference:** `QUICK_REFERENCE.md`

### Community & Support

- **vCon Working Group:** https://datatracker.ietf.org/wg/vcon/
- **MCP Discord:** https://discord.gg/modelcontextprotocol
- **Issues:** File bugs/questions in your repo issues

---

## Appendix: Command Reference

### Development Commands

```bash
# Install dependencies
npm install

# Build project
npm run build

# Run in development
npm run dev

# Run tests
npm test
npm run test:compliance

# Lint code
npm run lint

# Type check
npx tsc --noEmit
```

### Git Commands

```bash
# Initialize repo
git init

# Add all files
git add -A

# Commit
git commit -m "Initial commit"

# Create remote and push
git remote add origin <url>
git push -u origin main
```

### Database Commands

```bash
# Connect to Supabase
psql "postgresql://postgres:password@db.xxx.supabase.co:5432/postgres"

# List tables
\dt

# Describe table
\d analysis

# Run SQL file
\i schema.sql
```

---

## Success Checklist

Your implementation is complete when:

- [ ] All dependencies installed
- [ ] TypeScript compiles without errors
- [ ] Database schema matches spec
- [ ] No `schema_version` in codebase
- [ ] Analysis vendor is required
- [ ] Analysis body is string type
- [ ] Party has uuid field
- [ ] All compliance tests pass
- [ ] MCP server starts successfully
- [ ] Tools are callable from AI assistant
- [ ] Can create, read, search vCons
- [ ] vCons are spec-compliant
- [ ] Database operations work correctly

---

**🎉 Congratulations!** You've built a fully spec-compliant IETF vCon MCP Server!

---

*Last Updated: October 7, 2025*  
*Spec Version: draft-ietf-vcon-vcon-core-00*  
*vCon Schema: 0.3.0*

