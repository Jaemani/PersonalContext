import {
  chmod,
  link,
  lstat,
  mkdir,
  open,
  realpath,
  rm,
  stat,
} from "node:fs/promises";
import path from "node:path";

export interface PrivateRunStoreOptions {
  outputRoot: string;
  runId: string;
  forbiddenRoots: string[];
}

export type PrivateRunLocationOptions = Omit<PrivateRunStoreOptions, "runId">;

export interface PrivateRunStore {
  attemptRoot: string;
  writeJson(relativePath: string, value: unknown): Promise<string>;
}

export type PrivateRunStoreErrorCode =
  | "INVALID_RUN_ID"
  | "PROTECTED_ROOT_OVERLAP"
  | "ATTEMPT_EXISTS"
  | "INVALID_OUTPUT_PATH"
  | "OUTPUT_ROOT_PERMISSION_MISMATCH"
  | "OUTPUT_EXISTS"
  | "STORE_UNAVAILABLE";

export class PrivateRunStoreError extends Error {
  constructor(readonly code: PrivateRunStoreErrorCode) {
    super(`Private run store rejected the operation (${code}).`);
    this.name = "PrivateRunStoreError";
  }
}

export async function createPrivateRunStore(
  options: PrivateRunStoreOptions,
): Promise<PrivateRunStore> {
  if (!/^[A-Za-z0-9._-]{1,100}$/.test(options.runId)) {
    throw new PrivateRunStoreError("INVALID_RUN_ID");
  }

  const outputRoot = await validatedOutputRoot(options);

  let attemptRoot: string;
  try {
    await mkdir(outputRoot, { recursive: true, mode: 0o700 });
    if (process.platform !== "win32") await chmod(outputRoot, 0o700);
    attemptRoot = path.join(outputRoot, options.runId);
    await mkdir(attemptRoot, { mode: 0o700 });
    if (process.platform !== "win32") await chmod(attemptRoot, 0o700);
  } catch (error) {
    if (isNodeError(error) && error.code === "EEXIST") {
      throw new PrivateRunStoreError("ATTEMPT_EXISTS");
    }
    throw new PrivateRunStoreError("STORE_UNAVAILABLE");
  }

  return {
    attemptRoot,
    async writeJson(relativePath, value) {
      const target = safeChildPath(attemptRoot, relativePath);
      const temporary = `${target}.tmp-${process.pid}-${crypto.randomUUID()}`;
      try {
        await mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
        if (process.platform !== "win32") {
          await chmod(path.dirname(target), 0o700);
        }
        const handle = await open(temporary, "wx", 0o600);
        try {
          await handle.writeFile(`${JSON.stringify(value, null, 2)}\n`, "utf8");
          await handle.sync();
        } finally {
          await handle.close();
        }
        await link(temporary, target);
        if (process.platform !== "win32") await chmod(target, 0o600);
      } catch (error) {
        if (isNodeError(error) && error.code === "EEXIST") {
          throw new PrivateRunStoreError("OUTPUT_EXISTS");
        }
        if (error instanceof PrivateRunStoreError) throw error;
        throw new PrivateRunStoreError("STORE_UNAVAILABLE");
      } finally {
        try {
          await rm(temporary, { force: true });
        } catch {
          throw new PrivateRunStoreError("STORE_UNAVAILABLE");
        }
      }
      return target;
    },
  };
}

export async function validatePrivateRunLocation(
  options: PrivateRunLocationOptions,
): Promise<void> {
  await validatedOutputRoot(options);
}

async function validatedOutputRoot(
  options: PrivateRunLocationOptions,
): Promise<string> {
  const outputRoot = await canonicalProspectivePath(options.outputRoot);
  for (const forbiddenRoot of options.forbiddenRoots) {
    const canonicalForbidden = await canonicalProspectivePath(forbiddenRoot);
    if (pathsOverlap(outputRoot, canonicalForbidden)) {
      throw new PrivateRunStoreError("PROTECTED_ROOT_OVERLAP");
    }
  }
  try {
    const outputStat = await lstat(path.resolve(options.outputRoot));
    if (outputStat.isSymbolicLink() || !outputStat.isDirectory()) {
      throw new PrivateRunStoreError("INVALID_OUTPUT_PATH");
    }
    if (
      process.platform !== "win32" &&
      (outputStat.mode & 0o7777) !== 0o700
    ) {
      throw new PrivateRunStoreError("OUTPUT_ROOT_PERMISSION_MISMATCH");
    }
  } catch (error) {
    if (error instanceof PrivateRunStoreError) throw error;
    if (!isNodeError(error) || error.code !== "ENOENT") {
      throw new PrivateRunStoreError("STORE_UNAVAILABLE");
    }
  }
  return outputRoot;
}

function safeChildPath(root: string, relativePath: string): string {
  if (
    !relativePath ||
    path.isAbsolute(relativePath) ||
    relativePath.split(/[\\/]/).includes("..")
  ) {
    throw new PrivateRunStoreError("INVALID_OUTPUT_PATH");
  }
  const target = path.resolve(root, relativePath);
  if (!isWithin(root, target)) {
    throw new PrivateRunStoreError("INVALID_OUTPUT_PATH");
  }
  return target;
}

async function canonicalProspectivePath(value: string): Promise<string> {
  const absolute = path.resolve(value);
  try {
    return await realpath(absolute);
  } catch {
    const parent = path.dirname(absolute);
    if (parent === absolute) return absolute;
    return path.join(await canonicalProspectivePath(parent), path.basename(absolute));
  }
}

function pathsOverlap(left: string, right: string): boolean {
  return isWithin(left, right) || isWithin(right, left);
}

function isWithin(parent: string, candidate: string): boolean {
  const relative = path.relative(parent, candidate);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

export async function privatePathMode(value: string): Promise<number> {
  return (await stat(value)).mode & 0o777;
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
