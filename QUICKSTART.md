# Quick Start Guide

## Setup (First Time Only)

### 1. Install Dependencies

```bash
npm install
```

### 2. Build the Project

```bash
npm run build
```

### 3. Set Up LM Studio

1. Download and install [LM Studio](https://lmstudio.ai/)
2. Load an embedding model (recommended: `text-embedding-qwen3-embedding-4b`)
3. Start the local server (usually `http://localhost:1234`)

## Basic Usage

### Index Your First Repository

```bash
node dist/index.js \
  --dir /path/to/your/repo \
  --output ./embeddings \
  --base-url http://localhost:1234/v1 \
  --model text-embedding-qwen3-embedding-4b
```

### Using Short Options

```bash
node dist/index.js \
  -d /path/to/your/repo \
  -o ./embeddings \
  -u http://localhost:1234/v1 \
  -m text-embedding-qwen3-embedding-4b
```

## Common Use Cases

### 1. Index Current Directory

```bash
node dist/index.js -d . -o ./embeddings -u http://localhost:1234/v1 -m text-embedding-qwen3-embedding-4b
```

### 2. Ignore Test Files

```bash
node dist/index.js \
  -d . \
  -o ./embeddings \
  -u http://localhost:1234/v1 \
  -m text-embedding-qwen3-embedding-4b \
  -i "*.test.ts" \
  -i "*.spec.ts"
```

### 3. Custom Table and Faster Processing

```bash
node dist/index.js \
  -d . \
  -o ./embeddings \
  -u http://localhost:1234/v1 \
  -m text-embedding-qwen3-embedding-4b \
  -t my_project \
  -b 20
```

## Development Workflow

### Run Without Building

```bash
npm run dev -- -d . -o ./embeddings -u http://localhost:1234/v1 -m text-embedding-qwen3-embedding-4b
```

### After Making Changes

```bash
npm run build
```

## What Happens When You Run It?

1. **Initialization**: Sets up LanceDB vector store with specified table and dimensions
2. **Discovery**: Scans for text files (respects .gitignore)
3. **Processing**: 
   - Detects file type (markdown, HTML, JSON, or text)
   - Applies smart chunking strategy per file type
   - Generates embeddings via LM Studio
   - Stores in LanceDB with metadata
4. **State Saving**: Records processed files for resume support

## Expected Output

```
Embedder - Repository Indexer

Directory: /path/to/repo
Output: ./embeddings
Table: embeddings
Dimension: 2560
Model: text-embedding-qwen3-embedding-4b
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

Run the same command again to:
- Skip unchanged files ✓
- Re-process modified files ✓
- Process new files ✓

State is saved in `<output-dir>/.embedder-state.json`

## Tips

1. **First run is slow**: Subsequent runs are much faster (only processes changes)
2. **Match dimensions**: Set `--dimensions` to match your model's output size
3. **File type detection**: Markdown, HTML, and JSON files use specialized chunking strategies
4. **Batch size**: Increase `-b` for faster processing (uses more memory)
5. **Ignore patterns**: Use multiple `-i` flags to skip unnecessary files
6. **LM Studio**: Make sure the server is running before starting

## Troubleshooting

| Problem | Solution |
|---------|----------|
| `ECONNREFUSED` | Start LM Studio server |
| Model not found | Check model name in LM Studio |
| Out of memory | Reduce batch size (`-b 5`) |
| Permission denied | Check file/directory permissions |

## Next Steps

- See [EXAMPLE.md](./EXAMPLE.md) for more usage examples
- See [ARCHITECTURE.md](./ARCHITECTURE.md) for implementation details
- See [README.md](./README.md) for complete documentation

## Quick Reference

```bash
# Show help
node dist/index.js --help

# Show version
node dist/index.js --version

# Development mode
npm run dev -- [options]
```
