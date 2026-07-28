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

## Private evaluation runner

Private task inputs, expected labels, and raw model artifacts stay in the
operating system's application-data directory. They are never product
fixtures, runtime knowledge, npm package content, or Git history.

The source-only developer command is:

```bash
npm run eval:private -- \
  --manifest <private-manifest> \
  --expected-sha <sha256> \
  --store <knowledge-root> \
  --output <private-run-root> \
  --runner-revision <exact-full-git-object-id> \
  --model <exact-model-id> \
  --reasoning-effort <exact-effort> \
  --conditions A,B,C
```

Use `--validate-only` to verify the manifest, permissions, hash, source
records, pre-index exclusions, output-root isolation, exact model and reasoning
pins, exact runner revision, the knowledge snapshot hash, and the complete
A/B/C condition set without invoking a model or creating a run.

Completed runs create `blind-review/packet.json`. That packet contains the
private task, routing proposal, and artifact under opaque review IDs, but no
condition label, retrieved-context identity, raw model envelope, mechanical
score, expected method, or withheld rubric. The condition key remains in the
separate private `evaluation.json` file.

The runner fails closed when:

- A/B/C are not requested together in one immutable run;
- the declared full runner revision differs from the checked-out clean harness;
- the parent directory or manifest is not private;
- the manifest hash differs from its frozen value;
- production indexing is not explicitly disabled;
- a target record cannot be excluded before index construction;
- withheld rubric material enters a prompt;
- a raw secret pattern appears in a prompt or model result;
- the run output overlaps the knowledge root or source repository;
- an existing run output root is not an owner-only `700` directory;
- an attempt or result would overwrite prior output.

Codex evaluation runs are ephemeral, ignore user config and rules, disable web
search, inherit no shell environment, use a read-only empty temporary
workspace, and remove that workspace after every success or failure. Prompts
are passed over stdin and are not written into run metadata. Routing and
artifact responses are constrained with explicit Codex output schemas. If a
command or response contract fails, the immutable private attempt records a
`failure.json` envelope and any available raw model response before stopping;
failed output is never copied to Git or the production knowledge root.

The current runner implements the Documentation Router A/B/C contract. The
Operational Context suite has a separate condition meaning and is validation
only until that contract is implemented. No private model run has been
performed as part of the runner implementation.
