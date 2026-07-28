import { createHash } from "node:crypto";
import type { KnowledgeRecord, SearchHit } from "../../core/src/types.js";
import {
  parseDocumentationCases,
  parseRoutingProposal,
} from "./documentation-cases.js";
import { buildEligibleRecordSet } from "./eligible-records.js";
import type { EvaluationModelAdapter } from "./model-adapter.js";
import {
  assertNoRawSecret,
  assertWithheldValuesAbsent,
  buildArtifactPrompt,
  buildRoutingPrompt,
  type EvaluationCondition,
  type EvaluationContextRecord,
} from "./prompts.js";
import { createPrivateRunStore } from "./run-store.js";
import type {
  DocumentationEvaluationManifest,
  DocumentationMethod,
  PrivateManifestSummary,
} from "./types.js";

export interface PrivateDocumentationRunOptions {
  manifest: DocumentationEvaluationManifest;
  manifestSummary: PrivateManifestSummary;
  records: KnowledgeRecord[];
  conditions: EvaluationCondition[];
  model: EvaluationModelAdapter;
  outputRoot: string;
  runId: string;
  forbiddenRoots: string[];
  runnerRevision: string;
  modelDescription: string;
  currentRules?: string[];
  routerContract: string;
  methodContracts: Partial<Record<DocumentationMethod, string>>;
}

export async function runPrivateDocumentationEvaluation(
  options: PrivateDocumentationRunOptions,
): Promise<{ runId: string; caseCount: number; resultHashes: string[] }> {
  const cases = parseDocumentationCases(options.manifest);
  const store = await createPrivateRunStore({
    outputRoot: options.outputRoot,
    runId: options.runId,
    forbiddenRoots: options.forbiddenRoots,
  });
  const startedAt = new Date().toISOString();
  await store.writeJson("metadata-start.json", {
    runId: options.runId,
    suiteId: options.manifestSummary.suiteId,
    manifestSha256: options.manifestSummary.sha256,
    runnerRevision: options.runnerRevision,
    model: options.modelDescription,
    conditions: options.conditions,
    caseIds: cases.map((item) => item.input.id),
    startedAt,
  });

  const evaluations: unknown[] = [];
  const resultHashes: string[] = [];
  for (const testCase of cases) {
    const eligible = buildEligibleRecordSet(options.records, {
      suiteId: options.manifest.suiteId,
      caseId: testCase.input.id,
      sourceRecords: testCase.input.sourceRecords,
      excludedEvidenceIds: testCase.input.excludedEvidenceIds,
    });
    const relevant = eligible.index.search(testCase.input.taskInput, {}, 5);
    const contextRecords = relevant.map(toContextRecord);
    const precedents = relevant.slice(0, 2).map(toContextRecord);

    for (const condition of options.conditions) {
      const withheldValues = [
        ...testCase.rubric.requiredElements,
        ...testCase.rubric.forbiddenArtifacts,
        ...testCase.rubric.ambiguities,
      ];
      const routingPrompt = buildRoutingPrompt({
        condition,
        taskInput: testCase.input.taskInput,
        ...(condition === "B" ? { contextRecords } : {}),
        ...(condition === "C"
          ? {
              currentRules: options.currentRules,
              routerContract: options.routerContract,
              methodSummaries: methodSummaries(options.methodContracts),
            }
          : {}),
      });
      assertWithheldValuesAbsent(routingPrompt, withheldValues);
      const rawRouting = await options.model.completeJson(routingPrompt);
      assertNoRawSecret(JSON.stringify(rawRouting));
      const routing = parseRoutingProposal(rawRouting);

      const selectedMethodContract =
        routing.primary_method === "none"
          ? ""
          : options.methodContracts[routing.primary_method];
      if (condition === "C" && routing.primary_method !== "none" && !selectedMethodContract) {
        throw new Error("The model-selected method contract is unavailable.");
      }

      const artifactPrompt = buildArtifactPrompt({
        condition,
        taskInput: testCase.input.taskInput,
        routingProposal: routing,
        ...(condition === "B" ? { contextRecords } : {}),
        ...(condition === "C"
          ? { selectedMethodContract, precedents }
          : {}),
      });
      assertWithheldValuesAbsent(artifactPrompt, withheldValues);
      const rawArtifact = await options.model.completeJson(artifactPrompt);
      assertNoRawSecret(JSON.stringify(rawArtifact));
      const artifact = parseArtifact(rawArtifact);
      const mechanical = evaluateMechanically(
        routing.primary_method,
        artifact.content,
        testCase.rubric,
      );
      const conditionName = `condition-${condition.toLowerCase()}`;
      const relativePath = `${conditionName}/${testCase.input.id}/result.json`;
      const result = {
        runId: options.runId,
        caseId: testCase.input.id,
        condition,
        routing,
        artifact,
        rawModel: {
          routing: rawRouting,
          artifact: rawArtifact,
        },
        context: {
          recordIds:
            condition === "B"
              ? contextRecords.map((record) => record.id)
              : condition === "C"
                ? precedents.map((record) => record.id)
                : [],
          eligibleRecordCount: eligible.recordIds.length,
          excludedRecordIds: eligible.excludedRecordIds,
        },
        mechanical,
      };
      await store.writeJson(relativePath, result);
      resultHashes.push(
        createHash("sha256").update(JSON.stringify(result)).digest("hex"),
      );
      evaluations.push({
        caseId: testCase.input.id,
        condition,
        expectedPrimaryMethod: testCase.rubric.expectedPrimaryMethod,
        acceptableSecondaryMethods: testCase.rubric.acceptableSecondaryMethods,
        ...mechanical,
        requiresBlindedHumanReview: true,
      });
    }
  }

  await store.writeJson("evaluation.json", {
    runId: options.runId,
    suiteId: options.manifest.suiteId,
    evaluations,
  });
  await store.writeJson("metadata-end.json", {
    runId: options.runId,
    completedAt: new Date().toISOString(),
    resultCount: resultHashes.length,
    resultHashes,
  });
  return { runId: options.runId, caseCount: cases.length, resultHashes };
}

