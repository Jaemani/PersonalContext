import { PersonalKnowledgeIndex } from "../../core/src/index.js";
import type { KnowledgeRecord } from "../../core/src/types.js";

const AUDIT_TYPES = new Set(["evaluation-set", "evaluation-results"]);

export interface EligibleRecordOptions {
  suiteId: string;
  caseId: string;
  sourceRecords: string[];
  excludedEvidenceIds: string[];
}

export interface EligibleRecordSet {
  index: PersonalKnowledgeIndex;
  recordIds: string[];
  excludedRecordIds: string[];
}

export function assertEligibleRecordSelection(
  selectedRecordIds: string[],
  eligible: Pick<EligibleRecordSet, "recordIds" | "excludedRecordIds">,
): void {
  const allowed = new Set(eligible.recordIds);
  const excluded = new Set(eligible.excludedRecordIds);
  if (
    selectedRecordIds.some(
      (recordId) => !allowed.has(recordId) || excluded.has(recordId),
    )
  ) {
    throw new Error("Disallowed evaluation record entered prompt dataflow.");
  }
}

export function buildEligibleRecordSet(
  records: KnowledgeRecord[],
  options: EligibleRecordOptions,
): EligibleRecordSet {
  const recordsById = new Map<string, KnowledgeRecord>();
  for (const record of records) {
    if (recordsById.has(record.id)) {
      throw new Error("The knowledge snapshot contains duplicate record IDs.");
    }
    recordsById.set(record.id, record);
  }

  for (const sourcePath of options.sourceRecords) {
    const sourceId = sourcePath.startsWith("knowledge:")
      ? sourcePath
      : `knowledge:${sourcePath}`;
    if (!recordsById.has(sourceId)) {
      throw new Error(
        `Evaluation source record is missing for case ${safeId(options.caseId)}.`,
      );
    }
  }

  const explicitExclusions = new Set(options.excludedEvidenceIds);
  for (const excludedId of explicitExclusions) {
    if (!recordsById.has(excludedId)) {
      throw new Error(
        `Evaluation exclusion is missing for case ${safeId(options.caseId)}.`,
      );
    }
  }

  const excludedRecordIds: string[] = [];
  const eligible = records.filter((record) => {
    const exclude =
      explicitExclusions.has(record.id) ||
      AUDIT_TYPES.has(record.type.toLowerCase()) ||
      directlyDescribesCase(record, options.suiteId, options.caseId);
    if (exclude) excludedRecordIds.push(record.id);
    return !exclude;
  });

  for (const excludedId of explicitExclusions) {
    if (eligible.some((record) => record.id === excludedId)) {
      throw new Error(
        `Evaluation exclusion remained eligible for case ${safeId(options.caseId)}.`,
      );
    }
  }

  return {
    index: new PersonalKnowledgeIndex(eligible),
    recordIds: eligible.map((record) => record.id),
    excludedRecordIds,
  };
}

function directlyDescribesCase(
  record: KnowledgeRecord,
  suiteId: string,
  caseId: string,
): boolean {
  const searchable = `${record.title}\n${record.body}`.toLowerCase();
  return (
    searchable.includes(suiteId.toLowerCase()) ||
    searchable.includes(caseId.toLowerCase())
  );
}

function safeId(value: string): string {
  return /^[A-Za-z0-9._-]{1,80}$/.test(value) ? value : "redacted";
}
