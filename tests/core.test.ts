import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  PersonalKnowledgeIndex,
  inspectKnowledgeStore,
  readKnowledgeStore,
} from "../packages/core/src/runtime.js";

const fixtureRoot = path.resolve("fixtures/vault");

describe("portable knowledge contract", () => {
  it("parses repository provenance, exact evidence, and wikilinks", async () => {
    const records = await readKnowledgeStore(fixtureRoot);
    const experience = records.find(
      (record) => record.title === "Fail closed at the parser boundary",
    );

    expect(records).toHaveLength(3);
    expect(experience?.sourceRepository).toBe("owner/sample");
    expect(experience?.sourceCommit).toBe(
      "0123456789abcdef0123456789abcdef01234567",
    );
    expect(experience?.evidenceUrls[0]).toContain(
      "/blob/0123456789abcdef0123456789abcdef01234567/",
    );
  });

  it("retrieves high-signal records with bounded filters", async () => {
    const index = new PersonalKnowledgeIndex(
      await readKnowledgeStore(fixtureRoot),
    );
    const hits = index.search("manifest parser validation", {
      types: ["experience"],
    });

    expect(hits[0]?.title).toBe("Fail closed at the parser boundary");
    expect(hits[0]?.sourceRepository).toBe("owner/sample");
  });

  it("reports a valid fixture store", async () => {
    const records = await readKnowledgeStore(fixtureRoot);
    const report = inspectKnowledgeStore(fixtureRoot, records);

    expect(report.valid).toBe(true);
    expect(report.countsByType.experience).toBe(1);
    expect(report.findings).toEqual([]);
  });
});
