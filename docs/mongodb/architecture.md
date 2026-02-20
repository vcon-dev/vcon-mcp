# MongoDB Architecture in vCon MCP Server

This document outlines the architectural design of the MongoDB integration within the vCon MCP Server.

## Overview

The server supports a dual-database architecture, allowing it to run with either Supabase (PostgreSQL) or MongoDB as the backend. This is achieved through strict interface abstraction and dynamic dependency injection.

## Core Interfaces

All database interactions are governed by the following interfaces defined in `src/db/interfaces.ts` and `src/db/types.ts`:

1.  **`IVConQueries`**:
    -   Defines CRUD operations for vCons (Create, Read, Update, Delete).
    -   Defines Search operations (Keyword, Semantic, Hybrid).
2.  **`IDatabaseInspector`**:
    -   Provides methods to inspect database structure (collections/tables, indexes, schema).
    -   Provides database statistics.
3.  **`IDatabaseAnalytics`**:
    -   Provides business logic analytics (growth trends, tagging stats, attachment breakdowns).
4.  **`IDatabaseSizeAnalyzer`**:
    -   Analyzes storage usage and provides smart recommendations for query limits.

## MongoDB Implementation

The MongoDB implementation resides in `src/db/`:

| Component | Class | File | description |
| :--- | :--- | :--- | :--- |
| **Client** | `MongoDatabaseClient` | `mongo-client.ts` | Manages connection pool. |
| **Queries** | `MongoVConQueries` | `mongo-queries.ts` | Implements `IVConQueries`. |
| **Inspector** | `MongoDatabaseInspector` | `mongo-inspector.ts` | Implements `IDatabaseInspector`. |
| **Analytics** | `MongoDatabaseAnalytics` | `mongo-analytics.ts` | Implements `IDatabaseAnalytics`. |
| **Size** | `MongoDatabaseSizeAnalyzer` | `mongo-size-analyzer.ts` | Implements `IDatabaseSizeAnalyzer`. |

### Data Model

-   **Collection**: `vcons`
    -   Stores the full vCon object as a single document.
    -   Uses MongoDB Text Index for keyword search.
-   **Collection**: `vcon_embeddings`
    -   Stores vector embeddings separately to allow for optimized vector search.
    -   Fields: `vcon_id`, `embedding` (array of floats), `created_at`.
    -   Uses Atlas Vector Search Index (`vector_index`) for semantic search.

### Aggregation Pipelines

Complex analytics are implemented using MongoDB Aggregation Framework.
-   **Growth Trends**: Uses `$group` by date parts of `created_at`.
-   **Tag Analytics**: Uses `$project` and `$unwind` to normalize tag arrays/objects before grouping.
-   **Vector Search**: Uses `$vectorSearch` stage (available in Atlas) for similarity search.

## Dependency Injection

The server determines which backend to use at runtime in `src/server/setup.ts`:

1.  Checks `process.env.DB_TYPE`.
2.  If `'mongodb'`, dynamically imports MongoDB classes and initializes `MongoClient`.
3.  If `'supabase'` (default), initializes `SupabaseClient`.
4.  Injects the selected implementation into `ServerContext`.

This allows the core server logic and MCP tools to remain agnostic of the underlying database.
