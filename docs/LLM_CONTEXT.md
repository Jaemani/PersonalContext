# Personal Context — LLM context

## One sentence

Personal Context is a local, read-only runtime that makes reviewed Markdown
knowledge available to coding agents from any codebase, whether or not Obsidian
is installed or open.

```text
reviewed Markdown
  -> parser and in-memory index
  -> bounded, evidence-aware MCP tools
  -> Codex and Claude Code
```

This document is the implementation map. User-facing setup belongs in
`README.md`; the portable data grammar belongs in `KNOWLEDGE_CONTRACT.md`.

## Product boundaries

| System | Owns | Does not own |
| --- | --- | --- |
| Knowledge Sync | bounded GitHub reads, candidate review, Obsidian Markdown writes | Personal Context runtime or agent configuration |
| Personal Context | Markdown parsing, retrieval, evidence tracing, MCP, setup and client connection | GitHub analysis, knowledge promotion, Vault writes |
| Carrylog | continuity when switching harnesses inside one codebase | personal wiki structure or cross-project knowledge |
| Target repository | current rules, implementation truth, tests | personal knowledge storage |

The only integration contract with Knowledge Sync is Markdown, frontmatter, and
wikilinks. Never import its TypeScript, read its plugin `data.json`, or require
Obsidian APIs.

## Non-negotiable invariants

- The selected knowledge root and every target code repository are read-only.
- MCP tools are read-only and return bounded responses.
- Current user instructions and target-repository rules outrank retrieved notes.
- Retrieved notes are personal context and precedent, not universal rules.
- No API key, telemetry, daemon, repository-side file, or separate Skill install
  is required for the core product.
- Setup stores only `schemaVersion`, `knowledgeRoot`, and `lastValidatedAt`.
- Logs never contain note bodies, tokens, environment variables, or a copied
  client configuration.
- A runtime release is validated before the atomic `current` pointer changes.
- A failed client connection rolls back only the entry changed for that client;
  another client's success remains intact.
- Optional evaluation data and private results never enter the runtime package,
  production index, Vault, or public Git history.

## Source map

| Path | Responsibility |
| --- | --- |
| `packages/core` | Markdown/frontmatter/wikilink parsing, validation, lexical retrieval, store resolution, live reload, and the provider-neutral Context Pack builder/Markdown renderer in `src/context.ts` |
| `packages/mcp` | four read-only MCP tools, including `get_context_for_task` as a Markdown + `structuredContent` Context Pack delivery surface; server instructions and response bounds |
| `packages/agents` | official Codex and Claude Code CLI adapters with inspect/plan/apply/verify/rollback |
| `packages/setup` | candidate discovery, source validation, managed-runtime installation, client orchestration, loopback server |
| `packages/setup-ui` | one-time local setup wizard and its visual states |
| `packages/runtime` | OS application-data paths, versioned releases, atomic `current` replacement |
| `packages/cli` | public CLI commands and headless recovery |
| `packages/evaluation` | fail-closed evaluation logic outside the public retrieval path |
| `playbook` | bundled, provider-neutral engineering precedents |
| `skills/personal-engineering` | optional Skill; never installed or applied automatically |
| `fixtures`, `evals`, `scripts/private-eval.ts` | public fixtures and private-evaluation tooling with separate safety rules |

The core Module exposes a small Interface: parse records, search with filters,
build a Context Pack, trace one record, and evaluate a frozen case set. The MCP
server is an Adapter over that Interface, not a second knowledge model.

## Main execution flows

### Setup

```text
discover bounded candidates
  -> validate Markdown source
  -> detect Codex and Claude
  -> show current/proposed conflict when needed
  -> stage and smoke-test runtime
  -> write minimal user config
  -> connect each client through its official CLI
  -> verify or roll back that client
```

The loopback web server binds only to a random `127.0.0.1` port, uses a random
request token and restrictive headers, and closes on Done. If a browser or
loopback server is unavailable, the same decisions move to the headless
checklist.

### Retrieval

```text
resolve store: --store -> PERSONAL_CONTEXT_STORE -> user config
  -> parse complete Markdown generation
  -> atomically expose index
  -> watch with debounce
  -> fall back to fingerprint polling
  -> retain previous valid index on a bad reload
```

`get_context_for_task` is the normal entry point: it delivers the same bounded
Context Pack as readable Markdown and MCP `structuredContent`, with at most two
playbooks and three evidence or precedent records. Use `trace_evidence` before
relying on a selected record's full details.

Default retrieval remains deterministic lexical/fuzzy search. Current-rule
queries boost `active` and `current`, demote proposed and historical records,
and never remove history from temporal search. RetrievalCase v2 uses stable
`evidence_id`, explicit intent, required and forbidden evidence, lifecycle
expectations, MRR, recall@k, and provenance completeness.

## Change routing

- Markdown or frontmatter behavior: `packages/core` plus parser/runtime tests.
- Ranking, filters, or response selection: `packages/core`; preserve bounds.
- MCP names, schemas, instructions, or output limits: `packages/mcp` and MCP E2E.
- Codex/Claude syntax, conflict handling, scope, or rollback: `packages/agents`
  with realistic CLI-output tests. CLI human output may omit quotes around paths
  containing spaces; verification must compare the raw desired argument line
  without making an unsafe rollback guess for an unrelated ambiguous entry.
- Vault detection or setup state: `packages/setup` and setup browser tests.
- Wizard UI: `packages/setup-ui`; preserve the selected visual hierarchy and
  rerun browser accessibility and narrow/dark states.
- OS runtime layout or packaging: `packages/runtime`, bundle and package smoke.
- Private evaluation: read `docs/EVALUATION.md` first and keep production
  retrieval isolated from labels, answer keys, and raw results.

Do not add automatic knowledge promotion, Vault write-back, GitHub ingestion,
dense retrieval, GraphRAG, provider credential discovery, or a daemon as an
incidental part of another change.

## Verification matrix

Run the smallest relevant test while iterating, then the complete gate before a
release-affecting commit:

```bash
npm run check
npm test
npm run build
npm run test:e2e
npm run test:package
npm audit --omit=dev --audit-level=high
git diff --check
```

- Browser and loopback tests require an environment that permits Chromium and a
  local `127.0.0.1` listener.
- Live-reload tests must wait for watcher readiness and should not pass only by
  increasing an arbitrary timeout.
- The published tarball must contain the dependency-free runtime bundle and
  documented assets only; never source tests, user data, or private evaluation.

## Release rules

- Minimum Node version is 22; CI covers Node 22 and 24 on macOS, Ubuntu, and
  Windows.
- Runtime version is centralized in `packages/core/src/version.ts`. Keep it and
  the root `package.json` version aligned for every release; package smoke must
  assert the new managed-runtime version.
- Do not publish npm without explicit authentication. Do not create a release
  tag that triggers a known-failing publish workflow.
- Never merge this repository with Knowledge Sync or add a runtime import
  between them.

## Agent read order

1. `AGENTS.md`
2. this document
3. the request-specific contract and source package
4. adjacent tests
5. `docs/EVALUATION.md` only for evaluation work
6. dated handoff documents only when resuming that exact milestone

Dated handoffs are historical snapshots, not the general product source of
truth. Uninstall removes client connections and the managed runtime, never the
owner-controlled source Markdown.
