import MiniSearch from "minisearch";
import type {
  KnowledgeRecord,
  SearchFilters,
  SearchHit,
  RetrievalIntent,
} from "./types.js";

const MAX_SEARCH_EVIDENCE_URLS = 8;
const MAX_SEARCH_LINKS = 12;

interface IndexedRecord {
  id: string;
  title: string;
  body: string;
  type: string;
  kind: string;
  status: string;
  confidence: string;
  sourceRepository: string;
  tags: string;
  collection: string;
}

export class PersonalKnowledgeIndex {
  private readonly recordsById: Map<string, KnowledgeRecord>;
  private readonly searchIndex: MiniSearch<IndexedRecord>;

  constructor(readonly records: KnowledgeRecord[]) {
    this.recordsById = new Map(records.map((record) => [record.id, record]));
    this.searchIndex = new MiniSearch<IndexedRecord>({
      fields: ["title", "body", "tags", "sourceRepository", "type", "kind"],
      storeFields: [],
      searchOptions: {
        boost: { title: 4, tags: 2, sourceRepository: 1.5, kind: 1.5 },
        prefix: true,
        fuzzy: 0.15,
      },
    });
    this.searchIndex.addAll(records.map(indexedRecord));
  }

  search(
    query: string,
    filters: SearchFilters = {},
    limit = 5,
    intent?: RetrievalIntent,
  ): SearchHit[] {
    const normalizedQuery = query.trim();
    if (!normalizedQuery) return [];

    const results = this.searchIndex.search(normalizedQuery);
    const resolvedIntent = intent ?? inferRetrievalIntent(normalizedQuery);
    const hits: SearchHit[] = [];
    for (const result of results) {
      const record = this.recordsById.get(String(result.id));
      if (!record || !matchesFilters(record, filters)) continue;
      const score =
        resolvedIntent === "current-rule"
          ? result.score * currentRuleLifecycleWeight(record.status)
          : result.score;
      hits.push(toSearchHit(record, score, normalizedQuery));
    }
    return hits
      .sort((left, right) => right.score - left.score)
      .slice(0, Math.max(1, Math.min(limit, 20)));
  }

  get(identifier: string): KnowledgeRecord | null {
    const direct = this.recordsById.get(identifier);
    if (direct) return direct;
    const normalized = identifier.trim().toLowerCase();
    return (
      this.records.find(
        (record) =>
          record.path.toLowerCase() === normalized ||
          record.title.toLowerCase() === normalized,
      ) ?? null
    );
  }
}

function indexedRecord(record: KnowledgeRecord): IndexedRecord {
  return {
    id: record.id,
    title: record.title,
    body: record.body,
    type: record.type,
    kind: record.kind ?? "",
    status: record.status ?? "",
    confidence: record.confidence ?? "",
    sourceRepository: record.sourceRepository ?? "",
    tags: record.tags.join(" "),
    collection: record.collection,
  };
}

function matchesFilters(
  record: KnowledgeRecord,
  filters: SearchFilters,
): boolean {
  if (filters.types?.length && !includesFolded(filters.types, record.type)) {
    return false;
  }
  if (filters.kinds?.length && !includesFolded(filters.kinds, record.kind)) {
    return false;
  }
  if (
    filters.repositories?.length &&
    !includesFolded(filters.repositories, record.sourceRepository)
  ) {
    return false;
  }
  if (
    filters.collections?.length &&
    !filters.collections.includes(record.collection)
  ) {
    return false;
  }
  return true;
}

function includesFolded(values: string[], candidate: string | null): boolean {
  if (!candidate) return false;
  const folded = candidate.toLowerCase();
  return values.some((value) => value.toLowerCase() === folded);
}

function toSearchHit(
  record: KnowledgeRecord,
  score: number,
  query: string,
): SearchHit {
  return {
    id: record.id,
    path: record.path,
    collection: record.collection,
    title: record.title,
    type: record.type,
    kind: record.kind,
    status: record.status,
    confidence: record.confidence,
    sourceRepository: record.sourceRepository,
    sourceCommit: record.sourceCommit,
    tags: record.tags,
    evidenceUrls: record.evidenceUrls.slice(0, MAX_SEARCH_EVIDENCE_URLS),
    links: record.links.slice(0, MAX_SEARCH_LINKS),
    score,
    snippet: snippet(record.body, query),
    evidenceId: record.evidenceId,
  };
}

function inferRetrievalIntent(query: string): RetrievalIntent {
  const normalized = query.toLowerCase();
  const historical = [
    /\bhistor(?:y|ical)\b/,
    /\bpast\b/,
    /\bprevious\b/,
    /\bold\b/,
    /\bsuperseded\b/,
    /\bdeprecated\b/,
    /과거/u,
    /이전/u,
    /당시/u,
    /변경\s*전/u,
    /역사/u,
  ];
  if (historical.some((pattern) => pattern.test(normalized))) return "temporal";
  const current = [
    /\bcurrent(?:ly)?\b/,
    /\blatest\b/,
    /\bactive\b/,
    /\bnow\b/,
    /\bpresent\b/,
    /현재/u,
    /지금/u,
    /최신/u,
    /현행/u,
    /유효한/u,
    /적용\s*중/u,
  ];
  return current.some((pattern) => pattern.test(normalized))
    ? "current-rule"
    : "semantic";
}

function currentRuleLifecycleWeight(status: string | null): number {
  const normalized = status?.trim().toLowerCase();
  if (!normalized) return 1;
  if (["active", "current"].includes(normalized)) return 2;
  if (["proposed", "candidate", "draft"].includes(normalized)) return 0.55;
  if (
    ["historical", "superseded", "deprecated", "archived", "retired"].includes(
      normalized,
    )
  ) {
    return 0.3;
  }
  return 1;
}

function snippet(body: string, query: string): string {
  const compact = body.replace(/\s+/g, " ").trim();
  if (compact.length <= 420) return compact;
  const terms = query
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((term) => term.length >= 2);
  const lower = compact.toLowerCase();
  const positions = terms
    .map((term) => lower.indexOf(term))
    .filter((position) => position >= 0);
  const first = positions.length ? Math.min(...positions) : 0;
  const start = Math.max(0, first - 120);
  const end = Math.min(compact.length, start + 420);
  return `${start ? "…" : ""}${compact.slice(start, end)}${
    end < compact.length ? "…" : ""
  }`;
}
