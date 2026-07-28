import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

export interface PersonalContextUserConfig {
  schemaVersion?: number;
  knowledgeRoot?: string;
  lastValidatedAt?: string;
  /** Legacy field retained for pre-0.2 config compatibility. */
  store?: string;
  playbook?: string;
}

export interface StoreResolutionOptions {
  store?: string | null;
  environment?: NodeJS.ProcessEnv;
  configPath?: string;
}

export interface StoreResolution {
  storePath: string | null;
  source: "argument" | "environment" | "config" | "none";
  configPath: string;
}

/** Resolve the canonical store without ever writing configuration. */
export async function resolveStorePath(
  options: StoreResolutionOptions = {},
): Promise<StoreResolution> {
  const environment = options.environment ?? process.env;
  const configPath = options.configPath ?? defaultUserConfigPath(environment);
  const explicit = options.store?.trim();
  if (explicit) return resolved(explicit, "argument", configPath);
  const fromEnvironment = environment.PERSONAL_CONTEXT_STORE?.trim();
  if (fromEnvironment) return resolved(fromEnvironment, "environment", configPath);
  const config = await readUserConfig(configPath);
  const configuredStore = config.knowledgeRoot ?? config.store;
  return configuredStore?.trim()
    ? resolved(configuredStore, "config", configPath)
    : { storePath: null, source: "none", configPath };
}

export async function readUserConfig(
  configPath = defaultUserConfigPath(process.env),
): Promise<PersonalContextUserConfig> {
  try {
    const parsed: unknown = JSON.parse(await fs.readFile(configPath, "utf8"));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const value = parsed as Record<string, unknown>;
    return {
      ...(typeof value.schemaVersion === "number" ? { schemaVersion: value.schemaVersion } : {}),
      ...(typeof value.knowledgeRoot === "string" ? { knowledgeRoot: value.knowledgeRoot } : {}),
      ...(typeof value.lastValidatedAt === "string" ? { lastValidatedAt: value.lastValidatedAt } : {}),
      ...(typeof value.store === "string" ? { store: value.store } : {}),
      ...(typeof value.playbook === "string" ? { playbook: value.playbook } : {}),
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return {};
    throw error;
  }
}

export async function writeUserConfig(
  config: Required<
    Pick<
      PersonalContextUserConfig,
      "schemaVersion" | "knowledgeRoot" | "lastValidatedAt"
    >
  >,
  configPath = defaultUserConfigPath(process.env),
): Promise<void> {
  const directory = path.dirname(configPath);
  await fs.mkdir(directory, { recursive: true });
  const temporary = path.join(
    directory,
    `.config-${process.pid}-${Date.now()}.json`,
  );
  await fs.writeFile(temporary, `${JSON.stringify(config, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
  await fs.rename(temporary, configPath);
}

export function defaultUserConfigPath(environment: NodeJS.ProcessEnv): string {
  const home = environment.HOME ?? environment.USERPROFILE ?? os.homedir();
  const base = environment.XDG_CONFIG_HOME ?? path.join(home, ".config");
  return path.join(base, "personal-context", "config.json");
}

function resolved(value: string, source: StoreResolution["source"], configPath: string): StoreResolution {
  return { storePath: path.resolve(value), source, configPath };
}
