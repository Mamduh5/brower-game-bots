import path from "node:path";

export function sanitizePathSegment(segment: string): string {
  return segment.replace(/[^a-zA-Z0-9._/-]/g, "-").replace(/\.\./g, "-");
}

export function buildArtifactRelativePath(runId: string, relativePath: string): string {
  return path.posix.join(runId, sanitizePathSegment(relativePath));
}

export function resolveArtifactAbsolutePath(rootDir: string, runId: string, relativePath: string): string {
  const absoluteRoot = path.resolve(rootDir);
  const absoluteTarget = path.resolve(absoluteRoot, buildArtifactRelativePath(runId, relativePath));

  if (!absoluteTarget.startsWith(absoluteRoot)) {
    throw new Error(`Artifact path escapes artifact root: ${relativePath}`);
  }

  return absoluteTarget;
}

export function resolveStoredArtifactPath(rootDir: string, storedRelativePath: string): string {
  const absoluteRoot = path.resolve(rootDir);
  const absoluteTarget = path.resolve(absoluteRoot, sanitizePathSegment(storedRelativePath));

  if (!absoluteTarget.startsWith(absoluteRoot)) {
    throw new Error(`Stored artifact path escapes artifact root: ${storedRelativePath}`);
  }

  return absoluteTarget;
}
