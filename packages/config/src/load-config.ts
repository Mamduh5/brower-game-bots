import { readFile } from "node:fs/promises";

import YAML from "yaml";

import { AppConfigSchema, type AppConfig } from "./schemas.js";

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function mergeObjects<T extends Record<string, unknown>>(base: T, extra: Record<string, unknown>): T {
  const output: Record<string, unknown> = { ...base };

  for (const [key, value] of Object.entries(extra)) {
    const existing = output[key];
    if (isPlainObject(existing) && isPlainObject(value)) {
      output[key] = mergeObjects(existing, value);
      continue;
    }

    output[key] = value;
  }

  return output as T;
}

export async function loadConfig(paths: readonly string[]): Promise<AppConfig> {
  let merged: Record<string, unknown> = {};

  for (const path of paths) {
    const raw = await readFile(path, "utf8");
    const parsed = YAML.parse(raw) as Record<string, unknown>;
    merged = mergeObjects(merged, parsed);
  }

  return AppConfigSchema.parse(merged);
}
