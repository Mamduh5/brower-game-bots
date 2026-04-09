import path from "node:path";

import { loadConfig, type AppConfig } from "@game-bots/config";
import { FsArtifactStore } from "@game-bots/artifact-store-fs";
import { createLogger } from "@game-bots/logging";
import { SqliteRunRepository } from "@game-bots/persistence-sqlite";
import { ReportBuilder } from "@game-bots/reporting";
import { RunEngine } from "@game-bots/runtime-core";

export interface AppContainer {
  config: AppConfig;
  runEngine: RunEngine;
  reportBuilder: ReportBuilder;
  artifactStore: FsArtifactStore;
}

export async function createContainer(): Promise<AppContainer> {
  const cwd = process.cwd();
  const config = await loadConfig([
    path.resolve(cwd, "config/default.yaml"),
    path.resolve(cwd, "config/local.yaml")
  ]);

  const logger = createLogger({
    level: config.logging.level,
    base: config.logging.baseFields
  });

  const artifactStore = new FsArtifactStore({
    rootDir: path.resolve(cwd, config.artifacts.rootDir)
  });

  const repository = new SqliteRunRepository({
    filename: path.resolve(cwd, config.persistence.sqlite.filename)
  });

  logger.debug({ sqlite: config.persistence.sqlite.filename }, "Container initialized.");

  return {
    config,
    artifactStore,
    reportBuilder: new ReportBuilder(),
    runEngine: new RunEngine({
      repository
    })
  };
}
