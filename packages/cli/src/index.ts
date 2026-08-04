#!/usr/bin/env node

import { promises as fs } from "node:fs";
import path from "node:path";
import { createInterface } from "node:readline/promises";
import { fileURLToPath } from "node:url";
import { agentAdapter } from "../../agents/src/index.js";
import type { AgentName } from "../../agents/src/types.js";
import {
  createKnowledgeRuntime,
  inspectKnowledgeStore,
  readKnowledgeStore,
  resolveStorePath,
} from "../../core/src/runtime.js";
import { PERSONAL_CONTEXT_VERSION } from "../../core/src/version.js";
import { startPersonalContextServer } from "../../mcp/src/server.js";
import {
  managedRuntimeRoot,
  managedRuntimeVersion,
} from "../../runtime/src/index.js";
import {
  SetupService,
  startSetupServer,
  type SetupToolId,
} from "../../setup/src/index.js";

const PACKAGE_VERSION = PERSONAL_CONTEXT_VERSION;
const args = process.argv.slice(2);
const command = args[0];

try {
  switch (command) {
    case "setup":
      await setup();
      break;
    case "status":
      await status();
      break;
    case "doctor":
      await doctor();
      break;
    case "query":
      await query();
      break;
    case "mcp":
      await mcp();
      break;
    case "connect":
      await connect();
      break;
    case "disconnect":
      await disconnect();
      break;
    case "uninstall":
      await uninstall();
      break;
    case "help":
    case "--help":
    case "-h":
    case undefined:
      usage();
      break;
    case "--version":
    case "-v":
      process.stdout.write(`${PACKAGE_VERSION}\n`);
      break;
    default:
      throw new Error(`Unknown command: ${command}`);
  }
} catch (error) {
  process.stderr.write(`${message(error)}\n`);
  process.exitCode = 1;
}

async function setup(): Promise<void> {
  const service = await setupService();
  if (flag("--headless")) {
    await headlessSetup(service, flag("--yes"));
    return;
  }
  const releaseSource = await releaseSourcePath();
  let server: Awaited<ReturnType<typeof startSetupServer>>;
  try {
    server = await startSetupServer({
      service,
      assetsPath: path.join(releaseSource, "setup-ui"),
      openBrowser: !flag("--no-open"),
    });
  } catch (error) {
    if (!process.stdin.isTTY) throw error;
    process.stdout.write(
      "The local setup window was unavailable. Continuing with the same checklist here.\n",
    );
    await headlessSetup(service, false);
    return;
  }
  if (!server.browserOpened && !flag("--no-open")) {
    await server.close();
    if (!process.stdin.isTTY) {
      throw new Error("The local setup window could not open. Rerun with --headless.");
    }
    process.stdout.write(
      "The local setup window was unavailable. Continuing with the same checklist here.\n",
    );
    await headlessSetup(service, false);
    return;
  }
  process.stdout.write(
    server.browserOpened
      ? "Personal Context setup opened in your browser.\n"
      : `Personal Context is ready at ${server.url}\nOpen this local address to continue, or rerun with --headless.\n`,
  );
  await server.closed;
}

async function status(): Promise<void> {
  const resolution = await resolveStorePath({ store: option("--store") });
  const runtimeRoot = managedRuntimeRoot();
  const version = await managedRuntimeVersion(runtimeRoot);
  const clients = await Promise.all(
    (["codex", "claude"] as const).map(async (name) => {
      const adapter = agentAdapter(name);
      if (!(await adapter.detect())) return { client: name, status: "missing" };
      if (!resolution.storePath || version !== PACKAGE_VERSION) {
        return { client: name, status: "not-connected" };
      }
      const plan = await adapter.plan({
        nodePath: process.execPath,
        runtimePath: path.join(
          runtimeRoot,
          "current",
          "personal-context.mjs",
        ),
      });
      return {
        client: name,
        status:
          plan.action === "noop"
            ? "connected"
            : plan.action === "replace"
              ? "different-connection"
              : "not-connected",
      };
    }),
  );
  const report = {
    configured: Boolean(resolution.storePath),
    source: resolution.source,
    runtimeVersion: version,
    clients,
  };
  if (flag("--json")) process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  else {
    process.stdout.write(
      [
        `Knowledge source: ${report.configured ? "configured" : "not configured"}`,
        `Managed runtime: ${version ?? "not installed"}`,
        ...clients.map((item) => `${displayAgent(item.client)}: ${item.status}`),
      ].join("\n") + "\n",
    );
  }
}

