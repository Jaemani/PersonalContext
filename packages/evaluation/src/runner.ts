import type { KnowledgeRecord, SearchHit } from "../../core/src/types.js";
import {
  parseDocumentationCases,
  parseRoutingProposal,
} from "./documentation-cases.js";
import { buildEligibleRecordSet } from "./eligible-records.js";
import {
  createBlindedHumanReviewArtifacts,
  hashPrivateJson,
  type BlindReviewSource,
} from "./blind-review.js";
import {
  EvaluationModelError,
  type EvaluationModelAdapter,
  type EvaluationOutputSchema,
} from "./model-adapter.js";
import {
  assertNoRawSecret,
  assertWithheldValuesAbsent,
  buildArtifactPrompt,
  buildRoutingPrompt,
  type EvaluationCondition,
  type EvaluationContextRecord,
} from "./prompts.js";
import {
  createPrivateRunStore,
  type PrivateRunStore,
} from "./run-store.js";
import {
  assertCompleteEvaluationConditions,
  assertExactRunnerRevision,
  hashKnowledgeSnapshot,
} from "./run-contract.js";
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

export type PrivateDocumentationPromptPreflightOptions = Pick<
  PrivateDocumentationRunOptions,
  | "manifest"
  | "records"
  | "conditions"
  | "currentRules"
  | "routerContract"
  | "methodContracts"
>;

export type DocumentationPromptPreflightErrorCode =
  | "WITHHELD_PROMPT_OVERLAP"
  | "UNSAFE_ROUTING_PROMPT";

export class DocumentationPromptPreflightError extends Error {
  constructor(
    readonly code: DocumentationPromptPreflightErrorCode,
    readonly caseId: string,
    readonly condition: EvaluationCondition,
  ) {
    super("The private evaluation prompt preflight failed.");
    this.name = "DocumentationPromptPreflightError";
  }
}

const DOCUMENTATION_METHODS = [
  "decision",
  "experiment",
  "incident",
  "report",
  "none",
] as const;

const ROUTING_OUTPUT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: [
    "primary_method",
    "reason",
    "uncertainties",
    "secondary_artifacts",
  ],
  properties: {
    primary_method: { type: "string", enum: DOCUMENTATION_METHODS },
    reason: { type: "string" },
    uncertainties: { type: "array", items: { type: "string" } },
    secondary_artifacts: {
      type: "array",
      items: { type: "string", enum: DOCUMENTATION_METHODS },
    },
  },
} as const satisfies EvaluationOutputSchema;

const ARTIFACT_OUTPUT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["routing", "artifact"],
  properties: {
    routing: ROUTING_OUTPUT_SCHEMA,
    artifact: {
      type: "object",
      additionalProperties: false,
      required: ["kind", "content"],
      properties: {
        kind: { type: "string" },
        content: { type: "string" },
      },
    },
  },
} as const satisfies EvaluationOutputSchema;

export function preflightPrivateDocumentationPrompts(
  options: PrivateDocumentationPromptPreflightOptions,
): { routingPromptCount: number } {
  assertCompleteEvaluationConditions(options.conditions);
  const cases = parseDocumentationCases(options.manifest);
  let routingPromptCount = 0;

  for (const testCase of cases) {
    const eligible = buildEligibleRecordSet(options.records, {
      suiteId: options.manifest.suiteId,
      caseId: testCase.input.id,
      sourceRecords: testCase.input.sourceRecords,
      excludedEvidenceIds: testCase.input.excludedEvidenceIds,
    });
    const relevant = eligible.index.search(testCase.input.taskInput, {}, 5);
    const contextRecords = relevant.map(toContextRecord);
    const withheldValues = [
      ...testCase.rubric.requiredElements,
      ...testCase.rubric.forbiddenArtifacts,
      ...testCase.rubric.ambiguities,
    ];

    for (const condition of options.conditions) {
      try {
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
      } catch (error) {
        throw new DocumentationPromptPreflightError(
          error instanceof Error &&
            error.message ===
              "Withheld evaluation material entered a model prompt."
            ? "WITHHELD_PROMPT_OVERLAP"
            : "UNSAFE_ROUTING_PROMPT",
          testCase.input.id,
          condition,
        );
      }
      routingPromptCount += 1;
    }
  }

  return { routingPromptCount };
}

