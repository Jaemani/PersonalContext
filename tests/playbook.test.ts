import path from "node:path";
import { describe, expect, it } from "vitest";
import { createKnowledgeRuntime } from "../packages/core/src/runtime.js";

describe("engineering playbook", () => {
  it("retrieves a proportionate feature workflow", async () => {
    const index = await createKnowledgeRuntime({
      storePath: path.resolve("fixtures/vault"),
    });
    const hits = index.search(
      "implement a behavior changing feature and verify it",
      { collections: ["playbook"] },
      3,
    );

    expect(hits.map((hit) => hit.title)).toContain("Feature Implementation");
  });
});
