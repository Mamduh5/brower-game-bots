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
import { catAndDogWebPlugin } from "@game-bots/cat-and-dog-web";

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

function buildSnapshot(overrides: Partial<GameSnapshot> = {}): GameSnapshot {
  return {
    title: "Cat and Dog",
    isTerminal: false,
    semanticState: {
      status: "landing",
      routePath: "/desktop",
      hasAppRoot: true,
      hasPlayableSurface: false,
      hasGameplayHud: false,
      hasStartControl: true,
      gameplayEntered: false,
      gameplayActionExecuted: false
    },
    metrics: {
      hasPlayableSurface: 0,
      hasGameplayHud: 0
    },
    ...overrides
  };
}

const LANDING_DOM = `
<main id="root">
  <button id="start-game" data-testid="start-game">Start</button>
</main>
`;

const GAMEPLAY_DOM = `
<main id="root">
  <div id="player-hud" data-testid="player-hud">HP: 100</div>
  <canvas data-testid="game-canvas" width="800" height="600"></canvas>
</main>
`;

describe("cat-and-dog plugin", () => {
  it("bootstraps by navigating to the configured real-game URL and waiting for settle", async () => {
    const previousUrl = process.env.GAME_BOTS_CAT_AND_DOG_URL;
    process.env.GAME_BOTS_CAT_AND_DOG_URL = "https://cat-and-dog-p6qd.onrender.com/desktop";

    try {
      const session = await catAndDogWebPlugin.createSession({});
      const environment = new RecordingEnvironmentSession();
      await session.bootstrap(environment);

      expect(environment.executedActions).toEqual([
        {
          kind: "navigate",
          url: "https://cat-and-dog-p6qd.onrender.com/desktop"
        },
        {
          kind: "wait",
          durationMs: 800
        }
      ]);
    } finally {
      if (previousUrl === undefined) {
        delete process.env.GAME_BOTS_CAT_AND_DOG_URL;
      } else {
        process.env.GAME_BOTS_CAT_AND_DOG_URL = previousUrl;
      }
    }
  });

  it("translates opening snapshot and maps one smoke interaction action", async () => {
    const session = await catAndDogWebPlugin.createSession({});
    const snapshot = await session.translate({
      capturedAt: new Date().toISOString(),
      modes: ["dom"],
      payload: {
        url: "https://cat-and-dog-p6qd.onrender.com/desktop",
        domHtml: LANDING_DOM
      },
      summary: "sample"
    });

    expect(snapshot.semanticState).toMatchObject({
      status: "landing",
      routePath: "/desktop",
      hasAppRoot: true,
      hasPlayableSurface: false,
      hasGameplayHud: false,
      hasStartControl: true,
      gameplayEntered: false,
      gameplayActionExecuted: false
    });

    const actions = await session.actions(snapshot);
    expect(actions.map((action) => action.actionId)).toEqual(["enter-gameplay"]);

    const resolved = await session.resolveAction({ actionId: "enter-gameplay" }, snapshot);
    expect(resolved).toEqual([
      {
        kind: "click",
        target: {
          selector: "#start-game, [data-testid='start-game'], .start-game, .start-button, button[data-action='start']"
        }
      },
      {
        kind: "wait",
        durationMs: 450
      },
      {
        kind: "keypress",
        key: "Space"
      },
      {
        kind: "wait",
        durationMs: 300
      }
    ]);

    const scenarios = await session.scenarios();
    expect(scenarios).toHaveLength(1);
    expect(scenarios[0]?.scenarioId).toBe("smoke");
  });

  it("completes action list after the first smoke interaction", async () => {
    const session = await catAndDogWebPlugin.createSession({});
    const snapshot = buildSnapshot();

    const resolved = await session.resolveAction({ actionId: "enter-gameplay" }, snapshot);
    expect(resolved).toHaveLength(4);

    const closingSnapshot = await session.translate({
      capturedAt: new Date().toISOString(),
      modes: ["dom"],
      payload: {
        url: "https://cat-and-dog-p6qd.onrender.com/desktop",
        domHtml: GAMEPLAY_DOM
      },
      summary: "post-action"
    });

    expect(closingSnapshot.semanticState).toMatchObject({
      status: "gameplay",
      hasPlayableSurface: true,
      hasGameplayHud: true,
      gameplayEntered: true
    });

    const actions = await session.actions(closingSnapshot);
    expect(actions).toHaveLength(0);
  });
});
