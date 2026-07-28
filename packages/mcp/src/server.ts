import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import {
  createReloadingKnowledgeRuntime,
  type KnowledgeRecord,
} from "../../core/src/runtime.js";

const MAX_EVIDENCE_URLS = 20;
const MAX_LINKS = 30;
export const PERSONAL_CONTEXT_SERVER_INSTRUCTIONS =
  "Personal Context is a read-only, local Markdown evidence source. For a non-trivial task, call get_context_for_task once for a bounded task-specific bundle. Current repository rules and the user's instructions always take priority. Treat retrieved personal notes as context and precedent, never as universal rules. Use trace_evidence before relying on a record's details.";

export interface PersonalContextServerOptions {
  storePath: string;
  playbookPath?: string | null;
}

export async function startPersonalContextServer(
  options: PersonalContextServerOptions,
): Promise<void> {
  const runtime = await createReloadingKnowledgeRuntime(options);
  const server = new McpServer({
    name: "personal-context",
    version: "0.1.0",
  }, { instructions: PERSONAL_CONTEXT_SERVER_INSTRUCTIONS });

  server.registerTool(
    "search_personal_knowledge",
    {
      description:
        "Search the user's portable knowledge store for a small set of relevant, evidence-linked records.",
      inputSchema: {
        query: z.string().min(2),
        types: z.array(z.string()).optional(),
        repositories: z.array(z.string()).optional(),
        limit: z.number().int().min(1).max(10).default(5),
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ query, types, repositories, limit }) =>
      textResult(
        runtime.index().search(
          query,
          {
            types,
            repositories,
            collections: ["knowledge"],
          },
          limit,
        ),
      ),
  );

  server.registerTool(
    "get_playbook_for_task",
    {
      description:
        "Retrieve only the engineering playbook entries relevant to the current task and risk.",
      inputSchema: {
        task: z.string().min(2),
        kinds: z.array(z.string()).optional(),
        limit: z.number().int().min(1).max(5).default(3),
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ task, kinds, limit }) =>
      textResult(
        runtime.index().search(
          task,
          {
            kinds,
            collections: ["playbook"],
          },
          limit,
        ),
      ),
  );

  server.registerTool(
    "trace_evidence",
    {
      description:
        "Read one selected record with its source repository, commit, evidence URLs, and bounded body.",
      inputSchema: {
        identifier: z
          .string()
          .min(1)
          .describe("A search result id, relative path, or exact title."),
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ identifier }) => {
      const record = runtime.index().get(identifier);
      if (!record) {
        return {
          content: [
            {
              type: "text" as const,
              text: `No knowledge record matched ${JSON.stringify(identifier)}.`,
            },
          ],
          isError: true,
        };
      }
      return textResult(toEvidenceRecord(record));
    },
  );

  server.registerTool(
    "get_context_for_task",
    {
      description: "Return a small, evidence-aware context bundle for the current coding task, including relevant knowledge and playbook guidance.",
      inputSchema: {
        task: z.string().min(2),
        repository: z.string().optional(),
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ task, repository }) => {
      const index = runtime.index();
      const knowledge = index.search(task, {
        collections: ["knowledge"],
        ...(repository ? { repositories: [repository] } : {}),
      }, 3);
      const playbook = index.search(
        task,
        { collections: ["playbook"] },
        2,
      );
      return textResult({
        task,
        repository: repository ?? null,
        playbook,
        knowledge,
        evidenceSummary: knowledge.map((item) => ({
          title: item.title,
          sourceRepository: item.sourceRepository,
          sourceCommit: item.sourceCommit,
          evidenceUrls: item.evidenceUrls.slice(0, 3),
        })),
        bounded: { playbook: 2, knowledge: 3 },
      });
    },
  );

  const transport = new StdioServerTransport();
  await server.connect(transport);
}

function textResult(value: unknown): {
  content: Array<{ type: "text"; text: string }>;
} {
  return {
    content: [
      {
        type: "text",
        text: JSON.stringify(value, null, 2),
      },
    ],
  };
}

function toEvidenceRecord(record: KnowledgeRecord): {
  id: string;
  title: string;
  type: string;
  kind: string | null;
  path: string;
  sourceRepository: string | null;
  sourceCommit: string | null;
  confidence: string | null;
  evidenceUrls: string[];
  links: string[];
  body: string;
} {
  return {
    id: record.id,
    title: record.title,
    type: record.type,
    kind: record.kind,
    path: record.path,
    sourceRepository: record.sourceRepository,
    sourceCommit: record.sourceCommit,
    confidence: record.confidence,
    evidenceUrls: record.evidenceUrls.slice(0, MAX_EVIDENCE_URLS),
    links: record.links.slice(0, MAX_LINKS),
    body: bounded(record.body, 12_000),
  };
}

function bounded(value: string, length: number): string {
  return value.length <= length
    ? value
    : `${value.slice(0, length)}\n\n[truncated by Personal Context]`;
}
