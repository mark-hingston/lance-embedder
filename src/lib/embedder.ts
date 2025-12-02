import { MDocument } from "@mastra/rag";
import { embedMany } from "ai";
import { createOpenAI } from "@ai-sdk/openai";
import { LanceVectorStore } from "@mastra/lance";
import type { EmbedderOptions, ProcessingStats } from "../types/index.js";
import { FileDiscovery } from "./file-discovery.js";
import { StateManager } from "./state-manager.js";
import cliProgress from "cli-progress";
import chalk from "chalk";
import * as path from "path";
import * as fs from "fs";
import * as crypto from "crypto";

export class Embedder {
  private options: EmbedderOptions;
  private fileDiscovery: FileDiscovery;
  private stateManager: StateManager;
  private vectorStore: LanceVectorStore | null = null;
  private openaiProvider: ReturnType<typeof createOpenAI>;
  private tableExists: boolean = false;
  private stats: ProcessingStats = {
    filesProcessed: 0,
    filesSkipped: 0,
    chunksCreated: 0,
    errors: 0,
    warnings: [],
  };

  constructor(options: EmbedderOptions) {
    this.options = {
      ...options,
      batchSize: options.batchSize || 10,
    };

    this.fileDiscovery = new FileDiscovery(options.dir, options.ignore);
    this.stateManager = new StateManager(options.output);
    
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

    // Chunk the document
    const chunks = await this.chunkDocument(content, filePath);

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

    progressBar.increment();
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
    }
  }

  public async run(): Promise<void> {
    console.log(chalk.blue.bold("\nEmbedder - Repository Indexer\n"));
    console.log(chalk.gray(`Directory: ${this.options.dir}`));
    console.log(chalk.gray(`Output: ${this.options.output}`));
    console.log(chalk.gray(`Table: ${this.options.tableName}`));
    console.log(chalk.gray(`Dimension: ${this.options.dimension}`));
    console.log(chalk.gray(`Model: ${this.options.model}`));
    console.log(chalk.gray(`Base URL: ${this.options.baseUrl}\n`));

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

    // Save state
    this.stateManager.saveState();

    // Print summary
    this.printSummary();
  }

  private printSummary(): void {
    console.log(chalk.blue.bold("\n\nSummary:\n"));
    console.log(chalk.green(`✓ Files processed: ${this.stats.filesProcessed}`));
    console.log(chalk.gray(`- Files skipped: ${this.stats.filesSkipped}`));
    console.log(chalk.cyan(`- Chunks created: ${this.stats.chunksCreated}`));

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
