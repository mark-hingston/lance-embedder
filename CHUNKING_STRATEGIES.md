# Smart Chunking Strategies

The embedder automatically detects file types and applies optimized chunking strategies for better semantic understanding.

## File Type Detection

| Extension | Type | Strategy |
|-----------|------|----------|
| `.md`, `.markdown`, `.mdx` | Markdown | semantic-markdown |
| `.html`, `.htm` | HTML | html |
| `.json` | JSON | json |
| All others | Text | recursive |

## Strategy Details

### 1. Semantic Markdown (`.md`, `.mdx`)

**Best for:** Documentation, technical writing, README files

**Strategy:** `semantic-markdown`

**Configuration:**
```typescript
{
  strategy: "semantic-markdown",
  joinThreshold: 500
}
```

**How it works:**
- Understands markdown header hierarchy (H1, H2, H3, etc.)
- Groups related sections based on semantic relationships
- Merges smaller sections with parents/siblings when appropriate
- Preserves document structure and context

**Example:**
```markdown
# Main Title
Introduction text...

## Section 1
Content for section 1...

### Subsection 1.1
Detailed content...

## Section 2
Content for section 2...
```

Results in intelligent chunks that keep related headers and content together.

### 2. HTML Structure (`html`, `.htm`)

**Best for:** Web pages, HTML documentation

**Strategy:** `html`

**Configuration:**
```typescript
{
  strategy: "html",
  sections: [
    ["section", "section"],
    ["article", "article"],
    ["div", "div"]
  ]
}
```

**How it works:**
- Respects semantic HTML structure
- Splits on `<section>`, `<article>`, and `<div>` boundaries
- Preserves HTML element relationships
- Maintains document flow

**Example:**
```html
<article>
  <h1>Title</h1>
  <section>
    <h2>Section 1</h2>
    <p>Content...</p>
  </section>
  <section>
    <h2>Section 2</h2>
    <p>Content...</p>
  </section>
</article>
```

Results in chunks that respect HTML semantic structure.

### 3. JSON Structure (`.json`)

**Best for:** API responses, configuration files, data files

**Strategy:** `json`

**Configuration:**
```typescript
{
  strategy: "json",
  maxSize: 512
}
```

**How it works:**
- Understands JSON structure (objects, arrays)
- Splits at natural JSON boundaries
- Attempts to maintain valid JSON fragments
- Respects nested structures

**Example:**
```json
{
  "users": [
    { "id": 1, "name": "Alice", "email": "alice@example.com" },
    { "id": 2, "name": "Bob", "email": "bob@example.com" }
  ],
  "settings": {
    "theme": "dark",
    "notifications": true
  }
}
```

Results in chunks that preserve JSON object boundaries.

### 4. Recursive Text (code, `.txt`, etc.)

**Best for:** Source code, plain text, configuration files

**Strategy:** `recursive`

**Configuration:**
```typescript
{
  strategy: "recursive",
  maxSize: 512,
  overlap: 50
}
```

**How it works:**
- Splits on natural boundaries (double newline, newline, space)
- Tries each separator in order until chunk size is met
- Includes 50-character overlap for context preservation
- Smart splitting that respects code structure

**Example:**
```typescript
function processData(data) {
  const results = [];
  
  for (const item of data) {
    results.push(transform(item));
  }
  
  return results;
}

function transform(item) {
  return { ...item, processed: true };
}
```

Results in chunks that respect function boundaries and maintain context.

## Why Smart Chunking Matters

### Better Semantic Understanding

Different file types have different structures. Using the appropriate chunking strategy:
- **Preserves relationships** between content sections
- **Maintains context** that would be lost with naive splitting
- **Improves retrieval quality** by keeping related content together
- **Respects document structure** (headers, sections, objects)

### Example Comparison

**Naive Character Splitting (Bad):**
```
Chunk 1: "# User Guide\n\n## Install"
Chunk 2: "ation\n\nTo install, run: npm"
Chunk 3: " install embedder\n\n## Usage"
```

**Smart Semantic Markdown (Good):**
```
Chunk 1: "# User Guide"
Chunk 2: "## Installation\n\nTo install, run: npm install embedder"
Chunk 3: "## Usage\n\n[usage content...]"
```

### Retrieval Quality Impact

When searching for "how to install", the smart chunking approach:
- ✅ Returns complete installation instructions
- ✅ Includes relevant headers for context
- ✅ Preserves document structure
- ✅ Maintains semantic coherence

Naive splitting:
- ❌ Returns partial words ("ation")
- ❌ Loses header context
- ❌ Breaks across important boundaries
- ❌ Poor semantic quality

## Customization

If you need different chunking behavior, you can modify the `chunkDocument` method in `src/lib/embedder.ts`:

```typescript
private async chunkDocument(content: string, filePath: string): Promise<any[]> {
  const fileType = this.getFileType(filePath);
  
  // Add custom file type detection
  if (filePath.endsWith('.custom')) {
    const doc = MDocument.fromText(content, { source: filePath });
    return await doc.chunk({
      strategy: "custom-strategy",
      // custom options
    });
  }
  
  // ... existing logic
}
```

## Performance Considerations

| Strategy | Speed | Memory | Quality |
|----------|-------|--------|---------|
| recursive | Fast | Low | Good |
| semantic-markdown | Medium | Medium | Excellent |
| html | Medium | Medium | Excellent |
| json | Fast | Low | Good |

- **semantic-markdown** requires tokenization but provides best results for documentation
- **html** and **json** are structure-aware with minimal overhead
- **recursive** is fastest but may not preserve structure

## Recommended Use Cases

```bash
# Documentation repository (lots of .md files)
embedder -d ./docs -o ./embeddings -u $URL -m $MODEL --dimensions 768

# Web scraping results (HTML files)
embedder -d ./scraped -o ./embeddings -u $URL -m $MODEL --dimensions 768

# API data dumps (JSON files)
embedder -d ./api-data -o ./embeddings -u $URL -m $MODEL --dimensions 768

# Source code repository (mixed files)
embedder -d ./src -o ./embeddings -u $URL -m $MODEL --dimensions 768
```

The tool automatically applies the best strategy for each file!
