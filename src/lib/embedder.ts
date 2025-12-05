import { MDocument } from "@mastra/rag";
import { embedMany } from "ai";
import { createOpenAI } from "@ai-sdk/openai";
import { LanceVectorStore } from "@mastra/lance";
import type { EmbedderOptions, ProcessingStats, GraphChunkData } from "../types/index.js";
import { FileDiscovery } from "./file-discovery.js";
import { StateManager } from "./state-manager.js";
import { GraphStore } from "./graph-store.js";
import { isGitRepository, getCurrentCommitHash, getChangedFiles, hasUncommittedChanges, getUncommittedChangeCount } from "./git-diff.js";
import cliProgress from "cli-progress";
import chalk from "chalk";
import * as path from "path";
import * as fs from "fs";
import * as crypto from "crypto";

export class Embedder {
  private options: EmbedderOptions;
  private fileDiscovery: FileDiscovery;
  private stateManager: StateManager;
  private graphStore: GraphStore | null = null;
  private vectorStore: LanceVectorStore | null = null;
  private openaiProvider: ReturnType<typeof createOpenAI>;
  private tableExists: boolean = false;
  private stats: ProcessingStats = {
    filesProcessed: 0,
    filesSkipped: 0,
    chunksCreated: 0,
    errors: 0,
    warnings: [],
    indexMode: 'full',
    graphNodesCreated: 0,
    graphEdgesCreated: 0,
  };

  constructor(options: EmbedderOptions) {
    this.options = {
      ...options,
      batchSize: options.batchSize || 10,
      enableGraph: options.enableGraph ?? false,
      graphThreshold: options.graphThreshold ?? 0.7,
      mode: options.mode || 'full',
    };

    // Set initial index mode in stats
    this.stats.indexMode = this.options.mode === 'diff' ? 'diff' : 'full';

    this.fileDiscovery = new FileDiscovery(options.dir, options.ignore);
    this.stateManager = new StateManager(options.output);
    
    // Initialize GraphStore if GraphRAG is enabled
    if (this.options.enableGraph) {
      this.graphStore = new GraphStore(options.output);
      this.graphStore.setConfig(
        this.options.dimension,
        this.options.graphThreshold!
      );
    }
    
    // Initialize OpenAI provider once
    this.openaiProvider = createOpenAI({
      apiKey: "not-needed", // LM Studio doesn't require an API key
      baseURL: options.baseUrl,
    });
  }

  private async initVectorStore(): Promise<void> {
    // Ensure output directory exists
    if (!fs.existsSync(this.options.output)) {
      fs.mkdirSync(this.options.output, { recursive: true });
    }

    this.vectorStore = await LanceVectorStore.create(this.options.output);
  }

  private async ensureIndex(): Promise<void> {
    if (!this.vectorStore) {
      throw new Error("Vector store not initialized");
    }

    // Check if table exists before creating index
    const tables = await this.vectorStore.listTables();
    this.tableExists = tables.includes(this.options.tableName);
    
    if (!this.tableExists) {
      // Table doesn't exist yet - it will be created on first upsert
      // No need to create index yet
      return;
    }

    // Table exists, ensure it has an index for better query performance
    try {
      await this.vectorStore.createIndex({
        tableName: this.options.tableName,
        indexName: "vector", // indexName is the column name in LanceDB
        dimension: this.options.dimension,
      });
    } catch (error) {
      // Index might already exist or other non-critical error
      // Silently continue - index creation is optional for performance
    }
  }

  private getFileType(filePath: string): "markdown" | "html" | "json" | "text" {
    const ext = path.extname(filePath).toLowerCase();
    
    // Markdown files
    if (ext === ".md" || ext === ".markdown" || ext === ".mdx") {
      return "markdown";
    }
    
    // HTML files
    if (ext === ".html" || ext === ".htm") {
      return "html";
    }
    
    // JSON files
    if (ext === ".json") {
      return "json";
    }
    
    // Everything else as text
    return "text";
  }

