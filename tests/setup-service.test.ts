import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type {
  AdapterPlan,
  AgentAdapter,
  AgentConnection,
  AgentName,
  CommandResult,
} from "../packages/agents/src/types.js";
import { readUserConfig } from "../packages/core/src/runtime.js";
import {
  installManagedRuntime,
  managedRuntimeVersion,
} from "../packages/runtime/src/index.js";
import { SetupService } from "../packages/setup/src/service.js";

const temporary: string[] = [];
async function temp(): Promise<string> {
  const value = await fs.mkdtemp(path.join(os.tmpdir(), "pc-setup-"));
  temporary.push(value);
  return value;
}
afterEach(async () => {
  await Promise.all(
    temporary
      .splice(0)
      .map((directory) => fs.rm(directory, { recursive: true, force: true })),
  );
});

describe("setup service", () => {
  it("validates, installs, saves only the portable config, and connects clients independently", async () => {
    const root = await temp();
    const release = await fakeRelease(root, "new");
    const configPath = path.join(root, "config", "config.json");
    const adapters = new Map<AgentName, FakeAdapter>([
      ["codex", new FakeAdapter("codex")],
      ["claude", new FakeAdapter("claude", true)],
    ]);
    const service = new SetupService({
      version: "1.0.0",
      releaseSourcePath: release,
      explicitStore: path.resolve("fixtures/vault"),
      cwd: root,
      configPath,
      runtimeRoot: path.join(root, "runtime"),
      adapterFactory: (name) => adapters.get(name)!,
      smokeTest: async () => undefined,
    });

    const detection = await service.detect();
    expect(detection.sources[0]).toMatchObject({
      noteCount: 7,
      validation: "valid",
    });
    const result = await service.connect({
      sourceId: detection.sources[0]!.id,
      toolIds: ["codex", "claude-code"],
    });
    expect(result.connected).toEqual(["codex"]);
    expect(result.failed).toHaveLength(1);
    const config = await readUserConfig(configPath);
    expect(Object.keys(config).sort()).toEqual([
      "knowledgeRoot",
      "lastValidatedAt",
      "schemaVersion",
    ]);
    expect(config.knowledgeRoot).toBe(path.resolve("fixtures/vault"));
    expect(adapters.get("codex")?.connection?.runtimePath).toContain(
      path.join("current", "personal-context.mjs"),
    );
  });

  it("does not change config for an invalid folder", async () => {
    const root = await temp();
    const release = await fakeRelease(root, "new");
    const empty = path.join(root, "empty");
    await fs.mkdir(empty);
    const configPath = path.join(root, "config.json");
    const service = new SetupService({
      version: "1.0.0",
      releaseSourcePath: release,
      explicitStore: empty,
      cwd: root,
      configPath,
      runtimeRoot: path.join(root, "runtime"),
      adapterFactory: (name) => new FakeAdapter(name),
      smokeTest: async () => undefined,
    });
    const detection = await service.detect();
    expect(detection.sources[0]?.validation).toBe("invalid");
    await expect(
      service.connect({
        sourceId: detection.sources[0]!.id,
        toolIds: ["codex"],
      }),
    ).rejects.toThrow(/valid Markdown/);
    await expect(fs.access(configPath)).rejects.toThrow();
  });

  it("reports a credential-safe conflict comparison before a replacement", async () => {
    const root = await temp();
    const release = await fakeRelease(root, "new");
    const adapter = new ConflictAdapter("codex");
    const service = new SetupService({
      version: "1.0.0",
      releaseSourcePath: release,
      explicitStore: path.resolve("fixtures/vault"),
      cwd: root,
      configPath: path.join(root, "config.json"),
      runtimeRoot: path.join(root, "runtime"),
      adapterFactory: (name) =>
        name === "codex" ? adapter : new FakeAdapter(name),
      smokeTest: async () => undefined,
    });

    const detection = await service.detect();
    const codex = detection.tools.find((tool) => tool.id === "codex");
    expect(codex).toMatchObject({ status: "conflict" });
    expect(codex?.connectionDifference).toMatchObject({
      current: "Current connection: old-node (2 arguments)",
      proposed: "Proposed connection: node → managed Personal Context runtime",
      changes: ["MCP executable differs.", "MCP runtime arguments differ."],
    });
    expect(JSON.stringify(codex?.connectionDifference)).not.toContain("secret-token");
  });

  it("keeps the previous current runtime when new validation fails", async () => {
    const root = await temp();
    const runtimeRoot = path.join(root, "runtime");
    const oldRelease = await fakeRelease(root, "old");
    await installManagedRuntime(runtimeRoot, "0.9.0", oldRelease);
    const newRelease = await fakeRelease(root, "new");
    const service = new SetupService({
      version: "1.0.0",
      releaseSourcePath: newRelease,
      explicitStore: path.resolve("fixtures/vault"),
      cwd: root,
      configPath: path.join(root, "config.json"),
      runtimeRoot,
      adapterFactory: (name) => new FakeAdapter(name),
      smokeTest: async () => {
        throw new Error("smoke failed");
      },
    });
    const detection = await service.detect();
    await expect(
      service.connect({
        sourceId: detection.sources[0]!.id,
        toolIds: ["codex"],
      }),
    ).rejects.toThrow("smoke failed");
    expect(await managedRuntimeVersion(runtimeRoot)).toBe("0.9.0");
  });
});

class FakeAdapter implements AgentAdapter {
  connection: AgentConnection | null = null;
  constructor(
    readonly name: AgentName,
    private readonly failApply = false,
  ) {}
  async detect(): Promise<boolean> {
    return true;
  }
  async inspect(): Promise<CommandResult> {
    return commandResult(this.connection ? 0 : 1);
  }
  async plan(connection: AgentConnection): Promise<AdapterPlan> {
    return {
      action: this.connection ? "replace" : "add",
      desired: {
        command: connection.nodePath,
        args: [connection.runtimePath, "mcp"],
        raw: "",
      },
      previous: null,
      canRollback: true,
      inspection: commandResult(this.connection ? 0 : 1),
    };
  }
  async apply(connection: AgentConnection): Promise<CommandResult> {
    if (this.failApply) return commandResult(1);
    this.connection = connection;
    return commandResult(0);
  }
  async verify(): Promise<CommandResult> {
    return commandResult(this.connection ? 0 : 1);
  }
  async rollback(): Promise<CommandResult> {
    this.connection = null;
    return commandResult(0);
  }
  async disconnect(): Promise<CommandResult> {
    this.connection = null;
    return commandResult(0);
  }
}

class ConflictAdapter extends FakeAdapter {
  override async plan(connection: AgentConnection): Promise<AdapterPlan> {
    return {
      action: "replace",
      desired: {
        command: connection.nodePath,
        args: [connection.runtimePath, "mcp"],
        raw: "",
      },
      previous: {
        command: "/old/old-node",
        args: ["--token", "secret-token"],
        raw: "",
      },
      canRollback: true,
      inspection: commandResult(0),
    };
  }
}

function commandResult(exitCode: number): CommandResult {
  return { command: "fake", args: [], exitCode, stdout: "", stderr: "" };
}

async function fakeRelease(root: string, name: string): Promise<string> {
  const release = path.join(root, `release-${name}`);
  await fs.mkdir(release);
  await fs.writeFile(
    path.join(release, "personal-context.mjs"),
    `// ${name}\n`,
  );
  return release;
}
