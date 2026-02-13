# MongoDB Setup Guide for vCon MCP Server

This guide provides instructions on how to set up the vCon MCP Server with a MongoDB backend.

## Prerequisites
- **Node.js**: v18 or higher
- **MongoDB**: v6.0 or higher (Atlas recommended for Vector Search)
- **OpenAI API Key**: Required for generating embeddings

## 1. Environment Configuration

Create or update your `.env` file with the following variables:

```env
# Database Selection (mongodb or supabase)
DB_TYPE=mongodb

# MongoDB Connection String
# Format: mongodb+srv://<username>:<password>@<cluster>.mongodb.net/?appName=<appname>
MONGO_URL=mongodb+srv://user:pass@cluster.mongodb.net/?appName=vcon-app

# Optional: Specific Database Name (default: vcon)
MONGO_DB_NAME=vcon

# Embedding Configuration (Required for Vector Search)
OPENAI_API_KEY=sk-proj-...
```

## 2. Atlas Vector Search Setup

To enable Semantic and Hybrid search, you must create a Vector Search Index on your MongoDB Atlas cluster.

1.  **Create Collection**: Ensure the `vcon_embeddings` collection exists in your database.
2.  **Create Index**:
    -   Go to **Atlas UI** -> **Database** -> **Search**.
    -   Click **Create Search Index**.
    -   Select **JSON Editor**.
    -   Select output database and collection: `vcon.vcon_embeddings`.
    -   Name the index: `vector_index`.
    -   Input the following definition:

```json
{
  "fields": [
    {
      "numDimensions": 1536,
      "path": "embedding",
      "similarity": "cosine",
      "type": "vector"
    },
    {
      "path": "vcon_id",
      "type": "filter"
    },
    {
      "path": "created_at",
      "type": "filter"
    }
  ]
}
```

> [!NOTE]
> If you are using a different embedding model (e.g., Azure OpenAI), ensure `numDimensions` matches your model's output (e.g., 1536 for text-embedding-3-small).

## 3. Text Search Index

For standard keyword search functionality, a text index is required on the `vcons` collection. The server will attempt to create this automatically on startup, but you can also create it manually:

```javascript
db.vcons.createIndex({ "$**": "text" }, { name: "TextIndex" })
```

## 4. Verification

Run the verification scripts to ensure everything is configured correctly:

```bash
# Verify Core CRUD and Search
npx tsx scripts/verify-mongo.ts

# Verify Analytics and Inspector
npx tsx scripts/verify-mongo-analytics.ts
```
