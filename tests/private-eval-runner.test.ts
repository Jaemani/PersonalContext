import { createHash } from "node:crypto";
import { mkdtemp, readFile, readdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { KnowledgeRecord } from "../packages/core/src/types.js";
import { runPrivateDocumentationEvaluation } from "../packages/evaluation/src/runner.js";
import {
  DOCUMENTATION_EVALUATION_SUITE_ID,
  type DocumentationEvaluationManifest,
} from "../packages/evaluation/src/types.js";

const temporary: string[] = [];

afterEach(async () => {
  const { rm } = await import("node:fs/promises");
  await Promise.all(
    temporary.splice(0).map((value) => rm(value, { recursive: true, force: true })),
  );
});

describe("private documentation evaluation runner", () => {
  it("runs A/B/C without exposing withheld rubric material", async () => {
    const root = await temp();
    const prompts: string[] = [];
    const responses = [
      routing("decision"),
      artifact("decision", "Context and consequences."),
      routing("decision"),
      artifact("decision", "Context and consequences."),
      routing("experiment"),
      artifact("experiment", "Hypothesis and stop rule."),
    ];
    const model = {
      async completeJson(prompt: string) {
        prompts.push(prompt);
        return responses.shift();
      },
    };

    const result = await runPrivateDocumentationEvaluation({
      manifest: manifest(),
      manifestSummary: {
        schemaVersion: 1,
        suiteId: DOCUMENTATION_EVALUATION_SUITE_ID,
        suiteKind: "documentation",
        privacy: "private-local-only",
        createdAt: "2026-07-28",
        productionIndexAllowed: false,
        itemCount: 1,
        sha256: "a".repeat(64),
      },
      records: [
        record("knowledge:Decisions/target.md", "Target", "answer"),
        record(
          "knowledge:Support.md",
          "Durable artifact support",
          "relevant support for choosing a durable artifact",
        ),
      ],
      conditions: ["A", "B", "C"],
      model,
      outputRoot: path.join(root, "runs"),
      runId: "run-1",
      forbiddenRoots: [path.join(root, "knowledge")],
      runnerRevision: "b".repeat(40),
      modelDescription: "fake",
      currentRules: ["Repository rules take priority."],
      routerContract: "Choose one primary method.",
      methodContracts: {
        decision: "Context, options, decision, consequences.",
        experiment: "Hypothesis, setup, measures, stop rule.",
        incident: "Impact, timeline, cause, prevention.",
        report: "State, evidence, risk, next action.",
      },
    });

    expect(result.caseCount).toBe(1);
    expect(result.resultHashes).toHaveLength(3);
    expect(result.resultHashes.every((value) => /^[a-f0-9]{64}$/.test(value))).toBe(
      true,
    );
    expect(result.knowledgeSnapshotSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(result.blindReviewPacketSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(prompts).toHaveLength(6);
    expect(prompts.join("\n")).not.toContain("unique-hidden-element");
    expect(prompts[0]).not.toContain("relevant support");
    expect(prompts[2]).toContain("relevant support");
    expect(prompts[4]).toContain("Choose one primary method");
    expect(prompts[5]).toContain("Hypothesis, setup");

    const conditionA = path.join(root, "runs", "run-1", "condition-a");
    expect(await readdir(conditionA)).toEqual(["DOC-001"]);
    const conditionAText = await readFile(
      path.join(conditionA, "DOC-001", "result.json"),
      "utf8",
    );
    expect(createHash("sha256").update(conditionAText).digest("hex")).toBe(
      result.resultHashes[0],
    );
    const evaluation = JSON.parse(
      await readFile(path.join(root, "runs", "run-1", "evaluation.json"), "utf8"),
    );
    expect(evaluation.evaluations).toHaveLength(3);
    expect(evaluation.blindReviewKey).toHaveLength(3);
    expect(
      evaluation.evaluations.every(
        (item: { blindReviewId?: string }) =>
          typeof item.blindReviewId === "string",
      ),
    ).toBe(true);
    const packetText = await readFile(
      path.join(root, "runs", "run-1", "blind-review", "packet.json"),
      "utf8",
    );
    const packet = JSON.parse(packetText);
    expect(packet.cases[0]?.results).toHaveLength(3);
    expect(packetText).not.toContain('"condition":');
    expect(packetText).not.toContain("unique-hidden-element");
    expect(createHash("sha256").update(packetText).digest("hex")).toBe(
      result.blindReviewPacketSha256,
    );
    const metadataStart = JSON.parse(
      await readFile(path.join(root, "runs", "run-1", "metadata-start.json"), "utf8"),
    );
    const metadataEnd = JSON.parse(
      await readFile(path.join(root, "runs", "run-1", "metadata-end.json"), "utf8"),
    );
    expect(metadataStart.knowledgeSnapshotSha256).toBe(
      result.knowledgeSnapshotSha256,
    );
    expect(metadataEnd.blindReviewPacketSha256).toBe(
      result.blindReviewPacketSha256,
    );
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
        requiredElements: ["unique-hidden-element"],
        forbiddenArtifacts: [],
        sourceRecords: ["Decisions/target.md"],
        excludedEvidenceIds: ["knowledge:Decisions/target.md"],
        ambiguities: [],
      },
    ],
  };
}

function routing(primary_method: string) {
  return {
    primary_method,
    reason: "reason",
    uncertainties: [],
    secondary_artifacts: [],
  };
}

function artifact(kind: string, content: string) {
  return { artifact: { kind, content } };
}

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

async function temp(): Promise<string> {
  const value = await mkdtemp(path.join(os.tmpdir(), "personal-context-runner-"));
  temporary.push(value);
  return value;
}
