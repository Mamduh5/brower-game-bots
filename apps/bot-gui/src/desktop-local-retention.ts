import { readdir, readFile, rm } from "node:fs/promises";
import path from "node:path";

/** Retain five completed local runs. Teaching, macros, AI and unfinished runs are never candidates. */
export async function pruneLocalRunArtifacts(root: string, keep = 5): Promise<number> {
  const artifacts = path.resolve(root, "artifacts");
  let entries;
  try { entries = await readdir(artifacts, { withFileTypes: true }); } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return 0; throw error; }
  const candidates: { directory: string; endedAt: string }[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || !/^desktop-[a-f0-9-]{36}$/.test(entry.name)) continue;
    const directory = path.resolve(artifacts, entry.name);
    if (path.dirname(directory) !== artifacts) throw new Error("Invalid local artifact directory");
    try {
      const summary = JSON.parse(await readFile(path.join(directory, "reports", "desktop-summary.json"), "utf8"));
      if (summary.profile?.mode === "local" && typeof summary.endedAt === "string" && Number.isFinite(Date.parse(summary.endedAt))) candidates.push({ directory, endedAt: summary.endedAt });
    } catch { /* Unfinished or invalid reports are never deleted automatically. */ }
  }
  candidates.sort((a, b) => b.endedAt.localeCompare(a.endedAt));
  for (const candidate of candidates.slice(keep)) {
    // Resolve and recheck immediately before recursive deletion, on the same filesystem API.
    const target = path.resolve(candidate.directory);
    if (path.dirname(target) !== artifacts || !/^desktop-[a-f0-9-]{36}$/.test(path.basename(target))) throw new Error("Unsafe artifact retention target");
    await rm(target, { recursive: true, force: true });
  }
  return Math.max(0, candidates.length - keep);
}
