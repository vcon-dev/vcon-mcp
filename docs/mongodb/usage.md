# Using vCon MCP Server with MongoDB

## Running the Server

To start the server with MongoDB support:

1.  Ensure prerequisites are met (see [setup.md](./setup.md)).
2.  Run the development server:

```bash
# Using cross-env for cross-platform compatibility
cross-env DB_TYPE=mongodb npm run dev
```

Or set the environment variable in your shell/IDE configuration.

## Verification Scripts

We provide dedicated scripts to verify the MongoDB integration.

### 1. Core Verification (`scripts/verify-mongo.ts`)
Tests basic CRUD operations and Search.

```bash
npx tsx scripts/verify-mongo.ts
```

**What it tests:**
-   Connecting to MongoDB.
-   Creating a sample vCon.
-   Reading the vCon by UUID.
-   Performing a keyword search.
-   Performing a semantic search (requires embeddings).
-   Deleting the sample vCon.

### 2. Analytics Verification (`scripts/verify-mongo-analytics.ts`)
Tests Inspector, Analytics, and Size Analyzer components.

```bash
npx tsx scripts/verify-mongo-analytics.ts
```

**What it tests:**
-   `getDatabaseShape`: Lists collections and counts.
-   `getDatabaseStats`: Checks index usage and storage stats.
-   `getDatabaseAnalytics`: Aggregates dummy data for trends.
-   `getSmartSearchLimits`: Recommends limits based on DB size.

## Troubleshooting

### Connection Errors
-   **Error**: `MongoServerError: bad auth : Authentication failed.`
    -   **Fix**: Check `MONGO_URL`. Ensure user/password are correct and IP is whitelisted in Atlas.

### Search Errors
-   **Error**: `MongoServerError: PlanExecutor error during aggregation :: caused by :: Index 'vector_index' not found.`
    -   **Fix**: You must create the Vector Search Index in Atlas. See [setup.md](./setup.md).
-   **Error**: `text index required for $text query`
    -   **Fix**: The server attempts to create a text index on startup. Check logs for index creation errors, or run `db.vcons.createIndex({ "$**": "text" })` manually.

### Analytics Errors
-   **Error**: `Stage not supported`
    -   **Fix**: Ensure you are using a compatible MongoDB version (v6.0+ recommended).
