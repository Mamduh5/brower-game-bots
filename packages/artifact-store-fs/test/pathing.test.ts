import { describe, expect, it } from "vitest";

import { buildArtifactRelativePath, sanitizePathSegment } from "../src/pathing.js";

describe("artifact pathing", () => {
  it("sanitizes unsupported path characters", () => {
    expect(sanitizePathSegment("../trace?.zip")).toBe("-/trace-.zip");
  });

  it("nests artifacts under the run id", () => {
    expect(buildArtifactRelativePath("run-1", "screenshots/home.png")).toBe("run-1/screenshots/home.png");
  });
});
