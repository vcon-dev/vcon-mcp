# Lovable Instructions: Daily Engagement Diary App

## Overview

Build an application that creates a daily diary of engaged customer interactions for a tenant. The app finds all vCons (virtual conversations) tagged with `engagement:true` for a specific day, extracts transcriptions from those conversations, and displays them as a bulleted activity log.

## Supabase Database Connection

Connect to the existing Supabase database. The database URL and keys will be provided as environment variables:

```
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_ANON_KEY=your-anon-key
```

## Database Schema Reference

### Core Tables

#### `vcons` - Main conversation container
```sql
id              UUID PRIMARY KEY    -- Internal database ID
uuid            UUID UNIQUE         -- vCon document UUID (use this for references)
tenant_id       TEXT                -- Tenant identifier for multi-tenancy
subject         TEXT                -- Conversation subject/title
created_at      TIMESTAMPTZ         -- When the vCon was created
updated_at      TIMESTAMPTZ         -- Last update timestamp
```

#### `parties` - Participants in conversations
```sql
id              UUID PRIMARY KEY
vcon_id         UUID                -- References vcons(id)
tenant_id       TEXT                -- Tenant identifier
party_index     INTEGER             -- Position in parties array (0-based)
tel             TEXT                -- Phone number
mailto          TEXT                -- Email address
name            TEXT                -- Display name
```

#### `dialog` - Conversation content (recordings, transcripts, messages)
```sql
id              UUID PRIMARY KEY
vcon_id         UUID                -- References vcons(id)
tenant_id       TEXT                -- Tenant identifier
dialog_index    INTEGER             -- Position in dialog array
type            TEXT                -- 'recording', 'text', 'transfer', 'incomplete'
start_time      TIMESTAMPTZ         -- When this dialog segment started
duration_seconds REAL               -- Duration in seconds
parties         INTEGER[]           -- Array of party indexes involved
body            TEXT                -- Text content (for transcripts)
encoding        TEXT                -- 'base64url', 'json', 'none', or NULL
```

#### `analysis` - AI/ML analysis results (contains transcriptions)
```sql
id              UUID PRIMARY KEY
vcon_id         UUID                -- References vcons(id)
tenant_id       TEXT                -- Tenant identifier
analysis_index  INTEGER             -- Position in analysis array
type            TEXT                -- Analysis type: 'transcript', 'summary', 'sentiment', etc.
vendor          TEXT NOT NULL       -- Provider name (e.g., 'Deepgram', 'OpenAI')
body            TEXT                -- Analysis content (transcript text, summary, etc.)
encoding        TEXT                -- 'base64url', 'json', 'none', or NULL
dialog_indices  INTEGER[]           -- Which dialog elements this analysis applies to
created_at      TIMESTAMPTZ         -- When analysis was created
```

#### `attachments` - Files and metadata attached to vCons
```sql
id              UUID PRIMARY KEY
vcon_id         UUID                -- References vcons(id)
tenant_id       TEXT                -- Tenant identifier
attachment_index INTEGER            -- Position in attachments array
type            TEXT                -- Attachment type (IMPORTANT: 'tags' for tag storage)
body            TEXT                -- Content (for tags: JSON array of "key:value" strings)
encoding        TEXT                -- 'json' for tags
```

### Tags System

**Tags are stored as attachments with `type = 'tags'`** and `encoding = 'json'`.

The `body` field contains a JSON array of `"key:value"` strings:
```json
["engagement:true", "department:sales", "priority:high", "customer:acme-corp"]
```

### Materialized View for Fast Tag Queries

```sql
vcon_tags_mv
  vcon_id       UUID                -- References vcons(id)
  tags          JSONB               -- Tags as key-value object {"engagement": "true", ...}
```

## Multi-Tenant Support

All queries MUST filter by `tenant_id` to ensure data isolation. The tenant ID is typically passed via session or header.

**Setting tenant context:**
```sql
-- Set tenant context before queries (or filter explicitly)
SELECT set_config('app.current_tenant_id', 'your-tenant-id', false);
```

Or filter explicitly in every query:
```sql
WHERE tenant_id = 'your-tenant-id'
```

## Required Queries

### 1. Find Engaged vCons for a Day

Find all vCons tagged with `engagement:true` for a specific date range:

```sql
-- Using the materialized view (faster)
SELECT
  v.id,
  v.uuid,
  v.subject,
  v.created_at
FROM vcons v
JOIN vcon_tags_mv t ON t.vcon_id = v.id
WHERE
  v.tenant_id = :tenant_id
  AND v.created_at >= :start_of_day      -- e.g., '2025-01-15 00:00:00'
  AND v.created_at < :end_of_day          -- e.g., '2025-01-16 00:00:00'
  AND t.tags->>'engagement' = 'true'
ORDER BY v.created_at ASC;
```

