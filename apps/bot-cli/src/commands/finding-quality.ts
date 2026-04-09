import type { ArtifactRef, EvidenceRef, Finding, JsonObject, JsonValue } from "@game-bots/contracts";

const SEVERITY_RANK: Record<Finding["severity"], number> = {
  critical: 5,
  high: 4,
  medium: 3,
  low: 2,
  info: 1
};

const FREEZE_FINDING_TITLE = "Successful action did not change semantic state";

function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function evidenceKey(evidence: EvidenceRef): string {
  return [evidence.eventId ?? "", evidence.artifactId ?? "", evidence.label, evidence.detail ?? ""].join("|");
}

function byEvidence(left: EvidenceRef, right: EvidenceRef): number {
  const leftKey = [left.eventId ?? "", left.artifactId ?? "", left.label, left.detail ?? ""].join("|");
  const rightKey = [right.eventId ?? "", right.artifactId ?? "", right.label, right.detail ?? ""].join("|");
  return leftKey.localeCompare(rightKey);
}

function dedupeEvidence(evidence: readonly EvidenceRef[]): EvidenceRef[] {
  const seen = new Set<string>();
  const deduped: EvidenceRef[] = [];

  for (const item of evidence) {
    const key = evidenceKey(item);
    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    deduped.push(item);
  }

  return deduped.sort(byEvidence);
}

function hasMetadataFlag(finding: Finding, key: string): boolean {
  if (!finding.metadata || !isJsonObject(finding.metadata)) {
    return false;
  }

  return Object.prototype.hasOwnProperty.call(finding.metadata, key);
}

function selectRelevantArtifactKinds(finding: Finding): readonly ArtifactRef["kind"][] {
  if (hasMetadataFlag(finding, "clickProbe")) {
    return ["screenshot", "dom-snapshot"];
  }

  if (hasMetadataFlag(finding, "stateExpectation")) {
    return ["dom-snapshot", "screenshot"];
  }

  switch (finding.category) {
    case "ui":
    case "ux":
      return ["screenshot", "dom-snapshot"];
    case "functional":
    case "freeze":
    case "performance":
      return ["dom-snapshot", "screenshot"];
    case "crash":
      return ["screenshot", "dom-snapshot", "log", "trace"];
    default:
      return ["screenshot", "dom-snapshot"];
  }
}

function attachRelevantArtifacts(finding: Finding, artifacts: readonly ArtifactRef[]): Finding {
  const desiredKinds = selectRelevantArtifactKinds(finding);
  const evidence = [...finding.evidence];
  const existingArtifactIds = new Set(
    evidence.map((entry) => entry.artifactId).filter((artifactId): artifactId is string => Boolean(artifactId))
  );

  for (let index = 0; index < desiredKinds.length; index += 1) {
    const kind = desiredKinds[index];
    const artifact = artifacts.find((candidate) => candidate.kind === kind);
    if (!artifact || existingArtifactIds.has(artifact.artifactId)) {
      continue;
    }

    evidence.push({
      artifactId: artifact.artifactId,
      label: index === 0 ? `artifact-primary-${artifact.kind}` : `artifact-supporting-${artifact.kind}`,
      detail: artifact.relativePath
    });
    existingArtifactIds.add(artifact.artifactId);
  }

  return {
    ...finding,
    evidence: dedupeEvidence(evidence)
  };
}

function annotatePrimaryEvidence(finding: Finding): Finding {
  const primaryArtifactEvidence = finding.evidence.find(
    (evidence) => Boolean(evidence.artifactId) && evidence.label.startsWith("artifact-primary-")
  );
  const primaryEventEvidence =
    finding.evidence.find((evidence) => evidence.label === "state-expectation" && Boolean(evidence.eventId)) ??
    finding.evidence.find((evidence) => Boolean(evidence.eventId));

  const metadata: JsonObject = isJsonObject(finding.metadata) ? { ...finding.metadata } : {};

  const primaryEvidence: JsonObject = {
    ...(primaryArtifactEvidence?.artifactId ? { artifactId: primaryArtifactEvidence.artifactId } : {}),
    ...(primaryArtifactEvidence?.detail ? { artifactPath: primaryArtifactEvidence.detail } : {}),
    ...(primaryEventEvidence?.eventId ? { eventId: primaryEventEvidence.eventId } : {}),
    ...(primaryEventEvidence?.label ? { label: primaryEventEvidence.label } : {})
  };

  return {
    ...finding,
    metadata: {
      ...metadata,
      ...(Object.keys(primaryEvidence).length > 0 ? { primaryEvidence } : {})
    }
  };
}