function methodSummaries(
  contracts: Partial<Record<DocumentationMethod, string>>,
): string[] {
  return (["decision", "experiment", "incident", "report"] as const).map(
    (method) => `${method}\n${contracts[method] ?? "unavailable"}`,
  );
}

function toContextRecord(hit: SearchHit): EvaluationContextRecord {
  return {
    id: hit.id,
    title: hit.title,
    type: hit.type,
    status: hit.status,
    sourceRepository: hit.sourceRepository,
    sourceCommit: hit.sourceCommit,
    snippet: hit.snippet,
  };
}

function parseArtifact(value: unknown): { kind: string; content: string } {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("The model artifact output is invalid.");
  }
  const record = value as Record<string, unknown>;
  const artifact =
    record.artifact && typeof record.artifact === "object"
      ? (record.artifact as Record<string, unknown>)
      : record;
  if (typeof artifact.kind !== "string" || typeof artifact.content !== "string") {
    throw new Error("The model artifact output is invalid.");
  }
  return { kind: artifact.kind, content: artifact.content };
}

function evaluateMechanically(
  primaryMethod: DocumentationMethod,
  content: string,
  rubric: {
    expectedPrimaryMethod: DocumentationMethod;
    requiredElements: string[];
    forbiddenArtifacts: string[];
  },
) {
  const normalized = content.toLowerCase();
  const requiredFound = rubric.requiredElements.filter((value) =>
    normalized.includes(value.toLowerCase()),
  );
  const forbiddenFound = rubric.forbiddenArtifacts.filter((value) =>
    normalized.includes(value.toLowerCase()),
  );
  return {
    primaryRouteMatches: primaryMethod === rubric.expectedPrimaryMethod,
    requiredFound,
    requiredMissing: rubric.requiredElements.filter(
      (value) => !requiredFound.includes(value),
    ),
    forbiddenFound,
  };
}