Alternative using raw attachments table:
```sql
SELECT DISTINCT
  v.id,
  v.uuid,
  v.subject,
  v.created_at
FROM vcons v
JOIN attachments a ON a.vcon_id = v.id
WHERE
  v.tenant_id = :tenant_id
  AND v.created_at >= :start_of_day
  AND v.created_at < :end_of_day
  AND a.type = 'tags'
  AND a.encoding = 'json'
  AND a.body::jsonb ? 'engagement:true'
ORDER BY v.created_at ASC;
```

### 2. Get Transcriptions for a vCon

Get all transcript analysis for a specific vCon:

```sql
SELECT
  a.body AS transcript,
  a.vendor,
  a.created_at,
  a.dialog_indices
FROM analysis a
WHERE
  a.vcon_id = :vcon_id
  AND a.tenant_id = :tenant_id
  AND a.type = 'transcript'
  AND (a.encoding = 'none' OR a.encoding IS NULL)  -- Plain text transcripts
ORDER BY a.analysis_index ASC;
```

### 3. Get Party Information for Context

```sql
SELECT
  p.party_index,
  p.name,
  p.tel,
  p.mailto
FROM parties p
WHERE
  p.vcon_id = :vcon_id
  AND p.tenant_id = :tenant_id
ORDER BY p.party_index ASC;
```

### 4. Get Dialog Timing for Timeline

```sql
SELECT
  d.dialog_index,
  d.type,
  d.start_time,
  d.duration_seconds,
  d.parties
FROM dialog d
WHERE
  d.vcon_id = :vcon_id
  AND d.tenant_id = :tenant_id
ORDER BY d.start_time ASC;
```

### 5. Complete Query: Daily Engagement Summary

Combined query to get everything needed for the diary:

```sql
WITH engaged_vcons AS (
  SELECT
    v.id,
    v.uuid,
    v.subject,
    v.created_at
  FROM vcons v
  JOIN vcon_tags_mv t ON t.vcon_id = v.id
  WHERE
    v.tenant_id = :tenant_id
    AND v.created_at >= :start_of_day
    AND v.created_at < :end_of_day
    AND t.tags->>'engagement' = 'true'
)
SELECT
  ev.uuid AS vcon_uuid,
  ev.subject,
  ev.created_at,
  p.name AS customer_name,
  p.tel AS customer_phone,
  p.mailto AS customer_email,
  a.body AS transcript,
  a.vendor AS transcript_vendor,
  d.start_time AS call_start,
  d.duration_seconds AS call_duration
FROM engaged_vcons ev
LEFT JOIN parties p ON p.vcon_id = ev.id AND p.tenant_id = :tenant_id AND p.party_index = 0
LEFT JOIN analysis a ON a.vcon_id = ev.id AND a.tenant_id = :tenant_id AND a.type = 'transcript'
LEFT JOIN dialog d ON d.vcon_id = ev.id AND d.tenant_id = :tenant_id AND d.dialog_index = 0
ORDER BY ev.created_at ASC;
```

## Supabase JavaScript Client Examples

### Setup
```typescript
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_ANON_KEY!
)

const tenantId = 'your-tenant-id'  // From user session/auth
```

### Find Engaged vCons for a Day
```typescript
async function getEngagedVcons(date: Date, tenantId: string) {
  const startOfDay = new Date(date)
  startOfDay.setHours(0, 0, 0, 0)

  const endOfDay = new Date(date)
  endOfDay.setHours(23, 59, 59, 999)

  // First get vCon IDs from tags materialized view
  const { data: taggedVcons, error: tagError } = await supabase
    .from('vcon_tags_mv')
    .select('vcon_id')
    .eq('tags->>engagement', 'true')

  if (tagError) throw tagError

  const vconIds = taggedVcons?.map(t => t.vcon_id) || []

  // Then get vCon details filtered by date and tenant
  const { data: vcons, error: vconError } = await supabase
    .from('vcons')
    .select('id, uuid, subject, created_at')
    .eq('tenant_id', tenantId)
    .in('id', vconIds)
    .gte('created_at', startOfDay.toISOString())
    .lt('created_at', endOfDay.toISOString())
    .order('created_at', { ascending: true })

  if (vconError) throw vconError
  return vcons
}
```

