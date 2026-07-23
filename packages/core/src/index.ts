import MiniSearch from "minisearch";
import type {
  KnowledgeRecord,
  SearchFilters,
  SearchHit,
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
  ): SearchHit[] {
    const normalizedQuery = query.trim();
    if (!normalizedQuery) return [];

    const results = this.searchIndex.search(normalizedQuery);
    const hits: SearchHit[] = [];
    for (const result of results) {
      const record = this.recordsById.get(String(result.id));
      if (!record || !matchesFilters(record, filters)) continue;
      hits.push(toSearchHit(record, result.score, normalizedQuery));
      if (hits.length >= Math.max(1, Math.min(limit, 20))) break;
    }
    return hits;
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
  };
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