  private async chunkDocument(content: string, filePath: string): Promise<any[]> {
    const fileType = this.getFileType(filePath);
    let doc: MDocument;
    
    // Create document based on file type
    switch (fileType) {
      case "markdown":
        doc = MDocument.fromMarkdown(content, { source: filePath });
        break;
      case "html":
        doc = MDocument.fromHTML(content, { source: filePath });
        break;
      case "json":
        doc = MDocument.fromJSON(content, { source: filePath });
        break;
      default:
        doc = MDocument.fromText(content, { source: filePath });
    }

    // Use appropriate chunking strategy based on file type
    switch (fileType) {
      case "markdown":
        // Use semantic-markdown for better understanding of markdown structure
        return await doc.chunk({
          strategy: "semantic-markdown",
          joinThreshold: 500,
        });
      
      case "html":
        // Use HTML strategy to preserve structure
        return await doc.chunk({
          strategy: "html",
          sections: [
            ["section", "section"],
            ["article", "article"],
            ["div", "div"],
          ],
        });
      
      case "json":
        // Use JSON strategy
        return await doc.chunk({
          strategy: "json",
          maxSize: 512,
        });
      
      default:
        // Use recursive for text files (code, etc.)
        return await doc.chunk({
          strategy: "recursive",
          maxSize: 512,
          overlap: 50,
        });
    }
  }

  private async processFile(
    filePath: string,
    progressBar: cliProgress.SingleBar
  ): Promise<void> {
    // Intercept console output during processing to avoid interfering with progress bar
    const originalWarn = console.warn;
    const originalLog = console.log;
    const capturedWarnings: string[] = [];
    console.warn = (...args: any[]) => {
      capturedWarnings.push(args.join(' '));
    };
    console.log = (...args: any[]) => {
      // Also intercept console.log to catch chunking warnings
      const msg = args.join(' ');
      if (msg.includes('chunk of size')) {
        capturedWarnings.push(msg);
      }
    };

    try {
      // File read errors should be logged as warnings and continue
      let content: string;
      try {
        content = this.fileDiscovery.readFileContent(filePath);
      } catch (error) {
        this.stats.warnings.push(
          `Cannot read ${filePath}: ${error instanceof Error ? error.message : String(error)}`
        );
        progressBar.increment();
        return;
      }

      // Check if file needs processing
      if (!this.stateManager.needsProcessing(filePath, content)) {
        this.stats.filesSkipped++;
        progressBar.increment();
        return;
      }

      // Chunk the document - catch errors and continue
      let chunks;
      try {
        chunks = await this.chunkDocument(content, filePath);
      } catch (error) {
        // Log chunking errors as warnings and skip the file
        this.stats.warnings.push(
          `Failed to chunk ${filePath}: ${error instanceof Error ? error.message : String(error)}`
        );
        this.stats.errors++;
        progressBar.increment();
        return;
      }

      if (chunks.length === 0) {
        this.stats.warnings.push(`No chunks generated for ${filePath}`);
        progressBar.increment();
        return;
      }

      // Generate embeddings - throws on failure
      const model = this.openaiProvider.embedding(this.options.model);

      const { embeddings } = await embedMany({
        model,
        values: chunks.map((chunk) => chunk.text),
      });

      // Store embeddings in LanceDB - throws on failure
      if (!this.vectorStore) {
        throw new Error("Vector store not initialized");
      }

      // Delete existing vectors for this file path before inserting new ones
      await this.deleteExistingVectors(filePath);

      // Store chunks and embeddings in GraphStore for persistence
      if (this.options.enableGraph && this.graphStore) {
        // Only remove old chunks if this file already has chunks
        // This avoids expensive lookups for new files
        if (this.graphStore.hasChunksForSource(filePath)) {
          this.graphStore.removeChunksBySource(filePath);
        }
        
        chunks.forEach((chunk, i) => {
          const chunkId = crypto.randomUUID();
          const chunkData: GraphChunkData = {
            id: chunkId,
            text: chunk.text,
            source: filePath,
            chunkIndex: i,
          };
          this.graphStore!.addChunk(chunkData, embeddings[i]!);
        });
      }

      // If table doesn't exist, create it with first batch of data
      if (!this.tableExists) {
        const initialData = embeddings.map((vector, i) => ({
          id: crypto.randomUUID(),
          vector,
          metadata_text: chunks[i].text,
          metadata_source: filePath,
        }));

        await this.vectorStore.createTable(this.options.tableName, initialData);
        this.tableExists = true;
      } else {
        // Table exists, use regular upsert
        await this.vectorStore.upsert({
          tableName: this.options.tableName,
          indexName: "vector", // Column name where vectors are stored
          vectors: embeddings,
          metadata: chunks.map((chunk) => ({
            text: chunk.text,
            source: filePath,
          })),
        });
      }

      // Mark as processed
      this.stateManager.markProcessed(filePath, content, chunks.length);
      this.stats.filesProcessed++;
      this.stats.chunksCreated += chunks.length;

      // Add any captured warnings to stats (suppress duplicates from chunking library)
      if (capturedWarnings.length > 0) {
        // Only add unique warnings about chunk size issues
        const chunkWarnings = capturedWarnings.filter(w => w.includes('chunk of size'));
        if (chunkWarnings.length > 0 && !this.stats.warnings.some(w => w.includes('Chunk size exceeded'))) {
          this.stats.warnings.push(`Chunk size exceeded in some files (this is usually fine)`);
        }
      }

      progressBar.increment();
    } catch (error) {
      // Catch any unexpected errors during processing and continue
      this.stats.errors++;
      this.stats.warnings.push(
        `Error processing ${filePath}: ${error instanceof Error ? error.message : String(error)}`
      );
      progressBar.increment();
    } finally {
      // Restore original console methods
      console.warn = originalWarn;
      console.log = originalLog;
    }
  }

