import type {
  RetrievalCase,
  RetrievalCaseResultV2,
  RetrievalCaseV2,
  RetrievalEvaluation,
} from "./types.js";
import { PersonalKnowledgeIndex } from "./index.js";

export function evaluateRetrieval(
  index: PersonalKnowledgeIndex,
  cases: RetrievalCase[],
): RetrievalEvaluation {
  const results = cases.map((testCase) => {
    if (isV2Case(testCase)) {
      const hits = index.search(
        testCase.query,
        testCase.filters,
        testCase.limit,
        testCase.intent,
      );
      const actualEvidenceIds = hits.map((hit) => hit.evidenceId ?? hit.id);
      const required = testCase.expected.requiredEvidenceIds;
      const requiredFound = required.filter((id) => actualEvidenceIds.includes(id));
      const requiredMissing = required.filter((id) => !actualEvidenceIds.includes(id));
      const anyOfMissing = (testCase.expected.anyOfEvidenceIds ?? []).filter(
        (group) => !group.some((id) => actualEvidenceIds.includes(id)),
      );
      const forbiddenFound = (testCase.expected.forbiddenEvidenceIds ?? []).filter(
        (id) => actualEvidenceIds.includes(id),
      );
      const acceptableStatuses = new Set(
        (testCase.expected.requiredStatuses ?? []).map((status) => status.toLowerCase()),
      );
      const requiredHits = hits.filter((hit) =>
        required.includes(hit.evidenceId ?? hit.id),
      );
      const lifecycleMismatch =
        acceptableStatuses.size > 0 &&
        requiredHits.some(
          (hit) => !hit.status || !acceptableStatuses.has(hit.status.toLowerCase()),
        );
      const firstRelevant = actualEvidenceIds.findIndex((id) => required.includes(id));
      const provenanceComplete =
        requiredMissing.length === 0 &&
        requiredHits.every((hit) =>
          Boolean(hit.sourceCommit || hit.evidenceUrls.length),
        );
      const failureTypes: RetrievalCaseResultV2["failureTypes"] = [];
      if (requiredMissing.length || anyOfMissing.length || forbiddenFound.length) {
        failureTypes.push(intentFailure(testCase.intent));
      }
      if (lifecycleMismatch) failureTypes.push("lifecycle");
      if (!provenanceComplete) failureTypes.push("provenance");
      return {
        id: testCase.id,
        passed:
          requiredMissing.length === 0 &&
          anyOfMissing.length === 0 &&
          forbiddenFound.length === 0 &&
          !lifecycleMismatch &&
          provenanceComplete,
        actualEvidenceIds,
        requiredFound,
        requiredMissing,
        forbiddenFound,
        reciprocalRank: firstRelevant < 0 ? 0 : 1 / (firstRelevant + 1),
        recallAtK: required.length ? requiredFound.length / required.length : 1,
        lifecycleMismatch,
        provenanceComplete,
        failureTypes,
      } satisfies RetrievalCaseResultV2;
    }
    const hits = index.search(
      testCase.query,
      testCase.filters,
      testCase.limit ?? 5,
    );
    const actualTitles = hits.map((hit) => hit.title);
    const expected = new Set(
      testCase.expectedTitles.map((title) => title.toLowerCase()),
    );
    return {
      id: testCase.id,
      passed: actualTitles.some((title) => expected.has(title.toLowerCase())),
      expectedTitles: testCase.expectedTitles,
      actualTitles,
    };
  });
  const passed = results.filter((result) => result.passed).length;
  const v2 = results.filter(
    (result): result is RetrievalCaseResultV2 => "recallAtK" in result,
  );
  return {
    passed,
    total: results.length,
    hitRate: results.length ? passed / results.length : 0,
    meanReciprocalRank: mean(v2.map((result) => result.reciprocalRank)),
    meanRecallAtK: mean(v2.map((result) => result.recallAtK)),
    lifecycleMismatchCount: v2.filter((result) => result.lifecycleMismatch).length,
    provenanceIncompleteCount: v2.filter((result) => !result.provenanceComplete).length,
    cases: results,
  };
}

function intentFailure(
  intent: "exact" | "semantic" | "temporal" | "relational" | "current-rule",
): RetrievalCaseResultV2["failureTypes"][number] {
  if (intent === "temporal") return "temporal";
  if (intent === "relational") return "relational";
  if (intent === "semantic") return "semantic";
  return "selection";
}

function mean(values: number[]): number {
  return values.length
    ? values.reduce((total, value) => total + value, 0) / values.length
    : 0;
}

function isV2Case(testCase: RetrievalCase): testCase is RetrievalCaseV2 {
  return "schemaVersion" in testCase && testCase.schemaVersion === 2;
}
