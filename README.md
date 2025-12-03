# Embedder

A CLI tool to index a git repository by chunking and embedding text files into a LanceDB vector database.

## Features

- **File Discovery**: Scans directories recursively with .gitignore support
- **Smart Filtering**: Skips binary files and respects custom ignore patterns
- **Chunking**: Uses Mastra's recursive chunking strategy for optimal text segmentation
- **Embedding**: Generates embeddings via LM Studio's OpenAI-compatible API
- **Vector Storage**: Stores embeddings in LanceDB for fast similarity search
- **GraphRAG (Optional)**: Build knowledge graphs for relationship-based retrieval
- **Resume Support**: Tracks processed files and skips unchanged content
- **Progress Tracking**: Real-time progress bar with colorized output
- **Error Handling**: Continues processing on errors with detailed warnings

## Installation

```bash
npm install
npm run build
```

Or use directly with tsx:

```bash
npm run dev -- [options]
```

## Usage

```bash
embedder \
  --dir /path/to/repository \
  --output /path/to/lancedb \
  --base-url http://localhost:1234/v1 \
  --model text-embedding-qwen3-embedding-0.6b
```

### Required Options

- `-d, --dir <path>` - Directory to index (the git repository)
- `-o, --output <path>` - Output path for LanceDB database
- `-u, --base-url <url>` - Base URL for LM Studio (e.g., http://localhost:1234/v1)
- `-m, --model <name>` - Embedding model name (e.g., text-embedding-qwen3-embedding-0.6b)

### Optional Options

- `-t, --table-name <name>` - LanceDB table name (default: embeddings)
- `--dimensions <number>` - Embedding dimension size (default: 1024)
- `-i, --ignore <pattern>` - Glob patterns to ignore (can be specified multiple times)
- `-b, --batch-size <number>` - Number of embeddings to process in a batch (default: 10)
- `--enable-graph` - Enable GraphRAG knowledge graph creation (default: false)
- `--graph-threshold <number>` - Similarity threshold for graph edges, 0.0-1.0 (default: 0.7)

## Example

```bash
# Index the current directory with custom settings
embedder \
  -d . \
  -o ./embeddings \
  -u http://localhost:1234/v1 \
  -m text-embedding-qwen3-embedding-0.6b \
  -t my_embeddings \
  --dimensions 768 \
  -i "*.test.ts" \
  -i "*.spec.ts" \
  -b 20

# With GraphRAG enabled for relationship-based retrieval
embedder \
  -d . \
  -o ./embeddings \
  -u http://localhost:1234/v1 \
  -m text-embedding-qwen3-embedding-0.6b \
  --enable-graph \
  --graph-threshold 0.7
```

## How It Works

1. **Discovery**: Scans the specified directory for text files, respecting .gitignore rules
2. **Filtering**: Skips binary files, images, and files matching ignore patterns
3. **Resume Check**: Compares content hashes to skip already-processed files
4. **Smart Chunking**: Uses appropriate strategy based on file type:
   - **Markdown (.md, .mdx)**: semantic-markdown strategy for better structure understanding
   - **HTML (.html, .htm)**: HTML strategy preserving document structure
   - **JSON (.json)**: JSON-aware chunking
   - **Other files**: Recursive strategy with 512-char chunks, 50-char overlap
5. **Embedding**: Generates embeddings using the specified model via LM Studio
6. **Storage**: Stores embeddings and metadata in LanceDB with configurable table name and dimensions
7. **State Tracking**: Saves progress in `.embedder-state.json` in the output directory

## State File

The tool creates a `.embedder-state.json` file in the output directory to track:
- Processed file paths
- Content hashes
- Number of chunks per file
- Processing timestamps

This enables resume functionality - on subsequent runs, only new or modified files are processed.

## Output

The tool displays:
- Initialization status
- File discovery results
- Real-time progress bar
- Summary with statistics:
  - Files processed
  - Files skipped (unchanged)
  - Total chunks created
  - Knowledge graph nodes and edges (if GraphRAG enabled)
  - Errors and warnings

### Output Files

- **LanceDB database** - Vector embeddings stored in the output directory
- **`.embedder-state.json`** - Processing state for resume functionality
- **`graph-data/`** - Persisted knowledge graph (if `--enable-graph` is used)
  - Folder-based storage with batched chunks and binary embeddings
  - Scalable for large repositories

## GraphRAG

When `--enable-graph` is enabled, the tool creates a knowledge graph in addition to the vector store. This enables relationship-based retrieval for RAG applications.

**See [GRAPHRAG.md](./GRAPHRAG.md) for detailed documentation on:**
- How GraphRAG works
- Using the persisted graph data in your applications
- GraphStore API reference
- Example RAG workflows
- Performance considerations

## Error Handling

- **File read errors**: Logged as warnings, processing continues
- **Embedding failures**: Throws exception, processing halts
- **Storage errors**: Throws exception, processing halts
- All warnings are displayed in the final summary

## Requirements

- Node.js 18+
- LM Studio running with an embedding model loaded
- TypeScript 5+

## Development

```bash
# Install dependencies
npm install

# Build
npm run build

# Run in development mode
npm run dev -- --help

# Run built version
npm start -- --help
```

## License

ISC
