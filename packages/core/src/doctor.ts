import type {
  DoctorFinding,
  DoctorReport,
  KnowledgeRecord,
} from "./types.js";

export function inspectKnowledgeStore(
  root: string,
  records: KnowledgeRecord[],
): DoctorReport {
  const findings: DoctorFinding[] = [];
  const countsByType: Record<string, number> = {};

  for (const record of records) {
    countsByType[record.type] = (countsByType[record.type] ?? 0) + 1;
    if (record.type === "experience" && !record.sourceRepository) {
      findings.push({
        severity: "error",
        code: "experience-source-missing",
        path: record.path,
        message: "Experience records must name their source repository.",
      });
    }
    if (
      record.type === "experience" &&
      record.status === "recorded" &&
      !record.sourceCommit &&
      !record.evidenceUrls.some(hasExactGitHubSha)
    ) {
      findings.push({
        severity: "warning",
        code: "recorded-experience-evidence-weak",
        path: record.path,
        message:
          "Recorded experience has neither source_commit nor exact-SHA GitHub evidence.",
      });
    }
  }

  if (!records.length) {
    findings.push({
      severity: "error",
      code: "knowledge-store-empty",
      path: ".",
      message: "No Markdown records were found.",
    });
  }

  return {
    valid: !findings.some((finding) => finding.severity === "error"),
    root,
    recordCount: records.length,
    countsByType,
    findings,
  };
}

function hasExactGitHubSha(url: string): boolean {
  return /github\.com\/[^/]+\/[^/]+\/(?:blob|commit)\/[0-9a-f]{40}\b/i.test(
    url,
  );
}
