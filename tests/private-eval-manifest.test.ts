import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  loadPrivateEvaluationManifest,
  PrivateManifestError,
  type PrivateManifestErrorCode,
} from "../packages/evaluation/src/manifest.js";
import {
  DOCUMENTATION_EVALUATION_SUITE_ID,
  OPERATIONAL_EVALUATION_SUITE_ID,
} from "../packages/evaluation/src/types.js";

const temporaryRoots: string[] = [];

async function writeManifest(
  manifest: Record<string, unknown>,
): Promise<{
  manifestPath: string;
  expectedSha256: string;
  root: string;
}> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "private-eval-"));
  temporaryRoots.push(root);
  await fs.chmod(root, 0o700);
  const manifestPath = path.join(root, "manifest.json");
  const bytes = Buffer.from(JSON.stringify(manifest));
  await fs.writeFile(manifestPath, bytes, { mode: 0o600 });
  await fs.chmod(manifestPath, 0o600);
  return {
    manifestPath,
    expectedSha256: createHash("sha256").update(bytes).digest("hex"),
    root,
  };
}

function commonManifest() {
  return {
    schemaVersion: 1,
    privacy: "private-local-only",
    createdAt: "2026-07-28",
    productionIndexAllowed: false,
  };
}

async function expectRejection(
  promise: Promise<unknown>,
  code: PrivateManifestErrorCode,
  forbiddenValue?: string,
) {
  try {
    await promise;
    throw new Error("Expected private manifest rejection.");
  } catch (error) {
    expect(error).toBeInstanceOf(PrivateManifestError);
    const manifestError = error as PrivateManifestError;
    expect(manifestError.code).toBe(code);
    if (forbiddenValue) {
      expect(manifestError.message).not.toContain(forbiddenValue);
    }
  }
}

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((root) =>
      fs.rm(root, { recursive: true, force: true }),
    ),
  );
});

describe("private evaluation manifest guard", () => {
  it("loads a valid documentation manifest with a redacted summary", async () => {
    const fixture = await writeManifest({
      ...commonManifest(),
      suiteId: DOCUMENTATION_EVALUATION_SUITE_ID,
      cases: [{ id: "opaque-case", taskInput: "sensitive task" }],
    });

    const loaded = await loadPrivateEvaluationManifest(fixture);

    expect(loaded.summary).toEqual({
      schemaVersion: 1,
      suiteId: DOCUMENTATION_EVALUATION_SUITE_ID,
      suiteKind: "documentation",
      privacy: "private-local-only",
      createdAt: "2026-07-28",
      productionIndexAllowed: false,
      itemCount: 1,
      sha256: fixture.expectedSha256,
    });
    expect(JSON.stringify(loaded.summary)).not.toContain("sensitive task");
  });

  it("loads a valid operational manifest without exposing fixture fields", async () => {
    const fixture = await writeManifest({
      ...commonManifest(),
      suiteId: OPERATIONAL_EVALUATION_SUITE_ID,
      fixture: { id: "opaque-fixture", secretReference: "sensitive value" },
    });

    const loaded = await loadPrivateEvaluationManifest(fixture);

    expect(loaded.summary.suiteKind).toBe("operational");
    expect(loaded.summary.itemCount).toBe(1);
    expect(JSON.stringify(loaded.summary)).not.toContain("sensitive value");
  });

  it("rejects a hash mismatch without exposing manifest contents", async () => {
    const fixture = await writeManifest({
      ...commonManifest(),
      suiteId: DOCUMENTATION_EVALUATION_SUITE_ID,
      cases: [{ taskInput: "do-not-leak" }],
    });

    await expectRejection(
      loadPrivateEvaluationManifest({
        manifestPath: fixture.manifestPath,
        expectedSha256: "0".repeat(64),
      }),
      "HASH_MISMATCH",
      "do-not-leak",
    );
  });

  it.runIf(process.platform !== "win32")(
    "rejects permission mismatches",
    async () => {
      const fixture = await writeManifest({
        ...commonManifest(),
        suiteId: DOCUMENTATION_EVALUATION_SUITE_ID,
        cases: [{}],
      });
      await fs.chmod(fixture.manifestPath, 0o640);

      await expectRejection(
        loadPrivateEvaluationManifest(fixture),
        "FILE_PERMISSION_MISMATCH",
      );
    },
  );

  it("rejects production indexing without exposing the flag value", async () => {
    const fixture = await writeManifest({
      ...commonManifest(),
      productionIndexAllowed: true,
      suiteId: DOCUMENTATION_EVALUATION_SUITE_ID,
      cases: [{}],
    });

    await expectRejection(
      loadPrivateEvaluationManifest(fixture),
      "PRODUCTION_INDEX_NOT_DISABLED",
    );
  });

  it.runIf(process.platform !== "win32")(
    "rejects manifest symlinks",
    async () => {
      const fixture = await writeManifest({
        ...commonManifest(),
        suiteId: OPERATIONAL_EVALUATION_SUITE_ID,
        fixture: {},
      });
      const symlinkPath = path.join(fixture.root, "manifest-link.json");
      await fs.symlink(fixture.manifestPath, symlinkPath);

      await expectRejection(
        loadPrivateEvaluationManifest({
          manifestPath: symlinkPath,
          expectedSha256: fixture.expectedSha256,
        }),
        "SYMLINK_NOT_ALLOWED",
      );
    },
  );

  it("rejects unknown suite kinds", async () => {
    const fixture = await writeManifest({
      ...commonManifest(),
      suiteId: "UNKNOWN-SUITE",
      cases: [{}],
    });

    await expectRejection(
      loadPrivateEvaluationManifest(fixture),
      "UNKNOWN_SUITE",
    );
  });
});
