import { access } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PersonalKnowledgeIndex } from "./index.js";
import { readKnowledgeStore } from "./markdown.js";

export interface RuntimeOptions {
  storePath: string;
  playbookPath?: string | null;
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
export * from "./evaluate.js";
export * from "./index.js";
export * from "./markdown.js";
export * from "./types.js";