export async function runPrivateDocumentationEvaluation(
  options: PrivateDocumentationRunOptions,
): Promise<{
  runId: string;
  caseCount: number;
  resultHashes: string[];
  knowledgeSnapshotSha256: string;
  blindReviewPacketSha256: string;
}> {
  assertCompleteEvaluationConditions(options.conditions);
  const runnerRevision = assertExactRunnerRevision(options.runnerRevision);
  const cases = parseDocumentationCases(options.manifest);
  const knowledgeSnapshotSha256 = hashKnowledgeSnapshot(options.records);
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
    runnerRevision,
    knowledgeSnapshotSha256,
    model: options.modelDescription,
    runtime: {
      node: process.version,
      platform: process.platform,
      arch: process.arch,
    },
    conditions: options.conditions,
    caseIds: cases.map((item) => item.input.id),
    startedAt,
  });

  try {
    preflightPrivateDocumentationPrompts(options);
  } catch (error) {
    if (error instanceof DocumentationPromptPreflightError) {
      await writeFailure({
        store,
        runId: options.runId,
        caseId: error.caseId,
        condition: error.condition,
        stage: "routing-prompt-preflight",
        errorCode: error.code,
        rawModel: null,
      });
    }
    throw new Error("The private evaluation prompt preflight failed.");
  }

  const evaluations: Array<Record<string, unknown> & {
    caseId: string;
    condition: EvaluationCondition;
  }> = [];
  const blindReviewSources: BlindReviewSource[] = [];
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
      const rawRouting = await completeModelJson({
        model: options.model,
        prompt: routingPrompt,
        outputSchema: ROUTING_OUTPUT_SCHEMA,
        store,
        runId: options.runId,
        caseId: testCase.input.id,
        condition,
        stage: "routing",
      });
      let routing;
      try {
        assertNoRawSecret(JSON.stringify(rawRouting));
        routing = parseRoutingProposal(rawRouting);
      } catch {
        await writeFailure({
          store,
          runId: options.runId,
          caseId: testCase.input.id,
          condition,
          stage: "routing-contract",
          errorCode: "INVALID_ROUTING_RESULT",
          rawModel: rawRouting,
        });
        throw new Error("The private evaluation routing result is invalid.");
      }

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
      const rawArtifact = await completeModelJson({
        model: options.model,
        prompt: artifactPrompt,
        outputSchema: ARTIFACT_OUTPUT_SCHEMA,
        store,
        runId: options.runId,
        caseId: testCase.input.id,
        condition,
        stage: "artifact",
      });
      let artifact;
      try {
        assertNoRawSecret(JSON.stringify(rawArtifact));
        artifact = parseArtifact(rawArtifact);
      } catch {
        await writeFailure({
          store,
          runId: options.runId,
          caseId: testCase.input.id,
          condition,
          stage: "artifact-contract",
          errorCode: "INVALID_ARTIFACT_RESULT",
          rawModel: rawArtifact,
        });
        throw new Error("The private evaluation artifact result is invalid.");
      }
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
      resultHashes.push(hashPrivateJson(result));
      evaluations.push({
        caseId: testCase.input.id,
        condition,
        expectedPrimaryMethod: testCase.rubric.expectedPrimaryMethod,
        acceptableSecondaryMethods: testCase.rubric.acceptableSecondaryMethods,
        ...mechanical,
        requiresBlindedHumanReview: true,
      });
      blindReviewSources.push({
        caseId: testCase.input.id,
        taskInput: testCase.input.taskInput,
        condition,
        routing,
        artifact,
      });
    }
  }

  const blindReview = createBlindedHumanReviewArtifacts({
    runId: options.runId,
    suiteId: options.manifest.suiteId,
    sources: blindReviewSources,
  });
  await store.writeJson("blind-review/packet.json", blindReview.packet);
  const reviewIdByResult = new Map(
    blindReview.key.map((entry) => [
      `${entry.caseId}\u0000${entry.condition}`,
      entry.reviewId,
    ]),
  );
  const blindedEvaluations = evaluations.map((evaluation) => {
    const blindReviewId = reviewIdByResult.get(
      `${evaluation.caseId}\u0000${evaluation.condition}`,
    );
    if (!blindReviewId) {
      throw new Error("A blinded-review result key is missing.");
    }
    return { ...evaluation, blindReviewId };
  });
  await store.writeJson("evaluation.json", {
    runId: options.runId,
    suiteId: options.manifest.suiteId,
    blindReviewKey: blindReview.key,
    evaluations: blindedEvaluations,
  });
  await store.writeJson("metadata-end.json", {
    runId: options.runId,
    completedAt: new Date().toISOString(),
    resultCount: resultHashes.length,
    resultHashes,
    knowledgeSnapshotSha256,
    blindReviewPacketSha256: blindReview.packetSha256,
  });
  return {
    runId: options.runId,
    caseCount: cases.length,
    resultHashes,
    knowledgeSnapshotSha256,
    blindReviewPacketSha256: blindReview.packetSha256,
  };
}

function methodSummaries(
  contracts: Partial<Record<DocumentationMethod, string>>,
): string[] {
  return (["decision", "experiment", "incident", "report"] as const).map(
    (method) => `${method}\n${contracts[method] ?? "unavailable"}`,
  );
}

async function completeModelJson(options: {
  model: EvaluationModelAdapter;
  prompt: string;
  outputSchema: EvaluationOutputSchema;
  store: PrivateRunStore;
  runId: string;
  caseId: string;
  condition: EvaluationCondition;
  stage: "routing" | "artifact";
}): Promise<unknown> {
  try {
    return await options.model.completeJson(
      options.prompt,
      options.outputSchema,
    );
  } catch (error) {
    await writeFailure({
      store: options.store,
      runId: options.runId,
      caseId: options.caseId,
      condition: options.condition,
      stage: `${options.stage}-command`,
      errorCode:
        error instanceof EvaluationModelError
          ? error.code
          : "MODEL_ADAPTER_FAILED",
      rawModel:
        error instanceof EvaluationModelError ? error.rawOutput : null,
    });
    throw new Error(`The private evaluation ${options.stage} command failed.`);
  }
}

async function writeFailure(options: {
  store: PrivateRunStore;
  runId: string;
  caseId: string;
  condition: EvaluationCondition;
  stage: string;
  errorCode: string;
  rawModel: unknown;
}): Promise<void> {
  await options.store.writeJson("failure.json", {
    runId: options.runId,
    caseId: options.caseId,
    condition: options.condition,
    stage: options.stage,
    errorCode: options.errorCode,
    rawModel: options.rawModel,
    rawModelSha256:
      options.rawModel === null ? null : hashPrivateJson(options.rawModel),
    failedAt: new Date().toISOString(),
  });
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
