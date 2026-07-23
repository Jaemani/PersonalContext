---
type: playbook
kind: quality-gate
title: Proportionate Definition of Done
status: active
use_when: [implementation, refactor, fix, review]
avoid_when: []
tags: [engineering, completion, verification]
---
# Proportionate Definition of Done

A task is complete when:

- the requested outcome exists;
- repository-local rules and boundaries were respected;
- relevant tests, type checks, builds, or direct behavior checks passed;
- no unrelated user changes were overwritten;
- documentation changed only when behavior or a durable contract changed;
- unverified assumptions and residual risk are explicit.

The amount of ceremony scales with failure cost and reversibility, not file
count.
