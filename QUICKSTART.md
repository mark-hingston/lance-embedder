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
2. Load an embedding model (recommended: `text-embedding-qwen3-embedding-0.6b`)
3. Start the local server (usually `http://localhost:1234`)

## Basic Usage

### Index Your First Repository

```bash
node dist/index.js \
  --dir /path/to/your/repo \
  --output ./embeddings \
  --base-url http://localhost:1234/v1 \
  --model text-embedding-qwen3-embedding-0.6b
```

### Using Short Options

```bash
node dist/index.js \
  -d /path/to/your/repo \
  -o ./embeddings \
  -u http://localhost:1234/v1 \
  -m text-embedding-qwen3-embedding-0.6b
```

## Common Use Cases

### 1. Index Current Directory

```bash
node dist/index.js -d . -o ./embeddings -u http://localhost:1234/v1 -m text-embedding-qwen3-embedding-0.6b
```

### 2. Ignore Test Files

```bash
node dist/index.js \
  -d . \
  -o ./embeddings \
  -u http://localhost:1234/v1 \
  -m text-embedding-qwen3-embedding-0.6b \
  -i "*.test.ts" \
  -i "*.spec.ts"
```

### 3. Custom Table and Faster Processing

```bash
node dist/index.js \
  -d . \
  -o ./embeddings \
  -u http://localhost:1234/v1 \
  -m text-embedding-qwen3-embedding-0.6b \
  -t my_project \
  -b 20
```

## Development Workflow

### Run Without Building

```bash
npm run dev -- -d . -o ./embeddings -u http://localhost:1234/v1 -m text-embedding-qwen3-embedding-0.6b
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

## Incremental Indexing with Diff Mode

For faster updates after the initial index, use **diff mode** to only process files that changed in git:

```bash
node dist/index.js \
  --dir /path/to/your/repo \
  --output ./embeddings \
  --base-url http://localhost:1234/v1 \
  --model text-embedding-qwen3-embedding-0.6b \
  --mode diff
```

**Diff mode features:**
- Only processes files that changed since last index
- Requires a git repository
- Only indexes committed changes (uncommitted files ignored with warning)
- Automatically removes deleted files from index
- Handles renamed files intelligently
- **Much faster** for incremental updates

### Intelligent Mode (Recommended for Automation)

Let the tool auto-detect the best approach:

```bash
node dist/index.js \
  --dir /path/to/your/repo \
  --output ./embeddings \
  --base-url http://localhost:1234/v1 \
  --model text-embedding-qwen3-embedding-0.6b \
  --mode intelligent
```

**Intelligent mode will:**
- Use diff mode if in a git repo with previous index
- Fall back to full mode for first run or non-git repos
- Best for CI/CD pipelines and scheduled jobs

### Indexing Modes

| Mode | Use Case | Requirements |
|------|----------|--------------|
| `full` (default) | Complete re-index, first-time setup | None |
| `diff` | Fast incremental updates | Git repository, previous index |
| `intelligent` | Automatic mode selection | None (auto-detects) |

## Resume Functionality

**Full mode** automatically resumes:
- Skip unchanged files ✓
- Re-process modified files ✓
- Process new files ✓

**Diff mode** uses git:
- Only process committed changes ✓
- Delete removed files from index ✓
- Handle renames automatically ✓

State is saved in `<output-dir>/.embedder-state.json`

## Tips

1. **First run is slow**: Subsequent runs are much faster (only processes changes)
2. **Use intelligent mode**: Add `--mode intelligent` for automatic optimization
3. **Commit before indexing**: Diff mode only indexes committed changes
4. **Match dimensions**: Set `--dimensions` to match your model's output size
5. **File type detection**: Markdown, HTML, and JSON files use specialized chunking strategies
6. **Batch size**: Increase `-b` for faster processing (uses more memory)
7. **Ignore patterns**: Use multiple `-i` flags to skip unnecessary files
8. **LM Studio**: Make sure the server is running before starting

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

# Full indexing (default)
node dist/index.js -d . -o ./embeddings -u http://localhost:1234/v1 -m my-model

# Incremental indexing (diff mode)
node dist/index.js -d . -o ./embeddings -u http://localhost:1234/v1 -m my-model --mode diff

# Intelligent mode (auto-detect)
node dist/index.js -d . -o ./embeddings -u http://localhost:1234/v1 -m my-model --mode intelligent

# Development mode
npm run dev -- [options]
```
