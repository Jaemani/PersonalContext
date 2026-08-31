import path from "node:path";
import { promises as fs } from "node:fs";
import os from "node:os";
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

    expect(records).toHaveLength(7);
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

  it("uses lifecycle only for current-rule queries and keeps history searchable", async () => {
    const index = new PersonalKnowledgeIndex(
      await readKnowledgeStore(fixtureRoot),
    );

    const current = index.search("현재 context boundary rule", {}, 1);
    const historical = index.search("previous context boundary rule", {}, 3);

    expect(current[0]?.evidenceId).toBe("fixture:context-boundary-active");
    expect(historical.map((hit) => hit.evidenceId)).toContain(
      "fixture:context-boundary-superseded",
    );
  });

  it("reports a valid fixture store", async () => {
    const records = await readKnowledgeStore(fixtureRoot);
    const report = inspectKnowledgeStore(fixtureRoot, records);

    expect(report.valid).toBe(true);
    expect(report.countsByType.experience).toBe(1);
    expect(report.findings).toEqual([]);
  });

  it("skips hidden Markdown folders", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "pc-hidden-"));
    try {
      await fs.mkdir(path.join(root, ".private"));
      await fs.writeFile(path.join(root, "visible.md"), "# Visible");
      await fs.writeFile(path.join(root, ".private", "secret.md"), "# Secret");
      const records = await readKnowledgeStore(root);
      expect(records.map((record) => record.title)).toEqual(["Visible"]);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });
});
