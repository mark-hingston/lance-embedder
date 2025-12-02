import * as fs from "fs";
import * as path from "path";
import * as crypto from "crypto";
import type { StateFile, ProcessedFile } from "../types/index.js";

const STATE_FILE_NAME = ".embedder-state.json";

export class StateManager {
  private stateFilePath: string;
  private state: StateFile;

  constructor(outputDir: string) {
    this.stateFilePath = path.join(outputDir, STATE_FILE_NAME);
    this.state = this.loadState();
  }

  private loadState(): StateFile {
    if (fs.existsSync(this.stateFilePath)) {
      try {
        const content = fs.readFileSync(this.stateFilePath, "utf-8");
        return JSON.parse(content);
      } catch (error) {
        console.warn("Failed to load state file, starting fresh");
        return { files: {}, lastUpdated: Date.now() };
      }
    }
    return { files: {}, lastUpdated: Date.now() };
  }

  public saveState(): void {
    this.state.lastUpdated = Date.now();
    const dir = path.dirname(this.stateFilePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(
      this.stateFilePath,
      JSON.stringify(this.state, null, 2),
      "utf-8"
    );
  }

  public computeHash(content: string): string {
    return crypto.createHash("sha256").update(content).digest("hex");
  }

  public needsProcessing(filePath: string, content: string): boolean {
    const hash = this.computeHash(content);
    const existing = this.state.files[filePath];

    if (!existing) {
      return true;
    }

    return existing.hash !== hash;
  }

  public markProcessed(
    filePath: string,
    content: string,
    chunksCount: number
  ): void {
    const hash = this.computeHash(content);
    this.state.files[filePath] = {
      path: filePath,
      hash,
      chunks: chunksCount,
      timestamp: Date.now(),
    };
  }

  public getProcessedFiles(): string[] {
    return Object.keys(this.state.files);
  }

  public updateGraphMetadata(
    nodeCount: number,
    edgeCount: number
  ): void {
    this.state.graphMetadata = {
      nodeCount,
      edgeCount,
      lastGraphUpdate: Date.now(),
    };
  }
}
