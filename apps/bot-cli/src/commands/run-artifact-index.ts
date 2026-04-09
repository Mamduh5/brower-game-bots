import path from "node:path";

import type { ArtifactRef, Finding, JsonObject, JsonValue, RunEvent, RunRecord } from "@game-bots/contracts";

function asJsonValue(value: unknown): JsonValue {
  if (value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map((item) => asJsonValue(item));
  }

  if (typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, item]) => [key, asJsonValue(item)])
    ) as JsonObject;
  }

  return String(value);
}

function byArtifactPath(left: ArtifactRef, right: ArtifactRef): number {
  return left.relativePath.localeCompare(right.relativePath);
}

function bySeverity(left: Finding, right: Finding): number {
  const severityRank: Record<Finding["severity"], number> = {
    critical: 5,
    high: 4,
    medium: 3,
    low: 2,
    info: 1
  };

  const severityDelta = severityRank[right.severity] - severityRank[left.severity];
  if (severityDelta !== 0) {
    return severityDelta;
  }

  return left.createdAt.localeCompare(right.createdAt);
}

function buildArtifactLookup(artifacts: readonly ArtifactRef[]): Map<string, ArtifactRef> {
  const lookup = new Map<string, ArtifactRef>();

  for (const artifact of artifacts) {
    lookup.set(artifact.artifactId, artifact);
  }

  return lookup;
}

function compactRelativePath(relativePath: string): string {
  const normalized = relativePath.replace(/\\/g, "/");
  return path.posix.basename(normalized);
}

export function buildArtifactCaptureName(step: number, label: string): string {
  const safeLabel = label.toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
  return `${String(step).padStart(2, "0")}-${safeLabel}`;
}

export function buildArtifactIndex(input: {
  run: RunRecord;
  artifacts: readonly ArtifactRef[];
  findings: readonly Finding[];
  events: readonly RunEvent[];
}): JsonObject {
  const sortedArtifacts = [...input.artifacts].sort(byArtifactPath);
  const sortedFindings = [...input.findings].sort(bySeverity);
  const artifactLookup = buildArtifactLookup(sortedArtifacts);

  const findings = sortedFindings.map((finding) => {
    const linkedArtifacts = finding.evidence
      .filter((evidence) => evidence.artifactId)
      .map((evidence) => artifactLookup.get(evidence.artifactId as string))
      .filter((artifact): artifact is ArtifactRef => Boolean(artifact))
      .map((artifact) => ({
        artifactId: artifact.artifactId,
        kind: artifact.kind,
        relativePath: artifact.relativePath,
        fileName: compactRelativePath(artifact.relativePath)
      }));

    return {
      findingId: finding.findingId,
      title: finding.title,
      severity: finding.severity,
      category: finding.category,
      summary: finding.summary,
      evidence: finding.evidence.map((evidence) => ({
        label: evidence.label,
        ...(evidence.eventId ? { eventId: evidence.eventId } : {}),
        ...(evidence.artifactId ? { artifactId: evidence.artifactId } : {}),
        ...(evidence.detail ? { detail: evidence.detail } : {})
      })),
      linkedArtifacts
    };
  });

  const artifacts = sortedArtifacts.map((artifact, index) => ({
    order: index + 1,
    artifactId: artifact.artifactId,
    kind: artifact.kind,
    relativePath: artifact.relativePath,
    fileName: compactRelativePath(artifact.relativePath),
    createdAt: artifact.createdAt,
    ...(artifact.byteLength !== undefined ? { byteLength: artifact.byteLength } : {})
  }));

  const eventTypeCounts: Record<string, number> = {};
  for (const event of input.events) {
    eventTypeCounts[event.type] = (eventTypeCounts[event.type] ?? 0) + 1;
  }

  return {
    run: {
      runId: input.run.runId,
      agentKind: input.run.agentKind,
      gameId: input.run.gameId,
      scenarioId: input.run.scenarioId ?? "",
      phase: input.run.phase,
      status: input.run.status,
      createdAt: input.run.createdAt,
      updatedAt: input.run.updatedAt
    },
    summary: {
      artifactCount: artifacts.length,
      findingCount: findings.length,
      eventCount: input.events.length,
      eventTypeCounts: asJsonValue(eventTypeCounts)
    },
    artifacts: asJsonValue(artifacts),
    findings: asJsonValue(findings)
  };
}
