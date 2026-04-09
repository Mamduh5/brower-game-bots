import { existsSync } from "node:fs";
import path from "node:path";

const WORKSPACE_SENTINEL = "pnpm-workspace.yaml";

export interface ConfigPathResolutionOptions {
  configPaths?: readonly string[];
}

function parseDelimitedPaths(raw: string | undefined): readonly string[] {
  if (!raw) {
    return [];
  }

  return raw
    .split(path.delimiter)
    .map((value) => value.trim())
    .filter((value) => value.length > 0);
}

function resolvePathFromRoot(workspaceRoot: string, target: string): string {
  return path.isAbsolute(target) ? target : path.resolve(workspaceRoot, target);
}

export function resolveWorkspaceRoot(startDir: string): string {
  let current = path.resolve(startDir);

  for (;;) {
    const sentinelPath = path.join(current, WORKSPACE_SENTINEL);
    if (existsSync(sentinelPath)) {
      return current;
    }

    const parent = path.dirname(current);
    if (parent === current) {
      return path.resolve(startDir);
    }

    current = parent;
  }
}

export function resolveConfigPaths(
  workspaceRoot: string,
  options: ConfigPathResolutionOptions = {}
): readonly string[] {
  if (options.configPaths?.length) {
    return options.configPaths;
  }

  const envPaths = parseDelimitedPaths(process.env.GAME_BOTS_CONFIG_PATHS);
  if (envPaths.length > 0) {
    return envPaths.map((value) => resolvePathFromRoot(workspaceRoot, value));
  }

  const configDirOverride = process.env.GAME_BOTS_CONFIG_DIR?.trim();
  if (configDirOverride) {
    const configDir = resolvePathFromRoot(workspaceRoot, configDirOverride);
    return [
      path.resolve(configDir, "default.yaml"),
      path.resolve(configDir, "local.yaml")
    ];
  }

  return [
    path.resolve(workspaceRoot, "config/default.yaml"),
    path.resolve(workspaceRoot, "config/local.yaml")
  ];
}
