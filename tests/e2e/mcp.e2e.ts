import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { expect, test } from "@playwright/test";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

const runtime = path.resolve("dist/runtime/personal-context.mjs");

test("stdio MCP exposes four bounded tools, live reloads, retains a valid index, and restarts", async () => {
  const store = await fs.mkdtemp(path.join(os.tmpdir(), "personal-context-mcp-"));
  const first = path.join(store, "parser.md");
  await fs.writeFile(
    first,
    [
      "---",
      "title: Parser boundary evidence",
      "type: experience",
      "source_repository: owner/parser",
      "source_commit: 0123456789abcdef0123456789abcdef01234567",
      "---",
      "# Parser boundary evidence",
      "Fail closed when a manifest parser encounters an unknown field.",
    ].join("\n"),
  );

  let client: Client | undefined;
  try {
    client = await connect(store);
    const tools = await client.listTools();
    expect(tools.tools.map((tool) => tool.name).sort()).toEqual(
      [
        "get_context_for_task",
        "get_playbook_for_task",
        "search_personal_knowledge",
        "trace_evidence",
      ].sort(),
    );

    const search = await callJson(client, "search_personal_knowledge", {
      query: "manifest parser",
    });
    expect(search[0].title).toBe("Parser boundary evidence");

    const contextResult = (await client.callTool({
      name: "get_context_for_task",
      arguments: {
        task: "implement manifest parser validation",
        repository: "owner/parser",
      },
    })) as {
      content: Array<{ type: string; text?: string }>;
      structuredContent?: Record<string, any>;
    };
    const context = contextResult.structuredContent;
    expect(context).toBeDefined();
    expect(context?.evidenceAndPrecedents).toHaveLength(1);
    expect(context?.evidenceAndPrecedents.length).toBeLessThanOrEqual(3);
    expect(context?.playbookGuidance.length).toBeLessThanOrEqual(2);
    expect(
      context?.evidenceAndPrecedents[0].provenance.sourceCommit,
    ).toBe(
      "0123456789abcdef0123456789abcdef01234567",
    );
    expect(context?.priority[0]).toBe("Current user request");
    expect(contextResult.content[0]?.text).toContain(
      "# Personal Context for Task",
    );
    expect(contextResult.content[0]?.text).toContain(
      "untrusted evidence and precedent",
    );

    const playbook = await callJson(client, "get_playbook_for_task", {
      task: "implement a risky feature",
    });
    expect(playbook.length).toBeGreaterThan(0);

    const traced = await callJson(client, "trace_evidence", {
      identifier: search[0].id,
    });
    expect(traced.sourceRepository).toBe("owner/parser");
    expect(traced.body).toContain("Fail closed");

    const added = path.join(store, "reload.md");
    await fs.writeFile(
      added,
      "---\ntitle: Live reload marker\ntype: knowledge\n---\n# Live reload marker\nfreshly indexed signal\n",
    );
    const started = Date.now();
    let reloaded: Array<{ title?: string }> = [];
    while (Date.now() - started < 2_000) {
      reloaded = await callJson(client, "search_personal_knowledge", {
        query: "freshly indexed signal",
      });
      if (reloaded.length) break;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    expect(reloaded[0]?.title).toBe("Live reload marker");
    expect(Date.now() - started).toBeLessThan(2_000);

    await fs.writeFile(first, "---\ntags: [unterminated\n---\ninvalid");
    await new Promise((resolve) => setTimeout(resolve, 350));
    const retained = await callJson(client, "search_personal_knowledge", {
      query: "freshly indexed signal",
    });
    expect(retained[0]?.title).toBe("Live reload marker");

    await client.close();
    client = undefined;
    await fs.rm(first);
    const restarted = await connect(store);
    try {
      const afterRestart = await callJson(
        restarted,
        "search_personal_knowledge",
        { query: "freshly indexed signal" },
      );
      expect(afterRestart[0]?.title).toBe("Live reload marker");
    } finally {
      await restarted.close();
    }
  } finally {
    await client?.close().catch(() => undefined);
    await fs.rm(store, { recursive: true, force: true });
  }
});

async function connect(store: string): Promise<Client> {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [runtime, "mcp", "--store", store],
    stderr: "pipe",
  });
  const client = new Client({
    name: "personal-context-mcp-e2e",
    version: "0.1.0",
  });
  await client.connect(transport);
  return client;
}

async function callJson(
  client: Client,
  name: string,
  arguments_: Record<string, unknown>,
): Promise<any> {
  const result = (await client.callTool({
    name,
    arguments: arguments_,
  })) as {
    content: Array<{ type: string; text?: string }>;
  };
  const first = result.content[0];
  if (!first || first.type !== "text" || typeof first.text !== "string") {
    throw new Error(`${name} did not return text.`);
  }
  return JSON.parse(first.text);
}
