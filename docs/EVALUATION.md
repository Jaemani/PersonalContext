# Evaluation

Validation is split so the runtime, playbook, and Knowledge Sync plugin can
advance independently.

## Contract

- Parse representative Repository, Experience, Decision, Experiment, and
  Playbook records.
- Normalize wikilink repository values.
- Preserve exact commit and evidence URLs.
- Never require Obsidian APIs or plugin state.

## Retrieval

Golden cases name a user query and at least one acceptable title. A case passes
when the expected record appears within its bounded result set.

Track:

- top-k hit rate
- irrelevant cross-repository results
- evidence availability
- returned context size
- cold start and warm query latency

## Task quality

Compare real tasks with and without the personal engineering skill. Review:

- repository rule adherence
- verification coverage
- unsupported completion claims
- unnecessary documentation
- unrelated context injection
- change scope

## Provider parity

Run the same MCP calls from Codex and Claude Code in a clean repository while
Obsidian is closed. The canonical result set must be provider-independent.
