import * as fs from "fs";
import * as path from "path";
import { GraphRAG } from "@mastra/rag";
import type {
  GraphChunkData,
} from "../types/index.js";

const GRAPH_DIR = "graph-data";
const CHUNKS_DIR = "chunks";
const EMBEDDINGS_DIR = "embeddings";
const CONFIG_FILE = "config.json";
const INDEX_FILE = "index.json";
const BATCH_SIZE = 1000; // Chunks per batch file
const MAX_CACHED_BATCHES = 5; // Maximum batches to keep in memory (5000 chunks max)

interface GraphConfig {
  version: string;
  dimension: number;
  threshold: number;
  createdAt: number;
  updatedAt: number;
}

interface GraphIndex {
  chunkCount: number;
  batchSize: number;
  lastUpdated: number;
}

interface ChunkBatch {
  chunks: GraphChunkData[];
}

/**
 * GraphStore handles persistence of GraphRAG data using folder-based storage.
 * 
 * Storage structure:
 *   graph-data/
 *     config.json              - Configuration (dimension, threshold)
 *     index.json               - Metadata (chunk count, batch info)
 *     chunks/
 *       batch-0000.json        - Chunks 0-999
 *       batch-0001.json        - Chunks 1000-1999
 *     embeddings/
 *       batch-0000.bin         - Binary embeddings for chunks 0-999
 *       batch-0001.bin         - Binary embeddings for chunks 1000-1999
 * 
 * Benefits:
 * - Scalable: No single massive JSON file
 * - Efficient: Binary format for embeddings
 * - Partial loading: Load only needed batches
 * - Corruption-resistant: Issues isolated to single batch
 */
export class GraphStore {
  private graphDir: string;
  private chunksDir: string;
  private embeddingsDir: string;
  private configPath: string;
  private indexPath: string;
  
  private config: GraphConfig;
  private index: GraphIndex;
  
  // In-memory cache of chunks (loaded on demand)
  private chunksCache: Map<number, GraphChunkData[]> = new Map();
  private embeddingsCache: Map<number, number[][]> = new Map();
  private cacheAccessOrder: number[] = []; // Track LRU for cache eviction

  constructor(outputDir: string) {
    this.graphDir = path.join(outputDir, GRAPH_DIR);
    this.chunksDir = path.join(this.graphDir, CHUNKS_DIR);
    this.embeddingsDir = path.join(this.graphDir, EMBEDDINGS_DIR);
    this.configPath = path.join(this.graphDir, CONFIG_FILE);
    this.indexPath = path.join(this.graphDir, INDEX_FILE);
    
    this.ensureDirectories();
    this.config = this.loadConfig();
    this.index = this.loadIndex();
  }

  private ensureDirectories(): void {
    if (!fs.existsSync(this.graphDir)) {
      fs.mkdirSync(this.graphDir, { recursive: true });
    }
    if (!fs.existsSync(this.chunksDir)) {
      fs.mkdirSync(this.chunksDir, { recursive: true });
    }
    if (!fs.existsSync(this.embeddingsDir)) {
      fs.mkdirSync(this.embeddingsDir, { recursive: true });
    }
  }

  private loadConfig(): GraphConfig {
    if (fs.existsSync(this.configPath)) {
      try {
        const content = fs.readFileSync(this.configPath, "utf-8");
        const config = JSON.parse(content) as GraphConfig;
        
        if (config.version !== "1.0") {
          console.warn(`Graph config version mismatch (${config.version}), creating fresh`);
          return this.createEmptyConfig();
        }
        
        return config;
      } catch (error) {
        console.warn("Failed to load graph config, creating fresh");
        return this.createEmptyConfig();
      }
    }
    return this.createEmptyConfig();
  }

