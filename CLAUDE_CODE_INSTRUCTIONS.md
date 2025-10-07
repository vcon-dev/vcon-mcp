# Claude Code Instructions: IETF vCon MCP Server Implementation

## Project Overview

Build a Model Context Protocol (MCP) server for managing IETF vCon (Virtual Conversation) data stored in Supabase PostgreSQL. The implementation MUST be fully compliant with draft-ietf-vcon-vcon-core-00 specification.

**CRITICAL**: All implementations must use the corrected field names and data types documented in this file. The original specification had several inconsistencies that have been corrected.

## Project Structure

```
vcon-mcp/
├── src/
│   ├── index.ts                 # MCP server entry point
│   ├── types/
│   │   ├── vcon.ts             # Core vCon types (CORRECTED)
│   │   ├── mcp.ts              # MCP tool/resource types
│   │   └── privacy.ts          # Privacy extension types
│   ├── tools/
│   │   ├── vcon-crud.ts        # Create/Read/Update vCon tools
│   │   ├── search.ts           # Search and query tools
│   │   ├── analysis.ts         # Analysis management tools
│   │   └── privacy.ts          # Privacy compliance tools
│   ├── resources/
│   │   ├── vcon-resources.ts   # URI-based vCon access
│   │   └── privacy-resources.ts
│   ├── prompts/
│   │   ├── analysis-prompts.ts
│   │   └── compliance-prompts.ts
│   ├── db/
│   │   ├── client.ts           # Supabase client
│   │   ├── schema.sql          # CORRECTED database schema
│   │   └── queries.ts          # Common database queries
│   └── utils/
│       ├── validation.ts       # vCon validation
│       ├── privacy.ts          # PII processing
│       └── serialization.ts    # JWS/JWE handling
├── tests/
│   ├── vcon-compliance.test.ts # Spec compliance tests
│   └── interoperability.test.ts
├── package.json
├── tsconfig.json
└── .env.example
```

---

## CRITICAL: Corrected Field Names

These corrections are MANDATORY for IETF spec compliance:

### Analysis Object
```typescript
// ❌ WRONG (old implementation)
interface AnalysisWrong {
  schema_version?: string;  // WRONG FIELD NAME
  vendor?: string;          // WRONG - should be required
  body: object;             // WRONG - should support strings
}

// ✅ CORRECT (spec compliant)
interface Analysis {
  type: string;
  dialog?: number | number[];
  mediatype?: string;
  filename?: string;
  vendor: string;           // REQUIRED per spec Section 4.5.5
  product?: string;
  schema?: string;          // CORRECT field name per spec Section 4.5.7
  body?: string;            // String to support all formats
  encoding?: 'base64url' | 'json' | 'none';
  url?: string;
  content_hash?: string | string[];
}
```

### Party Object
```typescript
// ✅ CORRECT - includes uuid field
interface Party {
  tel?: string;
  sip?: string;
  stir?: string;
  mailto?: string;
  name?: string;
  did?: string;             // Added per spec Section 4.2.6
  validation?: string;
  jcard?: object;
  gmlpos?: string;
  civicaddress?: Civicaddress;
  timezone?: string;
  uuid?: string;            // REQUIRED field per spec Section 4.2.12
}
```

### Dialog Object
```typescript
// ✅ CORRECT - includes all required fields
interface Dialog {
  type: 'recording' | 'text' | 'transfer' | 'incomplete';
  start?: string;           // Date string
  duration?: number;
  parties?: number | number[] | (number | number[])[];
  originator?: number;
  mediatype?: string;
  filename?: string;
  body?: string;
  encoding?: 'base64url' | 'json' | 'none';
  url?: string;
  content_hash?: string | string[];
  disposition?: 'no-answer' | 'congestion' | 'failed' | 'busy' | 'hung-up' | 'voicemail-no-message';
  session_id?: string;      // Added per spec Section 4.3.10
  party_history?: PartyHistory[];
  application?: string;     // Added per spec Section 4.3.13
  message_id?: string;      // Added per spec Section 4.3.14
}
```