### Get Transcriptions
```typescript
async function getTranscriptions(vconId: string, tenantId: string) {
  const { data, error } = await supabase
    .from('analysis')
    .select('body, vendor, created_at, dialog_indices')
    .eq('vcon_id', vconId)
    .eq('tenant_id', tenantId)
    .eq('type', 'transcript')
    .or('encoding.is.null,encoding.eq.none')
    .order('analysis_index', { ascending: true })

  if (error) throw error
  return data
}
```

### Get Party Details
```typescript
async function getParties(vconId: string, tenantId: string) {
  const { data, error } = await supabase
    .from('parties')
    .select('party_index, name, tel, mailto')
    .eq('vcon_id', vconId)
    .eq('tenant_id', tenantId)
    .order('party_index', { ascending: true })

  if (error) throw error
  return data
}
```

### Complete Daily Diary Function
```typescript
interface DiaryEntry {
  time: string
  customerName: string
  customerContact: string
  subject: string
  transcriptSummary: string
  duration: string
}

async function generateDailyDiary(date: Date, tenantId: string): Promise<DiaryEntry[]> {
  const vcons = await getEngagedVcons(date, tenantId)
  const diary: DiaryEntry[] = []

  for (const vcon of vcons || []) {
    const [transcripts, parties, dialogs] = await Promise.all([
      getTranscriptions(vcon.id, tenantId),
      getParties(vcon.id, tenantId),
      supabase
        .from('dialog')
        .select('start_time, duration_seconds')
        .eq('vcon_id', vcon.id)
        .eq('tenant_id', tenantId)
        .order('dialog_index', { ascending: true })
        .limit(1)
        .single()
    ])

    const customer = parties?.[0]  // First party is typically the customer
    const transcript = transcripts?.[0]?.body || 'No transcript available'
    const dialog = dialogs.data

    diary.push({
      time: new Date(vcon.created_at).toLocaleTimeString(),
      customerName: customer?.name || 'Unknown',
      customerContact: customer?.tel || customer?.mailto || 'No contact info',
      subject: vcon.subject || 'No subject',
      transcriptSummary: transcript.substring(0, 500) + (transcript.length > 500 ? '...' : ''),
      duration: dialog?.duration_seconds
        ? `${Math.floor(dialog.duration_seconds / 60)}m ${Math.floor(dialog.duration_seconds % 60)}s`
        : 'Unknown'
    })
  }

  return diary
}
```

## UI Requirements

### Date Picker
- Allow user to select a date (default to today)
- Show date in header: "Engagement Diary - January 15, 2025"

### Diary Display
Display each engagement as a bulleted list item:

```
January 15, 2025 - Engagement Diary
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

• 9:15 AM - John Smith (+1-555-0123)
  Subject: Product Demo Call
  Duration: 23m 45s
  ─────────────────────────────
  "Hi John, thanks for taking the time to see our demo today.
  I'm excited to show you how our platform can help streamline
  your workflow..."
  [View Full Transcript]

• 10:30 AM - Sarah Johnson (sarah@acme.com)
  Subject: Onboarding Follow-up
  Duration: 15m 12s
  ─────────────────────────────
  "Sarah, great to connect again. I wanted to follow up on the
  onboarding session and see if you had any questions about..."
  [View Full Transcript]

• 2:45 PM - Mike Chen (+1-555-0456)
  Subject: Support Escalation Resolution
  Duration: 8m 30s
  ─────────────────────────────
  "Mike, I understand you've been having issues with the
  integration. Let me walk you through the solution..."
  [View Full Transcript]

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Total Engagements: 3
```

### Features
1. **Date Navigation** - Previous/Next day buttons
2. **Tenant Selection** - Dropdown if user has access to multiple tenants
3. **Expandable Transcripts** - Click to view full transcript
4. **Export** - Download as PDF or Markdown
5. **Search** - Filter diary entries by customer name or keyword
6. **Empty State** - "No engaged customers found for this date"

### Styling
- Clean, professional appearance
- Timestamps in local timezone
- Phone numbers formatted nicely
- Truncate long transcripts with "View Full" option
- Mobile responsive

## Environment Variables

```
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_ANON_KEY=your-anon-key
DEFAULT_TENANT_ID=optional-default-tenant
```

## Error Handling

1. **No vCons found** - Show friendly "No engagements for this date" message
2. **Missing transcripts** - Show "Transcript not available" placeholder
3. **Database errors** - Show toast notification, log to console
4. **Rate limiting** - Implement request throttling

## Performance Considerations

1. Use the `vcon_tags_mv` materialized view for tag queries (much faster)
2. Limit initial transcript preview to 500 characters
3. Lazy-load full transcripts on expand
4. Cache results for same date/tenant
5. Use pagination if more than 50 engagements per day
