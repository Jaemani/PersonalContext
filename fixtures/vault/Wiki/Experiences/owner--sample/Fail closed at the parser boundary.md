---
type: experience
title: Fail closed at the parser boundary
status: recorded
experience_kind: decision
source_repository: "[[Wiki/Entities/Repositories/owner--sample|owner/sample]]"
source_commit: 0123456789abcdef0123456789abcdef01234567
confidence: high
tags: [parser, validation]
---
# Fail closed at the parser boundary

Reject an unknown manifest version before state mutation instead of attempting
a permissive fallback.

## Source evidence

- https://github.com/owner/sample/blob/0123456789abcdef0123456789abcdef01234567/docs/decision.md