### VCon Object
```typescript
// ✅ CORRECT - includes all core fields
interface VCon {
  vcon: '0.3.0';            // Current spec version
  uuid: string;             // Required UUID
  extensions?: string[];    // Added per spec Section 4.1.3
  must_support?: string[];  // Added per spec Section 4.1.4
  created_at: string;       // Required Date
  updated_at?: string;      // Optional Date
  subject?: string;
  redacted?: Redacted;
  appended?: Appended;      // Added per spec Section 4.1.9
  group?: Group[];
  parties: Party[];
  dialog?: Dialog[];
  analysis?: Analysis[];
  attachments?: Attachment[];
}
```

---

## Implementation Steps

### Step 1: Database Setup

1. Create Supabase project
2. Run the CORRECTED schema from `CORRECTED_SCHEMA.md`
3. Set up Row Level Security policies
4. Configure database connection

**Key Points**:
- Use TEXT for analysis.body (not JSONB)
- Use `schema` field name (not `schema_version`)
- Make analysis.vendor NOT NULL
- Remove default values from encoding fields
- Add constraints for dialog.type and encoding values

### Step 2: Core TypeScript Types

Create `src/types/vcon.ts` with ALL corrected types:

```typescript
// src/types/vcon.ts

/**
 * IETF vCon Core Types - Compliant with draft-ietf-vcon-vcon-core-00
 * All field names and types match the specification exactly.
 */

export type VConVersion = '0.3.0';
export type Encoding = 'base64url' | 'json' | 'none';
export type DialogType = 'recording' | 'text' | 'transfer' | 'incomplete';
export type DialogDisposition = 'no-answer' | 'congestion' | 'failed' | 'busy' | 'hung-up' | 'voicemail-no-message';
export type PartyEventType = 'join' | 'drop' | 'hold' | 'unhold' | 'mute' | 'unmute';

// Section 4.2 - Party Object
export interface Civicaddress {
  country?: string;
  a1?: string;
  a2?: string;
  a3?: string;
  a4?: string;
  a5?: string;
  a6?: string;
  prd?: string;
  pod?: string;
  sts?: string;
  hno?: string;
  hns?: string;
  lmk?: string;
  loc?: string;
  flr?: string;
  nam?: string;
  pc?: string;
}

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
  civicaddress?: Civicaddress;
  timezone?: string;
  uuid?: string;  // Section 4.2.12
}

// Section 4.3.11 - Party History
export interface PartyHistory {
  party: number;
  time: string;  // Date string
  event: PartyEventType;
}

// Section 4.3 - Dialog Object
export interface Dialog {
  type: DialogType;
  start?: string;  // Date string
  duration?: number;
  parties?: number | number[] | (number | number[])[];
  originator?: number;
  mediatype?: string;
  filename?: string;
  body?: string;
  encoding?: Encoding;
  url?: string;
  content_hash?: string | string[];
  disposition?: DialogDisposition;
  session_id?: string;  // Section 4.3.10
  party_history?: PartyHistory[];  // Section 4.3.11
  application?: string;  // Section 4.3.13
  message_id?: string;  // Section 4.3.14
  
  // Transfer-specific fields (only for type='transfer')
  transferee?: number;
  transferor?: number;
  transfer_target?: number;
  original?: number;
  consultation?: number;
  target_dialog?: number;
}

// Section 4.4 - Attachment Object
export interface Attachment {
  type?: string;
  start?: string;  // Date string
  party?: number;
  dialog?: number;  // Section 4.4.4
  mediatype?: string;
  filename?: string;
  body?: string;
  encoding?: Encoding;
  url?: string;
  content_hash?: string | string[];
}

// Section 4.5 - Analysis Object
// CRITICAL: This is the corrected version
export interface Analysis {
  type: string;
  dialog?: number | number[];  // Section 4.5.2
  mediatype?: string;
  filename?: string;
  vendor: string;  // REQUIRED - Section 4.5.5
  product?: string;
  schema?: string;  // CORRECTED: was schema_version
  body?: string;  // CORRECTED: String, not object
  encoding?: Encoding;
  url?: string;
  content_hash?: string | string[];
}

// Section 4.1.8 - Redacted Object
export interface Redacted {
  uuid?: string;
  type?: string;
  url?: string;
  content_hash?: string | string[];
}

// Section 4.1.9 - Appended Object
export interface Appended {
  uuid?: string;
  url?: string;
  content_hash?: string | string[];
}

// Section 4.6 - Group Object
export interface Group {
  uuid?: string;
  body?: string;  // vCon content
  encoding?: 'json';
  url?: string;
  content_hash?: string | string[];
}

// Section 4.1 - Main vCon Object
export interface VCon {
  vcon: VConVersion;
  uuid: string;
  extensions?: string[];  // Section 4.1.3
  must_support?: string[];  // Section 4.1.4
  created_at: string;  // Date string
  updated_at?: string;  // Date string
  subject?: string;
  redacted?: Redacted;
  appended?: Appended;
  group?: Group[];
  parties: Party[];
  dialog?: Dialog[];
  analysis?: Analysis[];
  attachments?: Attachment[];
}

// Validation helpers
export function isValidDialogType(type: string): type is DialogType {
  return ['recording', 'text', 'transfer', 'incomplete'].includes(type);
}

export function isValidEncoding(encoding: string): encoding is Encoding {
  return ['base64url', 'json', 'none'].includes(encoding);
}

export function isValidDisposition(disposition: string): disposition is DialogDisposition {
  return ['no-answer', 'congestion', 'failed', 'busy', 'hung-up', 'voicemail-no-message'].includes(disposition);
}
```

