import { execSync } from "child_process";
import * as path from "path";

export interface GitDiffResult {
  added: string[];
  modified: string[];
  deleted: string[];
  renamed: Array<{ from: string; to: string }>;
}

/**
 * Check if a directory is a git repository
 * @param dir - Directory path to check
 * @returns true if directory is inside a git repository, false otherwise
 */
export function isGitRepository(dir: string): boolean {
  try {
    execSync(`git -C "${dir}" rev-parse --is-inside-work-tree`, {
      stdio: "pipe",
      encoding: "utf-8",
    });
    return true;
  } catch (error) {
    return false;
  }
}

/**
 * Get the current HEAD commit hash
 * @param dir - Repository directory path
 * @returns Commit hash (40 characters) or null if unable to determine
 */
export function getCurrentCommitHash(dir: string): string | null {
  try {
    const hash = execSync(`git -C "${dir}" rev-parse HEAD`, {
      stdio: "pipe",
      encoding: "utf-8",
    }).trim();
    
    // Validate it's a proper commit hash (40 character hex string)
    if (hash && /^[0-9a-f]{40}$/i.test(hash)) {
      return hash;
    }
    
    return null;
  } catch (error) {
    return null;
  }
}

/**
 * Get changed files between two commits
 * @param dir - Repository directory path
 * @param fromCommit - Starting commit hash
 * @param toCommit - Ending commit hash (defaults to HEAD if not provided)
 * @returns Object containing arrays of added, modified, deleted, and renamed files
 */
export function getChangedFiles(
  dir: string,
  fromCommit: string,
  toCommit?: string
): GitDiffResult {
  const result: GitDiffResult = {
    added: [],
    modified: [],
    deleted: [],
    renamed: [],
  };

  try {
    const target = toCommit || "HEAD";
    
    // Use git diff with --name-status to get file changes
    // Format: <status><tab><filename> or <status><tab><old><tab><new> for renames
    const output = execSync(
      `git -C "${dir}" diff --name-status --no-renames "${fromCommit}" "${target}"`,
      {
        stdio: "pipe",
        encoding: "utf-8",
      }
    ).trim();

    if (!output) {
      return result; // No changes
    }

    const lines = output.split("\n");
    
    for (const line of lines) {
      if (!line.trim()) continue;

      const parts = line.split("\t");
      const status = parts[0];
      
      if (!status) continue;

      // Handle different git status codes
      // A = Added, M = Modified, D = Deleted, R = Renamed, C = Copied, T = Type changed
      const statusCode = status[0];
      
      switch (statusCode) {
        case "A":
          // Added file
          if (parts[1]) {
            result.added.push(path.join(dir, parts[1]));
          }
          break;
          
        case "M":
        case "T": // Type changed (e.g., file to symlink) - treat as modified
          // Modified file
          if (parts[1]) {
            result.modified.push(path.join(dir, parts[1]));
          }
          break;
          
        case "D":
          // Deleted file
          if (parts[1]) {
            result.deleted.push(path.join(dir, parts[1]));
          }
          break;
      }
    }

    // Now get renamed files separately (need --find-renames flag)
    try {
      const renameOutput = execSync(
        `git -C "${dir}" diff --name-status --find-renames "${fromCommit}" "${target}"`,
        {
          stdio: "pipe",
          encoding: "utf-8",
        }
      ).trim();

      if (renameOutput) {
        const renameLines = renameOutput.split("\n");
        
        for (const line of renameLines) {
          if (!line.trim()) continue;

          const parts = line.split("\t");
          const status = parts[0];
          
          if (!status) continue;

          const statusCode = status[0];
          
          if (statusCode === "R") {
            // Renamed file: R<similarity><tab><old><tab><new>
            if (parts[1] && parts[2]) {
              result.renamed.push({
                from: path.join(dir, parts[1]),
                to: path.join(dir, parts[2]),
              });
            }
          }
        }
      }
    } catch (error) {
      // Rename detection failed, but we can continue without it
    }

    return result;
  } catch (error) {
    // If git diff fails, return empty result
    // This could happen if commits don't exist or aren't reachable
    return result;
  }
}

/**
 * Check if the repository has uncommitted changes
 * @param dir - Repository directory path
 * @returns true if there are uncommitted changes (staged or unstaged), false otherwise
 */
export function hasUncommittedChanges(dir: string): boolean {
  try {
    const output = execSync(`git -C "${dir}" status --porcelain`, {
      stdio: "pipe",
      encoding: "utf-8",
    }).trim();
    
    // If output is non-empty, there are uncommitted changes
    return output.length > 0;
  } catch (error) {
    return false;
  }
}

/**
 * Get a count of uncommitted changes (for display purposes)
 * @param dir - Repository directory path
 * @returns Number of files with uncommitted changes
 */
export function getUncommittedChangeCount(dir: string): number {
  try {
    const output = execSync(`git -C "${dir}" status --porcelain`, {
      stdio: "pipe",
      encoding: "utf-8",
    }).trim();
    
    if (!output) return 0;
    
    return output.split("\n").length;
  } catch (error) {
    return 0;
  }
}
