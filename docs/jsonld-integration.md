# JSON-LD Integration & Integrity Guide

This guide details the `jsonld-ex` integration in the vCon MCP Server, which adds semantic web capabilities, AI metadata enrichment, and cryptographic integrity to vCons.

## Overview

The integration provides three key features:
1.  **JSON-LD Context**: Maps vCon terms to standard URIs.
2.  **Enrichment**: Adds `@confidence` scores and `@source` provenance to Analysis objects.
3.  **Integrity**: Provides tamper-evident signing using SHA-256 hashing.

## 1. JSON-LD Context

The vCon server now supports converting standard vCons to JSON-LD format. This allows vCons to be linked with other semantic data.

### Usage

```typescript
import { toJsonLd } from '../src/jsonld/context.js';
import { VCon } from '../src/types/vcon.js';

const vcon: VCon = { ... }; // Your standard vCon
const jsonLdVcon = toJsonLd(vcon);

console.log(jsonLdVcon['@context']); 
// Outputs: ["https://validator.vcon.dev/vcon.jsonld", ...]
```

## 2. Analysis Enrichment

AI extensions allow you to attach metadata to `analysis` blocks, such as confidence scores and model sources.

### `@confidence`
A formatted float (0.0 - 1.0) indicating the certainty of the analysis.

### `@source`
A URI indicating the origin of the analysis (e.g., specific model endpoint).

### Example

```typescript
import { enrichAnalysis } from '../src/jsonld/enrichment.js';

const analysis = {
  type: "transcript",
  vendor: "openai",
  body: "Hello world"
};

// Add confidence (0.98) and source
const enriched = enrichAnalysis(
  analysis, 
  0.98, 
  "https://api.openai.com/v1/chat/completions"
);

// Result:
// {
//   ...analysis,
//   "@confidence": 0.98,
//   "@source": "https://api.openai.com/v1/chat/completions"
// }
```

## 3. Integrity & Signing

Ensure vCons have not been tampered with by adding a cryptographic signature. The server uses a deterministic SHA-256 hash of the vCon content (excluding the `@integrity` field itself).

### Signing a vCon

```typescript
import { signVCon } from '../src/jsonld/integrity.js';

const vcon = { ... };
const signedVCon = signVCon(vcon);

console.log(signedVCon['@integrity']);
// Outputs: "sha256-a1b2c3d4..."
```

### Verifying Integrity

Verification recalculates the hash and compares it to the `@integrity` field.

```typescript
import { verifyIntegrity } from '../src/jsonld/integrity.js';

const isValid = verifyIntegrity(signedVCon);

if (isValid) {
  console.log("vCon is authentic and untampered.");
} else {
  console.error("Integrity check failed! Data may be corrupted or tampered.");
}
```

### How it Verification Works
1.  Removes the existing `@integrity` field.
2.  Serializes the JSON using `fast-json-stable-stringify` (deterministic ordering).
3.  Computes SHA-256 hash.
4.  Compares computed hash with the provided hash.

## Best Practices

*   **Sign Last**: Always sign the vCon *after* all modifications (including enrichment) are complete.
*   **Enrich First**: Add confidence scores and sources before signing so they are protected by the integrity hash.
*   **Transport**: JSON-LD vCons are valid JSON and can be stored/transmitted exactly like standard vCons.
