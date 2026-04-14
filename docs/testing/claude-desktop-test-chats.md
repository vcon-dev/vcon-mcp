# Claude Desktop Test Chats — vCon MCP Tools

Paste each prompt into a **fresh Claude Desktop chat** (so tool calls don't carry state from prior tests). Tests are ordered so early chats produce a known UUID you can paste into later ones.

> **Note:** After running Chat 1, copy the returned `uuid` value. Several later chats reference `<UUID-FROM-CHAT-1>` — replace that placeholder with the real value.

---

## Chat 1 — Create a vCon (create_vcon)

```
Using the vCon MCP tools, create a new vCon with the following details:
- Subject: "Test support call — automated tool test"
- Two parties:
    - name: "Alice Tester", tel: "+15550001111", role: "customer"
    - name: "Bob Agent", mailto: "bob@example.com", role: "agent"

After creating it, tell me the UUID of the new vCon.
```

---

## Chat 2 — Retrieve a vCon (get_vcon)

```
Using the vCon MCP tools, retrieve the vCon with UUID <UUID-FROM-CHAT-1> using response_format "full".

Display the subject, the list of parties, and the vCon version field.
```

---

## Chat 3 — Update a vCon (update_vcon)

```
Using the vCon MCP tools, update the vCon with UUID <UUID-FROM-CHAT-1>:
- Change the subject to "Updated test support call"
- Add an extensions field: { "test_run": true, "environment": "dev" }

Then retrieve it again with get_vcon to confirm the changes were saved.
```

---

## Chat 4 — Add Dialog (add_dialog)

```
Using the vCon MCP tools, add a text dialog segment to the vCon with UUID <UUID-FROM-CHAT-1>:
- type: "text"
- start: (use current ISO timestamp)
- duration: 120
- parties: [0, 1]
- body: "Alice: Hi, I need help with my account.\nBob: Of course! What seems to be the issue?"
- encoding: "none"

Confirm the dialog was added by retrieving the vCon and showing the dialog array.
```

---

## Chat 5 — Add Analysis (add_analysis)

```
Using the vCon MCP tools, add an analysis object to the vCon with UUID <UUID-FROM-CHAT-1>:
- type: "sentiment"
- vendor: "TestVendor"
- product: "TestModel-1.0"
- schema: "sentiment-v1"
- body: (JSON.stringify of { "sentiment": "positive", "score": 0.92, "confidence": "high" })
- encoding: "json"
- dialog_indices: [0]

After adding, retrieve the vCon and show the analysis array to confirm it was stored correctly.
```

---

## Chat 6 — Add Attachment (add_attachment)

```
Using the vCon MCP tools, add an attachment to the vCon with UUID <UUID-FROM-CHAT-1>:
- type: "transcript"
- mediatype: "text/plain"
- body: "Full transcript: Alice asked about her account. Bob resolved the issue."
- encoding: "none"

Confirm the attachment was added by retrieving the vCon with response_format "full".
```

---

## Chat 7 — Create from Template (create_vcon_from_template)

```
Using the vCon MCP tools, first call get_examples to see what vCon templates are available.

Then use create_vcon_from_template to create a vCon from one of the available templates. Show me the UUID and subject of the created vCon.
```

---

## Chat 8 — Tag Management (manage_tag, get_tags)

```
Using the vCon MCP tools, perform the following tag operations on the vCon with UUID <UUID-FROM-CHAT-1>:

1. Add tag: key="department", value="support" (action: "set")
2. Add tag: key="priority", value="high" (action: "set")
3. Add tag: key="sentiment", value="positive" (action: "set")
4. Add tag: key="resolved", value="true" (action: "set")

Then call get_tags for that vCon to show all tags that were stored.
```

---

## Chat 9 — Update and Remove Tags (manage_tag, remove_all_tags)

```
Using the vCon MCP tools and the vCon UUID <UUID-FROM-CHAT-1>:

1. Update the "priority" tag to value "low" using manage_tag with action "set"
2. Remove just the "resolved" tag using manage_tag with action "remove"
3. Call get_tags to confirm the current state (should have department, priority, sentiment — no resolved)
4. Then call remove_all_tags to clear all tags
5. Call get_tags again to confirm all tags are gone
```

---

## Chat 10 — Discover Unique Tags (get_unique_tags)

```
Using the vCon MCP tools, call get_unique_tags to show all distinct tag keys and values currently in the database.

Report:
- Total number of unique tag keys
- The top 5 most common tag keys
- A few example values for the "department" key (if it exists)
```

---

## Chat 11 — Search by Tags (search_by_tags)

```
Using the vCon MCP tools, search for vCons using search_by_tags.

Run two searches:
1. Search for vCons tagged with department="support", using response_format "metadata", limit 10
2. Search for vCons tagged with priority="high", using response_format "ids_only", limit 20

Report the count of results for each search and any UUIDs returned.
```

---

## Chat 12 — Metadata / Filter Search (search_vcons)

```
Using the vCon MCP tools, use search_vcons to run three filtered searches:

1. Search for vCons created in the last 7 days, limit 10, response_format "metadata"
2. Search for vCons with subject containing "support", limit 10, response_format "metadata"
3. Search for vCons with no filter but sorted by created_at descending, limit 5, response_format "metadata"

Report the result counts and subjects for each search.
```

---

## Chat 13 — Full-Text Content Search (search_vcons_content)

```
Using the vCon MCP tools, use search_vcons_content to search for vCons whose dialog or analysis body contains relevant content.

Run two searches:
1. Query: "billing refund", limit 10, response_format "metadata"
2. Query: "account password reset", limit 10, response_format "metadata"

For each search, report the number of results and the subject of each matched vCon.
```

---

## Chat 14 — Semantic Search (search_vcons_semantic)

```
Using the vCon MCP tools, use search_vcons_semantic to find vCons by meaning rather than exact keywords.

Run these searches:
1. Query: "customer unhappy with service quality", threshold 0.7, limit 10, response_format "metadata"
2. Query: "technical issue with software not working", threshold 0.65, limit 10, response_format "metadata"

Report the number of results for each and the similarity scores if available.
```

---

## Chat 15 — Hybrid Search (search_vcons_hybrid)

```
Using the vCon MCP tools, use search_vcons_hybrid to combine keyword and semantic search.

Run two hybrid searches:
1. Query: "billing dispute", semantic_weight 0.6, limit 10, response_format "metadata"
2. Query: "password help login", tags { department: "support" }, semantic_weight 0.4, limit 10, response_format "metadata"

Compare the result counts between the two and note any differences in the types of results returned.
```

---

## Chat 16 — Query Analysis (analyze_query)

```
Using the vCon MCP tools, use analyze_query to inspect the execution plan for these SQL-style queries:

1. Analyze a search for vCons with a specific subject substring
2. Analyze a tag-filtered search

Call analyze_query with a representative query string (e.g., "SELECT * FROM vcons WHERE subject ILIKE '%support%' LIMIT 10") and report the execution plan details, estimated cost, and any index usage.
```

---

## Chat 17 — Database Shape (get_database_shape)

```
Using the vCon MCP tools, call get_database_shape and report:

- All tables in the schema and their row counts
- The indexes defined on the vcons table
- The indexes defined on the dialog table
- Any tables that appear to be missing indexes on foreign keys
```

---

## Chat 18 — Database Statistics (get_database_stats)

```
Using the vCon MCP tools, call get_database_stats and report:

- Total vCon count
- Total dialog count
- Total analysis count
- Total attachments count
- Average dialogs per vCon
- Any other summary statistics returned
```

---

## Chat 19 — Database Size Info (get_database_size_info)

```
Using the vCon MCP tools, call get_database_size_info and report:

- Total database size
- Size of each major table (vcons, dialog, analysis, attachments, vcon_embeddings)
- Which table consumes the most storage
- Any bloat or dead tuple information if available
```

---

## Chat 20 — Database Health Metrics (get_database_health_metrics)

```
Using the vCon MCP tools, call get_database_health_metrics and report:

- Cache hit ratio
- Index hit ratio
- Any long-running queries
- Connection pool utilization
- Any health warnings or recommendations from the tool
```

---

## Chat 21 — Database Analytics (get_database_analytics)

```
Using the vCon MCP tools, call get_database_analytics and report:

- vCon creation trends (by day or week if available)
- Distribution of dialog types (recording vs text vs transfer vs incomplete)
- Distribution of analysis vendor types
- Any other aggregate statistics returned
```

---

## Chat 22 — Monthly Growth Analytics (get_monthly_growth_analytics)

```
Using the vCon MCP tools, call get_monthly_growth_analytics and report:

- Month-by-month vCon creation counts for the past 6 months
- Which month had the highest volume
- The month-over-month growth rate
- Any trends or anomalies in the data
```

---

## Chat 23 — Content Analytics (get_content_analytics)

```
Using the vCon MCP tools, call get_content_analytics and report:

- Most common dialog body lengths (short/medium/long distribution)
- Most common analysis types
- Encoding distribution (base64url vs json vs none)
- Any other content-level statistics returned
```

---

## Chat 24 — Attachment Analytics (get_attachment_analytics)

```
Using the vCon MCP tools, call get_attachment_analytics and report:

- Total number of attachments
- Attachment type distribution (tags vs transcript vs other)
- Attachment mediatype distribution
- Average attachments per vCon
- Any notable patterns in the attachment data
```

---

## Chat 25 — Tag Analytics (get_tag_analytics)

```
Using the vCon MCP tools, call get_tag_analytics and report:

- Total number of tagged vCons
- Percentage of vCons that have at least one tag
- Top 10 most used tag keys
- Top 10 most used tag key:value pairs
- Any tag usage patterns or anomalies
```

---

## Chat 26 — Schema Reference (get_schema)

```
Using the vCon MCP tools, call get_schema and report:

- The current vCon spec version the server implements
- The required top-level fields of a vCon
- The structure of a Dialog object (required vs optional fields)
- The structure of an Analysis object (note which fields are required)
- The valid values for the encoding field
```

---

## Chat 27 — Examples Reference (get_examples)

```
Using the vCon MCP tools, call get_examples and show:

- All available example/template names
- The structure of one complete example vCon
- What fields differ between a minimal vCon and a full-featured vCon example
```

---

## Chat 28 — Smart Search Limits (get_smart_search_limits)

```
Using the vCon MCP tools, call get_smart_search_limits and report:

- The recommended result limits for each search type (keyword, semantic, hybrid)
- Any database-size-based adjustments in effect
- The maximum allowed limit for each search type
- Recommendations for response_format based on current database size
```

---

## Chat 29 — End-to-End Workflow Test

```
Using the vCon MCP tools, run a complete end-to-end workflow:

1. Create a new vCon with subject "E2E workflow test" and two parties (Alice and Bob)
2. Add a text dialog with a short conversation body
3. Add a sentiment analysis (vendor: "E2ETestVendor", type: "sentiment")
4. Set three tags: department=engineering, priority=low, test=e2e
5. Search for this vCon using search_vcons with the subject substring "E2E"
6. Verify it appears in the results
7. Delete the vCon using delete_vcon
8. Try to retrieve it again with get_vcon — confirm it returns a not-found error

Report pass/fail for each step.
```

---

## Chat 30 — Delete vCon (delete_vcon)

```
Using the vCon MCP tools, delete the vCon with UUID <UUID-FROM-CHAT-1>.

After deleting:
1. Attempt to retrieve it with get_vcon — confirm it returns an error or null
2. Search for it by subject "Updated test support call" using search_vcons — confirm it no longer appears

Report whether the deletion was clean (no orphaned records) based on any information the tool provides.
```

---

## Summary Checklist

| # | Chat | Tools Tested |
|---|------|-------------|
| 1 | Create vCon | `create_vcon` |
| 2 | Retrieve vCon | `get_vcon` |
| 3 | Update vCon | `update_vcon`, `get_vcon` |
| 4 | Add Dialog | `add_dialog`, `get_vcon` |
| 5 | Add Analysis | `add_analysis`, `get_vcon` |
| 6 | Add Attachment | `add_attachment`, `get_vcon` |
| 7 | Create from Template | `get_examples`, `create_vcon_from_template` |
| 8 | Set Tags | `manage_tag`, `get_tags` |
| 9 | Update/Remove Tags | `manage_tag`, `remove_all_tags`, `get_tags` |
| 10 | Discover Tags | `get_unique_tags` |
| 11 | Search by Tags | `search_by_tags` |
| 12 | Metadata Search | `search_vcons` |
| 13 | Full-Text Search | `search_vcons_content` |
| 14 | Semantic Search | `search_vcons_semantic` |
| 15 | Hybrid Search | `search_vcons_hybrid` |
| 16 | Query Analysis | `analyze_query` |
| 17 | DB Shape | `get_database_shape` |
| 18 | DB Statistics | `get_database_stats` |
| 19 | DB Size | `get_database_size_info` |
| 20 | DB Health | `get_database_health_metrics` |
| 21 | DB Analytics | `get_database_analytics` |
| 22 | Monthly Growth | `get_monthly_growth_analytics` |
| 23 | Content Analytics | `get_content_analytics` |
| 24 | Attachment Analytics | `get_attachment_analytics` |
| 25 | Tag Analytics | `get_tag_analytics` |
| 26 | Schema Reference | `get_schema` |
| 27 | Examples Reference | `get_examples` |
| 28 | Search Limits | `get_smart_search_limits` |
| 29 | E2E Workflow | All CRUD + tags + search + delete |
| 30 | Delete vCon | `delete_vcon`, `get_vcon`, `search_vcons` |