  private async deleteExistingVectors(filePath: string): Promise<void> {
    if (!this.vectorStore) {
      return;
    }

    // Check if table exists before trying to delete vectors
    if (!this.tableExists) {
      // Table doesn't exist yet - nothing to delete
      return;
    }

    try {
      // Delete all vectors matching this source file path using filter
      // This is more efficient than querying first then deleting each individually
      await this.vectorStore.deleteVectors({
        indexName: this.options.tableName, // In deleteVectors, indexName refers to the table name
        filter: { source: filePath },
      });
    } catch (error) {
      // Silently continue - this is expected if table doesn't exist yet or filter doesn't match
      // Only track critical errors that affect data integrity
    }
  }

  private async processBatch(
    files: string[],
    progressBar: cliProgress.SingleBar
  ): Promise<void> {
    const batchSize = this.options.batchSize!;

    for (let i = 0; i < files.length; i += batchSize) {
      const batch = files.slice(i, i + batchSize);
      await Promise.all(
        batch.map((file) => this.processFile(file, progressBar))
      );
      
      // Save state after each batch to allow resuming
      this.stateManager.saveState();
      
      // Save graph data periodically (every 10 batches) to reduce I/O
      // Final save happens at the end in buildKnowledgeGraph()
      if (this.options.enableGraph && this.graphStore && i % (batchSize * 10) === 0) {
        this.graphStore.save();
      }
    }
  }

  private buildKnowledgeGraph(): void {
    if (!this.options.enableGraph || !this.graphStore || !this.graphStore.hasData()) {
      return;
    }

    console.log(chalk.cyan("\nBuilding knowledge graph from persisted data..."));

    // Save graph data
    this.graphStore.save();

    // Update stats
    const stats = this.graphStore.getStats();
    this.stats.graphNodesCreated = stats.nodeCount;
    // Edges are created based on similarity threshold - estimate
    this.stats.graphEdgesCreated = Math.floor(stats.nodeCount * 0.3);

    // Update state with graph metadata
    this.stateManager.updateGraphMetadata(
      this.stats.graphNodesCreated || 0,
      this.stats.graphEdgesCreated || 0
    );

    console.log(chalk.green(`✓ Knowledge graph built with ${stats.nodeCount} nodes`));
    console.log(chalk.gray(`  Graph data saved to: ${this.options.output}/graph-data.json`));
  }

