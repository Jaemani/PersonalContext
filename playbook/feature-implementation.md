---
type: playbook
kind: workflow
title: Feature Implementation
status: active
use_when: [behavior-changing implementation]
avoid_when: [trivial mechanical edit]
tags: [engineering, feature, verification]
---
# Feature Implementation

## Intent

Deliver the smallest coherent behavior change that follows the repository's
existing contracts and can be verified from observable evidence.

## Workflow

1. Read local agent guidance, architecture boundaries, and supported commands.
2. State the user-visible outcome and the smallest affected surfaces.
3. Identify existing patterns before introducing an abstraction.
4. Implement one coherent slice.
5. Run the repository's narrow checks first, then broader checks in proportion
   to risk.
6. Report evidence, remaining uncertainty, and any intentionally deferred work.

## Documentation threshold

Create a separate plan or decision record only when the change crosses an
architectural boundary, introduces a durable contract, or needs future
explanation. Do not create process artifacts for a small local edit.
