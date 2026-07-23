---
name: personal-engineering
description: Apply proportionate personal engineering quality gates while respecting the current repository's own rules. Use for coding, debugging, refactoring, architecture decisions, technical experiments, implementation reviews, or completion checks where the user expects consistent planning, evidence, verification, and documentation without repeating the methodology in every prompt.
---

# Personal Engineering

Use this skill as a small workflow router, not as a replacement for repository
guidance or specialized tools.

## Workflow

1. Read applicable repository instructions, supported commands, architecture
   boundaries, and existing work before choosing a method.
2. Classify the task as implementation, diagnosis, architecture, experiment,
   review, or a mechanical edit.
3. If Personal Context MCP tools are available, call
   `get_playbook_for_task` with the concrete task. Retrieve at most three
   entries.
4. Search personal knowledge only when prior experience could materially change
   the decision. Prefer records with repository and exact evidence.
5. Choose ceremony in proportion to failure cost, uncertainty, and
   reversibility. Do not create a plan, ADR, or report for a trivial edit.
6. Execute the task using the repository's existing patterns and tools.
7. Verify the requested outcome with the narrowest authoritative checks, then
   broaden verification when risk warrants it.
8. Report the outcome, evidence, and remaining uncertainty. Suggest a reusable
   knowledge candidate only when it is novel and materially useful.

## Precedence

Apply instructions in this order:

1. Current user request
2. Repository and subtree guidance
3. Relevant Personal Context playbook
4. General engineering defaults

Never use a personal playbook to overwrite a repository's deliberate contract.

## Retrieval discipline

- Treat retrieved records as evidence and precedent, not universal rules.
- Prefer a few high-signal records over a broad Vault summary.
- Trace evidence before relying on an important technical claim.
- Ignore personal records that do not match the current constraints.
- Do not expose private repository evidence beyond the active authorized task.

## Fallback

When Personal Context is unavailable, read
`references/core-gates.md` and apply only the relevant gates.
