import path from "node:path";

import { loadConfig, type AppConfig } from "@game-bots/config";
import { FsArtifactStore } from "@game-bots/artifact-store-fs";
import { createLogger } from "@game-bots/logging";
import { SqliteRunRepository } from "@game-bots/persistence-sqlite";
import { ReportBuilder } from "@game-bots/reporting";
import { RunEngine } from "@game-bots/runtime-core";

import { LoggerEventPublisher } from "./logger-event-publisher.js";

export interface AppContainer {
  config: AppConfig;
  runEngine: RunEngine;
  reportBuilder: ReportBuilder;
  artifactStore: FsArtifactStore;
  logger: ReturnType<typeof createLogger>;
  workspaceRoot: string;
}

export interface CreateContainerOptions {
  cwd?: string;
  configPaths?: readonly string[];
}

function resolveConfigPaths(workspaceRoot: string, options?: CreateContainerOptions): readonly string[] {
  if (options?.configPaths?.length) {
    return options.configPaths;
  }

  const envPaths = process.env.GAME_BOTS_CONFIG_PATHS
    ?.split(path.delimiter)
    .map((value) => value.trim())
    .filter((value) => value.length > 0);

  if (envPaths?.length) {
    return envPaths;
  }

  return [
    path.resolve(workspaceRoot, "config/default.yaml"),
    path.resolve(workspaceRoot, "config/local.yaml")
  ];
}

export async function createContainer(options: CreateContainerOptions = {}): Promise<AppContainer> {
  const workspaceRoot = options.cwd ?? process.cwd();
  const config = await loadConfig(resolveConfigPaths(workspaceRoot, options));

  const logger = createLogger({
    level: config.logging.level,
    base: config.logging.baseFields
  });

  const artifactStore = new FsArtifactStore({
    rootDir: path.resolve(workspaceRoot, config.artifacts.rootDir)
  });

  const repository = new SqliteRunRepository({
    filename: path.resolve(workspaceRoot, config.persistence.sqlite.filename)
  });

  logger.debug({ sqlite: config.persistence.sqlite.filename }, "Container initialized.");

  return {
    config,
    artifactStore,
    logger,
    reportBuilder: new ReportBuilder(),
    runEngine: new RunEngine({
      repository,
      publisher: new LoggerEventPublisher(logger)
    }),
    workspaceRoot
  };
}
