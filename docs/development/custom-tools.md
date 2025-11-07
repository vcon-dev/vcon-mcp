# Custom Tools Development

Learn how to create custom MCP tools to extend the vCon MCP Server functionality.

## Table of Contents

- [Overview](#overview)
- [Tool Structure](#tool-structure)
- [Creating a Tool](#creating-a-tool)
- [Tool Schemas](#tool-schemas)
- [Implementing Handlers](#implementing-handlers)
- [Validation](#validation)
- [Testing Tools](#testing-tools)
- [Best Practices](#best-practices)
- [Examples](#examples)

---

## Overview

Custom tools allow you to add new capabilities to the MCP server that clients (like Claude) can invoke. Tools are functions that:

1. Accept structured input (JSON schema)
2. Perform operations (database queries, external API calls, etc.)
3. Return structured output
4. Handle errors gracefully

### Use Cases for Custom Tools

- **Analytics** - Generate reports and statistics
- **Integration** - Connect to external systems (CRM, support tickets)
- **Automation** - Batch operations, scheduled tasks
- **Custom Search** - Specialized search algorithms
- **Data Transformation** - Export, import, format conversion
- **Compliance** - Privacy audits, data retention policies

---

## Tool Structure

A tool consists of three parts:

### 1. Tool Definition

Describes the tool to MCP clients:

```typescript
{
  name: string;           // Unique identifier
  description: string;    // What the tool does
  inputSchema: {          // JSON Schema for inputs
    type: 'object';
    properties: {...};
    required: string[];
  };
}
```

### 2. Input Validation

Uses Zod schemas for runtime validation:

```typescript
const InputSchema = z.object({
  param1: z.string(),
  param2: z.number().optional()
});

type Input = z.infer<typeof InputSchema>;
```

### 3. Tool Handler

The function that implements the tool:

```typescript
async function handleTool(input: Input): Promise<ToolResponse> {
  // Implementation
}
```

---

## Creating a Tool

### Step 1: Define Your Tool

Create a file in `src/tools/`:

```typescript
// src/tools/analytics-tools.ts
import { z } from 'zod';

// Define input schema
export const VConStatisticsInputSchema = z.object({
  start_date: z.string().optional(),
  end_date: z.string().optional(),
  group_by: z.enum(['day', 'week', 'month']).optional().default('day')
});

export type VConStatisticsInput = z.infer<typeof VConStatisticsInputSchema>;

// Define tool
export const vconStatisticsTool = {
  name: 'get_vcon_statistics',
  description: 'Get statistics about vCons over a date range. Returns counts, averages, and trends.',
  inputSchema: {
    type: 'object' as const,
    properties: {
      start_date: {
        type: 'string',
        description: 'Start date (ISO 8601 format). Defaults to 30 days ago.',
        format: 'date-time'
      },
      end_date: {
        type: 'string',
        description: 'End date (ISO 8601 format). Defaults to now.',
        format: 'date-time'
      },
      group_by: {
        type: 'string',
        enum: ['day', 'week', 'month'],
        description: 'Group results by time period',
        default: 'day'
      }
    }
  }
};
```

### Step 2: Implement the Handler

```typescript
// src/tools/analytics-tools.ts (continued)
import { getSupabaseClient } from '../db/client.js';

export async function handleGetVConStatistics(
  input: VConStatisticsInput
): Promise<ToolResponse> {
  try {
    const supabase = getSupabaseClient();
    
    // Set default dates
    const endDate = input.end_date || new Date().toISOString();
    const startDate = input.start_date || 
      new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    
    // Query database
    const { data, error } = await supabase
      .rpc('get_vcon_statistics', {
        start_date: startDate,
        end_date: endDate,
        group_by: input.group_by
      });
    
    if (error) throw error;
    
    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          success: true,
          statistics: data,
          period: {
            start: startDate,
            end: endDate,
            group_by: input.group_by
          }
        }, null, 2)
      }]
    };
    
  } catch (error) {
    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error'
        })
      }],
      isError: true
    };
  }
}
```

### Step 3: Register the Tool

```typescript
// src/index.ts

import {
  vconStatisticsTool,
  handleGetVConStatistics
} from './tools/analytics-tools.js';

// Register tool in list
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      // ... existing tools
      vconStatisticsTool
    ]
  };
});

// Handle tool calls
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  
  switch (name) {
    case 'get_vcon_statistics':
      return handleGetVConStatistics(args as VConStatisticsInput);
    
    // ... other tool handlers
    
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
});
```

---

## Tool Schemas

### Input Schema Design

**Good Input Schemas:**

```typescript
// ✅ Clear, descriptive, validated
export const SearchVConsInputSchema = z.object({
  query: z.string().min(1).describe('Search query (required)'),
  limit: z.number().int().min(1).max(1000).default(50)
    .describe('Maximum number of results'),
  threshold: z.number().min(0).max(1).default(0.7)
    .describe('Minimum similarity score (0-1)'),
  tags: z.record(z.string()).optional()
    .describe('Filter by tags (key-value pairs)')
});

// ❌ Too loose, no validation
export const SearchInputSchema = z.object({
  query: z.string(),
  options: z.any()  // Don't use 'any'
});
```

### Output Format

Return consistent responses:

```typescript
interface ToolResponse {
  content: Array<{
    type: 'text' | 'image' | 'resource';
    text?: string;
    data?: string;
    uri?: string;
  }>;
  isError?: boolean;
}

// ✅ Good - Structured response
return {
  content: [{
    type: 'text',
    text: JSON.stringify({
      success: true,
      count: results.length,
      results: results
    }, null, 2)
  }]
};

// ✅ Good - Error response
return {
  content: [{
    type: 'text',
    text: JSON.stringify({
      success: false,
      error: 'Invalid input',
      details: validationErrors
    })
  }],
  isError: true
};
```

---

## Implementing Handlers

### Async Operations

Always use async/await:

```typescript
export async function handleMyTool(input: MyInput): Promise<ToolResponse> {
  try {
    // Validate input
    const validated = MyInputSchema.parse(input);
    
    // Perform async operations
    const data = await fetchData(validated);
    const processed = await processData(data);
    const stored = await storeResults(processed);
    
    return {
      content: [{
        type: 'text',
        text: JSON.stringify({ success: true, result: stored })
      }]
    };
  } catch (error) {
    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error'
        })
      }],
      isError: true
    };
  }
}
```

### Database Access

Use the queries layer:

```typescript
import { VConQueries } from '../db/queries.js';
import { getSupabaseClient } from '../db/client.js';

export async function handleMyTool(input: MyInput): Promise<ToolResponse> {
  const supabase = getSupabaseClient();
  const queries = new VConQueries(supabase);
  
  // Use queries for standard operations
  const vcons = await queries.searchVCons(input.criteria);
  
  // Or use supabase client directly for custom queries
  const { data, error } = await supabase
    .from('vcons')
    .select('uuid, subject')
    .gte('created_at', input.start_date);
  
  if (error) throw error;
  
  return {
    content: [{
      type: 'text',
      text: JSON.stringify({ success: true, results: data })
    }]
  };
}
```

### External API Calls

Handle timeouts and retries:

```typescript
async function callExternalAPI(url: string, data: any): Promise<any> {
  const maxRetries = 3;
  const timeout = 5000;
  
  for (let i = 0; i < maxRetries; i++) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeout);
      
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
        signal: controller.signal
      });
      
      clearTimeout(timeoutId);
      
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      
      return await response.json();
      
    } catch (error) {
      if (i === maxRetries - 1) throw error;
      await new Promise(resolve => setTimeout(resolve, 1000 * (i + 1)));
    }
  }
}
```

---

## Validation

### Input Validation

Always validate inputs with Zod:

```typescript
export async function handleMyTool(input: unknown): Promise<ToolResponse> {
  try {
    // Validate input
    const validated = MyInputSchema.parse(input);
    
    // Now TypeScript knows validated is MyInput type
    const result = await processInput(validated);
    
    return {
      content: [{
        type: 'text',
        text: JSON.stringify({ success: true, result })
      }]
    };
    
  } catch (error) {
    if (error instanceof z.ZodError) {
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: false,
            error: 'Invalid input',
            details: error.errors
          })
        }],
        isError: true
      };
    }
    
    throw error;
  }
}
```

### Business Logic Validation

Check business rules:

```typescript
async function handleDeleteBatch(input: DeleteBatchInput): Promise<ToolResponse> {
  // Validate input schema
  const validated = DeleteBatchInputSchema.parse(input);
  
  // Business rule: Can't delete more than 100 at once
  if (validated.uuids.length > 100) {
    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          success: false,
          error: 'Cannot delete more than 100 vCons at once'
        })
      }],
      isError: true
    };
  }
  
  // Business rule: Require confirmation for bulk delete
  if (!validated.confirm) {
    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          success: false,
          error: 'Must set confirm=true for bulk deletion'
        })
      }],
      isError: true
    };
  }
  
  // Proceed with deletion
  // ...
}
```

---

## Testing Tools

### Unit Tests

Test your tool handler in isolation:

```typescript
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { handleGetVConStatistics } from '../src/tools/analytics-tools';

describe('get_vcon_statistics tool', () => {
  let testVConUuids: string[];
  
  beforeAll(async () => {
    // Create test data
    testVConUuids = await createTestVCons(10);
  });
  
  afterAll(async () => {
    // Cleanup
    await deleteTestVCons(testVConUuids);
  });
  
  it('should return statistics for date range', async () => {
    const input = {
      start_date: '2025-01-01T00:00:00Z',
      end_date: '2025-01-31T23:59:59Z',
      group_by: 'day' as const
    };
    
    const response = await handleGetVConStatistics(input);
    
    expect(response.isError).toBeFalsy();
    const result = JSON.parse(response.content[0].text!);
    expect(result.success).toBe(true);
    expect(result.statistics).toBeDefined();
    expect(Array.isArray(result.statistics)).toBe(true);
  });
  
  it('should handle invalid date range', async () => {
    const input = {
      start_date: 'invalid-date',
      end_date: '2025-01-31T23:59:59Z'
    };
    
    const response = await handleGetVConStatistics(input as any);
    
    expect(response.isError).toBe(true);
    const result = JSON.parse(response.content[0].text!);
    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
  });
  
  it('should use default dates when not provided', async () => {
    const input = { group_by: 'week' as const };
    
    const response = await handleGetVConStatistics(input);
    
    expect(response.isError).toBeFalsy();
    const result = JSON.parse(response.content[0].text!);
    expect(result.period.start).toBeDefined();
    expect(result.period.end).toBeDefined();
  });
});
```

### Integration Tests

Test the full tool lifecycle:

```typescript
import { Server } from '@modelcontextprotocol/sdk/server/index.js';

describe('Tool Integration', () => {
  let server: Server;
  
  beforeAll(async () => {
    // Initialize server with test config
    server = createTestServer();
  });
  
  it('should list custom tool', async () => {
    const response = await server.request({
      method: 'tools/list'
    });
    
    const tools = response.tools;
    expect(tools).toContainEqual(
      expect.objectContaining({
        name: 'get_vcon_statistics'
      })
    );
  });
  
  it('should execute custom tool', async () => {
    const response = await server.request({
      method: 'tools/call',
      params: {
        name: 'get_vcon_statistics',
        arguments: {
          group_by: 'week'
        }
      }
    });
    
    expect(response.content).toBeDefined();
    const result = JSON.parse(response.content[0].text);
    expect(result.success).toBe(true);
  });
});
```

---

## Best Practices

### 1. Clear Names and Descriptions

```typescript
// ✅ Good
{
  name: 'export_vcons_to_csv',
  description: 'Export vCons to CSV format. Includes all fields and supports filtering by date range and tags.'
}

// ❌ Bad
{
  name: 'export',
  description: 'Exports stuff'
}
```

### 2. Comprehensive Input Validation

```typescript
// ✅ Good - Detailed validation
const InputSchema = z.object({
  format: z.enum(['csv', 'json', 'xml']),
  include_dialog: z.boolean().default(true),
  include_analysis: z.boolean().default(true),
  max_size_mb: z.number().min(1).max(100).default(10),
  filters: z.object({
    start_date: z.string().datetime().optional(),
    end_date: z.string().datetime().optional(),
    tags: z.record(z.string()).optional()
  }).optional()
});

// ❌ Bad - Minimal validation
const InputSchema = z.object({
  format: z.string(),
  options: z.any()
});
```

### 3. Structured Error Messages

```typescript
// ✅ Good - Detailed error
return {
  content: [{
    type: 'text',
    text: JSON.stringify({
      success: false,
      error: 'Export failed',
      reason: 'File size would exceed limit',
      details: {
        estimated_size_mb: 150,
        max_size_mb: 100,
        suggestion: 'Add more filters to reduce result set'
      }
    })
  }],
  isError: true
};

// ❌ Bad - Generic error
return {
  content: [{
    type: 'text',
    text: 'Error'
  }],
  isError: true
};
```

### 5. Validation Strategy

The vCon MCP Server uses a two-layer validation approach:

**Layer 1: JSON Schema Validation** (at the MCP protocol level)
- All tool input schemas must be valid JSON Schema
- Use `oneOf` or `anyOf` for union types (not array syntax)
- Include `default` values in schemas when defaults are mentioned in descriptions
- This provides client-side validation and better error messages

**Layer 2: Runtime Validation** (in tool handlers)
- Use helper functions from `src/utils/validation.ts` for common validations
- Validate UUIDs using `validateUUID()` helper
- Use Zod schemas for complex object validation (where applicable)
- Always validate required fields even if JSON Schema validates them

**Example: UUID Validation**

```typescript
import { validateUUID } from '../utils/validation.js';
import { McpError, ErrorCode } from '@modelcontextprotocol/sdk/types.js';

case 'my_tool': {
  const uuid = args?.uuid as string;
  
  // Validate UUID format
  const uuidValidation = validateUUID(uuid, 'uuid');
  if (!uuidValidation.valid) {
    throw new McpError(ErrorCode.InvalidParams, uuidValidation.errors.join(', '));
  }
  
  // Continue with tool logic...
}
```

**Example: JSON Schema with Defaults**

```typescript
// ✅ Good - Default value in schema
{
  type: 'object',
  properties: {
    limit: {
      type: 'number',
      description: 'Maximum number of results (default: 50)',
      minimum: 1,
      maximum: 1000,
      default: 50  // Include default in schema
    }
  }
}

// ❌ Bad - Default mentioned but not in schema
{
  type: 'object',
  properties: {
    limit: {
      type: 'number',
      description: 'Maximum number of results (default: 50)',  // Mentioned but not in schema
      minimum: 1,
      maximum: 1000
    }
  }
}
```

**Example: Union Types in JSON Schema**

```typescript
// ✅ Good - Use oneOf for union types
{
  type: 'object',
  properties: {
    value: {
      oneOf: [
        { type: 'string' },
        { type: 'number' },
        { type: 'boolean' }
      ]
    }
  }
}

// ❌ Bad - Invalid array syntax
{
  type: 'object',
  properties: {
    value: {
      type: ['string', 'number', 'boolean']  // Invalid JSON Schema syntax
    }
  }
}
```

### 6. Response Format Standardization

For long-running operations:

```typescript
async function handleLongRunningTool(input: MyInput): Promise<ToolResponse> {
  const totalItems = 1000;
  const results = [];
  
  for (let i = 0; i < totalItems; i += 100) {
    const batch = await processBatch(i, 100);
    results.push(...batch);
    
    // Log progress (to stderr, not stdout)
    console.error(`Progress: ${i + 100}/${totalItems}`);
  }
  
  return {
    content: [{
      type: 'text',
      text: JSON.stringify({
        success: true,
        total_processed: results.length,
        results: results
      })
    }]
  };
}
```

### 6. Response Format Standardization

All tools should return consistent response formats:

**Standard Success Response:**
```typescript
{
  content: [{
    type: 'text',
    text: JSON.stringify({
      success: true,
      // Tool-specific data
      uuid: '...',
      message: 'Operation completed successfully'
    }, null, 2)
  }]
}
```

**Standard Error Response:**
- Errors are thrown as `McpError` with appropriate `ErrorCode`
- The MCP framework handles error formatting
- Include actionable error messages with context

**Response Fields:**
- `success: boolean` - Always include for clarity
- `message: string` - Human-readable description
- Tool-specific data fields
- `count`, `total_count` - For list/search operations
- `uuid` - For operations that create or modify vCons

**Example: Consistent Response Format**

```typescript
// ✅ Good - Consistent format
result = {
  content: [{
    type: 'text',
    text: JSON.stringify({
      success: true,
      uuid: createResult.uuid,
      message: `Created vCon with UUID: ${createResult.uuid}`,
      vcon: vcon
    }, null, 2)
  }]
};

// ❌ Bad - Inconsistent format
result = {
  content: [{
    type: 'text',
    text: JSON.stringify(createResult)  // Missing success field, inconsistent structure
  }]
};
```

### 8. Error Message Consistency

Error messages should be clear, actionable, and consistent:

**Guidelines:**
- Use `McpError` with appropriate `ErrorCode` (InvalidParams, InternalError, etc.)
- Include the parameter name in error messages
- Provide examples or expected formats when relevant
- Use consistent error message format across all tools

**Example: Consistent Error Messages**

```typescript
// ✅ Good - Clear, actionable error
const uuidValidation = validateUUID(uuid, 'uuid');
if (!uuidValidation.valid) {
  throw new McpError(
    ErrorCode.InvalidParams,
    uuidValidation.errors.join(', ')
  );
}

// ✅ Good - Detailed error with context
if (!analysisData || !analysisData.vendor) {
  throw new McpError(
    ErrorCode.InvalidParams,
    'Analysis vendor is REQUIRED per IETF spec Section 4.5.5'
  );
}

// ❌ Bad - Generic error
if (!uuid) {
  throw new McpError(ErrorCode.InvalidParams, 'Invalid');
}
```

**Error Code Guidelines:**
- `InvalidParams` - Client provided invalid input (validation errors, missing required fields)
- `InternalError` - Server-side errors (database failures, unexpected exceptions)
- `MethodNotFound` - Tool name doesn't exist
- `InvalidRequest` - Malformed request structure

### 9. Resource Cleanup

```typescript
async function handleToolWithResources(input: MyInput): Promise<ToolResponse> {
  let tempFile: string | null = null;
  
  try {
    // Create temporary resource
    tempFile = await createTempFile();
    
    // Do work
    const result = await processFile(tempFile);
    
    return {
      content: [{
        type: 'text',
        text: JSON.stringify({ success: true, result })
      }]
    };
    
  } finally {
    // Always cleanup
    if (tempFile) {
      await deleteTempFile(tempFile);
    }
  }
}
```

---

## Summary: MCP Tools Best Practices Review

This document reflects the best practices review and improvements made to ensure all MCP tools follow consistent patterns:

### Key Improvements Made

1. **JSON Schema Compliance**
   - Fixed invalid union type syntax (replaced array syntax with `oneOf`)
   - Added default values to all schemas where defaults were mentioned in descriptions
   - Ensured all schemas are valid JSON Schema

2. **Validation Consistency**
   - Created `validateUUID()` helper function for consistent UUID validation
   - Updated all tool handlers to use the validation helper
   - Documented two-layer validation approach (JSON Schema + Runtime)

3. **Response Format Standardization**
   - Documented standard response format with `success` field
   - Ensured consistent error handling using `McpError`
   - Standardized response structure across all tools

4. **Error Message Consistency**
   - Standardized error message format
   - Added parameter names to error messages
   - Documented error code usage guidelines

### Validation Helper Functions

Available in `src/utils/validation.ts`:
- `validateUUID(uuid, paramName)` - Validates UUID format and returns ValidationResult
- `isValidUUID(uuid)` - Simple boolean check for UUID format
- `validateVCon(vcon)` - Validates complete vCon object
- `validateAnalysis(analysis)` - Validates analysis object

### Tool Schema Checklist

When creating new tools, ensure:
- [ ] JSON Schema is valid (use `oneOf` for union types)
- [ ] Default values are included in schema when mentioned in descriptions
- [ ] Required fields are marked in `required` array
- [ ] UUID parameters use pattern validation
- [ ] Descriptions are clear and actionable
- [ ] Handler uses `validateUUID()` for UUID parameters
- [ ] Response includes `success` field
- [ ] Errors use `McpError` with appropriate `ErrorCode`

---

### Example 1: Batch Export Tool

```typescript
// src/tools/export-tools.ts
import { z } from 'zod';
import { VConQueries } from '../db/queries.js';

export const exportVCons Tool = {
  name: 'export_vcons_batch',
  description: 'Export multiple vCons to a file format (JSON, CSV, or XML)',
  inputSchema: {
    type: 'object' as const,
    properties: {
      uuids: {
        type: 'array',
        items: { type: 'string', format: 'uuid' },
        description: 'Array of vCon UUIDs to export'
      },
      format: {
        type: 'string',
        enum: ['json', 'csv', 'xml'],
        description: 'Output format'
      },
      include_components: {
        type: 'boolean',
        description: 'Include dialog, analysis, attachments',
        default: true
      }
    },
    required: ['uuids', 'format']
  }
};

export async function handleExportVConsBatch(
  input: ExportBatchInput
): Promise<ToolResponse> {
  try {
    const validated = ExportBatchInputSchema.parse(input);
    
    // Validate batch size
    if (validated.uuids.length > 1000) {
      throw new Error('Cannot export more than 1000 vCons at once');
    }
    
    // Fetch vCons
    const queries = new VConQueries(getSupabaseClient());
    const vcons = await Promise.all(
      validated.uuids.map(uuid => queries.getVCon(uuid))
    );
    
    // Format output
    let output: string;
    switch (validated.format) {
      case 'json':
        output = JSON.stringify(vcons, null, 2);
        break;
      case 'csv':
        output = convertToCSV(vcons);
        break;
      case 'xml':
        output = convertToXML(vcons);
        break;
    }
    
    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          success: true,
          count: vcons.length,
          format: validated.format,
          data: output
        })
      }]
    };
    
  } catch (error) {
    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          success: false,
          error: error instanceof Error ? error.message : 'Export failed'
        })
      }],
      isError: true
    };
  }
}
```

### Example 2: Analytics Tool

```typescript
// src/tools/analytics-tools.ts
export const trendsAnalysisTool = {
  name: 'analyze_conversation_trends',
  description: 'Analyze trends in conversations over time. Returns insights about volume, sentiment, topics.',
  inputSchema: {
    type: 'object' as const,
    properties: {
      period: {
        type: 'string',
        enum: ['7d', '30d', '90d', '1y'],
        description: 'Time period to analyze',
        default: '30d'
      },
      metrics: {
        type: 'array',
        items: {
          type: 'string',
          enum: ['volume', 'sentiment', 'duration', 'parties']
        },
        description: 'Metrics to include in analysis'
      },
      group_by: {
        type: 'string',
        enum: ['day', 'week', 'month'],
        description: 'Time grouping',
        default: 'day'
      }
    }
  }
};

export async function handleAnalyzeTrends(
  input: TrendsInput
): Promise<ToolResponse> {
  const validated = TrendsInputSchema.parse(input);
  
  const trends = await calculateTrends(validated);
  const insights = await generateInsights(trends);
  
  return {
    content: [{
      type: 'text',
      text: JSON.stringify({
        success: true,
        period: validated.period,
        trends: trends,
        insights: insights,
        recommendations: generateRecommendations(insights)
      }, null, 2)
    }]
  };
}
```

---

## Publishing Custom Tools

### As Plugin

Package your tools as a plugin:

```typescript
// my-custom-tools-plugin/index.ts
import { VConPlugin } from '@vcon/mcp-server/hooks';
import { myCustomTool, handleMyCustomTool } from './tools.js';

export default class CustomToolsPlugin implements VConPlugin {
  name = 'custom-tools';
  version = '1.0.0';
  
  registerTools() {
    return [myCustomTool];
  }
  
  async initialize(config: any) {
    // Register handler
    config.server.setRequestHandler(CallToolRequestSchema, async (req) => {
      if (req.params.name === 'my_custom_tool') {
        return handleMyCustomTool(req.params.arguments);
      }
    });
  }
}
```

### Documentation

Document your tools:

```markdown
# My Custom Tool

## Description
Does X, Y, and Z.

## Input Parameters
- `param1` (string, required): Description
- `param2` (number, optional): Description

## Output
Returns JSON with...

## Examples
```typescript
// Example usage
const result = await callTool('my_custom_tool', {
  param1: 'value',
  param2: 42
});
```

## Error Handling
- `INVALID_INPUT` - When...
- `NOT_FOUND` - When...
```

---

## Next Steps

- See [Plugin Development](./plugins.md) for packaging tools as plugins
- See [Testing Guide](./testing.md) for comprehensive testing
- See [API Tools Reference](../api/tools.md) for examples of built-in tools
- See [Contributing Guide](./contributing.md) for submitting your tools

---

Need help? Ask in GitHub Discussions or check existing tools in `src/tools/` for reference implementations.

