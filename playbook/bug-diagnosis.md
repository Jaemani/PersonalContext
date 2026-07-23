---
type: playbook
kind: workflow
title: Bug Diagnosis
status: active
use_when: [unexpected behavior, regression, failing test]
avoid_when: [requested implementation with an already established cause]
tags: [engineering, diagnosis, evidence]
---
# Bug Diagnosis

## Workflow

1. Reproduce or identify the strongest available failure signal.
2. Separate observations from hypotheses.
3. Trace the smallest causal path through configuration, state, and code.
4. Test the leading hypothesis with a discriminating check.
5. Explain the root cause and affected boundary before proposing a fix.

Do not implement a fix when the request is diagnosis-only. Do not claim a root
cause from correlation or from an error message alone.
