import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { agentAdapter } from "../../agents/src/index.js";
import type {
  AdapterPlan,
  AgentAdapter,
  AgentConnection,
  AgentName,
} from "../../agents/src/types.js";
import {
  discoverObsidianVaults,
  discoverMarkdownFolders,
  discoverRegisteredObsidianVaults,
  inspectKnowledgeStore,
  readKnowledgeStore,
  writeUserConfig,
} from "../../core/src/runtime.js";
import {
  installManagedRuntime,
  managedRuntimeEntry,
  managedRuntimeRoot,
  managedRuntimeVersion,
} from "../../runtime/src/index.js";
import { smokeTestRuntime } from "./smoke.js";

export type SetupToolId = "codex" | "claude-code";

export interface SetupKnowledgeSource {
  id: string;
  name: string;
  path: string;
  noteCount: number;
  validation: "valid" | "warning" | "invalid";
}

export interface SetupDetectedTool {
  id: SetupToolId;
  name: string;
  status: "ready" | "connected" | "conflict" | "unavailable";
  detail?: string;
  /** A secret-safe structural comparison for an explicit replacement decision. */
  connectionDifference?: {
    current: string;
    proposed: string;
    changes: string[];
  };
}

export interface SetupDetection {
  sources: SetupKnowledgeSource[];
  tools: SetupDetectedTool[];
}

export interface SetupConnectOptions {
  sourceId: string;
  toolIds: SetupToolId[];
  includeHiddenFiles?: boolean;
}

export interface SetupResult {
  connected: SetupToolId[];
  failed: Array<{ toolId: SetupToolId; message: string }>;
}

interface SourceState extends SetupKnowledgeSource {
  absoluteStorePath: string;
}

export interface SetupServiceOptions {
  environment?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
  cwd?: string;
  explicitStore?: string | null;
  configPath?: string;
  version: string;
  releaseSourcePath: string;
  nodePath?: string;
  runtimeRoot?: string;
  adapterFactory?: (name: AgentName) => AgentAdapter;
  smokeTest?: typeof smokeTestRuntime;
}

export class SetupService {
  private readonly environment: NodeJS.ProcessEnv;
  private readonly platform: NodeJS.Platform;
  private readonly cwd: string;
  private readonly nodePath: string;
  private readonly runtimeRoot: string;
  private readonly adapterFactory: (name: AgentName) => AgentAdapter;
  private readonly smokeTest: typeof smokeTestRuntime;
  private readonly sources = new Map<string, SourceState>();

  constructor(private readonly options: SetupServiceOptions) {
    this.environment = options.environment ?? process.env;
    this.platform = options.platform ?? process.platform;
    this.cwd = path.resolve(options.cwd ?? process.cwd());
    this.nodePath = path.resolve(options.nodePath ?? process.execPath);
    this.runtimeRoot =
      options.runtimeRoot ??
      managedRuntimeRoot(this.environment, this.platform);
    this.adapterFactory = options.adapterFactory ?? agentAdapter;
    this.smokeTest = options.smokeTest ?? smokeTestRuntime;
  }

  async detect(): Promise<SetupDetection> {
    const candidates = await this.discoverCandidates();
    const sources = await Promise.all(
      candidates.slice(0, 12).map((candidate) =>
        this.inspectSource(candidate.path, candidate.storePath),
      ),
    );
    this.sources.clear();
    for (const source of sources) this.sources.set(source.id, source);
    const tools = await Promise.all(
      (["codex", "claude"] as const).map((name) => this.detectTool(name)),
    );
    return {
      sources: sources.map(publicSource),
      tools,
    };
  }

  async addChosenFolder(folderPath: string): Promise<SetupDetection> {
    const absolute = path.resolve(folderPath);
    const wiki = path.join(absolute, "Wiki");
    const storePath = await directoryExists(wiki) ? wiki : absolute;
    const source = await this.inspectSource(absolute, storePath);
    const current = await this.detect();
    this.sources.set(source.id, source);
    const unique = new Map(
      [...current.sources, publicSource(source)].map((item) => [item.id, item]),
    );
    return { ...current, sources: [...unique.values()] };
  }

