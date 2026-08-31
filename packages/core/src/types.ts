export type KnowledgeCollection = "knowledge" | "playbook";

export interface KnowledgeRecord {
  id: string;
  collection: KnowledgeCollection;
  root: string;
  path: string;
  absolutePath: string;
  title: string;
  type: string;
  kind: string | null;
  status: string | null;
  confidence: string | null;
  sourceRepository: string | null;
  sourceCommit: string | null;
  tags: string[];
  links: string[];
  evidenceUrls: string[];
  body: string;
  evidenceId?: string;
}

export type RetrievalIntent =
  | "exact"
  | "semantic"
  | "temporal"
  | "relational"
  | "current-rule";

export interface SearchFilters {
  types?: string[];
  kinds?: string[];
  repositories?: string[];
  collections?: KnowledgeCollection[];
}

export interface SearchHit {
  id: string;
  path: string;
  collection: KnowledgeCollection;
  title: string;
  type: string;
  kind: string | null;
  status: string | null;
  confidence: string | null;
  sourceRepository: string | null;
  sourceCommit: string | null;
  tags: string[];
  evidenceUrls: string[];
  links: string[];
  score: number;
  snippet: string;
  evidenceId?: string;
}

export interface DoctorFinding {
  severity: "error" | "warning";
  code: string;
  path: string;
  message: string;
}

export interface DoctorReport {
  valid: boolean;
  root: string;
  recordCount: number;
  countsByType: Record<string, number>;
  findings: DoctorFinding[];
}

export interface RetrievalCaseV1 {
  id: string;
  query: string;
  expectedTitles: string[];
  limit?: number;
  filters?: SearchFilters;
}

export interface RetrievalCaseV2 {
  schemaVersion: 2;
  id: string;
  query: string;
  intent: RetrievalIntent;
  limit: number;
  filters?: SearchFilters;
  expected: {
    requiredEvidenceIds: string[];
    anyOfEvidenceIds?: string[][];
    forbiddenEvidenceIds?: string[];
    requiredStatuses?: string[];
  };
  answerBoundary?: string;
  privacy: "public-fixture" | "private-local";
}

export type RetrievalCase = RetrievalCaseV1 | RetrievalCaseV2;

export interface RetrievalCaseResult {
  id: string;
  passed: boolean;
  expectedTitles: string[];
  actualTitles: string[];
}

export interface RetrievalCaseResultV2 {
  id: string;
  passed: boolean;
  actualEvidenceIds: string[];
  requiredFound: string[];
  requiredMissing: string[];
  forbiddenFound: string[];
  reciprocalRank: number;
  recallAtK: number;
  lifecycleMismatch: boolean;
  provenanceComplete: boolean;
  failureTypes: Array<
    | "selection"
    | "semantic"
    | "temporal"
    | "relational"
    | "lifecycle"
    | "provenance"
  >;
}

export interface RetrievalEvaluation {
  passed: number;
  total: number;
  hitRate: number;
  meanReciprocalRank: number;
  meanRecallAtK: number;
  lifecycleMismatchCount: number;
  provenanceIncompleteCount: number;
  cases: Array<RetrievalCaseResult | RetrievalCaseResultV2>;
}