async function doctor(): Promise<void> {
  const storePath = await requiredStorePath(positionalArguments()[0]);
  const records = await readKnowledgeStore(storePath, "knowledge");
  const report = inspectKnowledgeStore(storePath, records);
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (!report.valid) process.exitCode = 1;
}

async function query(): Promise<void> {
  const queryText = positionalArguments().join(" ").trim();
  if (!queryText) throw new Error("query requires search text.");
  const index = await createKnowledgeRuntime(await runtimeOptions());
  const hits = index.search(queryText, {}, integerOption("--limit", 5));
  process.stdout.write(`${JSON.stringify(hits, null, 2)}\n`);
}

async function mcp(): Promise<void> {
  await startPersonalContextServer(await runtimeOptions());
}

async function connect(): Promise<void> {
  if (!flag("--yes")) {
    throw new Error("connect changes one client setting; pass --yes to approve.");
  }
  const client = requiredClient();
  const service = await setupService();
  const detection = await service.detect();
  const source = detection.sources.find((item) => item.validation !== "invalid");
  if (!source) throw new Error("No valid configured knowledge source was found.");
  const tool = detection.tools.find((item) => item.id === toolId(client));
  if (tool?.status === "conflict" && tool.connectionDifference) {
    printConnectionDifference(displayAgent(client), tool.connectionDifference);
  }
  const result = await service.connect({
    sourceId: source.id,
    toolIds: [toolId(client)],
  });
  if (result.failed.length) throw new Error(result.failed[0]?.message);
  process.stdout.write(`${displayAgent(client)} connected.\n`);
}

async function disconnect(): Promise<void> {
  const client = requiredClient();
  const result = await agentAdapter(client).disconnect();
  if (result.exitCode !== 0) {
    throw new Error(`${displayAgent(client)} did not have a removable connection.`);
  }
  process.stdout.write(`${displayAgent(client)} disconnected.\n`);
}

async function uninstall(): Promise<void> {
  for (const name of ["codex", "claude"] as const) {
    const adapter = agentAdapter(name);
    if (!(await adapter.detect())) continue;
    await adapter.disconnect();
  }
  await fs.rm(managedRuntimeRoot(), { recursive: true, force: true });
  process.stdout.write(
    "Personal Context connections and managed runtime were removed. Your knowledge and saved source were preserved.\n",
  );
}

async function setupService(): Promise<SetupService> {
  const releaseSource = await releaseSourcePath();
  const configured = await resolveStorePath({ store: option("--store") });
  return new SetupService({
    version: PACKAGE_VERSION,
    releaseSourcePath: releaseSource,
    explicitStore: configured.storePath,
  });
}

async function releaseSourcePath(): Promise<string> {
  const moduleDirectory = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [
    moduleDirectory,
    path.resolve(moduleDirectory, "../../../runtime"),
    path.resolve(moduleDirectory, "../../../dist/runtime"),
  ];
  for (const candidate of candidates) {
    try {
      await Promise.all([
        fs.access(path.join(candidate, "personal-context.mjs")),
        fs.access(path.join(candidate, "setup-ui", "index.html")),
      ]);
      return candidate;
    } catch {
      // Try the next packaged or development layout.
    }
  }
  throw new Error(
    "The release bundle is incomplete. Reinstall personal-context and try again.",
  );
}