  public async run(): Promise<void> {
    const mode = this.options.mode || 'full';
    
    switch (mode) {
      case 'full':
        await this.runFull();
        break;
      case 'diff':
        await this.runDiff();
        break;
      case 'intelligent':
        await this.runIntelligent();
        break;
      default:
        throw new Error(`Invalid mode: ${mode}. Valid modes: full, diff, intelligent`);
    }
  }

  private async runFull(): Promise<void> {
    console.log(chalk.blue.bold("\nEmbedder - Repository Indexer" + 
      (this.options.enableGraph ? " (GraphRAG Enhanced)" : "") + "\n"));
    console.log(chalk.gray(`Directory: ${this.options.dir}`));
    console.log(chalk.gray(`Output: ${this.options.output}`));
    console.log(chalk.gray(`Table: ${this.options.tableName}`));
    console.log(chalk.gray(`Dimension: ${this.options.dimension}`));
    console.log(chalk.gray(`Model: ${this.options.model}`));
    console.log(chalk.gray(`Base URL: ${this.options.baseUrl}`));
    if (this.options.enableGraph) {
      console.log(chalk.gray(`GraphRAG: enabled`));
      console.log(chalk.gray(`Graph Threshold: ${this.options.graphThreshold}`));
    }
    console.log();

    // Initialize vector store
    console.log(chalk.cyan("Initializing vector store..."));
    await this.initVectorStore();
    await this.ensureIndex();

    // Discover files
    console.log(chalk.cyan("Discovering files..."));
    const files = this.fileDiscovery.discoverFiles();
    console.log(chalk.green(`Found ${files.length} text files\n`));

    if (files.length === 0) {
      console.log(chalk.yellow("No files to process"));
      return;
    }

    // Create progress bar
    const progressBar = new cliProgress.SingleBar(
      {
        format:
          chalk.cyan("{bar}") +
          " | {percentage}% | {value}/{total} files | ETA: {eta}s",
        barCompleteChar: "\u2588",
        barIncompleteChar: "\u2591",
        hideCursor: true,
      },
      cliProgress.Presets.shades_classic
    );

    progressBar.start(files.length, 0);

    // Process files in batches
    await this.processBatch(files, progressBar);

    progressBar.stop();

    // Build knowledge graph after all files are processed
    if (this.options.enableGraph) {
      this.buildKnowledgeGraph();
    }

    // Save commit hash if in a git repository
    if (isGitRepository(this.options.dir)) {
      const currentCommit = getCurrentCommitHash(this.options.dir);
      if (currentCommit) {
        this.stateManager.setLastCommitHash(currentCommit);
      }
    }

    // Save state
    this.stateManager.saveState();

    // Print summary
    this.printSummary();
  }

  private async runIntelligent(): Promise<void> {
    // Check if git repository
    if (!isGitRepository(this.options.dir)) {
      console.log(chalk.yellow("Not a git repository, using full indexing mode"));
      return this.runFull();
    }

    // Check if we have a last commit hash
    const lastCommit = this.stateManager.getLastCommitHash();
    if (!lastCommit) {
      console.log(chalk.yellow("No previous commit found, using full indexing mode"));
      return this.runFull();
    }

    // Check if current commit differs
    const currentCommit = getCurrentCommitHash(this.options.dir);
    if (!currentCommit) {
      console.log(chalk.yellow("Cannot determine current commit, using full indexing mode"));
      return this.runFull();
    }

    if (lastCommit === currentCommit) {
      console.log(chalk.green("✓ Already indexed at commit " + currentCommit.substring(0, 7)));
      return;
    }

    // Use diff mode
    console.log(chalk.cyan("Auto-detected changes, using diff mode"));
    return this.runDiff();
  }

