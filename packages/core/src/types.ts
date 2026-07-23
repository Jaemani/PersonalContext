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
}

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

export interface RetrievalCase {
  id: string;
  query: string;
  expectedTitles: string[];
  limit?: number;
  filters?: SearchFilters;
}

export interface RetrievalCaseResult {
  id: string;
  passed: boolean;
  expectedTitles: string[];
  actualTitles: string[];
}

export interface RetrievalEvaluation {
  passed: number;
  total: number;
  hitRate: number;
  cases: RetrievalCaseResult[];
}
