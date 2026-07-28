import { createHash } from "node:crypto";
import type { KnowledgeRecord } from "../../core/src/types.js";
import type { EvaluationCondition } from "./prompts.js";

const COMPLETE_CONDITIONS = ["A", "B", "C"] as const;

export function assertCompleteEvaluationConditions(
  conditions: EvaluationCondition[],
): void {
  const unique = new Set(conditions);
  if (
    conditions.length !== COMPLETE_CONDITIONS.length ||
    unique.size !== COMPLETE_CONDITIONS.length ||
    !COMPLETE_CONDITIONS.every(
      (condition, index) => conditions[index] === condition,
    )
  ) {
    throw new Error("Private evaluation requires A, B, and C in one run.");
  }
}

export function assertRunnerSourceState(options: {
  declaredRevision: string;
  currentRevision: string;
  dirty: boolean;
}): void {
  const declared = assertExactRunnerRevision(options.declaredRevision);
  const current = assertExactRunnerRevision(options.currentRevision);
  if (declared !== current) {
    throw new Error("--runner-revision does not match the checked-out runner.");
  }
  if (options.dirty) {
    throw new Error("Private evaluation runner sources must be clean.");
  }
}

export function assertExactRunnerRevision(value: string): string {
  const normalized = value.trim().toLowerCase();
  if (!/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(normalized)) {
    throw new Error("--runner-revision must be an exact Git object ID.");
  }
  return normalized;
}

export function hashKnowledgeSnapshot(records: KnowledgeRecord[]): string {
  const hash = createHash("sha256");
  for (const record of [...records].sort((left, right) =>
    left.id.localeCompare(right.id),
  )) {
    hash.update(
      `${JSON.stringify({
        id: record.id,
        collection: record.collection,
        path: record.path,
        title: record.title,
        type: record.type,
        kind: record.kind,
        status: record.status,
        confidence: record.confidence,
        sourceRepository: record.sourceRepository,
        sourceCommit: record.sourceCommit,
        tags: record.tags,
        links: record.links,
        evidenceUrls: record.evidenceUrls,
        body: record.body,
      })}\n`,
    );
  }
  return hash.digest("hex");
}
