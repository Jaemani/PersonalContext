import { constants, promises as fs } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import {
  DOCUMENTATION_EVALUATION_SUITE_ID,
  OPERATIONAL_EVALUATION_SUITE_ID,
  type DocumentationEvaluationManifest,
  type LoadedPrivateEvaluationManifest,
  type LoadPrivateEvaluationManifestOptions,
  type OperationalEvaluationManifest,
  type PrivateEvaluationManifest,
  type PrivateManifestSummary,
} from "./types.js";

export type PrivateManifestErrorCode =
  | "PATH_UNAVAILABLE"
  | "FILE_NOT_REGULAR"
  | "SYMLINK_NOT_ALLOWED"
  | "DIRECTORY_PERMISSION_MISMATCH"
  | "FILE_PERMISSION_MISMATCH"
  | "EXPECTED_HASH_INVALID"
  | "HASH_MISMATCH"
  | "INVALID_JSON"
  | "INVALID_STRUCTURE"
  | "PRODUCTION_INDEX_NOT_DISABLED"
  | "UNKNOWN_SUITE";

export class PrivateManifestError extends Error {
  constructor(public readonly code: PrivateManifestErrorCode) {
    super(`Private evaluation manifest rejected (${code}).`);
    this.name = "PrivateManifestError";
  }
}

function reject(code: PrivateManifestErrorCode): never {
  throw new PrivateManifestError(code);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function assertCommonStructure(
  value: Record<string, unknown>,
): asserts value is Record<string, unknown> & {
  schemaVersion: 1;
  suiteId: string;
  privacy: string;
  createdAt: string;
  productionIndexAllowed: false;
} {
  if (value.productionIndexAllowed !== false) {
    reject("PRODUCTION_INDEX_NOT_DISABLED");
  }

  if (
    value.schemaVersion !== 1 ||
    typeof value.suiteId !== "string" ||
    typeof value.privacy !== "string" ||
    value.privacy.trim().length === 0 ||
    typeof value.createdAt !== "string" ||
    value.createdAt.trim().length === 0
  ) {
    reject("INVALID_STRUCTURE");
  }
}

function parseManifest(value: unknown): PrivateEvaluationManifest {
  if (!isRecord(value)) {
    reject("INVALID_STRUCTURE");
  }

  assertCommonStructure(value);

  if (value.suiteId === DOCUMENTATION_EVALUATION_SUITE_ID) {
    if (
      !Array.isArray(value.cases) ||
      value.cases.length === 0 ||
      !value.cases.every(isRecord) ||
      "fixture" in value
    ) {
      reject("INVALID_STRUCTURE");
    }
    return value as unknown as DocumentationEvaluationManifest;
  }

  if (value.suiteId === OPERATIONAL_EVALUATION_SUITE_ID) {
    if (!isRecord(value.fixture) || "cases" in value) {
      reject("INVALID_STRUCTURE");
    }
    return value as unknown as OperationalEvaluationManifest;
  }

  reject("UNKNOWN_SUITE");
}

function summarize(
  manifest: PrivateEvaluationManifest,
  sha256: string,
): PrivateManifestSummary {
  if (manifest.suiteId === DOCUMENTATION_EVALUATION_SUITE_ID) {
    return {
      schemaVersion: manifest.schemaVersion,
      suiteId: manifest.suiteId,
      suiteKind: "documentation",
      privacy: manifest.privacy,
      createdAt: manifest.createdAt,
      productionIndexAllowed: false,
      itemCount: manifest.cases.length,
      sha256,
    };
  }

  return {
    schemaVersion: manifest.schemaVersion,
    suiteId: manifest.suiteId,
    suiteKind: "operational",
    privacy: manifest.privacy,
    createdAt: manifest.createdAt,
    productionIndexAllowed: false,
    itemCount: 1,
    sha256,
  };
}

async function readSecureManifest(
  manifestPath: string,
): Promise<{ bytes: Buffer; mode: number }> {
  let initialStat;
  try {
    initialStat = await fs.lstat(manifestPath);
  } catch {
    reject("PATH_UNAVAILABLE");
  }

  if (initialStat.isSymbolicLink()) {
    reject("SYMLINK_NOT_ALLOWED");
  }
  if (!initialStat.isFile()) {
    reject("FILE_NOT_REGULAR");
  }

  let parentStat;
  try {
    parentStat = await fs.stat(path.dirname(manifestPath));
  } catch {
    reject("PATH_UNAVAILABLE");
  }
  if (!parentStat.isDirectory()) {
    reject("PATH_UNAVAILABLE");
  }

  if (process.platform !== "win32") {
    if ((parentStat.mode & 0o7777) !== 0o700) {
      reject("DIRECTORY_PERMISSION_MISMATCH");
    }
    if ((initialStat.mode & 0o7777) !== 0o600) {
      reject("FILE_PERMISSION_MISMATCH");
    }
  }

  const noFollowFlag =
    process.platform === "win32" ? 0 : constants.O_NOFOLLOW;
  let handle;
  try {
    handle = await fs.open(manifestPath, constants.O_RDONLY | noFollowFlag);
    const openedStat = await handle.stat();
    if (
      !openedStat.isFile() ||
      openedStat.dev !== initialStat.dev ||
      openedStat.ino !== initialStat.ino
    ) {
      reject("FILE_NOT_REGULAR");
    }
    return {
      bytes: await handle.readFile(),
      mode: openedStat.mode,
    };
  } catch (error) {
    if (error instanceof PrivateManifestError) {
      throw error;
    }
    reject("PATH_UNAVAILABLE");
  } finally {
    await handle?.close();
  }

  return reject("PATH_UNAVAILABLE");
}

export async function loadPrivateEvaluationManifest(
  options: LoadPrivateEvaluationManifestOptions,
): Promise<LoadedPrivateEvaluationManifest> {
  const expectedSha256 = options.expectedSha256.trim().toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(expectedSha256)) {
    reject("EXPECTED_HASH_INVALID");
  }

  const { bytes } = await readSecureManifest(options.manifestPath);
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  if (sha256 !== expectedSha256) {
    reject("HASH_MISMATCH");
  }

  let raw: unknown;
  try {
    raw = JSON.parse(bytes.toString("utf8")) as unknown;
  } catch {
    reject("INVALID_JSON");
  }

  const manifest = parseManifest(raw);
  return {
    manifest,
    summary: summarize(manifest, sha256),
  };
}
