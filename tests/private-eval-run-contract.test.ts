import { describe, expect, it } from "vitest";
import type { KnowledgeRecord } from "../packages/core/src/types.js";
import {
  assertCompleteEvaluationConditions,
  assertExactRunnerRevision,
  assertRunnerSourceState,
  hashKnowledgeSnapshot,
} from "../packages/evaluation/src/run-contract.js";

describe("private evaluation run contract", () => {
  it("requires A/B/C together and an exact full runner revision", () => {
    expect(() => assertCompleteEvaluationConditions(["A", "B", "C"])).not.toThrow();
    expect(() => assertCompleteEvaluationConditions(["A", "C"])).toThrow(
      /requires A, B, and C/i,
    );
    expect(() =>
      assertCompleteEvaluationConditions(["A", "B", "C", "A"]),
    ).toThrow(/requires A, B, and C/i);
    expect(() => assertCompleteEvaluationConditions(["C", "B", "A"])).toThrow(
      /requires A, B, and C/i,
    );
    expect(assertExactRunnerRevision("A".repeat(40))).toBe("a".repeat(40));
    expect(() => assertExactRunnerRevision("83f4c28")).toThrow(
      /exact Git object ID/i,
    );
    expect(() =>
      assertRunnerSourceState({
        declaredRevision: "a".repeat(40),
        currentRevision: "b".repeat(40),
        dirty: false,
      }),
    ).toThrow(/does not match/i);
    expect(() =>
      assertRunnerSourceState({
        declaredRevision: "a".repeat(40),
        currentRevision: "a".repeat(40),
        dirty: true,
      }),
    ).toThrow(/must be clean/i);
  });

  it("hashes semantic Markdown records independent of read order and machine path", () => {
    const first = record("knowledge:first.md", "First body");
    const second = record("knowledge:second.md", "Second body");
    const moved = {
      ...first,
      root: "/another-machine/Wiki",
      absolutePath: "/another-machine/Wiki/first.md",
    };

    expect(hashKnowledgeSnapshot([first, second])).toBe(
      hashKnowledgeSnapshot([second, moved]),
    );
    expect(hashKnowledgeSnapshot([first, second])).not.toBe(
      hashKnowledgeSnapshot([{ ...first, body: "Changed body" }, second]),
    );
  });
});

function record(id: string, body: string): KnowledgeRecord {
  const relativePath = id.replace(/^knowledge:/, "");
  return {
    id,
    collection: "knowledge",
    root: "/vault/Wiki",
    path: relativePath,
    absolutePath: `/vault/Wiki/${relativePath}`,
    title: relativePath,
    type: "knowledge",
    kind: null,
    status: "current",
    confidence: null,
    sourceRepository: null,
    sourceCommit: null,
    tags: [],
    links: [],
    evidenceUrls: [],
    body,
  };
}
