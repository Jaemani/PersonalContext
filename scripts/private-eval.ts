import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { readKnowledgeStore } from "../packages/core/src/markdown.js";
import type { KnowledgeRecord } from "../packages/core/src/types.js";
import { parseDocumentationCases } from "../packages/evaluation/src/documentation-cases.js";
import { buildEligibleRecordSet } from "../packages/evaluation/src/eligible-records.js";
import { loadPrivateEvaluationManifest } from "../packages/evaluation/src/manifest.js";
import { CodexEvaluationModelAdapter } from "../packages/evaluation/src/model-adapter.js";
import type { EvaluationCondition } from "../packages/evaluation/src/prompts.js";
import { runPrivateDocumentationEvaluation } from "../packages/evaluation/src/runner.js";
import { validatePrivateRunLocation } from "../packages/evaluation/src/run-store.js";
import {
  assertCompleteEvaluationConditions,
  assertExactRunnerRevision,
  assertRunnerSourceState,
  hashKnowledgeSnapshot,
} from "../packages/evaluation/src/run-contract.js";
import {
  DOCUMENTATION_EVALUATION_SUITE_ID,
  type DocumentationMethod,
} from "../packages/evaluation/src/types.js";

const args = process.argv.slice(2);
const execFileAsync = promisify(execFile);

try {
  await main();
} catch (error) {
  process.stderr.write(`${safeErrorMessage(error)}\n`);
  process.exitCode = 1;
}

async function main(): Promise<void> {
  const manifestPath = requiredOption("--manifest");
  const expectedSha256 = requiredOption("--expected-sha");
  const storePath = path.resolve(requiredOption("--store"));
  const outputRoot = path.resolve(requiredOption("--output"));
  const modelName = requiredOption("--model");
  const reasoningEffort = requiredOption("--reasoning-effort");
  const conditions = parseConditions(option("--conditions") ?? "A,B,C");
  assertCompleteEvaluationConditions(conditions);
  const runnerRevision = assertExactRunnerRevision(
    requiredOption("--runner-revision"),
  );
  const sourceRepositoryRoot = await verifyRunnerSourceRevision(runnerRevision);
  const forbiddenRoots = [storePath, sourceRepositoryRoot];
  const loaded = await loadPrivateEvaluationManifest({
    manifestPath,
    expectedSha256,
  });
  await validatePrivateRunLocation({ outputRoot, forbiddenRoots });
  let records: KnowledgeRecord[] = [];
  let exclusionCount = 0;
  let knowledgeSnapshotSha256: string | null = null;
  let routerContract = "";
  let methodContracts: Partial<Record<DocumentationMethod, string>> = {};
  let currentRules: string[] = [];
  if (loaded.manifest.suiteId === DOCUMENTATION_EVALUATION_SUITE_ID) {
    records = await readKnowledgeStore(storePath, "knowledge");
    knowledgeSnapshotSha256 = hashKnowledgeSnapshot(records);
    ({ routerContract, methodContracts, currentRules } =
      await loadDocumentationContracts(storePath));
    for (const testCase of parseDocumentationCases(loaded.manifest)) {
      const eligible = buildEligibleRecordSet(records, {
        suiteId: loaded.manifest.suiteId,
        caseId: testCase.input.id,
        sourceRecords: testCase.input.sourceRecords,
        excludedEvidenceIds: testCase.input.excludedEvidenceIds,
      });
      exclusionCount += eligible.excludedRecordIds.length;
    }
  }
  if (args.includes("--validate-only")) {
    process.stdout.write(
      `${JSON.stringify({
        suiteId: loaded.summary.suiteId,
        itemCount: loaded.summary.itemCount,
        manifestSha256: loaded.summary.sha256,
        exclusionCount,
        conditions,
        modelPinned: Boolean(modelName),
        reasoningEffortPinned: Boolean(reasoningEffort),
        runnerRevisionPinned: true,
        knowledgeSnapshotSha256,
        outputIsolated: true,
        valid: true,
      })}\n`,
    );
    return;
  }
  if (loaded.manifest.suiteId !== DOCUMENTATION_EVALUATION_SUITE_ID) {
    throw new Error(
      "This runner revision supports the documentation suite only. Operational conditions use their own contract.",
    );
  }
  const runId = `run-${new Date().toISOString().replace(/[:.]/g, "-")}-${randomUUID().slice(0, 8)}`;
  const model = new CodexEvaluationModelAdapter({
    model: modelName,
    reasoningEffort,
  });
  const result = await runPrivateDocumentationEvaluation({
    manifest: loaded.manifest,
    manifestSummary: loaded.summary,
    records,
    conditions,
    model,
    outputRoot,
    runId,
    forbiddenRoots,
    runnerRevision,
    modelDescription: `codex:${modelName}:${reasoningEffort}`,
    currentRules,
    routerContract,
    methodContracts,
  });
  process.stdout.write(
    `${JSON.stringify({
      runId: result.runId,
      suiteId: loaded.summary.suiteId,
      caseCount: result.caseCount,
      resultCount: result.resultHashes.length,
      knowledgeSnapshotSha256: result.knowledgeSnapshotSha256,
      blindReviewPacketSha256: result.blindReviewPacketSha256,
    })}\n`,
  );
}

