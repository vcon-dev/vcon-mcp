# MongoDB Atlas Vector Search Index Definition

To enable Semantic Search and Hybrid Search, you must create a Vector Search Index on the `vcon_embeddings` collection in MongoDB Atlas.

## 1. Create the Index

1. Go to your MongoDB Atlas Cluster.
2. Navigate to **Atlas Search** -> **Vector Search**.
3. Click **Create Index**.
4. Select your Database and the **`vcon_embeddings`** collection.
5. Enter the **Index Name**: `vector_index` (This name is hardcoded in `MongoVConQueries`).
6. Choose **JSON Editor** and paste the following configuration:

```json
{
  "fields": [
    {
      "type": "vector",
      "path": "embedding",
      "numDimensions": 384,
      "similarity": "cosine"
    },
    {
      "type": "filter",
      "path": "vcon_id"
    },
    {
      "type": "filter",
      "path": "content_type"
    }
  ]
}
```

## 2. Verify

Once the index status changes to **Active**, the `semanticSearch` functionality in the vCon MCP server will automatically start returning results.

> **Note**: The `numDimensions` is set to **384** to match the `text-embedding-3-small` (or similar) model used in `embed-vcons.ts`. If you change the embedding model, update this value accordingly.
