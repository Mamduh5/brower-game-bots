import path from "node:path";

import { loadConfig, type AppConfig } from "@game-bots/config";
import { FsArtifactStore } from "@game-bots/artifact-store-fs";
import { createLogger } from "@game-bots/logging";
import { SqliteRunRepository } from "@game-bots/persistence-sqlite";
import { ReportBuilder } from "@game-bots/reporting";
import { RunEngine } from "@game-bots/runtime-core";

import { LoggerEventPublisher } from "./logger-event-publisher.js";
import { resolveConfigPaths, resolveWorkspaceRoot } from "./path-resolution.js";

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

export async function createContainer(options: CreateContainerOptions = {}): Promise<AppContainer> {
  const startDir = options.cwd ?? process.cwd();
  const workspaceRoot = resolveWorkspaceRoot(startDir);
  const configPaths = resolveConfigPaths(workspaceRoot, options);
  const config = await loadConfig(configPaths);

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

  logger.debug(
    {
      workspaceRoot,
      configPaths,
      sqlite: config.persistence.sqlite.filename
    },
    "Container initialized."
  );

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
