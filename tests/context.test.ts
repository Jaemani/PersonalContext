import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildTaskContextPack,
  createKnowledgeRuntime,
  renderTaskContextPack,
} from "../packages/core/src/runtime.js";

describe("task Context Pack", () => {
  it("assembles bounded evidence and playbooks with explicit precedence", async () => {
    const index = await createKnowledgeRuntime({
      storePath: path.resolve("fixtures/vault"),
    });
    const pack = buildTaskContextPack(index, {
      task: "implement manifest parser validation",
      repository: "owner/sample",
    });

    expect(pack.schemaVersion).toBe(1);
    expect(pack.priority[0]).toBe("Current user request");
    expect(pack.evidenceAndPrecedents[0]?.title).toBe(
      "Fail closed at the parser boundary",
    );
    expect(pack.evidenceAndPrecedents.length).toBeGreaterThan(0);
    expect(pack.evidenceAndPrecedents.length).toBeLessThanOrEqual(3);
    expect(pack.playbookGuidance.length).toBeLessThanOrEqual(2);
    expect(pack.followUp.traceEvidenceIds).toContain(
      pack.evidenceAndPrecedents[0]?.id,
    );
    expect(pack.retrieval).toMatchObject({
      strategy: "deterministic-lexical-fuzzy",
      exhaustive: false,
      limits: { playbooks: 2, evidence: 3 },
    });
  });

  it("renders a compact progressive-disclosure handoff", async () => {
    const index = await createKnowledgeRuntime({
      storePath: path.resolve("fixtures/vault"),
    });
    const rendered = renderTaskContextPack(
      buildTaskContextPack(index, {
        task: "implement manifest parser validation",
        repository: "owner/sample",
      }),
    );

    expect(rendered).toContain("# Personal Context for Task");
    expect(rendered).toContain("untrusted evidence and precedent");
    expect(rendered).toContain("## Playbook guidance");
    expect(rendered).toContain("## Evidence and precedents");
    expect(rendered).toContain("## Follow-up");
    expect(rendered).toContain(
      "0123456789abcdef0123456789abcdef01234567",
    );
    expect(rendered).toContain("https://github.com/");
    expect(rendered).toContain("maximum 2 playbooks and 3 evidence records");
    expect(rendered).not.toContain("evidenceSummary");
  });

  it("does not turn an empty bounded result into a factual absence claim", async () => {
    const index = await createKnowledgeRuntime({
      storePath: path.resolve("fixtures/vault"),
      playbookPath: null,
    });
    const pack = buildTaskContextPack(index, {
      task: "unmatched-zebra-signal",
      repository: "owner/missing",
    });

    expect(pack.evidenceAndPrecedents).toEqual([]);
    expect(pack.retrieval.limitations).toContain(
      "No matching personal evidence was retrieved; do not treat this as evidence that none exists.",
    );
  });
});