  private async runDiff(): Promise<void> {
    // Initialize stats for diff mode
    this.stats.indexMode = 'diff';
    this.stats.filesAdded = 0;
    this.stats.filesModified = 0;
    this.stats.filesDeleted = 0;

    // Validate git repository
    if (!isGitRepository(this.options.dir)) {
      throw new Error(
        `Diff mode requires a git repository\n` +
        `Directory: ${this.options.dir} is not a git repository\n\n` +
        `Suggestions:\n` +
        `  • Use --mode full for non-git directories\n` +
        `  • Initialize git: git init\n` +
        `  • Use --mode intelligent to auto-detect`
      );
    }

    // Get commit range
    const fromCommit = this.options.fromCommit || this.stateManager.getLastCommitHash();
    if (!fromCommit) {
      console.log(chalk.yellow("Warning: No previous commit hash found"));
      console.log(chalk.yellow("Falling back to full indexing mode for initial setup"));
      return this.runFull();
    }

    const toCommit = getCurrentCommitHash(this.options.dir);
    if (!toCommit) {
      throw new Error("Cannot determine current commit hash");
    }

    this.stats.fromCommit = fromCommit;
    this.stats.toCommit = toCommit;

    // Check for uncommitted changes
    if (hasUncommittedChanges(this.options.dir)) {
      const changeCount = getUncommittedChangeCount(this.options.dir);
      console.log(chalk.yellow(`\nWarning: ${changeCount} uncommitted change(s) detected`));
      console.log(chalk.yellow("Diff mode only indexes committed changes"));
      console.log(chalk.gray("Run 'git status' for details\n"));
    }

    // Get changed files
    const diff = getChangedFiles(this.options.dir, fromCommit, toCommit);

    // Print header
    console.log(chalk.blue.bold("\nDiff-based Indexing" + 
      (this.options.enableGraph ? " (GraphRAG Enhanced)" : "") + "\n"));
    console.log(chalk.gray(`From commit: ${fromCommit.substring(0, 7)}`));
    console.log(chalk.gray(`To commit:   ${toCommit.substring(0, 7)}`));
    console.log(chalk.gray(`Directory:   ${this.options.dir}`));
    console.log(chalk.gray(`Output:      ${this.options.output}`));

    // Print change summary
    const totalChanges = diff.added.length + diff.modified.length + 
                         diff.deleted.length + diff.renamed.length;
    
    if (totalChanges === 0) {
      console.log(chalk.green("\n✓ No changes detected, index is up to date"));
      return;
    }

    console.log(chalk.cyan(`\nChanges detected:`));
    if (diff.added.length > 0) {
      console.log(chalk.green(`  + ${diff.added.length} file(s) added`));
    }
    if (diff.modified.length > 0) {
      console.log(chalk.yellow(`  ~ ${diff.modified.length} file(s) modified`));
    }
    if (diff.deleted.length > 0) {
      console.log(chalk.red(`  - ${diff.deleted.length} file(s) deleted`));
    }
    if (diff.renamed.length > 0) {
      console.log(chalk.blue(`  ↔ ${diff.renamed.length} file(s) renamed`));
    }
    console.log();

    // Initialize vector store
    console.log(chalk.cyan("Initializing vector store..."));
    await this.initVectorStore();
    await this.ensureIndex();

    // Process added and modified files
    const filesToProcess = [...diff.added, ...diff.modified];
    
    if (filesToProcess.length > 0) {
      console.log(chalk.cyan(`Processing ${filesToProcess.length} changed file(s)...\n`));

      const progressBar = new cliProgress.SingleBar({
        format: chalk.cyan("{bar}") + " | {percentage}% | {value}/{total} files | ETA: {eta}s",
        barCompleteChar: "\u2588",
        barIncompleteChar: "\u2591",
        hideCursor: true,
      }, cliProgress.Presets.shades_classic);

      progressBar.start(filesToProcess.length, 0);
      await this.processBatch(filesToProcess, progressBar);
      progressBar.stop();

      this.stats.filesAdded = diff.added.length;
      this.stats.filesModified = diff.modified.length;
    }

    // Handle renamed files (treat as delete + add)
    if (diff.renamed.length > 0) {
      console.log(chalk.cyan(`\nProcessing ${diff.renamed.length} renamed file(s)...`));
      
      // Delete old paths
      for (const {from, to} of diff.renamed) {
        await this.deleteFileVectors([from]);
        this.stateManager.removeFile(from);
        if (this.graphStore) {
          this.graphStore.removeChunksBySource(from);
        }
      }
      
      // Process new paths
      const renamedToPaths = diff.renamed.map(r => r.to);
      if (renamedToPaths.length > 0) {
        const progressBar = new cliProgress.SingleBar({
          format: chalk.cyan("{bar}") + " | {percentage}% | {value}/{total} files | ETA: {eta}s",
          barCompleteChar: "\u2588",
          barIncompleteChar: "\u2591",
          hideCursor: true,
        }, cliProgress.Presets.shades_classic);

        progressBar.start(renamedToPaths.length, 0);
        await this.processBatch(renamedToPaths, progressBar);
        progressBar.stop();
      }
    }

    // Delete removed files
    if (diff.deleted.length > 0) {
      console.log(chalk.cyan(`\nCleaning up ${diff.deleted.length} deleted file(s)...`));
      await this.deleteFileVectors(diff.deleted);
      
      // Remove from state
      for (const filePath of diff.deleted) {
        this.stateManager.removeFile(filePath);
      }
      
      // Remove from graph store
      if (this.graphStore) {
        for (const filePath of diff.deleted) {
          this.graphStore.removeChunksBySource(filePath);
        }
      }
      
      this.stats.filesDeleted = diff.deleted.length;
      console.log(chalk.green(`✓ Deleted vectors for ${diff.deleted.length} file(s)`));
    }

    // Build knowledge graph if enabled
    if (this.options.enableGraph) {
      this.buildKnowledgeGraph();
    }

    // Update state with new commit hash (ONLY after everything succeeds)
    this.stateManager.setLastCommitHash(toCommit);
    this.stateManager.saveState();

    // Print summary
    this.printSummary();
  }

