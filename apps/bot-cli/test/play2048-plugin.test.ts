import { describe, expect, it } from "vitest";

import type { ArtifactRef } from "@game-bots/contracts";
import type {
  ActionResult,
  CaptureRequest,
  ClickProbeRequest,
  ClickProbeResult,
  EnvironmentAction,
  EnvironmentHealth,
  EnvironmentSession,
  EnvironmentStartRequest,
  ObservationFrame,
  ObservationRequest
} from "@game-bots/environment-sdk";
import type { GameSnapshot } from "@game-bots/game-sdk";
import { play2048WebPlugin } from "@game-bots/play2048-web";

class RecordingEnvironmentSession implements EnvironmentSession {
  readonly executedActions: EnvironmentAction[] = [];

  async start(_request: EnvironmentStartRequest): Promise<void> {
    return Promise.resolve();
  }

  async stop(_reason?: string): Promise<void> {
    return Promise.resolve();
  }

  async observe(_request: ObservationRequest): Promise<ObservationFrame> {
    return {
      capturedAt: new Date().toISOString(),
      modes: ["dom"],
      payload: {
        domHtml: "<html><body></body></html>"
      },
      summary: "recording-environment"
    };
  }

  async execute(action: EnvironmentAction): Promise<ActionResult> {
    this.executedActions.push(action);

    return {
      status: "succeeded",
      completedAt: new Date().toISOString(),
      payload: {}
    };
  }

  async probeClickability(request: ClickProbeRequest): Promise<ClickProbeResult> {
    return {
      probeId: request.probeId,
      surfaceSelector: request.surfaceSelector,
      ...(request.activationSelector ? { activationSelector: request.activationSelector } : {}),
      measuredAt: new Date().toISOString(),
      totalSamples: request.samplePoints.length,
      successfulSamples: request.samplePoints.length,
      successRatio: 1,
      sampleResults: request.samplePoints.map((point) => ({
        label: point.label,
        xRatio: point.xRatio,
        yRatio: point.yRatio,
        absoluteX: point.xRatio * 100,
        absoluteY: point.yRatio * 100,
        matched: true,
        clickStatus: "succeeded"
      })),
      summary: "recording-environment"
    };
  }

  async capture(request: CaptureRequest): Promise<ArtifactRef> {
    return {
      artifactId: `artifact-${request.kind}`,
      runId: "run-test",
      kind: request.kind,
      relativePath: `${request.kind}.txt`,
      contentType: "text/plain",
      byteLength: 0,
      createdAt: new Date().toISOString()
    };
  }

  async health(): Promise<EnvironmentHealth> {
    return {
      status: "healthy",
      checkedAt: new Date().toISOString(),
      signals: {}
    };
  }
}

const SAMPLE_2048_DOM = `
<main>
  <div class="game-container">
    <div class="score-container">64</div>
    <div class="best-container">128</div>
    <a class="restart-button">New Game</a>
    <div class="tile-container">
      <div class="tile tile-2 tile-position-1-1"></div>
      <div class="tile tile-4 tile-position-2-1"></div>
      <div class="tile tile-8 tile-position-1-2"></div>
    </div>
  </div>
</main>
`;

function buildSnapshot(overrides: Partial<GameSnapshot> = {}): GameSnapshot {
  return {
    title: "2048",
    isTerminal: false,
    semanticState: {
      status: "playing",
      hasGameContainer: true,
      score: 64,
      bestScore: 128,
      tileCount: 3
    },
    metrics: {
      tileCount: 3,
      score: 64
    },
    ...overrides
  };
}

describe("play2048 plugin", () => {
  it("bootstraps by navigating to the real-game URL and waiting for settle", async () => {
    const previousUrl = process.env.GAME_BOTS_PLAY2048_URL;
    process.env.GAME_BOTS_PLAY2048_URL = "https://play2048.co/";

    try {
      const session = await play2048WebPlugin.createSession({});
      const environment = new RecordingEnvironmentSession();

      await session.bootstrap(environment);

      expect(environment.executedActions).toEqual([
        {
          kind: "navigate",
          url: "https://play2048.co/"
        },
        {
          kind: "wait",
          durationMs: 700
        }
      ]);
    } finally {
      if (previousUrl === undefined) {
        delete process.env.GAME_BOTS_PLAY2048_URL;
      } else {
        process.env.GAME_BOTS_PLAY2048_URL = previousUrl;
      }
    }
  });

  it("translates DOM observation to semantic state and exposes smoke actions/scenario", async () => {
    const session = await play2048WebPlugin.createSession({});
    const snapshot = await session.translate({
      capturedAt: new Date().toISOString(),
      modes: ["dom"],
      payload: {
        domHtml: SAMPLE_2048_DOM
      },
      summary: "sample"
    });

    expect(snapshot.title).toBe("2048");
    expect(snapshot.semanticState).toMatchObject({
      status: "playing",
      hasGameContainer: true,
      score: 64,
      bestScore: 128,
      tileCount: 3
    });

    const actions = await session.actions(snapshot);
    expect(actions.map((action) => action.actionId)).toEqual(["nudge-left"]);

    const resolvedActions = await session.resolveAction({ actionId: "nudge-left" }, snapshot);
    expect(resolvedActions).toEqual([
      {
        kind: "keypress",
        key: "ArrowLeft"
      },
      {
        kind: "wait",
        durationMs: 250
      }
    ]);

    const scenarios = await session.scenarios();
    expect(scenarios).toHaveLength(1);
    expect(scenarios[0]?.scenarioId).toBe("smoke");
    expect(scenarios[0]?.clickProbes).toHaveLength(1);
  });

  it("switches to restart action for terminal snapshots", async () => {
    const session = await play2048WebPlugin.createSession({});
    const terminalSnapshot = buildSnapshot({
      isTerminal: true,
      semanticState: {
        status: "over",
        hasGameContainer: true,
        score: 512,
        bestScore: 1024,
        tileCount: 16
      }
    });

    const actions = await session.actions(terminalSnapshot);
    expect(actions.map((action) => action.actionId)).toEqual(["restart-game"]);
  });
});