### Step 3: MCP Tool Definitions

Create `src/tools/vcon-crud.ts` with corrected tool schemas:

```typescript
// src/tools/vcon-crud.ts

import { z } from 'zod';

// CORRECTED: Analysis schema with proper field names
export const AnalysisSchema = z.object({
  type: z.string(),
  dialog: z.union([z.number(), z.array(z.number())]).optional(),
  mediatype: z.string().optional(),
  filename: z.string().optional(),
  vendor: z.string(),  // REQUIRED
  product: z.string().optional(),
  schema: z.string().optional(),  // CORRECTED: was schema_version
  body: z.string().optional(),  // CORRECTED: string not object
  encoding: z.enum(['base64url', 'json', 'none']).optional(),
  url: z.string().optional(),
  content_hash: z.union([z.string(), z.array(z.string())]).optional(),
});

export const DialogSchema = z.object({
  type: z.enum(['recording', 'text', 'transfer', 'incomplete']),
  start: z.string().optional(),
  duration: z.number().optional(),
  parties: z.union([
    z.number(),
    z.array(z.number()),
    z.array(z.union([z.number(), z.array(z.number())]))
  ]).optional(),
  originator: z.number().optional(),
  mediatype: z.string().optional(),
  filename: z.string().optional(),
  body: z.string().optional(),
  encoding: z.enum(['base64url', 'json', 'none']).optional(),
  url: z.string().optional(),
  content_hash: z.union([z.string(), z.array(z.string())]).optional(),
  disposition: z.enum(['no-answer', 'congestion', 'failed', 'busy', 'hung-up', 'voicemail-no-message']).optional(),
  session_id: z.string().optional(),
  application: z.string().optional(),
  message_id: z.string().optional(),
});

export const PartySchema = z.object({
  tel: z.string().optional(),
  sip: z.string().optional(),
  stir: z.string().optional(),
  mailto: z.string().optional(),
  name: z.string().optional(),
  did: z.string().optional(),
  validation: z.string().optional(),
  uuid: z.string().uuid().optional(),  // ADDED
});

export const VConSchema = z.object({
  vcon: z.literal('0.3.0'),
  uuid: z.string().uuid(),
  extensions: z.array(z.string()).optional(),
  must_support: z.array(z.string()).optional(),
  created_at: z.string().datetime(),
  updated_at: z.string().datetime().optional(),
  subject: z.string().optional(),
  parties: z.array(PartySchema),
  dialog: z.array(DialogSchema).optional(),
  analysis: z.array(AnalysisSchema).optional(),
  attachments: z.array(z.any()).optional(),  // Define AttachmentSchema separately
});

// MCP Tool Definitions
export const createVConTool = {
  name: 'create_vcon',
  description: 'Create a new vCon compliant with IETF draft-ietf-vcon-vcon-core-00',
  inputSchema: {
    type: 'object',
    properties: {
      subject: { type: 'string' },
      parties: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            tel: { type: 'string' },
            mailto: { type: 'string' },
            name: { type: 'string' },
            uuid: { type: 'string', format: 'uuid' },
          }
        },
        minItems: 1,
      }
    },
    required: ['parties']
  }
};

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
          dialog: {
            oneOf: [
              { type: 'number' },
              { type: 'array', items: { type: 'number' } }
            ]
          },
          vendor: { type: 'string' },  // REQUIRED
          product: { type: 'string' },
          schema: { type: 'string' },  // CORRECTED field name
          body: { type: 'string' },    // CORRECTED to string
          encoding: { 
            type: 'string', 
            enum: ['base64url', 'json', 'none'] 
          },
        },
        required: ['type', 'vendor']  // vendor is required
      }
    },
    required: ['vcon_uuid', 'analysis']
  }
};

export const addDialogTool = {
  name: 'add_dialog',
  description: 'Add dialog to a vCon',
  inputSchema: {
    type: 'object',
    properties: {
      vcon_uuid: { type: 'string', format: 'uuid' },
      dialog: {
        type: 'object',
        properties: {
          type: { 
            type: 'string', 
            enum: ['recording', 'text', 'transfer', 'incomplete'] 
          },
          start: { type: 'string', format: 'date-time' },
          duration: { type: 'number' },
          parties: {
            oneOf: [
              { type: 'number' },
              { type: 'array', items: { type: 'number' } }
            ]
          },
          mediatype: { type: 'string' },
          body: { type: 'string' },
          encoding: { 
            type: 'string', 
            enum: ['base64url', 'json', 'none'] 
          },
          session_id: { type: 'string' },
          application: { type: 'string' },
          message_id: { type: 'string' },
        },
        required: ['type']
      }
    },
    required: ['vcon_uuid', 'dialog']
  }
};
```

