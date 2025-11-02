# Large Database Optimization Guide

This guide shows how to use the vCon MCP Server efficiently with large databases to prevent memory exhaustion and improve performance.

## Problem: Memory Exhaustion with Large Databases

When working with large databases (10,000+ vCons), standard queries can return massive amounts of data that exhaust the LLM's memory. For example:

```typescript
// ❌ BAD: This can return 100+ full vCons and exhaust memory
{
  "query": "what happened last week",
  "limit": 100
}
```

## Solution: Smart Response Formatting and Limits

### 1. Check Database Size First

Before running queries, check the database size to understand the scale:

```typescript
// Get database size and recommendations
{
  "include_recommendations": true
}
```

Response:
```json
{
  "success": true,
  "database_size_info": {
    "total_vcons": 50000,
    "total_size_bytes": 2147483648,
    "total_size_pretty": "2.0 GB",
    "size_category": "very_large",
    "recommendations": {
      "max_basic_search_limit": 10,
      "max_content_search_limit": 25,
      "max_semantic_search_limit": 25,
      "max_analytics_limit": 50,
      "recommended_response_format": "metadata",
      "memory_warning": true
    }
  }
}
```

### 2. Get Smart Limits for Your Query

Get recommended limits based on query type and expected result size:

```typescript
// Get smart limits for content search
{
  "query_type": "content",
  "estimated_result_size": "large"
}
```

Response:
```json
{
  "success": true,
  "smart_limits": {
    "query_type": "content",
    "estimated_result_size": "large",
    "recommended_limit": 20,
    "recommended_response_format": "metadata",
    "memory_warning": true,
    "explanation": "Database has 50,000 vCons (very_large size). For content queries with large results, recommend limit of 20 with metadata format. ⚠️ Memory warning: Large dataset detected."
  }
}
```

### 3. Use Appropriate Response Formats

#### Metadata Format (Recommended for Large Databases)
```typescript
// ✅ GOOD: Returns only essential info
{
  "query": "what happened last week",
  "limit": 20,
  "response_format": "metadata"
}
```

Response:
```json
{
  "success": true,
  "count": 20,
  "response_format": "metadata",
  "results": [
    {
      "uuid": "abc-123-def",
      "subject": "Customer Support Call",
      "created_at": "2024-01-15T10:30:00Z",
      "parties_count": 2,
      "dialog_count": 5,
      "analysis_count": 3,
      "attachments_count": 1
    }
    // ... 19 more metadata records
  ]
}
```

#### IDs Only Format (For Further Processing)
```typescript
// ✅ GOOD: Returns only UUIDs for batch processing
{
  "query": "billing issues",
  "limit": 50,
  "response_format": "ids_only"
}
```

Response:
```json
{
  "success": true,
  "count": 50,
  "response_format": "ids_only",
  "results": [
    "abc-123-def",
    "xyz-456-ghi",
    "def-789-jkl"
    // ... 47 more UUIDs
  ]
}
```

#### Snippets Format (For Content Search)
```typescript
// ✅ GOOD: Returns search snippets with highlights
{
  "query": "refund request",
  "limit": 25,
  "response_format": "snippets"
}
```

Response:
```json
{
  "success": true,
  "count": 25,
  "response_format": "snippets",
  "results": [
    {
      "vcon_id": "abc-123-def",
      "content_type": "dialog",
      "content_index": 2,
      "relevance_score": 0.95,
      "snippet": "Customer called about <mark>refund request</mark> for order #12345..."
    }
    // ... 24 more snippets
  ]
}
```

### 4. Batch Processing for Large Results

When you need to process many results, use IDs-only format and then fetch individual vCons:

```typescript
// Step 1: Get IDs
{
  "query": "last month",
  "limit": 100,
  "response_format": "ids_only"
}

// Step 2: Fetch specific vCons as needed
{
  "uuid": "abc-123-def"
}
```

### 5. Use Analytics Tools for Overview

For understanding patterns without loading individual records:

```typescript
// Get content analytics instead of individual records
{
  "include_dialog_analysis": true,
  "include_party_patterns": true,
  "include_conversation_metrics": true
}
```

## Best Practices

### 1. Always Check Database Size First
```typescript
// Before any large query
get_database_size_info → get_smart_search_limits → search with appropriate limits
```

### 2. Use Metadata Format by Default
```typescript
// Default to metadata for large databases
{
  "response_format": "metadata",
  "limit": 20
}
```

### 3. Use Pagination for Large Results
```typescript
// First page
{
  "query": "customer complaints",
  "limit": 20,
  "response_format": "metadata"
}

// Next page (if needed)
{
  "query": "customer complaints",
  "limit": 20,
  "offset": 20,
  "response_format": "metadata"
}
```

### 4. Use Analytics for Patterns
```typescript
// Instead of loading 1000 records
{
  "query": "billing issues",
  "limit": 1000,
  "response_format": "ids_only"
}

// Use analytics to understand patterns
{
  "include_content_analytics": true,
  "include_tag_analytics": true
}
```

## Response Format Comparison

| Format | Size | Use Case | Memory Safe |
|--------|------|----------|-------------|
| `full` | ~50KB per vCon | Detailed analysis | ❌ No (large DBs) |
| `metadata` | ~200 bytes per vCon | Overview, filtering | ✅ Yes |
| `snippets` | ~500 bytes per result | Content search | ✅ Yes |
| `ids_only` | ~36 bytes per vCon | Batch processing | ✅ Yes |

## Memory Usage Examples

For a database with 50,000 vCons:

- **Full format (100 results)**: ~5MB (❌ Memory exhaustion)
- **Metadata format (100 results)**: ~20KB (✅ Safe)
- **IDs only (100 results)**: ~3.6KB (✅ Very safe)
- **Snippets (100 results)**: ~50KB (✅ Safe)

## Summary

1. **Check database size** before running queries
2. **Use smart limits** based on database size
3. **Default to metadata format** for large databases
4. **Use IDs-only for batch processing**
5. **Use analytics tools** for pattern analysis
6. **Implement pagination** for large result sets

This approach ensures efficient operation with databases of any size while preventing memory exhaustion.
