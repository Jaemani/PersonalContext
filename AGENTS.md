# Personal Context development guide

## Product boundary

Personal Context reads portable Markdown knowledge and serves bounded,
evidence-aware context to coding agents. It must work without Obsidian.

- Keep the runtime independent of Obsidian APIs and plugin state.
- Treat Markdown, frontmatter, and wikilinks as the integration contract.
- Keep MCP read-only until a separately reviewed write queue exists.
- Prefer deterministic retrieval before adding model-based ranking.
- Never copy credentials, sessions, caches, or authentication files.
- Do not write configuration into a code repository unless the user explicitly
  chooses a project-shared export.
- Keep the personal engineering skill concise and load playbook material only
  when the task warrants it.

## Verification

Run before committing:

```bash
npm run check
npm test
npm run build
```
