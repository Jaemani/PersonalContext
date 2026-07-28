import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

export async function smokeTestRuntime(
  nodePath: string,
  runtimePath: string,
  storePath: string,
  timeoutMs = 10_000,
): Promise<void> {
  const transport = new StdioClientTransport({
    command: nodePath,
    args: [runtimePath, "mcp", "--store", storePath],
    stderr: "pipe",
  });
  const client = new Client({
    name: "personal-context-setup-smoke",
    version: "0.1.0",
  });
  let timer: NodeJS.Timeout | undefined;
  try {
    await Promise.race([
      (async () => {
        await client.connect(transport);
        const tools = await client.listTools();
        const names = new Set(tools.tools.map((tool) => tool.name));
        for (const required of [
          "get_context_for_task",
          "search_personal_knowledge",
          "get_playbook_for_task",
          "trace_evidence",
        ]) {
          if (!names.has(required)) {
            throw new Error(`Managed runtime is missing ${required}.`);
          }
        }
      })(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error("Managed runtime smoke test timed out.")),
          timeoutMs,
        );
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
    await client.close().catch(() => undefined);
  }
}
