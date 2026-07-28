export const DOCUMENTATION_EVALUATION_SUITE_ID = "PKR-DOC-ROUTER-V0";
export const OPERATIONAL_EVALUATION_SUITE_ID = "PKR-OPS-CONTEXT-V0";

export type PrivateEvaluationSuiteId =
  | typeof DOCUMENTATION_EVALUATION_SUITE_ID
  | typeof OPERATIONAL_EVALUATION_SUITE_ID;

export interface DocumentationEvaluationManifest {
  schemaVersion: 1;
  suiteId: typeof DOCUMENTATION_EVALUATION_SUITE_ID;
  privacy: string;
  createdAt: string;
  productionIndexAllowed: false;
  cases: Array<Record<string, unknown>>;
}

export interface OperationalEvaluationManifest {
  schemaVersion: 1;
  suiteId: typeof OPERATIONAL_EVALUATION_SUITE_ID;
  privacy: string;
  createdAt: string;
  productionIndexAllowed: false;
  fixture: Record<string, unknown>;
}

export type PrivateEvaluationManifest =
  | DocumentationEvaluationManifest
  | OperationalEvaluationManifest;

export interface PrivateManifestSummary {
  schemaVersion: 1;
  suiteId: PrivateEvaluationSuiteId;
  suiteKind: "documentation" | "operational";
  privacy: string;
  createdAt: string;
  productionIndexAllowed: false;
  itemCount: number;
  sha256: string;
}

export interface LoadedPrivateEvaluationManifest {
  manifest: PrivateEvaluationManifest;
  summary: PrivateManifestSummary;
}

export interface LoadPrivateEvaluationManifestOptions {
  manifestPath: string;
  expectedSha256: string;
}

export type DocumentationMethod =
  | "decision"
  | "experiment"
  | "incident"
  | "report"
  | "none";

export interface DocumentationEvaluationCaseInput {
  id: string;
  taskInput: string;
  sourceRecords: string[];
  excludedEvidenceIds: string[];
}

export interface DocumentationEvaluationRubric {
  expectedPrimaryMethod: DocumentationMethod;
  acceptableSecondaryMethods: DocumentationMethod[];
  requiredElements: string[];
  forbiddenArtifacts: string[];
  ambiguities: string[];
}

export interface DocumentationEvaluationCase {
  input: DocumentationEvaluationCaseInput;
  rubric: DocumentationEvaluationRubric;
}

export interface DocumentationRoutingProposal {
  primary_method: DocumentationMethod;
  reason: string;
  uncertainties: string[];
  secondary_artifacts: DocumentationMethod[];
}