### Step 4: Database Queries with Correct Field Names

Create `src/db/queries.ts`:

```typescript
// src/db/queries.ts

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
        extensions: vcon.extensions,  // ADDED
        must_support: vcon.must_support,  // ADDED
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
        did: party.did,  // ADDED
        uuid: party.uuid,  // ADDED - corrected field
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
    // Get vcon_id
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

    const nextIndex = existingAnalysis && existingAnalysis.length > 0 
      ? existingAnalysis[0].analysis_index + 1 
      : 0;

    // CORRECTED: Use 'schema' not 'schema_version'
    // CORRECTED: body is TEXT, not JSONB
    const { error: analysisError } = await this.supabase
      .from('analysis')
      .insert({
        vcon_id: vcon.id,
        analysis_index: nextIndex,
        type: analysis.type,
        dialog_indices: Array.isArray(analysis.dialog) ? analysis.dialog : (analysis.dialog ? [analysis.dialog] : null),  // ADDED
        mediatype: analysis.mediatype,
        filename: analysis.filename,
        vendor: analysis.vendor,  // REQUIRED field
        product: analysis.product,
        schema: analysis.schema,  // CORRECTED field name
        body: analysis.body,  // Now TEXT, can store any string
        encoding: analysis.encoding,
        url: analysis.url,
        content_hash: analysis.content_hash,
      });

    if (analysisError) throw analysisError;
  }

  async addDialog(vconUuid: string, dialog: Dialog): Promise<void> {
    const { data: vcon, error: vconError } = await this.supabase
      .from('vcons')
      .select('id')
      .eq('uuid', vconUuid)
      .single();

    if (vconError) throw vconError;

    // Get next dialog index
    const { data: existingDialog } = await this.supabase
      .from('dialog')
      .select('dialog_index')
      .eq('vcon_id', vcon.id)
      .order('dialog_index', { ascending: false })
      .limit(1);

    const nextIndex = existingDialog && existingDialog.length > 0 
      ? existingDialog[0].dialog_index + 1 
      : 0;

    const { error: dialogError } = await this.supabase
      .from('dialog')
      .insert({
        vcon_id: vcon.id,
        dialog_index: nextIndex,
        type: dialog.type,
        start_time: dialog.start,
        duration_seconds: dialog.duration,
        parties: Array.isArray(dialog.parties) ? dialog.parties : (dialog.parties ? [dialog.parties] : null),
        originator: dialog.originator,
        mediatype: dialog.mediatype,
        filename: dialog.filename,
        body: dialog.body,
        encoding: dialog.encoding,
        url: dialog.url,
        content_hash: dialog.content_hash,
        disposition: dialog.disposition,
        session_id: dialog.session_id,  // ADDED
        application: dialog.application,  // ADDED
        message_id: dialog.message_id,  // ADDED
      });

    if (dialogError) throw dialogError;

    // Handle party_history if present
    if (dialog.party_history && dialog.party_history.length > 0) {
      const { data: dialogData } = await this.supabase
        .from('dialog')
        .select('id')
        .eq('vcon_id', vcon.id)
        .eq('dialog_index', nextIndex)
        .single();

      if (dialogData) {
        const historyData = dialog.party_history.map(h => ({
          dialog_id: dialogData.id,
          party_index: h.party,
          time: h.time,
          event: h.event,
        }));

        await this.supabase
          .from('party_history')
          .insert(historyData);
      }
    }
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

    // Get analysis - CORRECTED: query 'schema' not 'schema_version'
    const { data: analysis } = await this.supabase
      .from('analysis')
      .select('*')
      .eq('vcon_id', vconData.id)
      .order('analysis_index');

    // Reconstruct vCon
    const vcon: VCon = {
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
        uuid: p.uuid,  // CORRECTED field
        validation: p.validation,
      })) || [],
      dialog: dialogs?.map(d => ({
        type: d.type,
        start: d.start_time,
        duration: d.duration_seconds,
        parties: d.parties,
        originator: d.originator,
        mediatype: d.mediatype,
        filename: d.filename,
        body: d.body,
        encoding: d.encoding,
        url: d.url,
        content_hash: d.content_hash,
        disposition: d.disposition,
        session_id: d.session_id,
        application: d.application,
        message_id: d.message_id,
      })),
      analysis: analysis?.map(a => ({
        type: a.type,
        dialog: a.dialog_indices?.length === 1 ? a.dialog_indices[0] : a.dialog_indices,
        mediatype: a.mediatype,
        filename: a.filename,
        vendor: a.vendor,
        product: a.product,
        schema: a.schema,  // CORRECTED field name
        body: a.body,  // Already TEXT in database
        encoding: a.encoding,
        url: a.url,
        content_hash: a.content_hash,
      })),
    };

    return vcon;
  }
}
```