  private createEmptyConfig(): GraphConfig {
    return {
      version: "1.0",
      dimension: 0,
      threshold: 0.7,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
  }

  private loadIndex(): GraphIndex {
    if (fs.existsSync(this.indexPath)) {
      try {
        const content = fs.readFileSync(this.indexPath, "utf-8");
        return JSON.parse(content) as GraphIndex;
      } catch (error) {
        console.warn("Failed to load graph index, creating fresh");
        return this.createEmptyIndex();
      }
    }
    return this.createEmptyIndex();
  }

  private createEmptyIndex(): GraphIndex {
    return {
      chunkCount: 0,
      batchSize: BATCH_SIZE,
      lastUpdated: Date.now(),
    };
  }

  private saveConfig(): void {
    this.config.updatedAt = Date.now();
    fs.writeFileSync(
      this.configPath,
      JSON.stringify(this.config, null, 2),
      "utf-8"
    );
  }

  private saveIndex(): void {
    this.index.lastUpdated = Date.now();
    fs.writeFileSync(
      this.indexPath,
      JSON.stringify(this.index, null, 2),
      "utf-8"
    );
  }

  private getBatchNumber(globalIndex: number): number {
    return Math.floor(globalIndex / BATCH_SIZE);
  }

  private getChunkBatchPath(batchNum: number): string {
    return path.join(this.chunksDir, `batch-${batchNum.toString().padStart(4, "0")}.json`);
  }

  private getEmbeddingBatchPath(batchNum: number): string {
    return path.join(this.embeddingsDir, `batch-${batchNum.toString().padStart(4, "0")}.bin`);
  }

  private loadChunkBatch(batchNum: number): GraphChunkData[] {
    // Always check cache first
    if (this.chunksCache.has(batchNum)) {
      // Return the cached array directly (we'll update cache after modification)
      return this.chunksCache.get(batchNum)!;
    }

    // Load from disk
    const batchPath = this.getChunkBatchPath(batchNum);
    if (!fs.existsSync(batchPath)) {
      return [];
    }

    try {
      const content = fs.readFileSync(batchPath, "utf-8");
      const batch = JSON.parse(content) as ChunkBatch;
      // Don't cache yet - caller will cache after modification
      return batch.chunks;
    } catch (error) {
      console.warn(`Failed to load chunk batch ${batchNum}`);
      return [];
    }
  }

  private saveChunkBatch(batchNum: number, chunks: GraphChunkData[]): void {
    const batchPath = this.getChunkBatchPath(batchNum);
    const batch: ChunkBatch = { chunks };
    
    try {
      const jsonString = JSON.stringify(batch, null, 2);
      fs.writeFileSync(batchPath, jsonString, "utf-8");
      this.chunksCache.set(batchNum, chunks);
    } catch (error) {
      console.error(`Failed to save chunk batch ${batchNum}:`, error);
      throw error;
    }
  }

  private loadEmbeddingBatch(batchNum: number): number[][] {
    // Always check cache first
    if (this.embeddingsCache.has(batchNum)) {
      // Return the cached array directly (we'll update cache after modification)
      return this.embeddingsCache.get(batchNum)!;
    }

    // Load from disk
    const batchPath = this.getEmbeddingBatchPath(batchNum);
    if (!fs.existsSync(batchPath)) {
      return [];
    }

    try {
      const buffer = fs.readFileSync(batchPath);
      const embeddings = this.decodeEmbeddings(buffer, this.config.dimension);
      // Don't cache yet - return the loaded data
      return embeddings;
    } catch (error) {
      console.warn(`Failed to load embedding batch ${batchNum}`);
      return [];
    }
  }

  private saveEmbeddingBatch(batchNum: number, embeddings: number[][]): void {
    const batchPath = this.getEmbeddingBatchPath(batchNum);
    const buffer = this.encodeEmbeddings(embeddings);
    fs.writeFileSync(batchPath, buffer);
    this.embeddingsCache.set(batchNum, embeddings);
  }

  private encodeEmbeddings(embeddings: number[][]): Buffer {
    // Store as: [count: uint32] [embedding1: float32[]] [embedding2: float32[]] ...
    const dimension = this.config.dimension;
    const count = embeddings.length;
    const bufferSize = 4 + (count * dimension * 4); // 4 bytes per float32
    const buffer = Buffer.allocUnsafe(bufferSize);
    
    let offset = 0;
    buffer.writeUInt32LE(count, offset);
    offset += 4;

    for (const embedding of embeddings) {
      for (const value of embedding) {
        buffer.writeFloatLE(value, offset);
        offset += 4;
      }
    }

    return buffer;
  }

  private decodeEmbeddings(buffer: Buffer, dimension: number): number[][] {
    let offset = 0;
    const count = buffer.readUInt32LE(offset);
    offset += 4;

    const embeddings: number[][] = [];
    for (let i = 0; i < count; i++) {
      const embedding: number[] = [];
      for (let j = 0; j < dimension; j++) {
        embedding.push(buffer.readFloatLE(offset));
        offset += 4;
      }
      embeddings.push(embedding);
    }

    return embeddings;
  }

  /**
   * Evict old batches from cache if we exceed MAX_CACHED_BATCHES
   * This prevents memory leaks when processing many files
   */
  private evictOldCaches(keepBatchNum: number): void {
    const totalCached = this.chunksCache.size;
    
    if (totalCached >= MAX_CACHED_BATCHES) {
      // Find batch numbers to evict (all except the one we want to keep)
      const batchNums = Array.from(this.chunksCache.keys()).filter(n => n !== keepBatchNum);
      
      // Evict oldest batches first
      const toEvict = batchNums.slice(0, Math.max(0, totalCached - MAX_CACHED_BATCHES + 1));
      
      for (const batchNum of toEvict) {
        // Flush to disk before evicting
        const chunks = this.chunksCache.get(batchNum);
        const embeddings = this.embeddingsCache.get(batchNum);
        
        if (chunks) {
          this.saveChunkBatch(batchNum, chunks);
        }
        if (embeddings) {
          this.saveEmbeddingBatch(batchNum, embeddings);
        }
        
        // Remove from cache
        this.chunksCache.delete(batchNum);
        this.embeddingsCache.delete(batchNum);
      }
    }
  }

  /**
   * Update configuration (dimension and threshold)
   */
  public setConfig(dimension: number, threshold: number): void {
    this.config.dimension = dimension;
    this.config.threshold = threshold;
    this.saveConfig();
  }

  /**
   * Add a chunk and its embedding to the store.
   * Always appends to the end - caller should call removeChunksBySource() first if updating.
   * Note: Changes are buffered in memory. Call save() to persist to disk.
   */
  public addChunk(chunk: GraphChunkData, embedding: number[]): void {
    const globalIndex = this.index.chunkCount;
    const batchNum = this.getBatchNumber(globalIndex);
    
    // Evict old caches before loading new batch
    this.evictOldCaches(batchNum);
    
    // Get current batch (either from cache or load from disk)
    let chunks = this.loadChunkBatch(batchNum);
    let embeddings = this.loadEmbeddingBatch(batchNum);
    
    // Add new data
    chunks.push(chunk);
    embeddings.push(embedding);
    
    // Update cache with the modified arrays
    this.chunksCache.set(batchNum, chunks);
    this.embeddingsCache.set(batchNum, embeddings);
    
    this.index.chunkCount++;
  }

  /**
   * Remove all chunks from a specific source file
   */
  public removeChunksBySource(source: string): void {
    const totalBatches = Math.ceil(this.index.chunkCount / BATCH_SIZE);
    let removedCount = 0;

    // Collect all chunks that should remain
    const remainingChunks: GraphChunkData[] = [];
    const remainingEmbeddings: number[][] = [];

    for (let batchNum = 0; batchNum < totalBatches; batchNum++) {
      const chunks = this.loadChunkBatch(batchNum);
      const embeddings = this.loadEmbeddingBatch(batchNum);

      for (let i = 0; i < chunks.length; i++) {
        if (chunks[i]!.source !== source) {
          remainingChunks.push(chunks[i]!);
          remainingEmbeddings.push(embeddings[i]!);
        } else {
          removedCount++;
        }
      }
    }

    if (removedCount === 0) {
      return; // Nothing to remove
    }

    // Clear all existing batch files
    for (let batchNum = 0; batchNum < totalBatches; batchNum++) {
      const chunkPath = this.getChunkBatchPath(batchNum);
      const embeddingPath = this.getEmbeddingBatchPath(batchNum);
      if (fs.existsSync(chunkPath)) fs.unlinkSync(chunkPath);
      if (fs.existsSync(embeddingPath)) fs.unlinkSync(embeddingPath);
    }

    // Clear caches
    this.chunksCache.clear();
    this.embeddingsCache.clear();

    // Re-write remaining chunks in new batches
    this.index.chunkCount = remainingChunks.length;
    const newTotalBatches = Math.ceil(remainingChunks.length / BATCH_SIZE);

    for (let batchNum = 0; batchNum < newTotalBatches; batchNum++) {
      const startIdx = batchNum * BATCH_SIZE;
      const endIdx = Math.min(startIdx + BATCH_SIZE, remainingChunks.length);
      
      const batchChunks = remainingChunks.slice(startIdx, endIdx);
      const batchEmbeddings = remainingEmbeddings.slice(startIdx, endIdx);
      
      this.saveChunkBatch(batchNum, batchChunks);
      this.saveEmbeddingBatch(batchNum, batchEmbeddings);
    }

    this.saveIndex();
  }

  /**
   * Save any pending changes (flushes all cached batches to disk)
   */
  public save(): void {
    // Flush all cached batches to disk
    const batchNums = Array.from(this.chunksCache.keys());
    
    for (const batchNum of batchNums) {
      const chunks = this.chunksCache.get(batchNum);
      const embeddings = this.embeddingsCache.get(batchNum);
      
      if (chunks) {
        this.saveChunkBatch(batchNum, chunks);
      }
      if (embeddings) {
        this.saveEmbeddingBatch(batchNum, embeddings);
      }
    }
    
    // Update timestamps and save metadata
    this.saveConfig();
    this.saveIndex();
    
    // Clear caches after save to free memory
    this.chunksCache.clear();
    this.embeddingsCache.clear();
  }

  /**
   * Get statistics about the stored graph data
   */
  public getStats(): { nodeCount: number; updatedAt: number } {
    return {
      nodeCount: this.index.chunkCount,
      updatedAt: this.index.lastUpdated,
    };
  }

  /**
   * Check if there's existing graph data
   */
  public hasData(): boolean {
    return this.index.chunkCount > 0;
  }

  /**
   * Get the stored configuration
   */
  public getConfig(): { dimension: number; threshold: number } {
    return {
      dimension: this.config.dimension,
      threshold: this.config.threshold,
    };
  }

  /**
   * Build a GraphRAG instance from the persisted data
   * 
   * @param dimension - Override dimension (uses stored if not provided)
   * @param threshold - Override threshold (uses stored if not provided)
   */
  public buildGraphRAG(
    dimension?: number,
    threshold?: number
  ): GraphRAG | null {
    if (!this.hasData()) {
      return null;
    }

    const dim = dimension ?? this.config.dimension;
    const thresh = threshold ?? this.config.threshold;

    if (dim === 0) {
      throw new Error("Graph dimension not set");
    }

    const graphRag = new GraphRAG(dim, thresh);

    // Load all chunks and embeddings from batches
    const totalBatches = Math.ceil(this.index.chunkCount / BATCH_SIZE);
    const allChunks: GraphChunkData[] = [];
    const allEmbeddings: number[][] = [];

    for (let batchNum = 0; batchNum < totalBatches; batchNum++) {
      const chunks = this.loadChunkBatch(batchNum);
      const embeddings = this.loadEmbeddingBatch(batchNum);
      allChunks.push(...chunks);
      allEmbeddings.push(...embeddings);
    }

    // Convert to GraphRAG format
    const graphChunks = allChunks.map((chunk) => ({
      text: chunk.text,
      metadata: {
        id: chunk.id,
        source: chunk.source,
        chunkIndex: chunk.chunkIndex,
      },
    }));

    const graphEmbeddings = allEmbeddings.map((emb) => ({
      vector: emb,
    }));

    // Build the graph
    graphRag.createGraph(graphChunks, graphEmbeddings);

    return graphRag;
  }

  /**
   * Get all chunks (loads from all batches)
   */
  public getChunks(): GraphChunkData[] {
    const totalBatches = Math.ceil(this.index.chunkCount / BATCH_SIZE);
    const allChunks: GraphChunkData[] = [];

    for (let batchNum = 0; batchNum < totalBatches; batchNum++) {
      const chunks = this.loadChunkBatch(batchNum);
      allChunks.push(...chunks);
    }

    return allChunks;
  }

  /**
   * Get all embeddings (loads from all batches)
   */
  public getEmbeddings(): number[][] {
    const totalBatches = Math.ceil(this.index.chunkCount / BATCH_SIZE);
    const allEmbeddings: number[][] = [];

    for (let batchNum = 0; batchNum < totalBatches; batchNum++) {
      const embeddings = this.loadEmbeddingBatch(batchNum);
      allEmbeddings.push(...embeddings);
    }

    return allEmbeddings;
  }

  /**
   * Clear all data (useful for full re-index)
   */
  public clear(): void {
    // Remove all batch files
    if (fs.existsSync(this.chunksDir)) {
      const files = fs.readdirSync(this.chunksDir);
      for (const file of files) {
        fs.unlinkSync(path.join(this.chunksDir, file));
      }
    }

    if (fs.existsSync(this.embeddingsDir)) {
      const files = fs.readdirSync(this.embeddingsDir);
      for (const file of files) {
        fs.unlinkSync(path.join(this.embeddingsDir, file));
      }
    }

    // Reset index
    this.index = this.createEmptyIndex();
    this.saveIndex();

    // Clear caches
    this.chunksCache.clear();
    this.embeddingsCache.clear();
  }
}
