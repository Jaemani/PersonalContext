import type {
  DocumentationEvaluationCase,
  DocumentationEvaluationManifest,
  DocumentationMethod,
} from "./types.js";

const METHODS = new Set<DocumentationMethod>([
  "decision",
  "experiment",
  "incident",
  "report",
  "none",
]);

export function parseDocumentationCases(
  manifest: DocumentationEvaluationManifest,
): DocumentationEvaluationCase[] {
  const ids = new Set<string>();
  return manifest.cases.map((value) => {
    const id = requiredString(value.id);
    if (!/^[A-Za-z0-9._-]{1,80}$/.test(id) || ids.has(id)) {
      throw new Error("The documentation evaluation case ID is invalid.");
    }
    ids.add(id);
    return {
      input: {
        id,
        taskInput: requiredString(value.taskInput),
        sourceRecords: stringArray(value.sourceRecords, false),
        excludedEvidenceIds: stringArray(value.excludedEvidenceIds, true),
      },
      rubric: {
        expectedPrimaryMethod: method(value.expectedPrimaryMethod),
        acceptableSecondaryMethods: methodArray(value.acceptableSecondaryMethods),
        requiredElements: stringArray(value.requiredElements, true),
        forbiddenArtifacts: stringArray(value.forbiddenArtifacts, true),
        ambiguities: stringArray(value.ambiguities, true),
      },
    };
  });
}

export function parseRoutingProposal(value: unknown) {
  if (!isRecord(value)) throw new Error("The model routing output is invalid.");
  return {
    primary_method: method(value.primary_method),
    reason: requiredString(value.reason),
    uncertainties: stringArray(value.uncertainties, true),
    secondary_artifacts: methodArray(value.secondary_artifacts),
  };
}

function method(value: unknown): DocumentationMethod {
  if (typeof value !== "string" || !METHODS.has(value as DocumentationMethod)) {
    throw new Error("The documentation method value is invalid.");
  }
  return value as DocumentationMethod;
}

function methodArray(value: unknown): DocumentationMethod[] {
  if (!Array.isArray(value)) {
    throw new Error("The documentation method list is invalid.");
  }
  return value.map(method);
}

function stringArray(value: unknown, allowEmpty: boolean): string[] {
  if (
    !Array.isArray(value) ||
    (!allowEmpty && value.length === 0) ||
    !value.every((item) => typeof item === "string" && item.trim())
  ) {
    throw new Error("The documentation evaluation string list is invalid.");
  }
  return [...new Set(value as string[])];
}

function requiredString(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error("The documentation evaluation string is invalid.");
  }
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
