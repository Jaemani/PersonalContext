# Context delivery architecture

Personal Context is a read-only context assembly and delivery runtime. It does
not own model inference, session memory, or automatic knowledge promotion. Its
job is to turn portable Markdown into a small, auditable working-context
projection that different agent harnesses can consume.

This design was reviewed against current official harness documentation and
context-engineering research on 2026-07-29. Recent arXiv work cited below is
useful directional evidence, not a production guarantee.

## Delivery layers

Use the smallest surface that matches the lifetime of the information.

| Layer | Contains | Loading behavior |
| --- | --- | --- |
| Repository instructions | Durable project commands, constraints, and completion checks | Loaded by the harness for the applicable repository scope |
| Thin Skill | A reusable workflow and rules for when to retrieve or trace | Metadata is discovered first; instructions load only when activated |
| Personal Context MCP | Current task-specific evidence, playbooks, and provenance | Retrieved on demand or prefetched by a simpler harness |
| Canonical Markdown | Human-approved facts, decisions, experiences, and Methods | Never injected wholesale; read through the bounded runtime |

Codex, Claude Code, and Gemini CLI all support hierarchical repository
instructions, progressively loaded Agent Skills, and MCP. Their exact loading
budgets, consent flows, and deferred-tool behavior differ, so Personal Context
does not make a client-specific prompt the knowledge contract.

## Adopted Context Pack

`get_context_for_task` returns one provider-neutral projection in two forms:

- readable Markdown for clients that place text tool output directly into the
  model context;
- MCP `structuredContent` for harnesses that can validate, reduce, display, or
  prefetch the same data programmatically.

The pack contains:

1. the task and optional repository identity;
2. an explicit precedence order: current user request, repository rules, then
   personal context;
3. at most two relevant playbook entries;
4. at most three relevant evidence or precedent records;
5. source repository, commit, and evidence URLs when available;
6. record IDs for optional `trace_evidence` follow-up;
7. retrieval limits and an explicit statement that an empty bounded result is
   not proof of absence.

The initial pack contains bounded snippets, not full notes. Full bodies remain
behind `trace_evidence`. This is progressive disclosure at the data layer and
keeps both context use and private-data exposure proportional to the task.

## Model and harness profiles

The canonical pack is stable; only delivery policy varies.

### Tool-first profile

Use for current agentic models that reliably discover and call tools.

1. Keep repository instructions and Skill bodies concise.
2. Call `get_context_for_task` only when personal precedent could materially
   change the work.
3. Trace only records used for a material decision or factual claim.
4. Stop retrieving when the task has enough evidence.

This matches current Codex guidance to expose only relevant tools, define a
retrieval budget, and keep prompts outcome-first. Claude Code and Gemini CLI
also defer Skill bodies and MCP tool definitions or resources until needed.

### Prefetch profile

Use for older or constrained harnesses that do not reliably initiate tool use.
The harness calls the same read-only Context Pack function before model
execution and injects the rendered Markdown. It must preserve the pack's
precedence, provenance, limits, and untrusted-data boundary.

Prefetch is a transport fallback, not a second knowledge model. It must not
copy context into the repository, promote notes, or persist a generated pack as
canonical memory.

## Why the pack is small

Long context capacity does not guarantee robust use. *Lost in the Middle*
found that relevant information position can materially change performance in
long inputs. A 2026 reasoning-model preprint, *Lost in the Noise*, reports that
irrelevant and hard-negative context can sharply degrade RAG, reasoning, and
tool-use tasks. These results support bounded retrieval and explicit source
selection rather than Vault-wide injection.

The current runtime keeps deterministic lexical/fuzzy retrieval as the
baseline. It does not add embeddings, GraphRAG, model ranking, or prompt
compression without a measured retrieval failure. Anthropic's Contextual
Retrieval results make contextualized chunks, hybrid lexical/semantic search,
and reranking reasonable later treatments, but not default dependencies.

Format is not treated as a universal quality lever. The 2026 file-native
context study reports model-dependent architecture effects and no significant
aggregate accuracy difference among Markdown, YAML, JSON, and TOON. Returning
both readable Markdown and structured MCP data preserves portability and lets
each harness use its native path without duplicating the source of truth.

