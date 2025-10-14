# Code Style Guide

This guide defines coding standards and best practices for the vCon MCP Server project.

## Table of Contents

- [TypeScript Style](#typescript-style)
- [Naming Conventions](#naming-conventions)
- [File Organization](#file-organization)
- [Comments and Documentation](#comments-and-documentation)
- [Error Handling](#error-handling)
- [Testing Style](#testing-style)
- [Git Practices](#git-practices)

---

## TypeScript Style

### General Principles

1. **Type Safety First** - No `any` types except where absolutely necessary
2. **Explicit Over Implicit** - Be clear about types and intentions
3. **Functional When Possible** - Prefer pure functions
4. **DRY Principle** - Don't Repeat Yourself

### Type Annotations

```typescript
// ✅ Good - Explicit types
function createVCon(vcon: VCon): Promise<{ uuid: string }> {
  return queries.createVCon(vcon);
}

// ❌ Bad - Missing types
function createVCon(vcon) {
  return queries.createVCon(vcon);
}

// ✅ Good - Return type explicit
async function getVCon(uuid: string): Promise<VCon> {
  const result = await queries.getVCon(uuid);
  return result;
}

// ⚠️ Acceptable - Return type can be inferred but explicit is better
async function getVCon(uuid: string) {
  return queries.getVCon(uuid);
}
```

### Interfaces vs Types

Use `interface` for object shapes that may be extended:

```typescript
// ✅ Good - Interface for extensible types
export interface VCon {
  vcon: string;
  uuid: string;
  parties: Party[];
}

export interface ExtendedVCon extends VCon {
  customField: string;
}
```

Use `type` for unions, intersections, and non-object types:

```typescript
// ✅ Good - Type for unions
export type DialogType = 'recording' | 'text' | 'transfer' | 'incomplete';

export type Encoding = 'none' | 'base64url' | 'json';

// ✅ Good - Type for intersection
export type VConWithMetadata = VCon & {
  metadata: Record<string, unknown>;
};
```

### Optional Properties

```typescript
// ✅ Good - Optional with ?
interface Analysis {
  type: string;
  vendor: string;
  product?: string;  // Optional
  schema?: string;   // Optional
}

// ❌ Bad - Using undefined
interface Analysis {
  type: string;
  vendor: string;
  product: string | undefined;
}
```

### Enums vs Union Types

Prefer union types over enums:

```typescript
// ✅ Good - Union type
export type DialogType = 'recording' | 'text' | 'transfer' | 'incomplete';

// ❌ Avoid - Enum (generates runtime code)
enum DialogType {
  Recording = 'recording',
  Text = 'text',
  Transfer = 'transfer',
  Incomplete = 'incomplete'
}
```

### Async/Await

Always use `async/await` over promises:

```typescript
// ✅ Good
async function createVCon(vcon: VCon): Promise<string> {
  const result = await queries.createVCon(vcon);
  return result.uuid;
}

// ❌ Bad
function createVCon(vcon: VCon): Promise<string> {
  return queries.createVCon(vcon).then(result => result.uuid);
}
```

### Arrow Functions

Use arrow functions for callbacks and short functions:

```typescript
// ✅ Good
const uuids = vcons.map(v => v.uuid);

const filtered = vcons.filter(v => v.subject?.includes('support'));

// ✅ Good - Multi-line
const processed = vcons.map(v => {
  const uuid = v.uuid;
  const subject = v.subject || 'Untitled';
  return { uuid, subject };
});
```

Use regular functions for methods and top-level functions:

```typescript
// ✅ Good
export function validateVCon(vcon: VCon): ValidationResult {
  // Implementation
}

// ✅ Good - Class method
class VConQueries {
  async createVCon(vcon: VCon): Promise<{ uuid: string }> {
    // Implementation
  }
}
```

### Destructuring

Use destructuring when accessing multiple properties:

```typescript
// ✅ Good
const { uuid, subject, parties } = vcon;

// ✅ Good - Function parameters
function displayVCon({ uuid, subject }: VCon): string {
  return `${subject} (${uuid})`;
}

// ⚠️ Acceptable for single property
const uuid = vcon.uuid;
```

### Template Literals

Use template literals over string concatenation:

```typescript
// ✅ Good
const message = `vCon ${uuid} created successfully`;

// ❌ Bad
const message = 'vCon ' + uuid + ' created successfully';
```

---

## Naming Conventions

### General Rules

- Use **camelCase** for variables, functions, and properties
- Use **PascalCase** for classes, interfaces, and types
- Use **UPPER_SNAKE_CASE** for constants
- Use **kebab-case** for file names

### Files

```
✅ Good file names:
vcon-queries.ts
search-tools.ts
validation-utils.ts
types/vcon.ts

❌ Bad file names:
VConQueries.ts
searchTools.ts
Validation_Utils.ts
```

### Variables and Functions

```typescript
// ✅ Good
const vconUuid = '123e4567-e89b-12d3-a456-426614174000';
const maxResults = 100;
let isValid = false;

function createVCon(vcon: VCon): Promise<string> {}
function validateVConStructure(vcon: VCon): boolean {}

// ❌ Bad
const VConUUID = '...';  // Use camelCase
const max_results = 100; // Use camelCase
let is_valid = false;    // Use camelCase

function CreateVCon() {}           // Use camelCase
function validate_vcon_structure() {} // Use camelCase
```

### Classes and Interfaces

```typescript
// ✅ Good
class VConQueries {}
interface VCon {}
interface SearchOptions {}
type DialogType = ...;

// ❌ Bad
class vconQueries {}   // Use PascalCase
interface vCon {}      // Use PascalCase
type dialogType = ...; // Use PascalCase
```

### Constants

```typescript
// ✅ Good
const VCON_VERSION = '0.3.0';
const MAX_SEARCH_RESULTS = 1000;
const DEFAULT_THRESHOLD = 0.7;

// ❌ Bad
const vconVersion = '0.3.0'; // Use UPPER_SNAKE_CASE for constants
const MaxSearchResults = 1000;
```

### Boolean Variables

Prefix with `is`, `has`, `should`, or `can`:

```typescript
// ✅ Good
const isValid = true;
const hasParties = vcon.parties.length > 0;
const shouldValidate = options.validate ?? true;
const canDelete = user.permissions.includes('delete');

// ❌ Bad
const valid = true;      // Not clear it's boolean
const parties = true;    // Confusing name
const validate = true;   // Could be a function
```

### Function Names

Use verbs for function names:

```typescript
// ✅ Good
function createVCon() {}
function getVCon() {}
function validateVCon() {}
function calculateScore() {}
function fetchResults() {}

// ❌ Bad
function vcon() {}      // Not descriptive
function vconCreation() {} // Noun, use createVCon
function validation() {}   // Noun, use validate
```

---

## File Organization

### Project Structure

```
src/
├── index.ts              # Entry point
├── types/               # Type definitions
│   ├── vcon.ts
│   ├── mcp.ts
│   └── index.ts
├── db/                  # Database layer
│   ├── client.ts
│   ├── queries.ts
│   └── index.ts
├── tools/               # MCP tools
│   ├── vcon-crud.ts
│   ├── search-tools.ts
│   ├── tag-tools.ts
│   └── index.ts
├── resources/           # MCP resources
│   └── index.ts
├── prompts/             # MCP prompts
│   └── index.ts
├── utils/               # Utilities
│   ├── validation.ts
│   ├── logger.ts
│   └── index.ts
└── hooks/               # Plugin system
    └── index.ts
```

### File Structure

Each file should follow this order:

```typescript
// 1. Imports - External first, then internal
import { createClient } from '@supabase/supabase-js';
import { z } from 'zod';

import { VCon, Analysis } from '../types/vcon.js';
import { validateVCon } from '../utils/validation.js';

// 2. Constants
const MAX_RETRIES = 3;
const RETRY_DELAY = 1000;

// 3. Type definitions
interface QueryOptions {
  limit?: number;
  offset?: number;
}

// 4. Main implementation
export class VConQueries {
  // Class implementation
}

// 5. Helper functions
function retry<T>(fn: () => Promise<T>, retries: number): Promise<T> {
  // Implementation
}

// 6. Exports
export { QueryOptions };
```

### Imports

```typescript
// ✅ Good - Organized by category
// External dependencies
import { createClient } from '@supabase/supabase-js';
import { z } from 'zod';

// Internal types
import type { VCon, Party } from '../types/vcon.js';

// Internal modules
import { getSupabaseClient } from './client.js';
import { validateVCon } from '../utils/validation.js';

// ❌ Bad - Disorganized
import { validateVCon } from '../utils/validation.js';
import { createClient } from '@supabase/supabase-js';
import { VCon } from '../types/vcon.js';
import { z } from 'zod';
```

### Exports

```typescript
// ✅ Good - Named exports
export function createVCon(vcon: VCon): Promise<string> {}
export function getVCon(uuid: string): Promise<VCon> {}

// ✅ Good - Export types
export type { VCon, Party, Dialog };

// ✅ Good - Re-exports in index.ts
export { createVCon, getVCon } from './queries.js';

// ❌ Avoid - Default exports (harder to refactor)
export default function createVCon() {}
```

---

## Comments and Documentation

### JSDoc Comments

All public APIs must have JSDoc comments:

```typescript
/**
 * Create a new vCon in the database.
 * 
 * Validates the vCon structure before insertion and returns the generated UUID.
 * All parties are inserted in a single transaction.
 * 
 * @param vcon - The vCon object to create
 * @returns Promise resolving to the UUID of the created vCon
 * @throws {ValidationError} If vCon fails validation
 * @throws {DatabaseError} If database operation fails
 * 
 * @example
 * ```typescript
 * const vcon: VCon = {
 *   vcon: '0.3.0',
 *   uuid: crypto.randomUUID(),
 *   created_at: new Date().toISOString(),
 *   parties: [{ name: 'Alice' }]
 * };
 * const uuid = await createVCon(vcon);
 * ```
 */
export async function createVCon(vcon: VCon): Promise<string> {
  // Implementation
}
```

### Inline Comments

Use sparingly for complex logic:

```typescript
// ✅ Good - Explains why, not what
function calculateRelevance(scores: number[]): number {
  // Normalize scores to 0-1 range before averaging
  // This prevents very high scores from skewing results
  const normalized = scores.map(s => Math.min(s, 1));
  return normalized.reduce((a, b) => a + b, 0) / normalized.length;
}

// ❌ Bad - States the obvious
function sum(a: number, b: number): number {
  // Add a and b together
  return a + b;
}
```

### TODO Comments

Always include context and assignee:

```typescript
// ✅ Good
// TODO(@username): Implement pagination for large result sets
// See issue #123 for requirements

// ❌ Bad
// TODO: fix this
```

### Section Comments

Use for major sections:

```typescript
// ============================================================================
// CRUD Operations
// ============================================================================

export async function createVCon(vcon: VCon): Promise<string> {}
export async function getVCon(uuid: string): Promise<VCon> {}
export async function updateVCon(uuid: string, updates: any): Promise<void> {}
export async function deleteVCon(uuid: string): Promise<void> {}

// ============================================================================
// Search Operations
// ============================================================================

export async function searchVCons(criteria: SearchCriteria): Promise<VCon[]> {}
```

---

## Error Handling

### Try-Catch Blocks

```typescript
// ✅ Good - Specific error handling
async function createVCon(vcon: VCon): Promise<Result> {
  try {
    const validation = validateVCon(vcon);
    if (!validation.valid) {
      return {
        success: false,
        error: `Validation failed: ${validation.errors.join(', ')}`
      };
    }
    
    const result = await queries.createVCon(vcon);
    return { success: true, uuid: result.uuid };
    
  } catch (error) {
    logger.error('Failed to create vCon', { error, vcon });
    
    if (error instanceof DatabaseError) {
      return { success: false, error: 'Database operation failed' };
    }
    
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    };
  }
}

// ❌ Bad - Swallowing errors
async function createVCon(vcon: VCon) {
  try {
    return await queries.createVCon(vcon);
  } catch (error) {
    console.log('Error');  // Too generic
    return null;           // Loses error information
  }
}
```

### Custom Errors

```typescript
// ✅ Good - Custom error classes
export class ValidationError extends Error {
  constructor(
    message: string,
    public readonly errors: string[]
  ) {
    super(message);
    this.name = 'ValidationError';
  }
}

export class DatabaseError extends Error {
  constructor(
    message: string,
    public readonly cause?: Error
  ) {
    super(message);
    this.name = 'DatabaseError';
  }
}

// Usage
if (!validation.valid) {
  throw new ValidationError(
    'vCon validation failed',
    validation.errors
  );
}
```

---

## Testing Style

### Test Structure

```typescript
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';

describe('VConQueries', () => {
  let queries: VConQueries;
  let testVConUuid: string;
  
  beforeAll(async () => {
    // One-time setup
    queries = new VConQueries(supabase);
  });
  
  afterAll(async () => {
    // One-time cleanup
    if (testVConUuid) {
      await queries.deleteVCon(testVConUuid);
    }
  });
  
  beforeEach(async () => {
    // Per-test setup
  });
  
  describe('createVCon', () => {
    it('should create a valid vCon', async () => {
      const vcon = createTestVCon();
      
      const result = await queries.createVCon(vcon);
      
      expect(result.uuid).toBeDefined();
      expect(result.uuid).toMatch(/^[0-9a-f-]{36}$/);
      testVConUuid = result.uuid;
    });
    
    it('should reject vCon without parties', async () => {
      const invalidVCon = {
        vcon: '0.3.0',
        uuid: crypto.randomUUID(),
        created_at: new Date().toISOString(),
        parties: []  // Empty - invalid
      };
      
      await expect(queries.createVCon(invalidVCon as VCon))
        .rejects
        .toThrow('at least one party');
    });
  });
});
```

### Test Naming

```typescript
// ✅ Good - Descriptive test names
it('should create a vCon with valid parties')
it('should reject vCon with invalid UUID format')
it('should return search results ordered by relevance')
it('should handle empty search results gracefully')

// ❌ Bad - Vague test names
it('works')
it('test1')
it('creates vcon')  // Not specific enough
```

### Assertions

```typescript
// ✅ Good - Specific assertions
expect(result.uuid).toBeDefined();
expect(result.uuid).toMatch(/^[0-9a-f-]{36}$/);
expect(result.parties).toHaveLength(2);
expect(result.parties[0].name).toBe('Alice');

// ❌ Bad - Vague assertions
expect(result).toBeTruthy();
expect(result.uuid).not.toBeNull();
```

---

## Git Practices

### Commit Messages

Follow [Conventional Commits](https://www.conventionalcommits.org/):

```bash
# ✅ Good
git commit -m "feat(search): add hybrid search capability"
git commit -m "fix(validation): correct analysis vendor requirement"
git commit -m "docs(api): update tools reference"
git commit -m "refactor(db): optimize search query performance"

# ❌ Bad
git commit -m "updates"
git commit -m "fix bug"
git commit -m "WIP"
```

### Commit Size

Keep commits focused and atomic:

```bash
# ✅ Good - One logical change
git commit -m "feat(search): add semantic search"

# Later...
git commit -m "docs(search): add semantic search examples"

# ❌ Bad - Multiple unrelated changes
git commit -m "Add search, fix validation, update docs, refactor utils"
```

### Branch Names

```bash
# ✅ Good
feature/semantic-search
fix/validation-error-messages
docs/api-reference-update
refactor/query-optimization

# ❌ Bad
my-feature
update
fix
```

---

## Linting and Formatting

### ESLint Configuration

The project uses ESLint with TypeScript support. Key rules:

```json
{
  "@typescript-eslint/no-explicit-any": "error",
  "@typescript-eslint/explicit-function-return-type": "warn",
  "@typescript-eslint/no-unused-vars": "error",
  "prefer-const": "error",
  "no-console": "warn"
}
```

### Running Linters

```bash
# Check for linting errors
npm run lint

# Fix auto-fixable issues
npm run lint:fix

# Format code with Prettier
npm run format

# Check formatting
npm run format:check
```

### Pre-commit Hooks

We use Husky for git hooks:

```json
{
  "husky": {
    "hooks": {
      "pre-commit": "npm run lint && npm test"
    }
  }
}
```

---

## Review Checklist

Before submitting code for review:

- [ ] Code follows style guidelines
- [ ] All tests pass
- [ ] New code has tests
- [ ] Documentation updated
- [ ] No linting errors
- [ ] TypeScript compiles
- [ ] Commit messages follow convention
- [ ] No `any` types added
- [ ] Error handling is proper
- [ ] Logging is appropriate

---

## Additional Resources

- [TypeScript Handbook](https://www.typescriptlang.org/docs/handbook/intro.html)
- [Google TypeScript Style Guide](https://google.github.io/styleguide/tsguide.html)
- [Conventional Commits](https://www.conventionalcommits.org/)
- [Clean Code JavaScript](https://github.com/ryanmcdermott/clean-code-javascript)

---

Questions about code style? Ask in GitHub Discussions or check existing code for examples.

