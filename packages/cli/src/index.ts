#!/usr/bin/env node

import { promises as fs } from "node:fs";
import path from "node:path";
import {
  createKnowledgeRuntime,
  evaluateRetrieval,
  inspectKnowledgeStore,
  readKnowledgeStore,
  type RetrievalCase,
} from "../../core/src/runtime.js";
import { startPersonalContextServer } from "../../mcp/src/server.js";

const args = process.argv.slice(2);
const command = args[0];

try {
  switch (command) {
    case "doctor":
      await doctor();
      break;
    case "query":
      await query();
      break;
    case "eval":
      await evaluate();
      break;
    case "mcp":
      await mcp();
      break;
    case "help":
    case "--help":
    case "-h":
    case undefined:
      usage();
      break;
    default:
      throw new Error(`Unknown command: ${command}`);
  }
} catch (error) {
  process.stderr.write(`${message(error)}\n`);
  process.exitCode = 1;
}

async function doctor(): Promise<void> {
  const storePath = requiredStorePath(positionalArguments()[0]);
  const records = await readKnowledgeStore(storePath, "knowledge");
  const report = inspectKnowledgeStore(storePath, records);
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (!report.valid) process.exitCode = 1;
}

async function query(): Promise<void> {
  const queryText = positionalArguments().join(" ").trim();
  if (!queryText) throw new Error("query requires search text.");
  const index = await createKnowledgeRuntime(runtimeOptions());
  const hits = index.search(queryText, {}, integerOption("--limit", 5));
  process.stdout.write(`${JSON.stringify(hits, null, 2)}\n`);
}

async function evaluate(): Promise<void> {
  const casesPath = positionalArguments()[0];
  if (!casesPath) throw new Error("eval requires a retrieval cases JSON file.");
  const raw = await fs.readFile(path.resolve(casesPath), "utf8");
  const cases = JSON.parse(raw) as RetrievalCase[];
  const index = await createKnowledgeRuntime(runtimeOptions());
  const report = evaluateRetrieval(index, cases);
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (report.hitRate < 1) process.exitCode = 1;
}

async function mcp(): Promise<void> {
  await startPersonalContextServer(runtimeOptions());
}

function runtimeOptions(): {
  storePath: string;
  playbookPath?: string;
} {
  const playbookPath = option("--playbook");
  return {
    storePath: requiredStorePath(),
    ...(playbookPath ? { playbookPath } : {}),
  };
}

function requiredStorePath(fallback?: string): string {
  const value =
    option("--store") ?? process.env.PERSONAL_CONTEXT_STORE ?? fallback;
  if (!value) {
    throw new Error(
      "Set PERSONAL_CONTEXT_STORE or pass --store /path/to/knowledge.",
    );
  }
  return path.resolve(value);
}

function option(name: string): string | null {
  const index = args.indexOf(name);
  const value = index >= 0 ? args[index + 1] : undefined;
  if (index >= 0 && (!value || value.startsWith("--"))) {
    throw new Error(`${name} requires a value.`);
  }
  return value ?? null;
}

function integerOption(name: string, fallback: number): number {
  const value = option(name);
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 20) {
    throw new Error(`${name} must be an integer from 1 to 20.`);
  }
  return parsed;
}

function positionalArguments(): string[] {
  const output: string[] = [];
  for (let index = 1; index < args.length; index += 1) {
    const value = args[index];
    if (!value) continue;
    if (value === "--store" || value === "--playbook" || value === "--limit") {
      index += 1;
      continue;
    }
    if (!value.startsWith("--")) output.push(value);
  }
  return output;
}

function usage(): void {
  process.stdout.write(`Personal Context

Usage:
  personal-context doctor [path] [--store path]
  personal-context query <text> --store path [--limit 5]
  personal-context eval <cases.json> --store path
  personal-context mcp --store path

Environment:
  PERSONAL_CONTEXT_STORE       Default Markdown knowledge root
  PERSONAL_CONTEXT_PLAYBOOK    Optional playbook root
`);
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : "Personal Context failed.";
}
