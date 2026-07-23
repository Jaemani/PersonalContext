---
type: playbook
kind: template
title: Architecture Decision
status: active
use_when: [durable boundary change, irreversible dependency choice]
avoid_when: [local refactor, easily reversible implementation detail]
tags: [engineering, architecture, adr]
---
# Architecture Decision

Record only decisions that a future maintainer could reasonably question.

## Minimal record

- Context: what constraint or tension requires a decision?
- Options: which plausible alternatives were considered?
- Decision: what boundary or rule is adopted?
- Consequences: what becomes easier, harder, or impossible?
- Evidence: which code, experiment, issue, or source supports it?
- Revisit trigger: what new evidence would justify changing it?
