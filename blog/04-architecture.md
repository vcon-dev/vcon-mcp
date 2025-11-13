# How the vCon MCP Server is Built

The vCon MCP Server is built in layers, with each layer handling a specific responsibility. This architecture makes the server reliable, performant, and extensible. This post explains how it works.

## The Three-Layer Architecture

The server has three main layers:

**MCP Server Layer** - Handles communication with AI assistants using the Model Context Protocol. This layer exposes tools, resources, and prompts that assistants can use.

**Business Logic Layer** - Contains the core functionality for managing conversations. This includes query engines, validation, and plugin systems.

**Database Layer** - Stores and retrieves conversation data. This layer uses Supabase and PostgreSQL with extensions for vector search.

Requests flow from top to bottom. An AI assistant sends a request to the MCP Server Layer. That layer processes it and passes it to the Business Logic Layer. The Business Logic Layer validates and processes the request, then uses the Database Layer to store or retrieve data. Responses flow back up the same path.

## The MCP Server Layer

The MCP Server Layer is the interface between AI assistants and the server. It speaks the Model Context Protocol, which is a standard way for assistants to interact with external systems.

### Tools, Resources, and Prompts

The server exposes three types of interfaces:

**Tools** are actions the assistant can perform. When you ask the assistant to create a conversation or search for something, it uses a tool. Each tool has a name, description, input parameters, and output format. The assistant reads these definitions and knows how to use each tool.

**Resources** are data the assistant can read. Resources use URI paths, similar to URLs. For example, a resource might be `vcon://v1/vcons/abc123` to access a specific conversation, or `vcon://v1/vcons/abc123/parties` to get just the participant information. Resources are read-only, which keeps them safe.

**Prompts** are guidance templates that help the assistant work effectively. They explain how to structure queries, what information to include, and best practices. The assistant uses prompts to understand how to accomplish tasks correctly.

### Request Handling

When an assistant sends a request, here is what happens:

1. The request arrives through the MCP protocol, either via standard input/output or HTTP
2. The server parses the JSON-RPC message to understand what the assistant wants
3. The server identifies which tool, resource, or prompt is being requested
4. The server prepares to process the request
5. Plugin hooks can run at this point to modify or intercept the request
6. The request moves to the Business Logic Layer for processing
7. The response comes back from the Business Logic Layer
8. Plugin hooks can run again to modify the response
9. The response is formatted as an MCP protocol message
10. The response is sent back to the assistant

This flow ensures requests are handled consistently and provides opportunities for plugins to add functionality.

## The Business Logic Layer

The Business Logic Layer contains the core functionality of the server. It handles validation, queries, and extensions.

### The Query Engine

The query engine handles all database operations. It knows how to create, read, update, and delete conversations. It also handles search operations, component management, and tag operations.

The query engine is designed to be efficient. It uses database transactions for operations that involve multiple steps, ensuring data consistency. When creating a conversation, for example, it might need to insert records into multiple tables. Using a transaction means either all the inserts succeed or none of them do, preventing partial data.

The engine also normalizes data when storing it. Normalized data is organized into separate tables with relationships between them. This makes queries efficient and prevents data duplication. When returning data to clients, the engine reconstructs complete conversation objects from the normalized data.

### The Validation Engine

The validation engine ensures all conversation data follows the IETF vCon standard before it is stored. This prevents invalid data from entering the database and ensures compatibility with other systems.

Validation checks include:

- Version numbers must match the current vCon specification version
- UUIDs must be in the correct format
- At least one participant must exist
- Dialog types must be valid
- Analysis entries must include required fields like vendor information
- References between components must be valid (for example, a dialog entry cannot reference a participant that does not exist)
- Encoding values must be valid
- Dates must be in ISO 8601 format

If validation fails, the server returns a clear error message explaining what is wrong. This helps users fix their data before trying again.

### The Plugin System

The plugin system allows extending the server without modifying its core code. Plugins can add new tools, resources, and prompts. They can also intercept operations at various points in the request lifecycle.

Plugins use hooks that fire at specific times:

- Before an operation starts, plugins can modify the request
- After an operation completes, plugins can modify the response
- Plugins can add logging, access control, data transformation, or other functionality

