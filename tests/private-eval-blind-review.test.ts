import { describe, expect, it } from "vitest";
import {
  createBlindedHumanReviewArtifacts,
  hashPrivateJson,
  type BlindReviewSource,
} from "../packages/evaluation/src/blind-review.js";
import { DOCUMENTATION_EVALUATION_SUITE_ID } from "../packages/evaluation/src/types.js";

describe("private evaluation blinded human review", () => {
  it("randomizes opaque results without exporting condition or rubric data", () => {
    let nextId = 0;
    const sources = (["A", "B", "C"] as const).map((condition) => ({
      ...source(condition),
      withheldRubric: "hidden-rubric-value",
      context: { recordIds: ["knowledge:target.md"] },
    })) as BlindReviewSource[];
    const artifacts = createBlindedHumanReviewArtifacts(
      {
        runId: "run-1",
        suiteId: DOCUMENTATION_EVALUATION_SUITE_ID,
        sources,
      },
      {
        reviewId: () => `review-${++nextId}`,
        index: () => 0,
      },
    );

    expect(artifacts.packet.cases[0]?.results).toHaveLength(3);
    expect(artifacts.key).toHaveLength(3);
    expect(artifacts.key.map((entry) => entry.condition).sort()).toEqual([
      "A",
      "B",
      "C",
    ]);
    const packetText = JSON.stringify(artifacts.packet);
    expect(packetText).not.toContain('"condition":');
    expect(packetText).not.toContain("hidden-rubric-value");
    expect(packetText).not.toContain("knowledge:target.md");
    expect(artifacts.packetSha256).toBe(hashPrivateJson(artifacts.packet));
  });

  it("rejects inconsistent case tasks and invalid random indexes", () => {
    expect(() =>
      createBlindedHumanReviewArtifacts(
        {
          runId: "run-1",
          suiteId: DOCUMENTATION_EVALUATION_SUITE_ID,
          sources: [
            source("A"),
            { ...source("B"), taskInput: "changed" },
            source("C"),
          ],
        },
        { index: () => 0 },
      ),
    ).toThrow(/inconsistent/i);
    expect(() =>
      createBlindedHumanReviewArtifacts(
        {
          runId: "run-1",
          suiteId: DOCUMENTATION_EVALUATION_SUITE_ID,
          sources: [source("A"), source("B"), source("C")],
        },
        { index: () => 10 },
      ),
    ).toThrow(/invalid index/i);
    expect(() =>
      createBlindedHumanReviewArtifacts(
        {
          runId: "run-1",
          suiteId: DOCUMENTATION_EVALUATION_SUITE_ID,
          sources: [source("A"), source("B"), source("C")],
        },
        { reviewId: () => "duplicate", index: () => 0 },
      ),
    ).toThrow(/unique/i);
  });
});

function source(condition: "A" | "B" | "C"): BlindReviewSource {
  return {
    caseId: "DOC-001",
    taskInput: "Choose a durable artifact.",
    condition,
    routing: {
      primary_method: "decision",
      reason: "A durable choice is needed.",
      uncertainties: [],
      secondary_artifacts: [],
    },
    artifact: {
      kind: "decision",
      content: "Context and consequences.",
    },
  };
}