async function headlessSetup(
  service: SetupService,
  approved: boolean,
): Promise<void> {
  let detection = await service.detect();
  let valid = detection.sources.filter((item) => item.validation !== "invalid");
  if (!valid.length && process.stdin.isTTY) {
    const answer = await prompt("Knowledge folder path: ");
    detection = await service.addChosenFolder(answer);
    valid = detection.sources.filter((item) => item.validation !== "invalid");
  }
  if (!valid.length) {
    throw new Error("No valid Markdown knowledge folder was found.");
  }
  let source = valid[0];
  if (!source) throw new Error("No source was selected.");
  if (valid.length > 1 && !approved) {
    process.stdout.write(
      valid
        .map(
          (item, index) =>
            `${index + 1}. ${item.name} (${item.noteCount} notes, ${item.validation})`,
        )
        .join("\n") + "\n",
    );
    const choice = Number.parseInt(await prompt("Choose a source: "), 10);
    source = valid[choice - 1];
    if (!source) throw new Error("No source was selected.");
  }
  const available = detection.tools.filter(
    (tool) => tool.status === "ready" || tool.status === "conflict",
  );
  if (!available.length) {
    process.stdout.write("Knowledge source validated. No supported client needs connecting.\n");
    return;
  }
  let selected = available;
  if (!approved) {
    process.stdout.write(
      available
        .map((tool) => `${tool.name}: ${tool.status}`)
        .join("\n") + "\n",
    );
    const proceed = await prompt("Connect these tools? [Y/n] ");
    if (/^n/i.test(proceed)) return;
    const conflicts = available.filter((tool) => tool.status === "conflict");
    if (conflicts.length) {
      const replace = await prompt(
        "Replace the existing Personal Context connections shown above? [y/N] ",
      );
      if (!/^y/i.test(replace)) {
        selected = selected.filter((tool) => tool.status !== "conflict");
      }
    }
  }
  const result = await service.connect({
    sourceId: source.id,
    toolIds: selected.map((tool) => tool.id),
  });
  process.stdout.write(
    result.failed.length
      ? `Connected ${result.connected.length}; ${result.failed.length} need attention.\n`
      : "Personal Context is connected.\n",
  );
  if (result.failed.length) process.exitCode = 1;
}

async function runtimeOptions(): Promise<{
  storePath: string;
  playbookPath?: string;
}> {
  const playbookPath = option("--playbook");
  return {
    storePath: await requiredStorePath(),
    ...(playbookPath ? { playbookPath } : {}),
  };
}

async function requiredStorePath(fallback?: string): Promise<string> {
  const resolution = await resolveStorePath({
    store: option("--store") ?? fallback,
  });
  if (!resolution.storePath) {
    throw new Error("Run `personal-context setup` to choose a knowledge source.");
  }
  return resolution.storePath;
}

function requiredClient(): AgentName {
  const value = option("--client");
  if (value === "codex") return "codex";
  if (value === "claude" || value === "claude-code") return "claude";
  throw new Error("--client must be codex or claude.");
}

function option(name: string): string | null {
  const index = args.indexOf(name);
  const value = index >= 0 ? args[index + 1] : undefined;
  if (index >= 0 && (!value || value.startsWith("--"))) {
    throw new Error(`${name} requires a value.`);
  }
  return value ?? null;
}

function flag(name: string): boolean {
  return args.includes(name);
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
  const optionsWithValues = new Set([
    "--store",
    "--playbook",
    "--limit",
    "--client",
  ]);
  const output: string[] = [];
  for (let index = 1; index < args.length; index += 1) {
    const value = args[index];
    if (!value) continue;
    if (optionsWithValues.has(value)) {
      index += 1;
      continue;
    }
    if (!value.startsWith("--")) output.push(value);
  }
  return output;
}

async function prompt(question: string): Promise<string> {
  const reader = createInterface({ input: process.stdin, output: process.stdout });
  try {
    return (await reader.question(question)).trim();
  } finally {
    reader.close();
  }
}

function usage(): void {
  process.stdout.write(`Personal Context

Usage:
  personal-context setup [--store path] [--headless] [--yes]
  personal-context status [--json]
  personal-context doctor [path] [--store path]
  personal-context query <text> [--store path] [--limit 5]
  personal-context mcp [--store path]
  personal-context connect --client codex|claude --yes
  personal-context disconnect --client codex|claude
  personal-context uninstall

No API key, daemon, Obsidian process, or per-repository files are required.
`);
}

function toolId(client: AgentName): SetupToolId {
  return client === "codex" ? "codex" : "claude-code";
}

function displayAgent(client: AgentName): string {
  return client === "codex" ? "Codex" : "Claude Code";
}

function printConnectionDifference(
  client: string,
  difference: NonNullable<
    Awaited<ReturnType<SetupService["detect"]>>["tools"][number]["connectionDifference"]
  >,
): void {
  process.stdout.write(
    [
      `${client} has a different Personal Context connection.`,
      difference.current,
      difference.proposed,
      ...difference.changes.map((change) => `- ${change}`),
      "Replacing it now because --yes explicitly approved this connection change.",
    ].join("\n") + "\n",
  );
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : "Personal Context failed.";
}