async function loadDocumentationContracts(storePath: string): Promise<{
  routerContract: string;
  methodContracts: Partial<Record<DocumentationMethod, string>>;
  currentRules: string[];
}> {
  const methodRoot = path.resolve(
    option("--method-root") ??
      path.join(storePath, "Methods", "Documentation"),
  );
  const routerContract = await readFile(
    path.join(methodRoot, "Documentation Router.md"),
    "utf8",
  );
  const methodFiles: Record<Exclude<DocumentationMethod, "none">, string> = {
    decision: "Architecture Decision Record.md",
    experiment: "Experiment Record.md",
    incident: "Incident Review.md",
    report: "Human Status Report.md",
  };
  const methodContracts = Object.fromEntries(
    await Promise.all(
      Object.entries(methodFiles).map(async ([method, file]) => [
        method,
        await readFile(path.join(methodRoot, file), "utf8"),
      ]),
    ),
  );
  const rulesPath = option("--rules");
  return {
    routerContract,
    methodContracts,
    currentRules: rulesPath
      ? [await readFile(path.resolve(rulesPath), "utf8")]
      : [],
  };
}

async function verifyRunnerSourceRevision(
  declaredRevision: string,
): Promise<string> {
  try {
    const repositoryRoot = (
      await runGit(["rev-parse", "--show-toplevel"], process.cwd())
    ).trim();
    const currentRevision = (
      await runGit(["rev-parse", "HEAD"], repositoryRoot)
    ).trim();
    const sourceStatus = await runGit(
      [
        "status",
        "--porcelain",
        "--untracked-files=all",
        "--",
        "package.json",
        "package-lock.json",
        "scripts/private-eval.ts",
        "packages/core",
        "packages/evaluation",
      ],
      repositoryRoot,
    );
    assertRunnerSourceState({
      declaredRevision,
      currentRevision,
      dirty: sourceStatus.trim().length > 0,
    });
    return repositoryRoot;
  } catch (error) {
    if (error instanceof Error && /runner|revision|Git object ID/i.test(error.message)) {
      throw error;
    }
    throw new Error("Runner source revision could not be verified.");
  }
}

async function runGit(arguments_: string[], cwd: string): Promise<string> {
  const result = await execFileAsync("git", arguments_, {
    cwd,
    encoding: "utf8",
    timeout: 10_000,
    maxBuffer: 65_536,
  });
  return String(result.stdout);
}

function requiredOption(name: string): string {
  const value = option(name);
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

function option(name: string): string | null {
  const index = args.indexOf(name);
  const value = index >= 0 ? args[index + 1] : undefined;
  if (index >= 0 && (!value || value.startsWith("--"))) {
    throw new Error(`${name} requires a value.`);
  }
  return value ?? null;
}

function parseConditions(value: string): EvaluationCondition[] {
  const parsed = [...new Set(value.split(",").map((item) => item.trim()))];
  if (
    !parsed.length ||
    !parsed.every((item) => item === "A" || item === "B" || item === "C")
  ) {
    throw new Error("--conditions must contain only A, B, and C.");
  }
  return parsed as EvaluationCondition[];
}

function safeErrorMessage(error: unknown): string {
  if (
    error instanceof Error &&
    ("path" in error || /\b(?:ENOENT|EACCES|EPERM)\b/.test(error.message))
  ) {
    return "Private evaluation input or storage is unavailable.";
  }
  if (error instanceof Error && !/[/\\](?:Users|home|private|var)[/\\]/i.test(error.message)) {
    return error.message;
  }
  return "Private evaluation failed.";
}