function getPrimaryEventId(finding: Finding): string {
  const primaryEvidence = finding.evidence.find((evidence) => Boolean(evidence.eventId));
  return primaryEvidence?.eventId ?? "";
}

function normalizeSummary(summary: string): string {
  return summary.toLowerCase().replace(/\s+/g, " ").trim();
}

function findingFingerprint(finding: Finding): string {
  return [
    finding.category,
    finding.title.toLowerCase(),
    getPrimaryEventId(finding),
    normalizeSummary(finding.summary)
  ].join("|");
}

function choosePreferredFinding(left: Finding, right: Finding): Finding {
  const leftRank = SEVERITY_RANK[left.severity];
  const rightRank = SEVERITY_RANK[right.severity];
  if (leftRank !== rightRank) {
    return leftRank > rightRank ? left : right;
  }

  if (left.confidence !== right.confidence) {
    return left.confidence >= right.confidence ? left : right;
  }

  return left.evidence.length >= right.evidence.length ? left : right;
}

function dedupeFindings(findings: readonly Finding[]): Finding[] {
  const byFingerprint = new Map<string, Finding>();

  for (const finding of findings) {
    const key = findingFingerprint(finding);
    const existing = byFingerprint.get(key);

    if (!existing) {
      byFingerprint.set(key, finding);
      continue;
    }

    byFingerprint.set(key, choosePreferredFinding(existing, finding));
  }

  return [...byFingerprint.values()];
}

function extractPostActionEventIds(finding: Finding): Set<string> {
  return new Set(
    finding.evidence
      .filter((evidence) => evidence.label === "post-action-state" && Boolean(evidence.eventId))
      .map((evidence) => evidence.eventId as string)
  );
}

function suppressRedundantFreezeFindings(findings: readonly Finding[]): Finding[] {
  const stateExpectationEventIds = new Set<string>();
  for (const finding of findings) {
    if (hasMetadataFlag(finding, "stateExpectation")) {
      for (const eventId of extractPostActionEventIds(finding)) {
        stateExpectationEventIds.add(eventId);
      }
    }
  }

  if (stateExpectationEventIds.size === 0) {
    return [...findings];
  }

  return findings.filter((finding) => {
    if (finding.title !== FREEZE_FINDING_TITLE) {
      return true;
    }

    return !finding.evidence.some(
      (evidence) => evidence.label === "post-action-state" && evidence.eventId && stateExpectationEventIds.has(evidence.eventId)
    );
  });
}

function bySeverityThenCreatedAt(left: Finding, right: Finding): number {
  const severityDelta = SEVERITY_RANK[right.severity] - SEVERITY_RANK[left.severity];
  if (severityDelta !== 0) {
    return severityDelta;
  }

  return left.createdAt.localeCompare(right.createdAt);
}

export function withEvaluatorMetadata(finding: Finding, evaluatorId: string): Finding {
  const metadata: JsonObject = isJsonObject(finding.metadata) ? { ...finding.metadata } : {};
  const sourcesValue = metadata.sources;
  const sourcesArray = Array.isArray(sourcesValue)
    ? sourcesValue.filter((value): value is string => typeof value === "string")
    : [];
  const mergedSources = Array.from(new Set([...sourcesArray, evaluatorId]));

  return {
    ...finding,
    metadata: {
      ...metadata,
      sources: mergedSources as JsonValue
    }
  };
}

export function finalizeFindingsQuality(
  findings: readonly Finding[],
  artifacts: readonly ArtifactRef[]
): Finding[] {
  const withRelevantArtifacts = findings.map((finding) => attachRelevantArtifacts(finding, artifacts));
  const withoutRedundantFreeze = suppressRedundantFreezeFindings(withRelevantArtifacts);
  const deduped = dedupeFindings(withoutRedundantFreeze);
  return deduped.map((finding) => annotatePrimaryEvidence(finding)).sort(bySeverityThenCreatedAt);
}
