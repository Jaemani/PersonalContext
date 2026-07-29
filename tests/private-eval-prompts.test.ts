import { describe, expect, it } from "vitest";
import {
  buildArtifactPrompt,
  buildRoutingPrompt,
} from "../packages/evaluation/src/prompts.js";

describe("private evaluation prompts", () => {
  it("keeps condition A task-only and condition B bounded", () => {
    const a = buildRoutingPrompt({
      condition: "A",
      taskInput: "Record this decision without inventing results.",
      contextRecords: [context("must-not-appear")],
    });
    expect(a).not.toContain("must-not-appear");

    const b = buildRoutingPrompt({
      condition: "B",
      taskInput: "Record this decision without inventing results.",
      contextRecords: [context("eligible evidence")],
    });
    expect(b).toContain("eligible evidence");
  });

  it("gives condition C only the explicitly supplied routing material", () => {
    const prompt = buildRoutingPrompt({
      condition: "C",
      taskInput: "Choose an appropriate durable artifact.",
      currentRules: ["Repository rules override personal precedent."],
      routerContract: "Return none when no durable document is warranted.",
      methodSummaries: ["Decision: use when choosing among viable options."],
    });

    expect(prompt).toContain("Repository rules override");
    expect(prompt).toContain("Return none");
    expect(prompt).not.toContain("unique-hidden-rubric-value");
  });

  it("uses the model-selected method for condition C artifact generation", () => {
    const prompt = buildArtifactPrompt({
      condition: "C",
      taskInput: "Write the selected artifact.",
      routingProposal: {
        primary_method: "experiment",
        reason: "The outcome is unknown.",
        uncertainties: [],
        secondary_artifacts: [],
      },
      selectedMethodContract: "Hypothesis, setup, measures, stop rule.",
      precedents: [context("leakage-safe precedent")],
    });

    expect(prompt).toContain('"primary_method":"experiment"');
    expect(prompt).toContain("Hypothesis, setup, measures");
    expect(prompt).toContain("leakage-safe precedent");
  });

  it("rejects credential-like task or context material", () => {
    expect(() =>
      buildRoutingPrompt({
        condition: "A",
        taskInput: `Use token=${"a".repeat(32)} for the task.`,
      }),
    ).toThrow(/secret-like/i);
  });
});

function context(snippet: string) {
  return {
    id: "knowledge:support.md",
    title: "Support",
    type: "knowledge",
    status: "current",
    sourceRepository: "owner/repository",
    sourceCommit: "0123456789abcdef0123456789abcdef01234567",
    snippet,
  };
}
