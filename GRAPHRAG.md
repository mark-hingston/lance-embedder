# GraphRAG Integration Guide

This document explains how to use the GraphRAG features in the embedder.

## Overview

The embedder can now create a **knowledge graph** in addition to the vector store. This enables more sophisticated retrieval patterns that discover semantic relationships between document chunks.

**Two storage systems:**
1. **LanceDB** - Fast vector similarity search (standard RAG)
2. **GraphRAG** - Relationship discovery via graph traversal (enhanced RAG)

## Indexing with GraphRAG

Enable GraphRAG during indexing with the `--enable-graph` flag:

```bash
embedder \
  -d ./my-repo \
  -o ./embeddings \
  -u http://localhost:1234/v1 \
  -m text-embedding-model \
  --enable-graph \
  --graph-threshold 0.7
```

### Options

- `--enable-graph` - Enable knowledge graph creation (default: false)
- `--graph-threshold <number>` - Similarity threshold for graph edges, 0.0-1.0 (default: 0.7)

### What Gets Created

When GraphRAG is enabled, the embedder creates:

1. **LanceDB table** - Vector embeddings for fast similarity search
2. **`graph-data/` directory** - Folder-based graph storage:
   ```
   graph-data/
     config.json           # Configuration (dimension, threshold, version)
     index.json            # Metadata (chunk count, batch info)
     chunks/
       batch-0000.json     # First 1000 chunks (text + metadata)
       batch-0001.json     # Next 1000 chunks
       ...
     embeddings/
       batch-0000.bin      # Binary embeddings for first 1000 chunks
       batch-0001.bin      # Binary embeddings for next 1000 chunks
       ...
   ```

**Why folder-based storage?**
- ✅ Scalable: No single massive JSON file
- ✅ Efficient: Binary format for embeddings (4-10x smaller)
- ✅ Partial loading: Load only needed batches
- ✅ Corruption-resistant: Issues isolated to single batch file
- ✅ Memory-efficient: Don't need to load everything at once

## Using the Graph Data

External tools can load the persisted graph data to enable graph-based retrieval:

```typescript
import { GraphStore } from "embedder/dist/lib/graph-store.js";
import { embed } from "ai";
import { createOpenAI } from "@ai-sdk/openai";

// 1. Load the persisted graph
const graphStore = new GraphStore("./embeddings");

if (!graphStore.hasData()) {
  throw new Error("No graph data found");
}

// 2. Build GraphRAG instance from persisted data
const graphRag = graphStore.buildGraphRAG();

// 3. Generate query embedding
const openai = createOpenAI({
  apiKey: "not-needed",
  baseURL: "http://localhost:1234/v1",
});

const { embedding } = await embed({
  model: openai.embedding("text-embedding-model"),
  value: "how does authentication work?",
});

// 4. Query the graph with random walk traversal
const results = await graphRag.query({
  query: embedding,
  topK: 10,
  randomWalkSteps: 100,
  restartProb: 0.15,
});

// 5. Use results for RAG
results.forEach((node) => {
  console.log(node.content);
  console.log(node.metadata); // { source: "file.ts", chunkIndex: 0, ... }
  console.log(node.score);
});
```

## GraphStore API

### Loading and Building

```typescript
const graphStore = new GraphStore("./embeddings");

// Check if data exists
graphStore.hasData(); // boolean

// Get statistics
graphStore.getStats(); 
// { nodeCount: 1234, updatedAt: 1234567890 }

// Get configuration
graphStore.getConfig(); 
// { dimension: 2560, threshold: 0.7 }

// Build GraphRAG instance
const graphRag = graphStore.buildGraphRAG();
// or with overrides:
const graphRag = graphStore.buildGraphRAG(2560, 0.8);
```

### Accessing Raw Data

```typescript
// Get all chunks
const chunks = graphStore.getChunks();
// Array<{ id, text, source, chunkIndex }>

// Get all embeddings
const embeddings = graphStore.getEmbeddings();
// Array<{ id, embedding: number[] }>
```

## Query Parameters

When querying the GraphRAG instance:

- `query` - Embedding vector (number[])
- `topK` - Number of results to return (default: 10)
- `randomWalkSteps` - Steps for random walk traversal (default: 100)
  - Higher = more exploration, slower
  - Lower = faster, less discovery
- `restartProb` - Probability of restarting from query node (default: 0.15)
  - Higher = stay closer to initial results
  - Lower = explore further relationships

## How GraphRAG Works

1. **During indexing**: 
   - Chunks are embedded and stored
   - Graph edges are created between chunks with similarity > threshold
   - All data is persisted to `graph-data.json`

2. **During querying**:
   - Graph is rebuilt from persisted data
   - Random walk algorithm traverses edges to discover related content
   - Results include both directly similar AND semantically connected chunks

## Example: RAG Workflow

```typescript
async function answerQuestion(question: string) {
  // Load graph
  const graphStore = new GraphStore("./embeddings");
  const graphRag = graphStore.buildGraphRAG();
  
  // Generate query embedding
  const openai = createOpenAI({
    baseURL: "http://localhost:1234/v1",
  });
  const { embedding } = await embed({
    model: openai.embedding("text-embedding-model"),
    value: question,
  });
  
  // Get relevant chunks via graph traversal
  const results = await graphRag.query({
    query: embedding,
    topK: 5,
  });
  
  // Build context for LLM
  const context = results.map(r => r.content).join("\n\n");
  
  // Use with your LLM of choice
  const answer = await yourLLM.generate({
    prompt: `Context:\n${context}\n\nQuestion: ${question}\n\nAnswer:`,
  });
  
  return answer;
}
```

## Performance Considerations

### Storage

**Folder-based storage is highly efficient:**
- Chunks stored as JSON batches (1000 chunks per file)
- Embeddings stored as binary (Float32Array format)
- Example for 10k chunks with 2560-dim embeddings:
  - Old approach: ~100MB single JSON file
  - New approach: ~40MB binary embeddings + ~20MB JSON chunks
  - 40% smaller + faster to load

**Batch size (1000 chunks):**
- Each batch file ~2-4MB (manageable size)
- 10k chunks = 10 batch files
- 100k chunks = 100 batch files

### Query Speed

- **Graph rebuild**: Fast, loads batches on demand
- **Partial loading**: Only load batches you need
- **Memory usage**: Load incrementally vs. all-at-once
- **Random walk traversal**: Slower than pure vector search
- **Trade-off**: Better results vs. query speed

### Recommendations

- Use **vector search** (LanceDB) for fast, simple queries
- Use **graph search** when relationships matter
- Consider hybrid: initial vector search → graph refinement
- For very large repos (100k+ chunks), graph rebuild may take a few seconds

## Troubleshooting

### "No graph data found"

Make sure you ran the embedder with `--enable-graph`:

```bash
embedder -d ./repo -o ./embeddings --enable-graph
```

### Graph dimension mismatch

If you change embedding models (different dimensions), rebuild the graph:

```bash
# Clear old graph data
rm -rf ./embeddings/graph-data

# Re-index with new model
embedder -d ./repo -o ./embeddings --enable-graph -m new-model
```

### Graph threshold tuning

- **Higher threshold (0.8-0.9)**: Fewer, stronger connections
- **Lower threshold (0.5-0.6)**: More connections, noisier graph
- **Default (0.7)**: Good balance for most cases

## Reference Files

The `files/` directory contains reference implementations:

- `files/query.ts` - Example standalone query CLI
- `files/example-rag.ts` - Full RAG workflow examples

These are **not** part of the embedder CLI but can be adapted for your use case.
