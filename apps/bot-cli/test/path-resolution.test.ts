import path from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

import { resolveConfigPaths, resolveWorkspaceRoot } from "../src/bootstrap/path-resolution.js";

const repoRoot = fileURLToPath(new URL("../../../", import.meta.url));
const originalConfigPaths = process.env.GAME_BOTS_CONFIG_PATHS;
const originalConfigDir = process.env.GAME_BOTS_CONFIG_DIR;

function normalizeForComparison(input: string): string {
  return path.normalize(input).replace(/[\\\/]+$/, "");
}

afterEach(() => {
  if (originalConfigPaths === undefined) {
    delete process.env.GAME_BOTS_CONFIG_PATHS;
  } else {
    process.env.GAME_BOTS_CONFIG_PATHS = originalConfigPaths;
  }

  if (originalConfigDir === undefined) {
    delete process.env.GAME_BOTS_CONFIG_DIR;
  } else {
    process.env.GAME_BOTS_CONFIG_DIR = originalConfigDir;
  }
});

describe("path resolution", () => {
  it("finds the workspace root from nested package directories", () => {
    const nested = path.join(repoRoot, "apps", "bot-cli");
    const resolved = resolveWorkspaceRoot(nested);
    expect(normalizeForComparison(resolved)).toBe(normalizeForComparison(repoRoot));
  });

  it("uses workspace-root config files by default", () => {
    delete process.env.GAME_BOTS_CONFIG_PATHS;
    delete process.env.GAME_BOTS_CONFIG_DIR;

    expect(resolveConfigPaths(repoRoot)).toEqual([
      path.join(repoRoot, "config", "default.yaml"),
      path.join(repoRoot, "config", "local.yaml")
    ]);
  });

  it("supports GAME_BOTS_CONFIG_DIR as explicit config directory", () => {
    delete process.env.GAME_BOTS_CONFIG_PATHS;
    process.env.GAME_BOTS_CONFIG_DIR = "config";

    expect(resolveConfigPaths(repoRoot)).toEqual([
      path.join(repoRoot, "config", "default.yaml"),
      path.join(repoRoot, "config", "local.yaml")
    ]);
  });

  it("prioritizes explicit config paths and resolves env config path list from workspace root", () => {
    process.env.GAME_BOTS_CONFIG_PATHS = ["config/default.yaml", "config/production.yaml"].join(path.delimiter);
    process.env.GAME_BOTS_CONFIG_DIR = "ignored";

    expect(resolveConfigPaths(repoRoot)).toEqual([
      path.join(repoRoot, "config", "default.yaml"),
      path.join(repoRoot, "config", "production.yaml")
    ]);

    expect(
      resolveConfigPaths(repoRoot, {
        configPaths: ["custom/default.yaml", "custom/local.yaml"]
      })
    ).toEqual(["custom/default.yaml", "custom/local.yaml"]);
  });
});
