# MCP Server and Conserver: Different Roles, Working Together

The vCon ecosystem includes two main components: the MCP server and the conserver. They serve different purposes but work together to create a complete system for managing conversation data. This post explains what each does, how they differ, and how they combine with Redis and Supabase to optimize performance.

## Two Different Roles

The MCP server and conserver solve different problems in the vCon ecosystem.

**The MCP server** is a storage and query system. It provides an interface for AI assistants to work with conversation data. It focuses on storing, searching, and retrieving vCons through the Model Context Protocol.

**The conserver** is a processing and workflow engine. It focuses on creating and enriching vCons through chains of processing steps. It handles the intake of new conversations and runs them through workflows like transcription, analysis, and enrichment.

Think of it this way: the conserver is like a factory that creates and processes products, while the MCP server is like a warehouse where products are stored and retrieved. They work together but have different jobs.

## The MCP Server: Storage and Query

The MCP server is built in TypeScript and serves as the storage backend for conversation data. Its primary role is providing AI assistants with tools to work with stored conversations.

### What It Does

The MCP server provides:
- Storage for vCon data in Supabase
- Search capabilities across stored conversations
- Query tools for AI assistants
- Analytics about your conversation database
- Management tools for organizing conversations

### How It Works

When you use an AI assistant with the MCP server, the assistant can:
- Store conversations you create
- Search through historical conversations
- Analyze patterns in your data
- Answer questions about conversations
- Manage tags and organization

The server exposes over 27 tools through the MCP protocol. AI assistants understand these tools and can use them to work with your conversation data. The server handles validation, database operations, and response formatting.

### Architecture

The MCP server uses a cache-first read strategy when Redis is configured. When you request a conversation:
1. It checks Redis cache first
2. If found in cache, returns immediately
3. If not found, fetches from Supabase
4. Caches the result in Redis for future requests
5. Returns the data

This makes reads very fast for frequently accessed conversations.

## The Conserver: Scaling Creation and Processing

The conserver is built in Python and serves as a workflow engine for processing conversations. Its primary role is taking in raw conversation data and running it through processing chains.

### What It Does

The conserver provides:
- Processing chains that can transcribe, analyze, and enrich conversations
- Scalable processing through multiple instances
- Integration with external services like transcription APIs
- Storage backends that work with various databases
- Queue management for processing workflows

### How It Works

The conserver processes conversations through configurable chains. A chain is a sequence of processing steps called links. For example, a chain might:
1. Receive a new conversation
2. Transcribe audio using Deepgram
3. Analyze sentiment using OpenAI
4. Extract key topics
5. Store the enriched conversation

You configure chains in a YAML file, defining what processing should happen and in what order. The conserver reads from Redis queues, processes conversations through the chains, and writes results to storage backends.

### Scaling

The conserver scales by running multiple instances. You can start multiple conserver processes, and they all read from the same Redis queues. This allows you to process many conversations in parallel.

For example, if you have 100 conversations to process and each takes 30 seconds, one conserver instance would take 50 minutes. With 10 instances, it takes 5 minutes. You scale simply by starting more instances.

## How They Work Together

The MCP server and conserver complement each other:

**Conserver creates and processes** - It takes in raw conversation data, runs it through processing chains, and stores the enriched results.

**MCP server stores and queries** - It provides the storage backend and gives AI assistants tools to work with the stored data.

You can use conserver's Supabase storage backend, which stores data in the same Supabase database that the MCP server uses. This means:
- Conserver writes enriched conversations to Supabase
- MCP server can immediately query those conversations
- Both use the same Redis cache for performance
- Data flows seamlessly between systems

## The Redis and Supabase Combination

Using Redis and Supabase together optimizes performance throughout the conversation lifecycle. Here is how it works at each stage.

### Stage 1: Creation and Processing

When conserver processes a conversation:

1. **Conserver receives** the conversation from an API or queue
2. **Conserver processes** it through chains (transcription, analysis, etc.)
3. **Conserver writes to Supabase** first (permanent storage)
4. **Conserver caches in Redis** (fast access)
5. **Conserver adds to queues** for further processing if needed

This is called a write-through cache pattern. Data is written to permanent storage first, then cached. This ensures data is never lost, even if Redis fails.

The conserver can run multiple instances in parallel, all writing to the same Supabase database. Redis coordinates the work by managing queues that distribute processing across instances.

### Stage 2: Storage and Retrieval

