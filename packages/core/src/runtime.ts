import { access } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PersonalKnowledgeIndex } from "./index.js";
import { readKnowledgeStore } from "./markdown.js";
import { watchKnowledgeStore, type LiveReloadHandle } from "./live-reload.js";

export interface RuntimeOptions {
  storePath: string;
  playbookPath?: string | null;
}

export async function createReloadingKnowledgeRuntime(
  options: RuntimeOptions,
  onReload?: (index: PersonalKnowledgeIndex) => void,
): Promise<{ index: () => PersonalKnowledgeIndex; watcher: LiveReloadHandle }> {
  let current = await createKnowledgeRuntime(options);
  const watcher = await watchKnowledgeStore(options.storePath, async () => {
    // Build a complete new index before swapping, so readers never observe a partial reload.
    current = await createKnowledgeRuntime(options);
    onReload?.(current);
  });
  return { index: () => current, watcher };
}

export async function createKnowledgeRuntime(
  options: RuntimeOptions,
): Promise<PersonalKnowledgeIndex> {
  const knowledge = await readKnowledgeStore(options.storePath, "knowledge");
  const playbookPath =
    options.playbookPath === null
      ? null
      : options.playbookPath ?? (await findBundledPlaybook());
  const playbook = playbookPath
    ? await readKnowledgeStore(playbookPath, "playbook")
    : [];
  return new PersonalKnowledgeIndex([...knowledge, ...playbook]);
}

export async function findBundledPlaybook(): Promise<string | null> {
  const environmentPath = process.env.PERSONAL_CONTEXT_PLAYBOOK;
  const moduleDirectory = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [
    environmentPath,
    // Managed bundles may place portable playbooks beside dist/runtime.
    path.resolve(moduleDirectory, "../../../runtime/playbook"),
    path.resolve(moduleDirectory, "../../runtime/playbook"),
    path.resolve(moduleDirectory, "../../../playbook"),
    path.resolve(moduleDirectory, "../../../../playbook"),
    path.resolve(process.cwd(), "playbook"),
  ].filter((candidate): candidate is string => Boolean(candidate));

  for (const candidate of candidates) {
    try {
      await access(candidate);
      return candidate;
    } catch {
      // Try the next installation layout.
    }
  }
  return null;
}

export * from "./doctor.js";
export * from "./config.js";
export * from "./evaluate.js";
export * from "./index.js";
export * from "./markdown.js";
export * from "./types.js";
export * from "./vault.js";
export * from "./live-reload.js";
