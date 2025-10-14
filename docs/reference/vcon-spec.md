# IETF vCon Specification Reference

Complete reference for the IETF vCon (Virtual Conversation) standard.

## Overview

**Specification:** `draft-ietf-vcon-vcon-core-00`  
**Version:** 0.3.0  
**Working Group:** IETF vCon WG  
**Status:** Internet-Draft  
**Full Text:** [../background_docs/draft-ietf-vcon-vcon-core-00.txt](../../background_docs/draft-ietf-vcon-vcon-core-00.txt)

The vCon (Virtual Conversation) is a standard container format for storing conversation data in a structured, interoperable way. It supports voice calls, video meetings, text chats, emails, and other communication forms.

---

## Table of Contents

1. [Core Concepts](#core-concepts)
2. [Main vCon Object](#main-vcon-object)
3. [Party Object](#party-object)
4. [Dialog Object](#dialog-object)
5. [Attachment Object](#attachment-object)
6. [Analysis Object](#analysis-object)
7. [Encoding Options](#encoding-options)
8. [Extensions](#extensions)
9. [Security](#security)

---

## Core Concepts

### What is a vCon?

A vCon is a JSON object that contains:
- **Metadata** - Subject, timestamps, identifiers
- **Parties** - Participants in the conversation
- **Dialog** - The actual conversation content (audio, text, video)
- **Attachments** - Supporting files and metadata (tags, notes)
- **Analysis** - AI/ML analysis results (transcripts, sentiment, summary)

### Key Principles

1. **Self-contained** - All conversation data in one object
2. **Interoperable** - Standard format across systems
3. **Extensible** - Support for custom data via extensions
4. **Secure** - Support for signing (JWS) and encryption (JWE)
5. **Flexible** - Support for any communication medium

### Use Cases

- **Call recording storage** - Phone, video, web calls
- **Chat archival** - Text conversations, emails
- **Compliance** - GDPR, CCPA, HIPAA record keeping
- **Analytics** - Conversation intelligence and insights
- **Training** - Agent training data
- **Legal** - Dispute resolution and evidence

---

## Main vCon Object

**Section 4.1** of the IETF spec defines the top-level vCon structure.

### Required Fields

```typescript
interface VCon {
  // REQUIRED
  vcon: string;           // Version (e.g., "0.3.0")
  uuid: string;           // Unique identifier (RFC 4122)
  created_at: string;     // ISO 8601 timestamp
  parties: Party[];       // At least one party required
}
```

### Optional Fields

```typescript
interface VCon {
  // Optional metadata
  subject?: string;        // Conversation subject/title
  updated_at?: string;     // Last modification timestamp
  
  // Optional content
  dialog?: Dialog[];       // Conversation content
  analysis?: Analysis[];   // AI/ML analysis results
  attachments?: Attachment[]; // Files, notes, metadata
  
  // Optional advanced features
  redacted?: RedactedInfo;    // Redaction information
  appended?: AppendedInfo;    // Append-only chain info
  group?: GroupInfo[];        // Group conversation info
  
  // Extension support (Section 4.1.3, 4.1.4)
  extensions?: string[];      // Extension identifiers
  must_support?: string[];    // Required extensions
}
```

### Field Definitions

#### vcon (string, required)

Version of the vCon specification. Current version is `"0.3.0"`.

```json
{
  "vcon": "0.3.0"
}
```

#### uuid (string, required)

Unique identifier for the vCon. Must be a valid UUID per RFC 4122.

```json
{
  "uuid": "01234567-89ab-cdef-0123-456789abcdef"
}
```

#### created_at (string, required)

When the vCon was created. ISO 8601 format with timezone.

```json
{
  "created_at": "2025-01-15T10:30:00Z"
}
```

#### subject (string, optional)

Human-readable title or subject for the conversation.

```json
{
  "subject": "Customer Support - Billing Inquiry"
}
```

#### extensions (array, optional)

**Section 4.1.3** - List of extension identifiers this vCon uses.

```json
{
  "extensions": ["privacy-v1", "custom-metadata"]
}
```

#### must_support (array, optional)

**Section 4.1.4** - Extensions that MUST be understood to process this vCon.

```json
{
  "must_support": ["required-extension-v1"]
}
```

---

## Party Object

**Section 4.2** - Represents a participant in the conversation.

### Structure

```typescript
interface Party {
  // Contact information
  tel?: string;           // Telephone number (E.164 format)
  stir?: string;          // STIR information
  mailto?: string;        // Email address
  name?: string;          // Display name
  
  // Identity
  sip?: string;           // SIP URI
  did?: string;           // Decentralized Identifier (Section 4.2.6)
  uuid?: string;          // UUID for this party (Section 4.2.12)
  validation?: string;    // Validation method/proof
  
  // Extended information
  jcard?: object;         // vCard in JSON format
  gmlpos?: string;        // Geographic location (GML)
  civicaddress?: object;  // Civic address
  timezone?: string;      // IANA timezone
}
```

### Examples

**Phone call participant:**
```json
{
  "tel": "+12025551234",
  "name": "John Smith"
}
```

**Email participant:**
```json
{
  "mailto": "customer@example.com",
  "name": "Alice Johnson"
}
```

**Full featured party:**
```json
{
  "name": "Bob Williams",
  "tel": "+12025555678",
  "mailto": "bob@company.com",
  "uuid": "123e4567-e89b-12d3-a456-426614174000",
  "timezone": "America/New_York"
}
```

---

## Dialog Object

**Section 4.3** - Represents conversation content.

### Required Fields

```typescript
interface Dialog {
  type: DialogType;  // REQUIRED
}

type DialogType = 'recording' | 'text' | 'transfer' | 'incomplete';
```

### Optional Fields

```typescript
interface Dialog {
  // Timing
  start?: string;      // ISO 8601 start time
  duration?: number;   // Duration in seconds
  
  // Participants
  parties?: number | number[] | (number | number[])[]; // Party indexes
  originator?: number; // Party index of originator
  
  // Content
  mimetype?: string;   // Media type
  filename?: string;   // Filename
  body?: string;       // Inline content
  encoding?: Encoding; // Content encoding
  url?: string;        // External URL
  
  // Metadata
  content_hash?: string | string[]; // Content hash
  disposition?: Disposition;  // Call disposition
  session_id?: string;        // Session identifier (Section 4.3.10)
  application?: string;       // Application name (Section 4.3.13)
  message_id?: string;        // Message ID (Section 4.3.14)
}

type Encoding = 'none' | 'base64url' | 'json';
type Disposition = 'no-answer' | 'congestion' | 'failed' | 'busy' | 
                   'hung-up' | 'voicemail-no-message';
```

### Dialog Types

#### recording

Audio or video recording of the conversation.

```json
{
  "type": "recording",
  "start": "2025-01-15T10:30:00Z",
  "duration": 125.4,
  "parties": [0, 1],
  "originator": 0,
  "mimetype": "audio/wav",
  "filename": "call-recording.wav",
  "url": "https://storage.example.com/recording.wav"
}
```

#### text

Text-based conversation (chat, SMS, email body).

```json
{
  "type": "text",
  "start": "2025-01-15T10:32:15Z",
  "parties": 0,
  "body": "Hello, I need help with my account.",
  "encoding": "none"
}
```

#### transfer

Reference to another vCon (call transfer, forwarding).

```json
{
  "type": "transfer",
  "start": "2025-01-15T10:35:00Z",
  "parties": [0, 2],
  "body": "01234567-89ab-cdef-0123-456789abcdef",
  "encoding": "none"
}
```

#### incomplete

Partial or failed conversation.

```json
{
  "type": "incomplete",
  "start": "2025-01-15T10:30:00Z",
  "disposition": "no-answer",
  "parties": [0, 1]
}
```

---

## Attachment Object

**Section 4.4** - Supporting files and metadata.

### Structure

```typescript
interface Attachment {
  // Timing and context
  type?: string;       // Attachment type (custom)
  start?: string;      // ISO 8601 timestamp
  party?: number;      // Associated party index
  dialog?: number;     // Associated dialog index
  
  // Content
  mimetype?: string;   // Media type
  filename?: string;   // Filename
  body?: string;       // Inline content
  encoding?: Encoding; // Content encoding
  url?: string;        // External URL
  
  // Verification
  content_hash?: string | string[]; // Content hash
}
```

### Common Attachment Types

#### Tags Attachment

Special attachment type for key-value metadata (used by search).

```json
{
  "type": "tags",
  "encoding": "json",
  "body": "[\"department:support\", \"priority:high\", \"status:open\"]"
}
```

#### Document Attachment

Supporting document or file.

```json
{
  "type": "document",
  "start": "2025-01-15T10:30:00Z",
  "mimetype": "application/pdf",
  "filename": "invoice.pdf",
  "url": "https://storage.example.com/invoice.pdf"
}
```

#### Note Attachment

Human-added notes or annotations.

```json
{
  "type": "note",
  "party": 1,
  "start": "2025-01-15T10:35:00Z",
  "body": "Customer was satisfied with resolution",
  "encoding": "none"
}
```

---

## Analysis Object

**Section 4.5** - AI/ML analysis results.

### Required Fields

```typescript
interface Analysis {
  type: string;    // REQUIRED - Analysis type
  vendor: string;  // REQUIRED - Vendor who produced this (Section 4.5.5)
}
```

### Optional Fields

```typescript
interface Analysis {
  // Context
  dialog?: number | number[]; // Associated dialog(s)
  
  // Metadata
  product?: string;   // Specific product/model used
  schema?: string;    // Schema identifier (Section 4.5.6) ⚠️ NOT schema_version
  
  // Content
  mimetype?: string;  // Media type
  filename?: string;  // Filename
  body?: string;      // Analysis result (Section 4.5.7) ⚠️ STRING not object
  encoding?: Encoding; // Content encoding
  url?: string;       // External URL
  
  // Verification
  content_hash?: string | string[]; // Content hash
}
```

### Critical Corrections

⚠️ **Common Mistakes:**

1. Using `schema_version` - WRONG. Use `schema` (Section 4.5.6)
2. Making `vendor` optional - WRONG. It's REQUIRED (Section 4.5.5)
3. Using `object` type for `body` - WRONG. Use `string` (Section 4.5.7)

### Examples

**Transcript analysis:**
```json
{
  "type": "transcript",
  "vendor": "Deepgram",
  "product": "Nova-2",
  "schema": "v1",
  "dialog": 0,
  "body": "Hello, I need help with my account. Sure, I can help...",
  "encoding": "none"
}
```

**Sentiment analysis:**
```json
{
  "type": "sentiment",
  "vendor": "OpenAI",
  "product": "gpt-4",
  "dialog": [0, 1, 2],
  "body": "{\"sentiment\": \"positive\", \"score\": 0.85}",
  "encoding": "json"
}
```

**Summary:**
```json
{
  "type": "summary",
  "vendor": "CustomAI",
  "schema": "summary-v2",
  "body": "Customer inquired about billing. Issue resolved by providing refund.",
  "encoding": "none"
}
```

---

## Encoding Options

**Section 4.3.6, 4.4.7, 4.5.8** - Content encoding types.

### none

Raw text content, no encoding.

```json
{
  "body": "Plain text content",
  "encoding": "none"
}
```

### base64url

Base64 URL-safe encoding (RFC 4648).

```json
{
  "body": "SGVsbG8gV29ybGQh",
  "encoding": "base64url"
}
```

### json

JSON-formatted content.

```json
{
  "body": "{\"key\": \"value\"}",
  "encoding": "json"
}
```

### Important

⚠️ **NO DEFAULT VALUES** - `encoding` field should NOT have a default value in database schema or type definitions. It must be explicitly set.

---

## Extensions

**Section 4.1.3, 4.1.4** - Supporting custom functionality.

### extensions Array

List of extension identifiers used in this vCon.

```json
{
  "extensions": [
    "privacy-redaction-v1",
    "custom-analytics-v2"
  ]
}
```

### must_support Array

Extensions that MUST be understood to process this vCon correctly.

```json
{
  "must_support": [
    "required-extension-v1"
  ]
}
```

**Processing Rules:**
1. If a vCon has `must_support` entries you don't understand, reject it
2. If a vCon has `extensions` you don't understand, you MAY process it
3. Always preserve unrecognized extension data

---

## Security

### Signing (JWS)

vCons can be signed using JSON Web Signature (JWS):

```json
{
  "payload": "base64url(vcon_json)",
  "signatures": [{
    "protected": "base64url(header)",
    "signature": "base64url(signature)"
  }]
}
```

### Encryption (JWE)

vCons can be encrypted using JSON Web Encryption (JWE):

```json
{
  "protected": "base64url(header)",
  "encrypted_key": "base64url(key)",
  "iv": "base64url(iv)",
  "ciphertext": "base64url(encrypted_vcon)",
  "tag": "base64url(tag)"
}
```

### Content Hashing

All content fields (body, url) can have `content_hash` for verification:

```json
{
  "body": "content",
  "content_hash": "sha256:abc123..."
}
```

---

## Complete Example

**Minimal vCon:**
```json
{
  "vcon": "0.3.0",
  "uuid": "01234567-89ab-cdef-0123-456789abcdef",
  "created_at": "2025-01-15T10:30:00Z",
  "parties": [
    {
      "name": "Alice",
      "mailto": "alice@example.com"
    }
  ]
}
```

**Full-featured vCon:**
```json
{
  "vcon": "0.3.0",
  "uuid": "01234567-89ab-cdef-0123-456789abcdef",
  "created_at": "2025-01-15T10:30:00Z",
  "updated_at": "2025-01-15T10:35:00Z",
  "subject": "Customer Support Call - Billing Issue",
  "parties": [
    {
      "tel": "+12025551234",
      "name": "Customer",
      "uuid": "123e4567-e89b-12d3-a456-426614174000"
    },
    {
      "tel": "+12025555678",
      "name": "Agent Sarah",
      "uuid": "234e5678-e89b-12d3-a456-426614174001"
    }
  ],
  "dialog": [
    {
      "type": "recording",
      "start": "2025-01-15T10:30:00Z",
      "duration": 180,
      "parties": [0, 1],
      "originator": 0,
      "mimetype": "audio/wav",
      "url": "https://storage.example.com/call.wav"
    },
    {
      "type": "text",
      "start": "2025-01-15T10:30:05Z",
      "parties": 0,
      "body": "I was charged twice this month",
      "encoding": "none"
    }
  ],
  "analysis": [
    {
      "type": "transcript",
      "vendor": "Deepgram",
      "product": "Nova-2",
      "dialog": 0,
      "body": "Customer: I was charged twice... Agent: I can help...",
      "encoding": "none"
    },
    {
      "type": "summary",
      "vendor": "OpenAI",
      "product": "gpt-4",
      "body": "Customer reported duplicate charge. Refund processed.",
      "encoding": "none"
    }
  ],
  "attachments": [
    {
      "type": "tags",
      "encoding": "json",
      "body": "[\"department:billing\", \"status:resolved\"]"
    }
  ]
}
```

---

## Validation Rules

### Required Validations

1. ✅ `vcon` field must be `"0.3.0"`
2. ✅ `uuid` must be valid UUID format
3. ✅ `created_at` must be ISO 8601 timestamp
4. ✅ `parties` array must have at least one party
5. ✅ Dialog `type` must be one of 4 valid types
6. ✅ Analysis `vendor` must be provided

### Reference Validations

1. ✅ Party indexes in `dialog.parties` must be valid
2. ✅ Dialog indexes in `analysis.dialog` must be valid
3. ✅ Party indexes in `attachment.party` must be valid
4. ✅ Dialog indexes in `attachment.dialog` must be valid

### Format Validations

1. ✅ Timestamps must be ISO 8601 with timezone
2. ✅ UUIDs must be RFC 4122 format
3. ✅ `encoding` must be one of: `none`, `base64url`, `json`
4. ✅ Phone numbers should be E.164 format

---

## Additional Resources

- **Full Specification:** [../background_docs/draft-ietf-vcon-vcon-core-00.txt](../../background_docs/draft-ietf-vcon-vcon-core-00.txt)
- **Privacy Primer:** [../background_docs/draft-ietf-vcon-privacy-primer-00.txt](../../background_docs/draft-ietf-vcon-privacy-primer-00.txt)
- **IETF Working Group:** https://datatracker.ietf.org/wg/vcon/
- **Quick Reference:** [QUICK_REFERENCE.md](./QUICK_REFERENCE.md)
- **Database Schema:** [CORRECTED_SCHEMA.md](./CORRECTED_SCHEMA.md)

---

*This reference is based on draft-ietf-vcon-vcon-core-00 and reflects all corrections identified in [IMPLEMENTATION_CORRECTIONS.md](./IMPLEMENTATION_CORRECTIONS.md).*

