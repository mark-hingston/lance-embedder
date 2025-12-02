# Embedder - Project Structure

## Overview

A TypeScript CLI tool that indexes git repositories by chunking and embedding text files into LanceDB.

## Project Structure

```
embedder/
├── src/
│   ├── index.ts                 # CLI entry point
│   ├── types/
│   │   └── index.ts            # TypeScript type definitions
│   └── lib/
│       ├── embedder.ts         # Main embedder orchestration
│       ├── file-discovery.ts   # File scanning and filtering
│       └── state-manager.ts    # Progress tracking and resume
├── dist/                        # Compiled JavaScript output
├── package.json
├── tsconfig.json
├── README.md                    # Main documentation
├── EXAMPLE.md                   # Usage examples
└── .gitignore
```

## Key Components

### 1. File Discovery (`src/lib/file-discovery.ts`)
- Scans directories recursively
- Respects .gitignore rules
- Filters out binary files
- Supports additional ignore patterns
- Detects text files automatically

### 2. State Manager (`src/lib/state-manager.ts`)
- Tracks processed files with SHA-256 hashes
- Enables resume functionality
- Stores state in `.embedder-state.json`
- Skips unchanged files on subsequent runs

### 3. Embedder (`src/lib/embedder.ts`)
- Orchestrates the entire indexing process
- Uses Mastra for document chunking
- Generates embeddings via LM Studio
- Stores vectors in LanceDB
- Shows progress with colored output
- Handles errors gracefully

### 4. CLI Interface (`src/index.ts`)
- Built with Commander.js
- Validates required options
- Supports multiple ignore patterns
- Configurable batch size

## Data Flow

```
1. File Discovery
   └─> Scan directory with .gitignore support
       └─> Filter text files

2. Resume Check
   └─> Load state file
       └─> Compare content hashes
           └─> Skip unchanged files

3. Processing
   └─> Read file content
       └─> Detect file type (.md, .html, .json, other)
           └─> Apply appropriate chunking strategy
               └─> Generate embeddings (via LM Studio)
                   └─> Store in LanceDB

4. State Update
   └─> Save file hash and metadata
       └─> Update state file
```

## Configuration

### Chunking Strategies

File-type specific strategies are automatically selected:

- **Markdown (.md, .mdx)**: 
  - Strategy: semantic-markdown
  - Join Threshold: 500 tokens
  - Preserves semantic relationships between sections
  
- **HTML (.html, .htm)**:
  - Strategy: html
  - Sections: section, article, div
  - Preserves HTML document structure
  
- **JSON (.json)**:
  - Strategy: json
  - Max Size: 512 characters
  - JSON structure-aware
  
- **Other (code, text files)**:
  - Strategy: recursive
  - Max Size: 512 characters
  - Overlap: 50 characters
  - Smart splitting on separators

### Batch Processing
- Default: 10 files in parallel
- Configurable via `--batch-size`

### Vector Storage
- **Database**: LanceDB
- **Table**: Configurable via `--table-name` (default: embeddings)
- **Index**: default
- **Dimension**: Configurable via `--dimensions` (default: 2560)
  - Common dimensions: 384, 768, 1024, 1536, 2560, 3072
  - Must match your embedding model's output dimension

## Metadata Stored

Each chunk includes:
- `text`: Original chunk content
- `source`: File path
- Additional metadata from chunking process

## State File Format

```json
{
  "files": {
    "/path/to/file.ts": {
      "path": "/path/to/file.ts",
      "hash": "sha256-hash",
      "chunks": 5,
      "timestamp": 1234567890
    }
  },
  "lastUpdated": 1234567890
}
```

## Error Handling

- **File read errors**: Warning logged, processing continues
- **Embedding failures**: Throws exception, processing halts
- **Storage errors**: Throws exception, processing halts
- All warnings displayed in final summary

## Performance Considerations

1. **Batch Processing**: Processes files in configurable batches
2. **Resume Support**: Skips unchanged files
3. **Progress Tracking**: Real-time progress bar
4. **Parallel Processing**: Batches processed concurrently

## Dependencies

### Core
- `@mastra/rag`: Document chunking
- `@mastra/lance`: LanceDB vector storage
- `@ai-sdk/openai`: OpenAI SDK for embeddings
- `ai`: AI SDK core

### CLI & UX
- `commander`: CLI argument parsing
- `cli-progress`: Progress bar
- `chalk`: Colored terminal output
- `ignore`: .gitignore parsing

### Utilities
- `crypto`: SHA-256 hashing (built-in)
- `fs`/`path`: File system operations (built-in)

## Build Process

```bash
# TypeScript compilation
tsc

# Output: dist/ directory with:
# - Compiled JavaScript (.js)
# - Type definitions (.d.ts)
# - Source maps (.js.map)
```

## Environment

- **Node.js**: 18+
- **TypeScript**: 5+
- **Module System**: ES Modules
- **Target**: ES2020