  async connect(request: SetupConnectOptions): Promise<SetupResult> {
    if (!this.sources.size) await this.detect();
    const source = this.sources.get(request.sourceId);
    if (!source || source.validation === "invalid") {
      throw new Error("Choose a valid Markdown knowledge folder first.");
    }

    const installed = await installManagedRuntime(
      this.runtimeRoot,
      this.options.version,
      this.options.releaseSourcePath,
      async (releasePath) => {
        await this.smokeTest(
          this.nodePath,
          path.join(releasePath, "personal-context.mjs"),
          source.absoluteStorePath,
        );
      },
    );
    const runtimePath = path.join(
      installed.currentPath,
      "personal-context.mjs",
    );
    await writeUserConfig(
      {
        schemaVersion: 1,
        knowledgeRoot: source.absoluteStorePath,
        lastValidatedAt: new Date().toISOString(),
      },
      this.options.configPath,
    );

    const connection: AgentConnection = {
      nodePath: this.nodePath,
      runtimePath,
    };
    // Keep client mutations isolated and deterministic. They target separate
    // official CLIs, and a failure below remains local to its own client.
    const outcomes: Array<{
      toolId: SetupToolId;
      connected: boolean;
      message?: string;
    }> = [];
    for (const toolId of request.toolIds) {
      outcomes.push(await this.connectTool(toolId, connection));
    }
    return {
      connected: outcomes
        .filter((item) => item.connected)
        .map((item) => item.toolId),
      failed: outcomes
        .filter((item) => !item.connected)
        .map((item) => ({
          toolId: item.toolId,
          message: item.message ?? "Connection failed and was rolled back.",
        })),
    };
  }

  async status(): Promise<SetupDetection> {
    return this.detect();
  }

  async disconnect(toolId: SetupToolId): Promise<boolean> {
    const result = await this.adapterFactory(agentName(toolId)).disconnect();
    return result.exitCode === 0;
  }

  runtimePath(): string {
    return path.join(
      this.runtimeRoot,
      "current",
      path.basename(managedRuntimeEntry(this.environment, this.platform)),
    );
  }

  private async connectTool(
    toolId: SetupToolId,
    connection: AgentConnection,
  ): Promise<{ toolId: SetupToolId; connected: boolean; message?: string }> {
    const adapter = this.adapterFactory(agentName(toolId));
    const plan = await adapter.plan(connection);
    const applied = await adapter.apply(connection, plan, {
      allowReplace: true,
    });
    if (applied.exitCode !== 0) {
      return {
        toolId,
        connected: false,
        message: friendlyConnectionError(plan),
      };
    }
    const verified = await adapter.verify(connection);
    if (verified.exitCode === 0) return { toolId, connected: true };
    await adapter.rollback(plan);
    return {
      toolId,
      connected: false,
      message: "The tool could not start the verified runtime. Its previous connection was restored.",
    };
  }

  private async detectTool(name: AgentName): Promise<SetupDetectedTool> {
    const adapter = this.adapterFactory(name);
    const id = toolId(name);
    if (!(await adapter.detect())) {
      return { id, name: displayToolName(name), status: "unavailable" };
    }
    const plan = await adapter.plan({
      nodePath: this.nodePath,
      runtimePath: this.runtimePath(),
    });
    const runtimeReady =
      (await managedRuntimeVersion(this.runtimeRoot)) === this.options.version;
    return {
      id,
      name: displayToolName(name),
      status:
        plan.action === "noop" && runtimeReady
          ? "connected"
          : plan.action === "replace" || plan.action === "noop"
            ? "conflict"
            : "ready",
      ...(plan.action === "replace" || (plan.action === "noop" && !runtimeReady)
        ? {
            detail:
              plan.action === "noop"
                ? "The managed runtime needs repair"
                : "A different Personal Context setup is connected",
          }
        : {}),
      ...(plan.action === "replace" && plan.previous
        ? { connectionDifference: safeConnectionDifference(plan) }
        : {}),
    };
  }

  private async discoverCandidates(): Promise<
    Array<{ path: string; storePath: string }>
  > {
    const candidates: Array<{ path: string; storePath: string }> = [];
    if (this.options.explicitStore) {
      const storePath = path.resolve(this.options.explicitStore);
      // An explicit source is already an intentional user choice. Do not turn
      // setup into a second discovery decision by mixing in nearby Markdown
      // folders from the process working directory.
      return [{
        path: path.basename(storePath) === "Wiki"
          ? path.dirname(storePath)
          : storePath,
        storePath,
      }];
    }
    for (const registry of obsidianRegistryPaths(
      this.environment,
      this.platform,
    )) {
      candidates.push(...(await discoverRegisteredObsidianVaults(registry)));
    }
    const roots = new Set([
      this.cwd,
      path.dirname(this.cwd),
      path.join(homeDirectory(this.environment), "Documents"),
    ]);
    for (const root of roots) {
      if (!(await directoryExists(root))) continue;
      candidates.push(
        ...(await discoverObsidianVaults(root, {
          maxDepth: root === this.cwd ? 2 : 1,
          maxDirectories: 180,
        })),
      );
      candidates.push(
        ...(await discoverMarkdownFolders(root, {
          maxDepth: root === this.cwd ? 2 : 1,
          maxDirectories: 120,
        })),
      );
    }
    return deduplicateCandidates(candidates);
  }

