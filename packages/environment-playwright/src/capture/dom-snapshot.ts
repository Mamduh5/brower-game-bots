import { Buffer } from "node:buffer";

import type { Page } from "playwright";

import type { ArtifactStore } from "@game-bots/runtime-core";

export async function captureDomSnapshot(
  page: Page,
  artifactStore: ArtifactStore,
  runId: string,
  name = "dom"
) {
  const html = await page.content();

  return artifactStore.put(
    {
      runId,
      kind: "dom-snapshot",
      relativePath: `dom/${name}.html`,
      contentType: "text/html"
    },
    Buffer.from(html, "utf8")
  );
}
