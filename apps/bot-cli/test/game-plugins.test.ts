import { describe, expect, it } from "vitest";

import { resolveGamePlugin, resolveTesterDefaults } from "../src/bootstrap/game-plugins.js";

describe("game plugin registry", () => {
  it("resolves tester-compatible plugins by gameId", () => {
    const wordle = resolveGamePlugin("wordle-web");
    const catAndDog = resolveGamePlugin("cat-and-dog-web");
    const play2048 = resolveGamePlugin("play2048-web");

    expect(wordle.manifest.gameId).toBe("wordle-web");
    expect(catAndDog.manifest.gameId).toBe("cat-and-dog-web");
    expect(play2048.manifest.gameId).toBe("play2048-web");
  });

  it("resolves tester defaults for supported games", () => {
    expect(resolveTesterDefaults("wordle-web")).toEqual({
      profileId: "wordle-web.tester.smoke",
      scenarioId: "smoke"
    });

    expect(resolveTesterDefaults("play2048-web")).toEqual({
      profileId: "play2048-web.tester.smoke",
      scenarioId: "smoke"
    });

    expect(resolveTesterDefaults("cat-and-dog-web")).toEqual({
      profileId: "cat-and-dog-web.tester.smoke",
      scenarioId: "smoke"
    });
  });

  it("throws for unknown game ids", () => {
    expect(() => resolveGamePlugin("unknown-web-game")).toThrowError("Unsupported gameId");
    expect(() => resolveTesterDefaults("unknown-web-game")).toThrowError("No tester defaults configured");
  });
});