  private async inspectSource(
    vaultPath: string,
    storePath: string,
  ): Promise<SourceState> {
    try {
      const records = await readKnowledgeStore(storePath, "knowledge");
      const report = inspectKnowledgeStore(storePath, records);
      const validation =
        report.valid && records.length > 0
          ? report.findings.length
            ? "warning"
            : "valid"
          : "invalid";
      return sourceState(vaultPath, storePath, records.length, validation);
    } catch {
      return sourceState(vaultPath, storePath, 0, "invalid");
    }
  }
}

function sourceState(
  vaultPath: string,
  storePath: string,
  noteCount: number,
  validation: SourceState["validation"],
): SourceState {
  const name =
    path.basename(storePath) === "Wiki"
      ? `${path.basename(vaultPath)} / Wiki`
      : path.basename(storePath);
  return {
    id: createHash("sha256").update(storePath).digest("hex").slice(0, 16),
    name,
    path: displayPath(storePath),
    noteCount,
    validation,
    absoluteStorePath: path.resolve(storePath),
  };
}

function publicSource(source: SourceState): SetupKnowledgeSource {
  const { absoluteStorePath: _, ...visible } = source;
  return visible;
}

function displayPath(value: string): string {
  const home = os.homedir();
  return value.startsWith(`${home}${path.sep}`)
    ? `~${value.slice(home.length)}`
    : value;
}

function obsidianRegistryPaths(
  environment: NodeJS.ProcessEnv,
  platform: NodeJS.Platform,
): string[] {
  const home = homeDirectory(environment);
  if (platform === "darwin") {
    return [
      path.join(
        home,
        "Library",
        "Application Support",
        "obsidian",
        "obsidian.json",
      ),
    ];
  }
  if (platform === "win32") {
    return [
      path.join(
        environment.APPDATA ?? path.join(home, "AppData", "Roaming"),
        "obsidian",
        "obsidian.json",
      ),
    ];
  }
  return [
    path.join(
      environment.XDG_CONFIG_HOME ?? path.join(home, ".config"),
      "obsidian",
      "obsidian.json",
    ),
  ];
}

function homeDirectory(environment: NodeJS.ProcessEnv): string {
  return environment.HOME ?? environment.USERPROFILE ?? os.homedir();
}

function deduplicateCandidates<T extends { storePath: string }>(
  candidates: T[],
): T[] {
  const output = new Map<string, T>();
  for (const candidate of candidates) {
    output.set(path.resolve(candidate.storePath), candidate);
  }
  return [...output.values()];
}

async function directoryExists(value: string): Promise<boolean> {
  try {
    return (await fs.stat(value)).isDirectory();
  } catch {
    return false;
  }
}

function toolId(name: AgentName): SetupToolId {
  return name === "codex" ? "codex" : "claude-code";
}

function agentName(id: SetupToolId): AgentName {
  return id === "codex" ? "codex" : "claude";
}

function displayToolName(name: AgentName): string {
  return name === "codex" ? "Codex" : "Claude Code";
}

function friendlyConnectionError(plan: AdapterPlan): string {
  return plan.action === "replace"
    ? "The existing connection was left unchanged."
    : "The tool could not save the connection.";
}

/**
 * Do not surface raw MCP arguments: an unrelated existing server can contain
 * credentials in its command line. The user still gets the relevant decision:
 * which connection shape will be replaced and why.
 */
function safeConnectionDifference(plan: AdapterPlan): NonNullable<
  SetupDetectedTool["connectionDifference"]
> {
  const previous = plan.previous;
  if (!previous) {
    return {
      current: "Current Personal Context connection",
      proposed: "Managed Personal Context runtime",
      changes: ["The existing connection could not be inspected completely."],
    };
  }
  const executableChanged = path.basename(previous.command) !== path.basename(plan.desired.command);
  const argumentsChanged =
    previous.args.length !== plan.desired.args.length ||
    previous.args.some((value, index) => value !== plan.desired.args[index]);
  const changes = [
    ...(executableChanged ? ["MCP executable differs."] : []),
    ...(argumentsChanged ? ["MCP runtime arguments differ."] : []),
  ];
  return {
    current: `Current connection: ${path.basename(previous.command)} (${previous.args.length} argument${previous.args.length === 1 ? "" : "s"})`,
    proposed: `Proposed connection: ${path.basename(plan.desired.command)} → managed Personal Context runtime`,
    changes: changes.length ? changes : ["The connection needs a managed-runtime repair."],
  };
}
