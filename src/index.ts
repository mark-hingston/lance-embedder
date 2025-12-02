#!/usr/bin/env node

import { Command } from "commander";
import { Embedder } from "./lib/embedder.js";
import chalk from "chalk";

const program = new Command();

program
  .name("embedder")
  .description(
    "CLI tool to index a git repository by chunking and embedding text files into LanceDB"
  )
  .version("1.0.0");

program
  .requiredOption("-d, --dir <path>", "Directory to index (the git repository)")
  .requiredOption("-o, --output <path>", "Output path for LanceDB database")
  .requiredOption(
    "-u, --base-url <url>",
    "Base URL for LM Studio (e.g., http://localhost:1234/v1)"
  )
  .requiredOption(
    "-m, --model <name>",
    "Embedding model name (e.g., text-embedding-qwen3-embedding-4b)"
  )
  .option(
    "-t, --table-name <name>",
    "LanceDB table name",
    "embeddings"
  )
  .option(
    "--dimensions <number>",
    "Embedding dimension size",
    "2560"
  )
  .option(
    "-i, --ignore <pattern>",
    "Glob patterns to ignore (can be specified multiple times)",
    (value: string, previous: string[] = []) => {
      return [...previous, value];
    },
    [] as string[]
  )
  .option(
    "-b, --batch-size <number>",
    "Number of embeddings to process in a batch",
    "10"
  )
  .action(async (options) => {
    try {
      const embedder = new Embedder({
        dir: options.dir,
        output: options.output,
        baseUrl: options.baseUrl,
        model: options.model,
        tableName: options.tableName,
        dimension: parseInt(options.dimensions, 10),
        ignore: options.ignore,
        batchSize: parseInt(options.batchSize, 10),
      });

      await embedder.run();
    } catch (error) {
      console.error(
        chalk.red.bold("\n✗ Error:"),
        error instanceof Error ? error.message : String(error)
      );
      if (error instanceof Error && error.stack) {
        console.error(chalk.gray("\nStack trace:"));
        console.error(chalk.gray(error.stack));
      }
      process.exit(1);
    }
  });

program.parse();
