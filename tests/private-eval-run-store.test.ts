import { access, mkdtemp, mkdir, readFile, symlink } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  createPrivateRunStore,
  privatePathMode,
  PrivateRunStoreError,
  validatePrivateRunLocation,
} from "../packages/evaluation/src/run-store.js";

const temporary: string[] = [];

afterEach(async () => {
  const { rm } = await import("node:fs/promises");
  await Promise.all(
    temporary.splice(0).map((value) => rm(value, { recursive: true, force: true })),
  );
});

describe("private evaluation run store", () => {
  it("validates an isolated prospective root without creating output", async () => {
    const root = await temp();
    const outputRoot = path.join(root, "runs");

    await validatePrivateRunLocation({
      outputRoot,
      forbiddenRoots: [path.join(root, "knowledge")],
    });

    await expect(access(outputRoot)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("writes immutable private JSON files", async () => {
    const root = await temp();
    const store = await createPrivateRunStore({
      outputRoot: path.join(root, "runs"),
      runId: "run-1",
      forbiddenRoots: [path.join(root, "knowledge")],
    });

    const target = await store.writeJson("condition-a/result.json", {
      caseId: "case-1",
    });

    expect(JSON.parse(await readFile(target, "utf8"))).toEqual({
      caseId: "case-1",
    });
    if (process.platform !== "win32") {
      expect(await privatePathMode(store.attemptRoot)).toBe(0o700);
      expect(await privatePathMode(target)).toBe(0o600);
    }
    await expect(
      store.writeJson("condition-a/result.json", { caseId: "changed" }),
    ).rejects.toMatchObject({
      code: "OUTPUT_EXISTS",
    } satisfies Partial<PrivateRunStoreError>);
  });

  it("rejects protected-root overlap and path traversal", async () => {
    const root = await temp();
    const knowledge = path.join(root, "knowledge");
    await mkdir(knowledge);

    await expect(
      createPrivateRunStore({
        outputRoot: path.join(knowledge, "runs"),
        runId: "run-1",
        forbiddenRoots: [knowledge],
      }),
    ).rejects.toMatchObject({
      code: "PROTECTED_ROOT_OVERLAP",
    } satisfies Partial<PrivateRunStoreError>);

    const store = await createPrivateRunStore({
      outputRoot: path.join(root, "runs"),
      runId: "run-2",
      forbiddenRoots: [knowledge],
    });
    await expect(store.writeJson("../escape.json", {})).rejects.toMatchObject({
      code: "INVALID_OUTPUT_PATH",
    } satisfies Partial<PrivateRunStoreError>);
  });

  it("resolves symlinks before checking protected roots", async () => {
    const root = await temp();
    const knowledge = path.join(root, "knowledge");
    const link = path.join(root, "linked-output");
    await mkdir(knowledge);
    await symlink(knowledge, link);

    await expect(
      createPrivateRunStore({
        outputRoot: link,
        runId: "run-1",
        forbiddenRoots: [knowledge],
      }),
    ).rejects.toMatchObject({
      code: "PROTECTED_ROOT_OVERLAP",
    } satisfies Partial<PrivateRunStoreError>);
  });
});

async function temp(): Promise<string> {
  const value = await mkdtemp(path.join(os.tmpdir(), "personal-context-eval-"));
  temporary.push(value);
  return value;
}