  private async deleteFileVectors(filePaths: string[]): Promise<void> {
    if (!this.vectorStore || filePaths.length === 0) {
      return;
    }

    if (!this.tableExists) {
      return; // Nothing to delete if table doesn't exist
    }

    try {
      for (const filePath of filePaths) {
        await this.vectorStore.deleteVectors({
          indexName: this.options.tableName,
          filter: { source: filePath },
        });
      }
    } catch (error) {
      // Log warning but continue (deletion is best-effort)
      console.warn(chalk.yellow(`Warning: Failed to delete some vectors: ${error instanceof Error ? error.message : String(error)}`));
    }
  }

  private printSummary(): void {
    console.log(chalk.blue.bold("\n\nSummary:\n"));
    
    if (this.stats.indexMode === 'diff') {
      console.log(chalk.cyan(`Mode: Diff (${this.stats.fromCommit?.substring(0, 7)} → ${this.stats.toCommit?.substring(0, 7)})`));
      if (this.stats.filesAdded) {
        console.log(chalk.green(`✓ Files added: ${this.stats.filesAdded}`));
      }
      if (this.stats.filesModified) {
        console.log(chalk.yellow(`✓ Files modified: ${this.stats.filesModified}`));
      }
      if (this.stats.filesDeleted) {
        console.log(chalk.red(`✓ Files deleted: ${this.stats.filesDeleted}`));
      }
    } else {
      console.log(chalk.cyan(`Mode: Full indexing`));
      console.log(chalk.green(`✓ Files processed: ${this.stats.filesProcessed}`));
      console.log(chalk.gray(`- Files skipped: ${this.stats.filesSkipped}`));
    }
    
    console.log(chalk.cyan(`- Chunks created: ${this.stats.chunksCreated}`));

    if (this.options.enableGraph && this.stats.graphNodesCreated) {
      console.log(chalk.magenta(`\nKnowledge Graph:`));
      console.log(chalk.magenta(`  - Nodes: ${this.stats.graphNodesCreated}`));
      console.log(chalk.magenta(`  - Edges: ~${this.stats.graphEdgesCreated} (estimated)`));
    }

    if (this.stats.errors > 0) {
      console.log(chalk.red(`✗ Errors: ${this.stats.errors}`));
    }

    if (this.stats.warnings.length > 0) {
      console.log(chalk.yellow(`\nWarnings:`));
      this.stats.warnings.forEach((warning) => {
        console.log(chalk.yellow(`  - ${warning}`));
      });
    }

    console.log();
  }
}
