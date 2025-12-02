import * as fs from "fs";
import * as path from "path";
import ignore from "ignore";
import type { Ignore } from "ignore";

const BINARY_EXTENSIONS = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".bmp",
  ".ico",
  ".svg",
  ".webp",
  ".pdf",
  ".zip",
  ".tar",
  ".gz",
  ".7z",
  ".rar",
  ".exe",
  ".dll",
  ".so",
  ".dylib",
  ".bin",
  ".dat",
  ".db",
  ".sqlite",
  ".woff",
  ".woff2",
  ".ttf",
  ".eot",
  ".otf",
  ".mp4",
  ".mp3",
  ".avi",
  ".mov",
  ".wav",
  ".flac",
]);

export class FileDiscovery {
  private ig: Ignore;
  private rootDir: string;

  constructor(rootDir: string, additionalPatterns: string[] = []) {
    this.rootDir = rootDir;
    this.ig = ignore();

    // Load .gitignore if it exists
    const gitignorePath = path.join(rootDir, ".gitignore");
    if (fs.existsSync(gitignorePath)) {
      const gitignoreContent = fs.readFileSync(gitignorePath, "utf-8");
      this.ig.add(gitignoreContent);
    }

    // Add additional patterns
    if (additionalPatterns.length > 0) {
      this.ig.add(additionalPatterns);
    }

    // Always ignore .git directory and common build/dependency directories
    this.ig.add([".git", "node_modules", ".next", "dist", "build", ".turbo"]);
  }

  private isBinaryFile(filePath: string): boolean {
    const ext = path.extname(filePath).toLowerCase();
    return BINARY_EXTENSIONS.has(ext);
  }

  private isTextFile(filePath: string): boolean {
    if (this.isBinaryFile(filePath)) {
      return false;
    }

    // Try to read first 512 bytes to check for binary content
    try {
      const fd = fs.openSync(filePath, "r");
      const buffer = Buffer.alloc(512);
      const bytesRead = fs.readSync(fd, buffer, 0, 512, 0);
      fs.closeSync(fd);

      // Check for null bytes (common in binary files)
      for (let i = 0; i < bytesRead; i++) {
        if (buffer[i] === 0) {
          return false;
        }
      }

      return true;
    } catch (error) {
      return false;
    }
  }

  private *walkDirectory(dir: string): Generator<string> {
    const entries = fs.readdirSync(dir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      const relativePath = path.relative(this.rootDir, fullPath);

      // Skip if ignored by gitignore or additional patterns
      if (this.ig.ignores(relativePath)) {
        continue;
      }

      if (entry.isDirectory()) {
        yield* this.walkDirectory(fullPath);
      } else if (entry.isFile()) {
        yield fullPath;
      }
    }
  }

  public discoverFiles(): string[] {
    const files: string[] = [];

    for (const file of this.walkDirectory(this.rootDir)) {
      if (this.isTextFile(file)) {
        files.push(file);
      }
    }

    return files;
  }

  public readFileContent(filePath: string): string {
    return fs.readFileSync(filePath, "utf-8");
  }
}
