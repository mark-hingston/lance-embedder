export interface EmbedderOptions {
  dir: string;
  output: string;
  baseUrl: string;
  model: string;
  tableName: string;
  dimension: number;
  ignore?: string[];
  batchSize?: number;
  // GraphRAG options
  enableGraph?: boolean;
  graphThreshold?: number;
  // Diff mode options
  mode?: 'full' | 'diff' | 'intelligent';
  fromCommit?: string;
}

export interface ProcessedFile {
  path: string;
  hash: string;
  chunks: number;
  timestamp: number;
}

export interface StateFile {
  files: Record<string, ProcessedFile>;
  lastUpdated: number;
  lastCommitHash?: string;
  // Track graph metadata
  graphMetadata?: {
    nodeCount: number;
    edgeCount: number;
    lastGraphUpdate: number;
  };
}

export interface ProcessingStats {
  filesProcessed: number;
  filesSkipped: number;
  chunksCreated: number;
  errors: number;
  warnings: string[];
  // Diff mode stats
  filesAdded?: number;
  filesModified?: number;
  filesDeleted?: number;
  indexMode: 'full' | 'diff';
  fromCommit?: string;
  toCommit?: string;
  // GraphRAG stats
  graphNodesCreated?: number;
  graphEdgesCreated?: number;
}

// GraphRAG specific types - for persistence
export interface GraphChunkData {
  id: string;
  text: string;
  source: string;
  chunkIndex: number;
}

export interface GraphEmbeddingData {
  id: string;
  embedding: number[];
}

/**
 * Persisted graph data structure
 * This is stored as JSON and can be loaded to rebuild the GraphRAG instance
 */
export interface PersistedGraphData {
  version: string;
  createdAt: number;
  updatedAt: number;
  config: {
    dimension: number;
    threshold: number;
  };
  chunks: GraphChunkData[];
  embeddings: GraphEmbeddingData[];
}

/**
 * Git diff result structure
 * Contains lists of files that were added, modified, deleted, or renamed
 */
export interface GitDiffResult {
  added: string[];
  modified: string[];
  deleted: string[];
  renamed: Array<{ from: string; to: string }>;
}
