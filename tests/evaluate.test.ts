import { promises as fs } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  PersonalKnowledgeIndex,
  evaluateRetrieval,
  readKnowledgeStore,
  type RetrievalCase,
} from "../packages/core/src/runtime.js";

describe("retrieval evaluation", () => {
  it("passes the fixture golden cases", async () => {
    const records = await readKnowledgeStore(path.resolve("fixtures/vault"));
    const cases = JSON.parse(
      await fs.readFile(
        path.resolve("evals/retrieval/fixture-cases.json"),
        "utf8",
      ),
    ) as RetrievalCase[];
    const report = evaluateRetrieval(
      new PersonalKnowledgeIndex(records),
      cases,
    );

    expect(report.hitRate).toBe(1);
    expect(report.cases.every((testCase) => testCase.passed)).toBe(true);
  });
});