### Step 5: Validation

Create `src/utils/validation.ts`:

```typescript
// src/utils/validation.ts

import { VCon, Analysis, Dialog, Party } from '../types/vcon';

export class VConValidator {
  private errors: string[] = [];

  validate(vcon: VCon): { valid: boolean; errors: string[] } {
    this.errors = [];

    // Core vCon validation
    this.validateVConVersion(vcon);
    this.validateUUID(vcon.uuid);
    this.validateParties(vcon.parties);
    if (vcon.dialog) this.validateDialogs(vcon.dialog);
    if (vcon.analysis) this.validateAnalysis(vcon.analysis);

    return {
      valid: this.errors.length === 0,
      errors: this.errors
    };
  }

  private validateVConVersion(vcon: VCon): void {
    if (vcon.vcon !== '0.3.0') {
      this.errors.push(`Invalid vcon version: ${vcon.vcon}. Must be '0.3.0'`);
    }
  }

  private validateUUID(uuid: string): void {
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(uuid)) {
      this.errors.push(`Invalid UUID format: ${uuid}`);
    }
  }

  private validateParties(parties: Party[]): void {
    if (parties.length === 0) {
      this.errors.push('vCon must have at least one party');
    }

    parties.forEach((party, index) => {
      // At least one identifier should be present
      const hasIdentifier = party.tel || party.sip || party.mailto || party.name || party.uuid;
      if (!hasIdentifier) {
        this.errors.push(`Party ${index} has no identifier (tel, sip, mailto, name, or uuid)`);
      }
    });
  }

  private validateDialogs(dialogs: Dialog[]): void {
    dialogs.forEach((dialog, index) => {
      // Validate dialog type
      const validTypes: Dialog['type'][] = ['recording', 'text', 'transfer', 'incomplete'];
      if (!validTypes.includes(dialog.type)) {
        this.errors.push(`Dialog ${index} has invalid type: ${dialog.type}`);
      }

      // Validate encoding if present
      if (dialog.encoding) {
        const validEncodings = ['base64url', 'json', 'none'];
        if (!validEncodings.includes(dialog.encoding)) {
          this.errors.push(`Dialog ${index} has invalid encoding: ${dialog.encoding}`);
        }
      }

      // Incomplete dialogs must have disposition
      if (dialog.type === 'incomplete' && !dialog.disposition) {
        this.errors.push(`Dialog ${index} is incomplete but has no disposition`);
      }

      // Validate disposition values
      if (dialog.disposition) {
        const validDispositions = ['no-answer', 'congestion', 'failed', 'busy', 'hung-up', 'voicemail-no-message'];
        if (!validDispositions.includes(dialog.disposition)) {
          this.errors.push(`Dialog ${index} has invalid disposition: ${dialog.disposition}`);
        }
      }

      // Transfer dialogs must have transfer fields
      if (dialog.type === 'transfer') {
        if (!dialog.transferee || !dialog.transferor || !dialog.transfer_target) {
          this.errors.push(`Dialog ${index} is transfer type but missing transfer fields`);
        }
      }
    });
  }

  private validateAnalysis(analyses: Analysis[]): void {
    analyses.forEach((analysis, index) => {
      // CRITICAL: vendor is required per spec Section 4.5.5
      if (!analysis.vendor) {
        this.errors.push(`Analysis ${index} missing required field: vendor`);
      }

      // Validate encoding if present
      if (analysis.encoding) {
        const validEncodings = ['base64url', 'json', 'none'];
        if (!validEncodings.includes(analysis.encoding)) {
          this.errors.push(`Analysis ${index} has invalid encoding: ${analysis.encoding}`);
        }
      }

      // If body and encoding are present, validate they match
      if (analysis.body && analysis.encoding === 'json') {
        try {
          JSON.parse(analysis.body);
        } catch (e) {
          this.errors.push(`Analysis ${index} has encoding='json' but body is not valid JSON`);
        }
      }

      // Must have either (body + encoding) or (url + content_hash)
      const hasInline = analysis.body !== undefined && analysis.encoding !== undefined;
      const hasExternal = analysis.url !== undefined && analysis.content_hash !== undefined;
      
      if (!hasInline && !hasExternal) {
        this.errors.push(`Analysis ${index} must have either (body + encoding) or (url + content_hash)`);
      }
    });
  }
}

// Export convenience function
export function validateVCon(vcon: VCon): { valid: boolean; errors: string[] } {
  const validator = new VConValidator();
  return validator.validate(vcon);
}
```

