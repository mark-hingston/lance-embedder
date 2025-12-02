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
