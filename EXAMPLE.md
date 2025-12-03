# Example Usage

## Prerequisites

1. Install and run LM Studio
2. Load an embedding model in LM Studio (recommended: `text-embedding-qwen3-embedding-0.6b`)
3. Start the local server in LM Studio (usually runs on `http://localhost:1234`)

## Basic Usage

```bash
# Build the project
npm run build

# Index a repository
node dist/index.js \
  --dir /path/to/your/repository \
  --output ./my-embeddings \
  --base-url http://localhost:1234/v1 \
  --model text-embedding-qwen3-embedding-0.6b
```

## Development Mode

```bash
# Run without building
npm run dev -- \
  --dir /path/to/your/repository \
  --output ./my-embeddings \
  --base-url http://localhost:1234/v1 \
  --model text-embedding-qwen3-embedding-0.6b
```

## Advanced Examples

### With Custom Configuration

```bash
node dist/index.js \
  -d ./my-project \
  -o ./embeddings \
  -u http://localhost:1234/v1 \
  -m text-embedding-qwen3-embedding-0.6b \
  -t project_docs \
  --ignore "*.test.ts" \
  --ignore "*.spec.ts" \
  --ignore "**/__tests__/**" \
  --batch-size 20
```

### Index Current Directory

```bash
node dist/index.js \
  -d . \
  -o ./embeddings \
  -u http://localhost:1234/v1 \
  -m text-embedding-qwen3-embedding-0.6b
```

## Expected Output

```
Embedder - Repository Indexer

Directory: /path/to/repository
Output: ./embeddings
Table: embeddings
Dimension: 1024
Model: text-embedding-qwen3-embedding-0.6b
Base URL: http://localhost:1234/v1

Initializing vector store...
Discovering files...
Found 47 text files

████████████████████████████████████████ | 100% | 47/47 files | ETA: 0s


Summary:

✓ Files processed: 42
- Files skipped: 5
- Chunks created: 523
```

## Resume Functionality

The tool automatically tracks processed files. If you run it again:
- Unchanged files will be skipped
- Modified files will be re-processed
- New files will be processed

Progress is stored in `<output-dir>/.embedder-state.json`

## Troubleshooting

### Error: Connection refused

Make sure LM Studio is running and the server is started.

### Error: Model not found

Verify the model name matches exactly what's loaded in LM Studio. Check the server logs in LM Studio.

### Warning: No chunks generated

This can happen with:
- Very small files (< 50 characters)
- Empty files
- Files with only whitespace

These warnings are normal and don't indicate a problem.

### Setting the Right Dimension

The `--dimensions` parameter must match your embedding model's output:
- **text-embedding-qwen3-embedding-0.6b**: 1024 dimensions (default)
- **nomic-embed-text-v1.5**: 768 dimensions
- **text-embedding-3-small**: 1536 dimensions
- **text-embedding-3-large**: 3072 dimensions

Check your model's documentation for the correct dimension size.
