# Personal Context

Personal Context makes one Markdown knowledge base available to Codex and
Claude Code from any codebase. It is local-first, evidence-aware, read-only, and
does not copy files into repositories.

Obsidian is supported as an editor, but is not required at runtime. The
companion Knowledge Sync plugin may write reviewed GitHub evidence into the
same portable Markdown store; Personal Context only reads it.

## One-minute setup

```bash
npx personal-context setup
```

The one-time local wizard:

1. detects Obsidian Vaults and ordinary Markdown knowledge folders;
2. validates the best candidate;
3. detects Codex and Claude Code;
4. shows any existing connection conflict before replacement;
5. installs a versioned, stable local runtime; and
6. registers and verifies the runtime through each client's official MCP CLI.

There is no API key, Skill installation, daemon, telemetry, GitHub login, or
per-repository file.

If a browser cannot open:

```bash
npx personal-context setup --headless
```

## Everyday use

Once connected, Codex and Claude Code can call:

- `get_context_for_task` — one compact Context Pack with ordered precedence,
  up to two playbooks, up to three evidence records, provenance, retrieval
  limits, and IDs for optional follow-up
- `search_personal_knowledge` — bounded search over approved knowledge
- `get_playbook_for_task` — relevant engineering workflow guidance
- `trace_evidence` — one selected record with repository, commit, links, and a
  bounded body

The MCP instructions ask an agent to retrieve context only when personal
precedent or workflow guidance could materially change the work. The first
response is deliberately small; agents use `trace_evidence` only for records
that materially support a decision or factual claim. Current repository rules
and the user's instructions always take priority, and note content is treated
as untrusted evidence rather than as instructions.

`get_context_for_task` returns the same provider-neutral projection as readable
Markdown and MCP structured content. Modern tool-using agents can retrieve it
on demand; a simpler harness can prefetch and inject the same pack without
changing the canonical knowledge or inventing a second memory format. See
[CONTEXT_DELIVERY.md](docs/CONTEXT_DELIVERY.md) for the research and design
tradeoffs.

Markdown changes are debounced and swapped into a complete new in-memory index.
Agents see successful edits without restarting. If filesystem watching fails,
Personal Context falls back to low-frequency fingerprint polling.

## CLI

```text
personal-context setup [--store path] [--headless] [--yes]
personal-context status [--json]
personal-context doctor [path] [--store path]
personal-context query <text> [--store path] [--limit 5]
personal-context mcp [--store path]
personal-context connect --client codex|claude --yes
personal-context disconnect --client codex|claude
personal-context uninstall
```

Store resolution is deterministic:

1. `--store`
2. `PERSONAL_CONTEXT_STORE`
3. the source selected during setup

`disconnect` removes only the named `personal-context` MCP entry. `uninstall`
removes both Personal Context MCP entries and its managed runtime, while
preserving the knowledge folder, the selected-source preference, and every
unrelated MCP server.

## Portable knowledge contract

Personal Context recursively reads Markdown and understands ordinary
frontmatter and wikilinks. Evidence-aware records may use:

```yaml
---
title: Fail closed at the parser boundary
type: experience
source_repository: owner/repository
source_commit: 0123456789abcdef0123456789abcdef01234567
tags:
  - parser
  - validation
---
```

The connection between Personal Context and Knowledge Sync is only Markdown,
frontmatter, and wikilinks. Neither repository imports the other.

See [KNOWLEDGE_CONTRACT.md](docs/KNOWLEDGE_CONTRACT.md),
[PRODUCT_BOUNDARY.md](docs/PRODUCT_BOUNDARY.md), and
[SECURITY.md](SECURITY.md).

## Privacy and installation

The setup UI is served once from a random loopback port and closes when setup is
finished. Runtime MCP communication is local stdio. Configuration stores only a
schema version, the chosen knowledge root, and its last validation time.

The npm artifact contains a dependency-free runtime bundle. It copies that
bundle to the operating system's application-data directory by version and
atomically advances a `current` pointer only after the new runtime passes an MCP
smoke test. Agent settings point to the stable Node executable and managed
runtime path, never to an ephemeral npx cache.

## Development

Requires Node 22 or newer.

```bash
npm install
npm run check
npm test
npm run build
npm run test:e2e
npm run test:package
```

The selected setup reference and implementation captures live in
[`docs/design`](docs/design). The blocking accessibility and fidelity verdict is
recorded in [`design-qa.md`](design-qa.md).
