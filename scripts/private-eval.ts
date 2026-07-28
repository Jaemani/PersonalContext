import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { readKnowledgeStore } from "../packages/core/src/markdown.js";
import { parseDocumentationCases } from "../packages/evaluation/src/documentation-cases.js";
import { buildEligibleRecordSet } from "../packages/evaluation/src/eligible-records.js";
import { loadPrivateEvaluationManifest } from "../packages/evaluation/src/manifest.js";
import { CodexEvaluationModelAdapter } from "../packages/evaluation/src/model-adapter.js";
import type { EvaluationCondition } from "../packages/evaluation/src/prompts.js";
import { runPrivateDocumentationEvaluation } from "../packages/evaluation/src/runner.js";
import { validatePrivateRunLocation } from "../packages/evaluation/src/run-store.js";
import {
  DOCUMENTATION_EVALUATION_SUITE_ID,
  type DocumentationMethod,
} from "../packages/evaluation/src/types.js";

const args = process.argv.slice(2);

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
  const forbiddenRoots = [storePath, process.cwd()];
  const loaded = await loadPrivateEvaluationManifest({
    manifestPath,
    expectedSha256,
  });
  await validatePrivateRunLocation({ outputRoot, forbiddenRoots });
  if (args.includes("--validate-only")) {
    let exclusionCount = 0;
    if (loaded.manifest.suiteId === DOCUMENTATION_EVALUATION_SUITE_ID) {
      const records = await readKnowledgeStore(storePath, "knowledge");
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
    process.stdout.write(
      `${JSON.stringify({
        suiteId: loaded.summary.suiteId,
        itemCount: loaded.summary.itemCount,
        manifestSha256: loaded.summary.sha256,
        exclusionCount,
        conditions,
        modelPinned: Boolean(modelName),
        reasoningEffortPinned: Boolean(reasoningEffort),
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
  const currentRules = rulesPath
    ? [await readFile(path.resolve(rulesPath), "utf8")]
    : [];
  const records = await readKnowledgeStore(storePath, "knowledge");
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
    runnerRevision: process.env.PERSONAL_CONTEXT_RUNNER_REVISION ?? "working-tree",
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
    })}\n`,
  );
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