For example, a privacy plugin might intercept read operations and remove sensitive information before returning data. An audit plugin might log all operations for compliance tracking. A compliance plugin might check operations against regulatory requirements.

The plugin system loads plugins when the server starts. Plugins register their hooks, tools, resources, and prompts. When requests come in, the server calls the appropriate hooks and tools from all loaded plugins.

## The Database Layer

The Database Layer stores conversation data in Supabase, which provides PostgreSQL with additional features.

### Normalized Schema Design

The database uses a normalized schema, which means data is organized into separate tables with relationships between them. This is different from storing each conversation as a single JSON document.

The main tables are:

- `vcons` - Stores the main conversation record with metadata
- `parties` - Stores participants, with a reference to the conversation
- `dialog` - Stores conversation content, with references to the conversation and participants
- `analysis` - Stores AI analysis results, with references to the conversation and dialog entries
- `attachments` - Stores files and documents, with references to the conversation
- `groups` - Stores group information for multi-party conversations

This design has several benefits:

- Efficient queries. You can search for conversations by participant without loading all conversation data
- Easy to update. You can add a new dialog entry without touching other parts of the conversation
- Scalable. The database can handle millions of conversations efficiently
- Proper constraints. Foreign keys ensure data relationships are valid

When returning data to clients, the query engine joins these tables together to reconstruct complete conversation objects.

### Search Architecture

The server supports four types of search, each using different database features:

**Metadata search** filters by subject, participant, or dates. It uses B-tree indexes, which are fast for exact matches and range queries. This is the fastest search method, typically returning results in under 100 milliseconds.

**Keyword search** looks for words within conversation content. It uses GIN indexes with trigram matching, which allows it to find words even with minor typos. It searches through dialog text, analysis results, and participant information. This method typically takes a few hundred milliseconds.

**Semantic search** finds conversations by meaning using AI embeddings. Conversations are converted into vectors, which are mathematical representations of their meaning. The search converts your query into a vector, then finds conversations with similar vectors. It uses an HNSW index, which is optimized for vector similarity searches. This method typically takes one to two seconds.

**Hybrid search** combines keyword and semantic search. It runs both searches and merges the results, ranking them based on a weighted combination of both scores. You can control how much weight each method has. This method provides the best of both approaches but takes longer, typically two to three seconds.

Each search method is implemented as a database function that runs on the database server. This keeps search logic close to the data, which improves performance.

### Tag Storage

Tags are stored as a special type of attachment. This keeps tags within the vCon format while allowing efficient searching.

The server maintains a materialized view that extracts tags from attachments and indexes them. A materialized view is a pre-computed query result that is stored in the database and refreshed periodically. This makes tag searches very fast without requiring schema changes when you add new tags.

When you search by tags, the server uses this materialized view to find conversations quickly. When you add or update tags, the materialized view is updated automatically.

### Caching with Redis

The server supports optional Redis caching. Redis is an in-memory data store that is much faster than database queries. When enabled, the server checks Redis first before querying the database.

If data is found in Redis, it returns immediately. If not, it queries the database, stores the result in Redis for future requests, and then returns it. This can make frequently accessed conversations load 20 to 50 times faster.

Redis caches have expiration times, so cached data does not become stale. When conversations are updated, the cache is cleared for those conversations, ensuring you always get current data.

## Request Flow Examples

Let us walk through two examples to see how requests flow through the system.

### Creating a Conversation

You ask the assistant: "Create a vCon for a support call."

1. The assistant calls the `create_vcon` tool with conversation data.

2. The MCP Server Layer receives the request and identifies it as a tool call.

3. Plugin hooks can run at this point. For example, a plugin might add default tags or metadata.

4. The Business Logic Layer receives the request. The validation engine checks that all required fields are present and valid.

5. If validation passes, the query engine starts a database transaction.

6. The query engine inserts records:
   - First, it inserts the main conversation record into the `vcons` table
   - Then it inserts participant records into the `parties` table
   - If dialog content is provided, it inserts dialog records
   - If analysis results are provided, it inserts analysis records

7. The transaction commits, ensuring all inserts succeed together.

8. Plugin hooks run again. For example, an audit plugin might log the creation, or a webhook plugin might notify another system.

