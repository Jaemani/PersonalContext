# Personal Context

Personal Context is a standalone, local-first knowledge runtime for coding
agents. It reads Markdown knowledge stores, normalizes frontmatter and
wikilinks, and exposes bounded read-only context through a CLI and MCP server.
Obsidian is an optional editor, not a runtime dependency.

It does not copy a Vault into every repository. One runtime reads one canonical
Markdown store, and Codex, Claude Code, or another MCP client can retrieve only
the records relevant to the current task.

## Current scope

- `personal-context doctor`: validate a knowledge store.
- `personal-context query`: search knowledge and playbooks.
- `personal-context eval`: run retrieval golden cases.
- `personal-context mcp`: serve read-only MCP tools over stdio.
- `skills/personal-engineering`: apply proportionate engineering quality gates.

The existing Knowledge Sync plugin remains responsible for GitHub ingestion,
review, and Markdown writes. Personal Context only consumes the resulting
portable records.

## Install

From a clone:

```bash
git clone https://github.com/Jaemani/PersonalContext.git
cd PersonalContext
npm install
npm link
```

`npm install` builds the runtime and `npm link` makes `personal-context`
available globally. This repository is not published to npm yet.

## Use

Point the runtime at the folder containing canonical knowledge notes. For the
companion Knowledge Sync default layout, this is the Vault's `Wiki` folder, not
the entire Vault:

```bash
personal-context doctor --store /path/to/vault/Wiki
personal-context query "token validation" --store /path/to/vault/Wiki
personal-context mcp --store /path/to/vault/Wiki
```

Set `PERSONAL_CONTEXT_STORE` to avoid passing `--store`. The bundled playbook
is discovered automatically or can be overridden with
`PERSONAL_CONTEXT_PLAYBOOK`.

An MCP client needs only one stdio server entry:

```json
{
  "command": "personal-context",
  "args": ["mcp", "--store", "/path/to/vault/Wiki"]
}
```

No Obsidian process, GitHub token, LLM API key, repository modification, or
per-codebase knowledge copy is required. Restart the MCP server after the
Markdown store changes; automatic live reload is intentionally outside the
initial release.

## MCP tools

- `search_personal_knowledge`: bounded search over approved personal knowledge
- `get_playbook_for_task`: at most a few relevant engineering workflow entries
- `trace_evidence`: provenance and bounded source content for one chosen record

All tools are read-only. Retrieval treats personal notes as evidence and
precedent, not as instructions that override the active repository.

## Development

```bash
npm run check
npm test
npm run build
```
