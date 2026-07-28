import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  createReloadingKnowledgeRuntime,
  discoverMarkdownFolders,
  discoverObsidianVaults,
  discoverRegisteredObsidianVaults,
  resolveStorePath,
} from "../packages/core/src/runtime.js";
import { installManagedRuntime, managedRuntimeVersion } from "../packages/runtime/src/index.js";

const temporary: string[] = [];
async function temp(): Promise<string> { const value = await fs.mkdtemp(path.join(os.tmpdir(), "personal-context-")); temporary.push(value); return value; }
afterEach(async () => { await Promise.all(temporary.splice(0).map((directory) => fs.rm(directory, { recursive: true, force: true }))); });

describe("user store resolution", () => {
  it("uses argument, then environment, then config", async () => {
    const root = await temp();
    const config = path.join(root, "config.json");
    await fs.writeFile(config, JSON.stringify({ store: "from-config" }));
    expect((await resolveStorePath({ store: "from-argument", environment: { PERSONAL_CONTEXT_STORE: "from-env" }, configPath: config })).source).toBe("argument");
    expect((await resolveStorePath({ environment: { PERSONAL_CONTEXT_STORE: "from-env" }, configPath: config })).source).toBe("environment");
    const resolved = await resolveStorePath({ environment: {}, configPath: config });
    expect(resolved.source).toBe("config");
    expect(resolved.storePath).toBe(path.resolve("from-config"));
  });
});

describe("vault discovery", () => {
  it("is bounded and only reads directory markers", async () => {
    const root = await temp();
    await fs.mkdir(path.join(root, "vault", ".obsidian"), { recursive: true });
    await fs.mkdir(path.join(root, "vault", "Wiki"));
    await fs.writeFile(path.join(root, "vault", ".obsidian", "data.json"), "not json");
    await fs.mkdir(path.join(root, "deep", "one", "two"), { recursive: true });
    const vaults = await discoverObsidianVaults(root, { maxDepth: 1 });
    expect(vaults).toEqual([{ path: path.join(root, "vault"), storePath: path.join(root, "vault", "Wiki"), hasObsidianMarker: true }]);
  });

  it("reads the official Obsidian registry envelope", async () => {
    const root = await temp();
    const vault = path.join(root, "vault");
    await fs.mkdir(path.join(vault, ".obsidian"), { recursive: true });
    await fs.mkdir(path.join(vault, "Wiki"));
    const registry = path.join(root, "obsidian.json");
    await fs.writeFile(
      registry,
      JSON.stringify({ vaults: { abc123: { path: vault, open: true } } }),
    );
    expect(await discoverRegisteredObsidianVaults(registry)).toEqual([
      {
        path: vault,
        storePath: path.join(vault, "Wiki"),
        hasObsidianMarker: true,
      },
    ]);
  });

  it("detects a bounded ordinary Markdown knowledge folder without treating a code project as one", async () => {
    const root = await temp();
    const notes = path.join(root, "Notes");
    const project = path.join(root, "project");
    await fs.mkdir(notes);
    await fs.mkdir(project);
    await fs.writeFile(path.join(notes, "first.md"), "# First");
    await fs.writeFile(path.join(project, "README.md"), "# Project");
    await fs.writeFile(path.join(project, "package.json"), "{}");
    expect(await discoverMarkdownFolders(root, { maxDepth: 1 })).toEqual([
      { path: notes, storePath: notes, hasObsidianMarker: false },
    ]);
  });
});

describe("managed runtime", () => {
  it("installs a version and atomically points current at it", async () => {
    const root = await temp();
    const source = path.join(root, "source");
    await fs.mkdir(source);
    await fs.writeFile(path.join(source, "personal-context.mjs"), "export {};");
    const installed = await installManagedRuntime(path.join(root, "managed"), "1.2.3", source);
    expect(await fs.readFile(path.join(installed.currentPath, "personal-context.mjs"), "utf8")).toContain("export");
    expect(await managedRuntimeVersion(path.join(root, "managed"))).toBe("1.2.3");
  });
});

describe("live knowledge reload", () => {
  it("atomically exposes Markdown changes without restarting", async () => {
    const root = await temp();
    await fs.writeFile(
      path.join(root, "first.md"),
      "---\ntitle: First note\ntype: knowledge\n---\n# First note\n",
    );
    const runtime = await createReloadingKnowledgeRuntime({
      storePath: root,
      playbookPath: null,
    });
    try {
      expect(runtime.index().search("First note")).toHaveLength(1);
      const started = Date.now();
      await fs.writeFile(
        path.join(root, "second.md"),
        "---\ntitle: Reloaded note\ntype: knowledge\n---\n# Reloaded note\nlive marker\n",
      );
      while (
        runtime.index().search("live marker").length === 0 &&
        Date.now() - started < 2_000
      ) {
        await new Promise((resolve) => setTimeout(resolve, 40));
      }
      expect(runtime.index().search("live marker")[0]?.title).toBe(
        "Reloaded note",
      );
      expect(Date.now() - started).toBeLessThan(2_000);
    } finally {
      await runtime.watcher.close();
    }
  });
});
