import type { Readable } from "node:stream";

import type { ArtifactKind, ArtifactRef, RunId } from "@game-bots/contracts";

export interface ArtifactWriteRequest {
  runId: RunId;
  kind: ArtifactKind;
  relativePath: string;
  contentType: string;
}

export interface ArtifactStore {
  put(meta: ArtifactWriteRequest, payload: Buffer | Readable): Promise<ArtifactRef>;
  get(ref: ArtifactRef): Promise<Readable>;
  exists(ref: ArtifactRef): Promise<boolean>;
}