---

## Testing Requirements

### Compliance Tests

Create `tests/vcon-compliance.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { VCon, Analysis } from '../src/types/vcon';
import { validateVCon } from '../src/utils/validation';

describe('IETF vCon Compliance', () => {
  it('should use correct field name "schema" not "schema_version"', () => {
    const analysis: Analysis = {
      type: 'transcript',
      vendor: 'TestVendor',
      schema: 'v1.0',  // CORRECT field name
      body: 'test content',
      encoding: 'none'
    };

    // TypeScript should compile without errors
    expect(analysis.schema).toBe('v1.0');
    expect((analysis as any).schema_version).toBeUndefined();
  });

  it('should require vendor field in analysis', () => {
    const vcon: VCon = {
      vcon: '0.3.0',
      uuid: '123e4567-e89b-12d3-a456-426614174000',
      created_at: new Date().toISOString(),
      parties: [{ name: 'Test' }],
      analysis: [{
        type: 'test',
        // vendor: 'Required',  // Missing - should fail
        body: 'test',
        encoding: 'none'
      } as any]
    };

    const result = validateVCon(vcon);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain(expect.stringContaining('vendor'));
  });

  it('should accept string body in analysis', () => {
    const analysis: Analysis = {
      type: 'transcript',
      vendor: 'TestVendor',
      body: 'Plain text transcript content',  // String, not object
      encoding: 'none'
    };

    expect(typeof analysis.body).toBe('string');
  });

  it('should accept non-JSON body formats', () => {
    const csvAnalysis: Analysis = {
      type: 'data_export',
      vendor: 'CSVExporter',
      body: 'col1,col2,col3\nval1,val2,val3',
      encoding: 'none'
    };

    expect(csvAnalysis.body).toContain('col1,col2,col3');
  });

  it('should support party uuid field', () => {
    const vcon: VCon = {
      vcon: '0.3.0',
      uuid: '123e4567-e89b-12d3-a456-426614174000',
      created_at: new Date().toISOString(),
      parties: [{
        name: 'Test Party',
        uuid: '223e4567-e89b-12d3-a456-426614174000'  // uuid field per spec
      }]
    };

    const result = validateVCon(vcon);
    expect(result.valid).toBe(true);
    expect(vcon.parties[0].uuid).toBeDefined();
  });

  it('should validate dialog types', () => {
    const validTypes: Array<'recording' | 'text' | 'transfer' | 'incomplete'> = [
      'recording', 'text', 'transfer', 'incomplete'
    ];

    validTypes.forEach(type => {
      const vcon: VCon = {
        vcon: '0.3.0',
        uuid: '123e4567-e89b-12d3-a456-426614174000',
        created_at: new Date().toISOString(),
        parties: [{ name: 'Test' }],
        dialog: [{
          type,
          body: 'test',
          encoding: 'none'
        }]
      };

      const result = validateVCon(vcon);
      expect(result.valid).toBe(true);
    });
  });

  it('should validate encoding values', () => {
    const validEncodings: Array<'base64url' | 'json' | 'none'> = [
      'base64url', 'json', 'none'
    ];

    validEncodings.forEach(encoding => {
      const analysis: Analysis = {
        type: 'test',
        vendor: 'TestVendor',
        body: 'test content',
        encoding
      };

      expect(encoding).toMatch(/^(base64url|json|none)$/);
    });
  });
});
```