9. The response is formatted and sent back to the assistant, including the new conversation's UUID.

10. The assistant receives the response and confirms the conversation was created.

### Semantic Search

You ask the assistant: "Find frustrated customers from last week."

1. The assistant calls the `search_vcons_semantic` tool with a query and date range.

2. The MCP Server Layer receives the request.

3. Plugin hooks might modify the search criteria. For example, a multi-tenant plugin might add filters to restrict results to your organization.

4. The Business Logic Layer receives the request. It converts your query text into an embedding vector using an AI service like OpenAI.

5. The query engine calls a database function that performs the semantic search. The function:
   - Uses the HNSW index to find conversations with similar embeddings
   - Filters by your date range
   - Applies any tag filters you specified
   - Ranks results by similarity
   - Returns the top matches

6. The query engine reconstructs complete conversation objects by joining the search results with related tables.

7. Plugin hooks might filter the results. For example, a privacy plugin might remove sensitive conversations before returning them.

8. The response is formatted and sent back to the assistant with search results.

9. The assistant receives the results and can analyze or present them to you.

## Performance Considerations

The server is designed for performance at multiple levels.

### Database Optimization

The database uses indexes strategically. B-tree indexes on UUIDs and dates make lookups by identifier or date range fast. GIN indexes on text fields enable fast full-text search. HNSW indexes on embeddings enable fast semantic search.

The server also uses materialized views for frequently accessed data like tags. These views are pre-computed and refreshed periodically, avoiding expensive computations on every query.

Query patterns are optimized. The server uses prepared statements, which are faster than building queries from strings. It batches operations where possible, reducing the number of database round trips.

### Memory Management

The server limits result set sizes to prevent memory issues. Large searches return paginated results. The server can stream large responses instead of loading everything into memory at once.

Plugin resources are cleaned up properly. When plugins are unloaded or the server shuts down, resources are released to prevent memory leaks.

### Scalability

The server design supports scaling in multiple ways:

**Horizontal scaling** means running multiple server instances. Since the server is stateless (it does not store session information), you can run multiple instances behind a load balancer. Requests can be distributed across instances.

**Vertical scaling** means increasing the resources available to a single instance. You can add more memory, faster CPUs, or faster database connections.

**Read replicas** allow distributing read queries across multiple database copies. Write operations go to the main database, while read operations can use replicas, reducing load on the primary database.

## Type Safety and Validation

The server is built with TypeScript, which provides compile-time type checking. This means many errors are caught before the code runs. Type definitions match the IETF vCon specification exactly, ensuring the code implements the standard correctly.

Runtime validation uses Zod, which validates data when it arrives. Even if data comes from an external source that might not follow types correctly, Zod ensures it matches the expected structure before processing.

The combination of TypeScript types and Zod validation provides both compile-time safety and runtime safety, preventing many classes of bugs.

## Extensibility Through Plugins

The plugin system allows the server to be extended without modifying core code. This keeps the core simple and focused, while allowing specific needs to be addressed through plugins.

Plugins can be developed independently and loaded at runtime. They can add functionality like compliance checking, privacy controls, integrations with other systems, or custom analytics.

The plugin interface is well-defined, so plugins work reliably. As long as a plugin implements the interface correctly, it will work with the server regardless of when it was developed.

## Security Architecture

Security is handled at multiple levels:

**Authentication** ensures only authorized systems can access the server. Supabase provides Row Level Security policies that restrict access based on user identity. API keys validate that requests come from authorized sources.

**Authorization** controls what authenticated users can do. Row Level Security policies define which records users can access. Plugins can add additional authorization checks.

**Data protection** includes encryption at rest in the database and encryption in transit over the network. Plugins can add redaction to hide sensitive information before returning data.

The server itself does not store sensitive authentication information. All authentication is handled by Supabase, which is designed for secure data storage.

## Conclusion

The vCon MCP Server's architecture balances simplicity, performance, and extensibility. The layered design separates concerns, making the code easier to understand and maintain. The normalized database schema ensures efficient queries and scalability. The plugin system allows extending functionality without modifying core code.

This architecture supports the server's goals of providing reliable conversation data management while remaining flexible enough to meet diverse needs. The next post in this series covers business cases and real-world use cases for the server.

