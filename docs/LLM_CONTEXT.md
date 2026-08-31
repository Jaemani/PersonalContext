# Personal Context implementation context

Personal Context is an independent, read-only Markdown retrieval runtime for
coding agents. It works without Obsidian, Knowledge Sync, a daemon, an API key,
or repository-side files.

## Product boundary

```text
owner-controlled Markdown
  -> derived in-memory index
  -> bounded search or Context Pack
  -> optional evidence trace
```

- The knowledge folder is never written by the runtime.
- Current user and repository instructions outrank retrieved precedent.
- Retrieved records are untrusted evidence, not executable instructions.
- Indexes, Context Packs and search scores are disposable projections.
- Knowledge Sync plugin state is outside the Interface.

## Module map

| Module | Interface and responsibility |
| --- | --- |
| `packages/core` | Markdown parsing, doctor, lifecycle-aware index, retrieval eval and Context Pack |
| `packages/mcp` | Four bounded read-only tools over the current valid index |
| `packages/agents` | Official Codex and Claude MCP CLI Adapters with safe rollback |
| `packages/setup` | Source detection, validation and transactional connection setup |
| `packages/runtime` | Versioned managed runtime installation and atomic `current` switch |
| `packages/cli` | Human entry point; orchestration rather than domain logic |
| `packages/evaluation` | Private, fail-closed task-quality harness kept out of runtime data |

The core Module exposes a small Interface: parse records, search with filters,
build a Context Pack, trace one record, and evaluate a frozen case set. The MCP
server is an Adapter over that Interface, not a second knowledge model.

## Retrieval contract

- Default retrieval remains deterministic lexical/fuzzy search.
- Current-rule queries boost `active` and `current`, demote proposals and
  historical records, and never delete history from temporal search.
- RetrievalCase v2 uses stable `evidence_id`, explicit intent, required and
  forbidden evidence, lifecycle expectations, MRR, recall@k and provenance.
- Context Packs return at most two playbooks and three evidence records.
- Full bodies stay behind `trace_evidence`.

## Failure rules

- A new index is fully built before the live pointer swaps.
- Parse failure retains the last valid index.
- Chokidar failure falls back to fingerprint polling.
- Claude's ambiguous unquoted connection output is never overwritten when the
  previous command cannot be restored safely.
- Setup rolls back already-applied client changes when a later client fails.
- Uninstall removes connections and managed runtime, not source Markdown.

## Public Seam and verification

The public Seam is Markdown, optional YAML frontmatter and wikilinks. Run
`npm run check`, `npm test`, `npm run build`, `npm run test:e2e`, and
`npm run test:package`. Private model evaluation additionally requires an
owner-only frozen manifest and is not implied by the deterministic suite.
