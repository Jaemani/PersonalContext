import type {
  RetrievalCase,
  RetrievalEvaluation,
} from "./types.js";
import { PersonalKnowledgeIndex } from "./index.js";

export function evaluateRetrieval(
  index: PersonalKnowledgeIndex,
  cases: RetrievalCase[],
): RetrievalEvaluation {
  const results = cases.map((testCase) => {
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
  return {
    passed,
    total: results.length,
    hitRate: results.length ? passed / results.length : 0,
    cases: results,
  };
}
