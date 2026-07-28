import { describe, expect, it } from "vitest";
import {
  parseDocumentationCases,
  parseRoutingProposal,
} from "../packages/evaluation/src/documentation-cases.js";
import {
  DOCUMENTATION_EVALUATION_SUITE_ID,
  type DocumentationEvaluationManifest,
} from "../packages/evaluation/src/types.js";

describe("documentation evaluation case parsing", () => {
  it("separates model input from withheld rubric", () => {
    const cases = parseDocumentationCases(manifest());
    expect(cases[0]?.input).toEqual({
      id: "DOC-001",
      taskInput: "Choose a durable artifact.",
      sourceRecords: ["Decisions/example.md"],
      excludedEvidenceIds: ["knowledge:Decisions/example.md"],
    });
    expect(cases[0]?.rubric.expectedPrimaryMethod).toBe("decision");
    expect(JSON.stringify(cases[0]?.input)).not.toContain("hidden-heading");
  });

  it("rejects duplicate IDs and malformed routing output", () => {
    const duplicate = manifest();
    duplicate.cases.push({ ...duplicate.cases[0] });
    expect(() => parseDocumentationCases(duplicate)).toThrow(/case ID/i);
    expect(() =>
      parseRoutingProposal({
        primary_method: "unknown",
        reason: "reason",
        uncertainties: [],
        secondary_artifacts: [],
      }),
    ).toThrow(/method value/i);
  });
});

function manifest(): DocumentationEvaluationManifest {
  return {
    schemaVersion: 1,
    suiteId: DOCUMENTATION_EVALUATION_SUITE_ID,
    privacy: "private-local-only",
    createdAt: "2026-07-28",
    productionIndexAllowed: false,
    cases: [
      {
        id: "DOC-001",
        taskInput: "Choose a durable artifact.",
        expectedPrimaryMethod: "decision",
        acceptableSecondaryMethods: [],
        requiredElements: ["hidden-heading"],
        forbiddenArtifacts: [],
        sourceRecords: ["Decisions/example.md"],
        excludedEvidenceIds: ["knowledge:Decisions/example.md"],
        ambiguities: [],
      },
    ],
  };
}
