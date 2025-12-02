export interface EmbedderOptions {
  dir: string;
  output: string;
  baseUrl: string;
  model: string;
  tableName: string;
  dimension: number;
  ignore?: string[];
  batchSize?: number;
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
}

export interface ProcessingStats {
  filesProcessed: number;
  filesSkipped: number;
  chunksCreated: number;
  errors: number;
  warnings: string[];
}
