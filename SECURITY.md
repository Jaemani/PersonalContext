# Security model

Personal Context is local-only and read-only with respect to the selected
knowledge folder.

- The MCP server uses stdio. It opens no network listener.
- The one-time setup server binds to a random `127.0.0.1` port, requires a
  per-process random token for every API request, validates the loopback origin,
  applies a restrictive Content Security Policy, and stops when setup is done.
- Setup stores only `schemaVersion`, `knowledgeRoot`, and `lastValidatedAt`.
  Knowledge bodies, tokens, environment variables, and client configuration
  copies are not stored.
- Agent configuration is changed only through the official `codex mcp` and
  `claude mcp --scope user` commands.
- The published package contains a dependency-free runtime bundle. Runtime
  installation therefore has no transitive npm dependencies.

## Dependency audit note

Development currently reports a moderate advisory in the MCP SDK's unused Hono
HTTP adapter. Personal Context imports only the SDK's stdio server/client
modules, and the published bundle exposes no Hono route. Production
`npm audit --omit=dev` reports zero vulnerabilities. High and critical
development findings are also zero.

Please report a vulnerability privately through the repository's GitHub
security advisory flow.