---

## Configuration Files

### package.json

```json
{
  "name": "vcon-mcp-server",
  "version": "1.0.0",
  "description": "MCP Server for IETF vCon with Supabase - Spec Compliant",
  "type": "module",
  "main": "dist/index.js",
  "scripts": {
    "build": "tsc",
    "dev": "tsx watch src/index.ts",
    "test": "vitest",
    "test:compliance": "vitest run tests/vcon-compliance.test.ts",
    "lint": "eslint src/**/*.ts",
    "validate-spec": "node scripts/validate-spec-compliance.js"
  },
  "dependencies": {
    "@modelcontextprotocol/sdk": "^0.5.0",
    "@supabase/supabase-js": "^2.39.0",
    "zod": "^3.22.4"
  },
  "devDependencies": {
    "@types/node": "^20.10.0",
    "typescript": "^5.3.0",
    "tsx": "^4.7.0",
    "vitest": "^1.0.0",
    "eslint": "^8.56.0",
    "@typescript-eslint/eslint-plugin": "^6.15.0",
    "@typescript-eslint/parser": "^6.15.0"
  }
}
```

### tsconfig.json

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

---

## Critical Reminders for Claude Code

1. **ALWAYS use `schema` not `schema_version`** in Analysis objects
2. **ALWAYS make `vendor` required** in Analysis objects  
3. **ALWAYS use TEXT/string for `body`** fields, never JSONB/object
4. **NEVER set default values** for `encoding` fields
5. **ALWAYS validate dialog.type** against the 4 valid values
6. **ALWAYS include `uuid` field** in Party objects
7. **ALWAYS add `dialog_indices`** array to Analysis for dialog references
8. **ALWAYS include new fields**: `session_id`, `application`, `message_id`, `did`, `extensions`, `must_support`

## Spec References

- Main Spec: draft-ietf-vcon-vcon-core-00.txt
- Corrections Document: IMPLEMENTATION_CORRECTIONS.md
- Database Schema: CORRECTED_SCHEMA.md

## Success Criteria

- [ ] All TypeScript types match IETF spec exactly
- [ ] Database schema uses corrected field names
- [ ] All tool definitions use corrected schemas
- [ ] Validation enforces spec requirements
- [ ] Tests verify spec compliance
- [ ] Generated vCons are interoperable with other implementations
- [ ] No `schema_version` references anywhere in code
- [ ] All analysis objects have required `vendor` field
- [ ] Analysis body supports non-JSON formats

---

*This document is the authoritative reference for implementation. Any conflicts with other documentation should defer to this document and the IETF specification.*
