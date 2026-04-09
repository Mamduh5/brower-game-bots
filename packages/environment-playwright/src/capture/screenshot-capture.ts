import { Buffer } from "node:buffer";

import type { Page } from "playwright";

import type { ArtifactStore } from "@game-bots/runtime-core";

export async function captureScreenshot(
  page: Page,
  artifactStore: ArtifactStore,
  runId: string,
  name = "page"
) {
  const buffer = Buffer.from(await page.screenshot({ fullPage: true }));

  return artifactStore.put(
    {
      runId,
      kind: "screenshot",
      relativePath: `screenshots/${name}.png`,
      contentType: "image/png"
    },
    buffer
  );
}
