import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { randomUUID } from "node:crypto";

import type { ArtifactRef } from "@game-bots/contracts";
import type { ArtifactStore, ArtifactWriteRequest } from "@game-bots/runtime-core";

import { resolveArtifactAbsolutePath, resolveStoredArtifactPath } from "./pathing.js";

export interface FsArtifactStoreOptions {
  rootDir: string;
}

export class FsArtifactStore implements ArtifactStore {
  constructor(private readonly options: FsArtifactStoreOptions) {}

  async put(meta: ArtifactWriteRequest, payload: Buffer | Readable): Promise<ArtifactRef> {
    const absolutePath = resolveArtifactAbsolutePath(this.options.rootDir, meta.runId, meta.relativePath);
    await mkdir(path.dirname(absolutePath), { recursive: true });

    if (Buffer.isBuffer(payload)) {
      await writeFile(absolutePath, payload);
    } else {
      await pipeline(payload, createWriteStream(absolutePath));
    }

    const fileStat = await stat(absolutePath);

    return {
      artifactId: randomUUID(),
      runId: meta.runId,
      kind: meta.kind,
      relativePath: path.relative(this.options.rootDir, absolutePath).replace(/\\/g, "/"),
      contentType: meta.contentType,
      byteLength: fileStat.size,
      createdAt: new Date().toISOString()
    };
  }

  async get(ref: ArtifactRef): Promise<Readable> {
    const absolutePath = resolveStoredArtifactPath(this.options.rootDir, ref.relativePath);
    return createReadStream(absolutePath);
  }

  async exists(ref: ArtifactRef): Promise<boolean> {
    const absolutePath = resolveStoredArtifactPath(this.options.rootDir, ref.relativePath);

    try {
      await stat(absolutePath);
      return true;
    } catch {
      return false;
    }
  }
}