When the MCP server retrieves a conversation:

1. **MCP server checks Redis** first (cache-first read)
2. **If found, returns immediately** (typically 1-2 milliseconds)
3. **If not found, fetches from Supabase** (typically 50-100 milliseconds)
4. **Caches result in Redis** for future requests
5. **Returns the data**

This is called a cache-first read pattern. It checks fast storage first, only going to slower storage when needed. This makes repeated reads very fast.

### Stage 3: Updates and Deletes

When conversations are updated or deleted:

1. **Operation happens in Supabase** (permanent storage)
2. **Cache is invalidated in Redis** (removed or marked stale)
3. **Next read fetches fresh data** from Supabase and caches it

This ensures cached data stays consistent with permanent storage.

## Performance Benefits Throughout the Lifecycle

The Redis and Supabase combination provides speed optimizations at every stage:

**During creation** - Conserver writes to Supabase, then caches in Redis. This makes the conversation immediately available for fast reads while ensuring it is permanently stored.

**During processing** - Redis queues coordinate work across multiple conserver instances. This allows parallel processing without conflicts.

**During reads** - Cache-first reads make frequently accessed conversations load 20 to 50 times faster. A conversation read from cache takes 1-2 milliseconds instead of 50-100 milliseconds.

**During searches** - While search always queries Supabase for complete results, cached individual conversations load instantly when displayed.

**During updates** - Updates write to Supabase first, then invalidate cache. The next read gets fresh data and caches it, keeping everything consistent.

## A Complete Example

Let us trace a conversation through the entire system:

**Hour 1: Creation**
- A phone call comes in to your system
- Conserver receives the call recording
- Conserver processes it: transcribes audio, analyzes sentiment, extracts topics
- Conserver writes the enriched vCon to Supabase
- Conserver caches it in Redis with a 1-hour TTL
- The conversation is now stored and available

**Hour 2: First Access**
- You ask your AI assistant to find the conversation
- MCP server checks Redis cache (miss, it expired)
- MCP server fetches from Supabase (50ms)
- MCP server caches in Redis (1ms)
- MCP server returns to assistant (51ms total)

**Hour 3: Repeated Access**
- You ask about the same conversation again
- MCP server checks Redis cache (hit)
- MCP server returns immediately (1ms total)

**Hour 4: Update**
- You add analysis results to the conversation
- MCP server updates Supabase
- MCP server invalidates Redis cache
- The conversation is now updated permanently

**Hour 5: Search**
- You search for conversations about a topic
- MCP server searches Supabase (query always hits database)
- Results include the conversation you updated
- When you open individual results, they load from cache if recently accessed

## Configuration Overview

To use both systems together, you configure:

**Conserver configuration** (in config.yml):
```yaml
storages:
  supabase:
    module: storage.supabase
    options:
      url: ${SUPABASE_URL}
      anon_key: ${SUPABASE_ANON_KEY}
      redis_url: ${REDIS_URL}
      cache_ttl: 3600
```

**MCP server configuration** (in .env):
```bash
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_ANON_KEY=your-key
REDIS_URL=redis://localhost:6379
VCON_REDIS_EXPIRY=3600
```

Both use the same Supabase database and Redis cache, so data flows seamlessly between them.

## When to Use Each

Use the conserver when:
- You need to process many conversations at scale
- You want to run workflows like transcription and analysis
- You need to integrate with external processing services
- You are receiving conversations from APIs or queues

Use the MCP server when:
- You want AI assistants to work with conversation data
- You need to search and query stored conversations
- You want analytics about your conversation database
- You are building applications that interact with conversations

Most organizations use both:
- Conserver handles the creation and processing pipeline
- MCP server handles storage and AI assistant access
- They share the same Supabase database and Redis cache

## Summary

The MCP server and conserver serve different but complementary roles. The conserver scales the creation and processing of conversations through parallel instances and workflow chains. The MCP server provides storage and query capabilities for AI assistants.

Together with Redis and Supabase, they create an optimized system:
- Conserver writes to Supabase first, then caches in Redis (write-through)
- MCP server reads from Redis first, then Supabase if needed (cache-first)
- This combination makes the entire lifecycle fast while ensuring data durability
- Multiple conserver instances process in parallel while sharing the same storage
- AI assistants get fast access to all conversation data through the MCP server

The result is a system that can handle high-volume creation, complex processing, and fast queries, all while maintaining data consistency and durability.