## Skill and MCP boundary

The Skill teaches the workflow:

- when personal context can materially change a task;
- when to call the Context Pack;
- when to trace evidence;
- how to respect user and repository precedence;
- when to stop retrieving.

MCP supplies live local data and enforces read-only boundaries. The Skill must
not contain the user's knowledge base, generated summaries, model-specific
memory, credentials, or private evaluation material.

Setup currently connects the MCP server but does not install or activate the
candidate Skill. MCP server instructions therefore provide the minimal common
workflow. Skill activation remains a separately evaluated capability.

## Backup and recovery

Personal Context does not create or own backups. The canonical Markdown
repository and its owner-controlled sync or version history are the preservation
plane; this read-only runtime is the delivery plane. It can rebuild projections
from an intact source, but it cannot recover canonical notes that were never
backed up.

Back up information a future model cannot recompute:

- canonical Markdown and its Git history;
- source revisions and evidence links;
- human approvals, rejections, and corrections;
- decisions, experimental outcomes, and lifecycle state.

Regenerate instead of backing up:

- the in-memory index;
- search scores and snippets;
- Context Packs;
- embeddings, summaries, caches, or model-specific prompt renderings.

Private evaluation manifests and raw runs remain owner-only application data
and never become production context. Machine-local MCP bindings remain
configuration, not personal knowledge.

## Evaluation posture

The model is a consumer probe, not the product. Compare delivery structures on
the same task, source snapshot, model, and harness, then repeat representative
tasks across model capability tiers instead of assuming one prompt works for
all models.

Use deterministic checks for schema, provenance, boundaries, and unsupported
claims. Use condition-blinded human review for actual usefulness, correction
burden, unnecessary context, and whether the result is worth keeping. Keep a
development set separate from the frozen decision gate so the Context Pack is
not tuned to private expected answers.

Evaluation leakage is also a provenance question. Text shared by a private
rubric and an independently authored eligible note is not sufficient evidence
of leakage. The gate must instead prove that rubric objects, excluded target
records, and audit records have no path into model input.

## Sources

- OpenAI, [Codex best practices](https://learn.chatgpt.com/guides/best-practices)
- OpenAI, [Build skills](https://learn.chatgpt.com/docs/build-skills)
- OpenAI, [Model Context Protocol in Codex](https://learn.chatgpt.com/docs/extend/mcp)
- OpenAI, [Prompting guidance for GPT-5.6 Sol](https://developers.openai.com/api/docs/guides/prompt-guidance-gpt-5p6)
- Anthropic, [Claude Code memory](https://code.claude.com/docs/en/memory)
- Anthropic, [Claude Code skills](https://code.claude.com/docs/en/skills)
- Anthropic, [Claude Code MCP](https://code.claude.com/docs/en/mcp)
- Google, [Gemini CLI context files](https://geminicli.com/docs/cli/gemini-md/)
- Google, [Gemini CLI Agent Skills](https://geminicli.com/docs/cli/skills/)
- Google, [Gemini CLI MCP servers](https://geminicli.com/docs/tools/mcp-server/)
- Agent Skills, [format specification](https://agentskills.io/specification)
- Model Context Protocol, [Resources](https://modelcontextprotocol.io/specification/2025-11-25/server/resources)
- Liu et al., [Lost in the Middle](https://arxiv.org/abs/2307.03172)
- Jiang et al., [LongLLMLingua](https://arxiv.org/abs/2310.06839)
- Anthropic, [Contextual Retrieval](https://www.anthropic.com/engineering/contextual-retrieval)
- Wang et al., [Searching for Best Practices in RAG](https://arxiv.org/abs/2407.01219)
- [Structured Context Engineering for File-Native Agentic Systems](https://arxiv.org/abs/2602.05447)
- [Lost in the Noise](https://arxiv.org/abs/2601.07226)
- [Memory in the Age of AI Agents](https://arxiv.org/abs/2512.13564)
- [From Question Answering to Task Completion: A Survey on Agent System and Harness Design](https://arxiv.org/abs/2606.20683)
