import { promises as fs } from "node:fs";
import path from "node:path";

export interface LiveReloadOptions {
  pollIntervalMs?: number;
  debounceMs?: number;
}

export interface LiveReloadHandle {
  close(): Promise<void>;
  readonly mode: "chokidar" | "polling";
}

interface PortableWatcher {
  on(event: string, handler: (...arguments_: unknown[]) => void): this;
  once(event: string, handler: (...arguments_: unknown[]) => void): this;
  close(): Promise<void>;
}

/** Watches one store, debounces bursts, and falls back to fingerprint polling. */
export async function watchKnowledgeStore(
  directory: string,
  reload: () => Promise<void> | void,
  options: LiveReloadOptions = {},
): Promise<LiveReloadHandle> {
  let activeMode: LiveReloadHandle["mode"] = "polling";
  let closed = false;
  let debounceTimer: NodeJS.Timeout | undefined;
  let pollingTimer: NodeJS.Timeout | undefined;
  let watcher: PortableWatcher | undefined;
  let reloading = false;
  let reloadAgain = false;

  const runReload = async () => {
    if (reloading) {
      reloadAgain = true;
      return;
    }
    reloading = true;
    try {
      await reload();
    } catch {
      // A complete replacement index is built by the caller. Keep the old one.
    } finally {
      reloading = false;
      if (reloadAgain && !closed) {
        reloadAgain = false;
        scheduleReload();
      }
    }
  };

  const scheduleReload = () => {
    if (closed) return;
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(
      () => void runReload(),
      options.debounceMs ?? 150,
    );
    debounceTimer.unref();
  };

  const startPolling = async () => {
    activeMode = "polling";
    let fingerprint = await markdownFingerprint(directory).catch(() => "");
    pollingTimer = setInterval(async () => {
      try {
        const next = await markdownFingerprint(directory);
        if (next !== fingerprint) {
          fingerprint = next;
          scheduleReload();
        }
      } catch {
        // A transient directory rename is retried on the next interval.
      }
    }, options.pollIntervalMs ?? 5_000);
    pollingTimer.unref();
  };

  const chokidar = await optionalChokidar();
  if (chokidar) {
    activeMode = "chokidar";
    watcher = chokidar.watch(directory, {
      ignoreInitial: true,
      awaitWriteFinish: { stabilityThreshold: 100 },
    });
    watcher.on("add", scheduleReload);
    watcher.on("change", scheduleReload);
    watcher.on("unlink", scheduleReload);
    watcher.on("addDir", scheduleReload);
    watcher.on("unlinkDir", scheduleReload);
    watcher.on("error", () => {
      if (closed || activeMode === "polling") return;
      void watcher?.close().finally(() => {
        watcher = undefined;
        void startPolling();
      });
    });
    await new Promise<void>((resolve) => watcher?.once("ready", () => resolve()));
  } else {
    await startPolling();
  }

  return {
    get mode() {
      return activeMode;
    },
    async close() {
      closed = true;
      if (debounceTimer) clearTimeout(debounceTimer);
      if (pollingTimer) clearInterval(pollingTimer);
      await watcher?.close();
    },
  };
}

async function markdownFingerprint(root: string): Promise<string> {
  const entries: string[] = [];
  async function visit(directory: string): Promise<void> {
    for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
      if (
        entry.name === ".obsidian" ||
        entry.name === ".git" ||
        entry.name === "node_modules"
      ) {
        continue;
      }
      const candidate = path.join(directory, entry.name);
      if (entry.isDirectory()) await visit(candidate);
      else if (entry.isFile() && entry.name.toLowerCase().endsWith(".md")) {
        const stat = await fs.stat(candidate);
        entries.push(`${candidate}:${stat.size}:${stat.mtimeMs}`);
      }
    }
  }
  await visit(root);
  return entries.sort().join("|");
}

async function optionalChokidar(): Promise<{
  watch(path: string, options: object): PortableWatcher;
} | null> {
  try {
    const moduleName = "chokidar";
    return (await import(moduleName)) as never;
  } catch {
    return null;
  }
}
