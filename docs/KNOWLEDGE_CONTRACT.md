# Knowledge contract

The integration boundary is plain Markdown with optional YAML frontmatter and
wikilinks. Personal Context never reads an Obsidian plugin's private state.

## Canonical fields

| Field | Meaning |
| --- | --- |
| `type` | `repository`, `experience`, `decision`, `experiment`, `playbook`, or another explicit object type |
| `title` | Stable human-readable title |
| `status` | Lifecycle state such as `recorded`, `candidate`, or `active` |
| `source_repository` | Repository identity or wikilink for provenance |
| `source_commit` | Exact commit SHA or commit URL when available |
| `confidence` | Evidence confidence, not writing quality |
| `tags` | Retrieval hints; never the sole source of meaning |

Unknown fields are preserved by the source file and ignored by the reader.
Missing optional fields do not block indexing. An Experience without a source
repository is a contract error.

Portable producers may add an optional stable `id`, `evidence_id`, and
`knowledge_contract: 1`. The runtime keeps its path-scoped internal record ID,
while `evidence_id` provides a stable evaluation and evidence identity when a
producer can guarantee one. Older notes remain valid without these fields.

Wikilinks are graph edges without an assumed predicate. Explicit relationship
predicates may be added in a future schema version without changing current
Markdown readability.
