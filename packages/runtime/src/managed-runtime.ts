import { constants, promises as fs } from "node:fs";
import path from "node:path";

export interface ManagedRuntime { root: string; version: string; releasePath: string; currentPath: string; }

/** Installs a versioned release and flips `current` only after a complete staged copy succeeds. */
export async function installManagedRuntime(
  root: string,
  version: string,
  sourceDirectory: string,
  validate?: (releasePath: string) => Promise<void>,
): Promise<ManagedRuntime> {
  validateVersion(version);
  const absoluteRoot = path.resolve(root);
  const releases = path.join(absoluteRoot, "releases");
  const releasePath = path.join(releases, version);
  const currentPath = path.join(absoluteRoot, "current");
  await fs.mkdir(releases, { recursive: true });
  await fs.access(sourceDirectory, constants.R_OK);
  try {
    await fs.access(releasePath);
  } catch {
    const staging = path.join(
      releases,
      `.${version}-${process.pid}-${Date.now()}`,
    );
    await fs.cp(sourceDirectory, staging, {
      recursive: true,
      force: true,
      errorOnExist: true,
    });
    try {
      await fs.rename(staging, releasePath);
    } catch (error) {
      await fs.rm(staging, { recursive: true, force: true });
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    }
  }
  await validate?.(releasePath);
  const next = path.join(absoluteRoot, `.current-${process.pid}-${Date.now()}`);
  await fs.symlink(
    path.relative(absoluteRoot, releasePath),
    next,
    process.platform === "win32" ? "junction" : "dir",
  );
  await replaceCurrent(next, currentPath);
  return { root: absoluteRoot, version, releasePath, currentPath };
}

export async function managedRuntimeVersion(root: string): Promise<string | null> {
  try { return path.basename(await fs.realpath(path.join(root, "current"))); } catch { return null; }
}

function validateVersion(version: string): void {
  if (!/^[0-9A-Za-z][0-9A-Za-z._-]{0,127}$/.test(version)) throw new Error("Runtime version must be a safe filename.");
}

async function replaceCurrent(next: string, current: string): Promise<void> {
  try {
    await fs.rename(next, current);
    return;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== "EEXIST" && code !== "ENOTEMPTY" && code !== "EPERM") {
      throw error;
    }
  }
  const previous = `${current}.previous-${process.pid}-${Date.now()}`;
  await fs.rename(current, previous);
  try {
    await fs.rename(next, current);
    await fs.rm(previous, { recursive: true, force: true });
  } catch (error) {
    await fs.rename(previous, current);
    await fs.rm(next, { recursive: true, force: true });
    throw error;
  }
}
