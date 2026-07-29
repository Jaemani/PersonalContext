import { describe, expect, it } from "vitest";
import type { KnowledgeRecord } from "../packages/core/src/types.js";
import {
  assertEligibleRecordSelection,
  buildEligibleRecordSet,
} from "../packages/evaluation/src/eligible-records.js";

describe("private evaluation eligible records", () => {
  it("removes target evidence before constructing the search index", () => {
    const records = [
      record("knowledge:target.md", "Target", "answer"),
      record("knowledge:support.md", "Support", "relevant evidence"),
    ];

    const eligible = buildEligibleRecordSet(records, {
      suiteId: "SUITE-1",
      caseId: "CASE-1",
      sourceRecords: ["target.md"],
      excludedEvidenceIds: ["knowledge:target.md"],
    });

    expect(eligible.recordIds).toEqual(["knowledge:support.md"]);
    expect(eligible.excludedRecordIds).toContain("knowledge:target.md");
    expect(eligible.index.get("knowledge:target.md")).toBeNull();
  });

  it("fails closed when a source or exclusion cannot be mapped", () => {
    const records = [record("knowledge:support.md", "Support", "body")];

    expect(() =>
      buildEligibleRecordSet(records, {
        suiteId: "SUITE-1",
        caseId: "CASE-1",
        sourceRecords: ["missing.md"],
        excludedEvidenceIds: [],
      }),
    ).toThrow(/source record is missing/i);

    expect(() =>
      buildEligibleRecordSet(records, {
        suiteId: "SUITE-1",
        caseId: "CASE-1",
        sourceRecords: ["support.md"],
        excludedEvidenceIds: ["knowledge:missing.md"],
      }),
    ).toThrow(/exclusion is missing/i);
  });

  it("removes audit records that directly identify the suite or case", () => {
    const records = [
      record(
        "knowledge:audit.md",
        "SUITE-1 audit",
        "The result for CASE-1 is recorded here.",
      ),
      record("knowledge:support.md", "Support", "body"),
    ];

    const eligible = buildEligibleRecordSet(records, {
      suiteId: "SUITE-1",
      caseId: "CASE-1",
      sourceRecords: ["support.md"],
      excludedEvidenceIds: [],
    });

    expect(eligible.recordIds).toEqual(["knowledge:support.md"]);
  });

  it("rejects excluded or unknown records at the prompt dataflow boundary", () => {
    const eligible = {
      recordIds: ["knowledge:support.md"],
      excludedRecordIds: ["knowledge:target.md"],
    };

    expect(() =>
      assertEligibleRecordSelection(["knowledge:support.md"], eligible),
    ).not.toThrow();
    expect(() =>
      assertEligibleRecordSelection(["knowledge:target.md"], eligible),
    ).toThrow(/disallowed evaluation record/i);
    expect(() =>
      assertEligibleRecordSelection(["knowledge:unknown.md"], eligible),
    ).toThrow(/disallowed evaluation record/i);
  });
});

function record(id: string, title: string, body: string): KnowledgeRecord {
  const relativePath = id.replace(/^knowledge:/, "");
  return {
    id,
    collection: "knowledge",
    root: "/vault/Wiki",
    path: relativePath,
    absolutePath: `/vault/Wiki/${relativePath}`,
    title,
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
