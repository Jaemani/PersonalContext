import { promises as fs } from "node:fs";
import path from "node:path";

const SKIPPED = new Set([".git", ".trash", "node_modules", "dist"]);
const KNOWLEDGE_DIRECTORY_NAMES = new Set([
  "knowledge",
  "knowledge-base",
  "notes",
  "vault",
  "wiki",
]);

export interface VaultDiscoveryOptions {
  maxDepth?: number;
  maxDirectories?: number;
}

export interface VaultCandidate {
  path: string;
  storePath: string;
  hasObsidianMarker: boolean;
}

/** Finds likely ordinary Markdown knowledge roots without scanning whole homes. */
export async function discoverMarkdownFolders(
  startPath: string,
  options: VaultDiscoveryOptions = {},
): Promise<VaultCandidate[]> {
  const maxDepth = options.maxDepth ?? 2;
  const maxDirectories = options.maxDirectories ?? 150;
  const found: VaultCandidate[] = [];
  let visited = 0;
  async function visit(directory: string, depth: number): Promise<void> {
    if (visited >= maxDirectories || depth > maxDepth) return;
    visited += 1;
    let entries: import("node:fs").Dirent[];
    try {
      entries = await fs.readdir(directory, { withFileTypes: true });
    } catch {
      return;
    }
    const markdownCount = entries.filter(
      (entry) => entry.isFile() && entry.name.toLowerCase().endsWith(".md"),
    ).length;
    const hasProjectManifest = entries.some(
      (entry) =>
        entry.isFile() &&
        (entry.name === "package.json" ||
          entry.name === "pyproject.toml" ||
          entry.name === "Cargo.toml"),
    );
    const recognizedName = KNOWLEDGE_DIRECTORY_NAMES.has(
      path.basename(directory).toLowerCase(),
    );
    if (
      markdownCount > 0 &&
      (recognizedName || (markdownCount >= 3 && !hasProjectManifest))
    ) {
      found.push({
        path: directory,
        storePath: directory,
        hasObsidianMarker: false,
      });
      return;
    }
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name.startsWith(".") || SKIPPED.has(entry.name)) {
        continue;
      }
      await visit(path.join(directory, entry.name), depth + 1);
    }
  }
  await visit(path.resolve(startPath), 0);
  return found;
}

/** Reads Obsidian's vault registry only (never a vault plugin's data.json). */
export async function discoverRegisteredObsidianVaults(
  registryPath: string,
  maxVaults = 50,
): Promise<VaultCandidate[]> {
  let raw: unknown;
  try { raw = JSON.parse(await fs.readFile(registryPath, "utf8")); } catch { return []; }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return [];
  const root = raw as Record<string, unknown>;
  const registered =
    root.vaults &&
    typeof root.vaults === "object" &&
    !Array.isArray(root.vaults)
      ? (root.vaults as Record<string, unknown>)
      : root;
  const candidates: VaultCandidate[] = [];
  for (const value of Object.values(registered).slice(0, maxVaults)) {
    if (!value || typeof value !== "object" || Array.isArray(value)) continue;
    const vaultPath = (value as Record<string, unknown>).path;
    if (typeof vaultPath !== "string" || !path.isAbsolute(vaultPath)) continue;
    try {
      const entries = await fs.readdir(vaultPath, { withFileTypes: true });
      const wiki = entries.some((entry) => entry.isDirectory() && entry.name === "Wiki");
      candidates.push({ path: vaultPath, storePath: wiki ? path.join(vaultPath, "Wiki") : vaultPath, hasObsidianMarker: entries.some((entry) => entry.isDirectory() && entry.name === ".obsidian") });
    } catch { /* stale official registry entry */ }
  }
  return candidates;
}

/** Finds vault roots by directory markers only; no .obsidian contents are read. */
export async function discoverObsidianVaults(
  startPath: string,
  options: VaultDiscoveryOptions = {},
): Promise<VaultCandidate[]> {
  const maxDepth = options.maxDepth ?? 4;
  const maxDirectories = options.maxDirectories ?? 250;
  const found: VaultCandidate[] = [];
  let visited = 0;
  async function visit(directory: string, depth: number): Promise<void> {
    if (visited >= maxDirectories || depth > maxDepth) return;
    visited += 1;
    let entries: import("node:fs").Dirent[];
    try { entries = await fs.readdir(directory, { withFileTypes: true }); } catch { return; }
    const hasObsidianMarker = entries.some((entry) => entry.isDirectory() && entry.name === ".obsidian");
    const wiki = entries.find((entry) => entry.isDirectory() && entry.name === "Wiki");
    if (hasObsidianMarker) found.push({ path: directory, storePath: wiki ? path.join(directory, "Wiki") : directory, hasObsidianMarker });
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name === ".obsidian" || SKIPPED.has(entry.name)) continue;
      await visit(path.join(directory, entry.name), depth + 1);
    }
  }
  await visit(path.resolve(startPath), 0);
  return found;
}
