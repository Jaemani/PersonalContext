import { createHash, randomInt, randomUUID } from "node:crypto";
import type { EvaluationCondition } from "./prompts.js";
import { assertCompleteEvaluationConditions } from "./run-contract.js";
import type {
  DocumentationRoutingProposal,
  PrivateEvaluationSuiteId,
} from "./types.js";

export interface BlindReviewSource {
  caseId: string;
  taskInput: string;
  condition: EvaluationCondition;
  routing: DocumentationRoutingProposal;
  artifact: { kind: string; content: string };
}

export interface BlindReviewKeyEntry {
  reviewId: string;
  caseId: string;
  condition: EvaluationCondition;
}

export interface BlindedHumanReviewPacket {
  schemaVersion: 1;
  runId: string;
  suiteId: PrivateEvaluationSuiteId;
  blinded: true;
  instructions: string;
  cases: Array<{
    caseId: string;
    taskInput: string;
    results: Array<{
      reviewId: string;
      routing: DocumentationRoutingProposal;
      artifact: { kind: string; content: string };
    }>;
  }>;
}

export function createBlindedHumanReviewArtifacts(
  options: {
    runId: string;
    suiteId: PrivateEvaluationSuiteId;
    sources: BlindReviewSource[];
  },
  randomness: {
    reviewId?: () => string;
    index?: (maximum: number) => number;
  } = {},
): {
  packet: BlindedHumanReviewPacket;
  key: BlindReviewKeyEntry[];
  packetSha256: string;
} {
  const makeReviewId = randomness.reviewId ?? (() => `review-${randomUUID()}`);
  const randomIndex = randomness.index ?? ((maximum) => randomInt(maximum));
  const caseIds = [...new Set(options.sources.map((source) => source.caseId))];
  const key: BlindReviewKeyEntry[] = [];
  const reviewIds = new Set<string>();
  const cases = caseIds.map((caseId) => {
    const sources = shuffled(
      options.sources.filter((source) => source.caseId === caseId),
      randomIndex,
    );
    assertCompleteEvaluationConditions(
      sources
        .map((source) => source.condition)
        .sort() as EvaluationCondition[],
    );
    const taskInput = sources[0]?.taskInput;
    if (!taskInput || sources.some((source) => source.taskInput !== taskInput)) {
      throw new Error("Blind-review sources for a case are inconsistent.");
    }
    return {
      caseId,
      taskInput,
      results: sources.map((source) => {
        const reviewId = makeReviewId();
        if (!reviewId || reviewIds.has(reviewId)) {
          throw new Error("Blind-review IDs must be unique and non-empty.");
        }
        reviewIds.add(reviewId);
        key.push({ reviewId, caseId, condition: source.condition });
        return {
          reviewId,
          routing: source.routing,
          artifact: source.artifact,
        };
      }),
    };
  });
  const packet: BlindedHumanReviewPacket = {
    schemaVersion: 1,
    runId: options.runId,
    suiteId: options.suiteId,
    blinded: true,
    instructions:
      "Review each result without inferring its condition. Record whether it is worth keeping, required corrections, and any evidence-boundary violation in a separate owner-only review record.",
    cases,
  };
  return {
    packet,
    key,
    packetSha256: hashPrivateJson(packet),
  };
}

export function hashPrivateJson(value: unknown): string {
  return createHash("sha256")
    .update(`${JSON.stringify(value, null, 2)}\n`)
    .digest("hex");
}

function shuffled<T>(
  values: T[],
  randomIndex: (maximum: number) => number,
): T[] {
  const result = [...values];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const selected = randomIndex(index + 1);
    if (!Number.isInteger(selected) || selected < 0 || selected > index) {
      throw new Error("Blind-review randomization returned an invalid index.");
    }
    [result[index], result[selected]] = [result[selected]!, result[index]!];
  }
  return result;
}
