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
import {
  CAT_AND_DOG_PLAYER_UNTIL_WIN_PROFILE_ID,
  catAndDogWebPlugin
} from "@game-bots/cat-and-dog-web";

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
      routePath: "/play/desktop/",
      hasAppRoot: true,
      hasModeSelection: true,
      hasTwoPlayerOption: true,
      hasPlayCpuOption: true,
      hasPlayableSurface: false,
      hasGameplayHud: false,
      hasGameplayControls: false,
      aimStatusText: null,
      aimDirection: "unknown",
      powerStatusText: null,
      gameplayInputApplied: false,
      hasStartControl: true,
      gameplayEntered: false,
      menuVisible: true,
      cpuSetupVisible: false,
      startCpuAvailable: false,
      weaponBarVisible: false,
      selectedWeaponKey: null,
      modeLabelText: null,
      matchNoteText: null,
      canvasHintText: null,
      turnBannerVisible: false,
      turnBannerTitleText: null,
      endVisible: false,
      endTitleText: null,
      endSubtitleText: null,
      playerTurnReady: false,
      outcome: "not-started",
      modeSelectionExecuted: false,
      gameplayInteractionExecuted: false
    },
    metrics: {
      hasModeSelection: 1,
      hasTwoPlayerOption: 1,
      hasPlayCpuOption: 1,
      hasPlayableSurface: 0,
      hasGameplayHud: 0,
      hasGameplayControls: 0,
      gameplayInputApplied: 0
    },
    ...overrides
  };
}

const LANDING_DOM = `
<main id="playRoot">
  <div id="modeLabel">Mode: Menu</div>
  <div id="menuOverlay">
    <div id="menuActions">
      <button id="playCpuButton" data-testid="play-vs-cpu">Play vs CPU</button>
      <button id="playLocalButton" data-testid="play-2-player" data-mode="two-player">2 Players</button>
    </div>
    <div id="difficultyPanel" class="is-hidden">
      <button data-difficulty="easy" class="is-active">Easy</button>
      <button id="startCpuButton" data-testid="start-cpu-match">Start CPU Match</button>
    </div>
  </div>
</main>
`;

const GAMEPLAY_DOM = `
<main id="playRoot">
  <div id="modeLabel">Mode: 2 Players</div>
  <div id="gameplaySurface">
    <canvas id="gameCanvas" data-testid="game-canvas" width="800" height="600"></canvas>
  </div>
  <div id="weaponBar" data-testid="weapon-bar">
    <button class="weapon-bar-button is-active" data-weapon-key="normal">Normal</button>
  </div>
  <p id="matchNote">2-player match started.</p>
  <p id="controls-hint" data-testid="controls-hint">Controls: A/D aim, W/S power, 1-5 items</p>
  <p id="playerHp" data-testid="player-hp">P1 Cat HP: 100/100</p>
  <p id="cpuHp" data-testid="cpu-hp">P2 Dog HP: 100/100</p>
  <p id="turnCounter" data-testid="turn-counter">Turn 1</p>
  <p id="aim-status" data-testid="aim-status">Aim: left</p>
  <p id="power-status" data-testid="power-status">Power: medium</p>
  <div id="turnBanner" class="hidden"><span id="turnBannerLabel">Get Ready</span><strong id="turnBannerTitle">P1 Cat</strong></div>
</main>
`;

const CPU_SETUP_DOM = `
<main id="playRoot">
  <div id="modeLabel">Mode: Menu</div>
  <div id="menuOverlay">
    <div id="menuActions">
      <button id="playCpuButton" hidden data-testid="play-vs-cpu">Play vs CPU</button>
      <button id="playLocalButton" hidden data-testid="play-2-player">2 Players</button>
    </div>
    <div id="difficultyPanel">
      <button data-difficulty="easy" class="is-active">Easy</button>
      <button id="startCpuButton" data-testid="start-cpu-match">Start CPU Match</button>
    </div>
  </div>
</main>
`;

const CPU_BATTLE_DOM = `
<main id="playRoot">
  <div id="modeLabel">Mode: 1P vs CPU / Easy</div>
  <div id="gameplaySurface">
    <canvas id="gameCanvas" data-testid="game-canvas" width="800" height="600"></canvas>
  </div>
  <div id="weaponBar" data-testid="weapon-bar">
    <button class="weapon-bar-button is-active" data-weapon-key="normal">Normal</button>
    <button class="weapon-bar-button" data-weapon-key="light">Light</button>
  </div>
  <p id="matchNote">CPU attempt 1 started.</p>
  <p id="controls-hint" data-testid="controls-hint">Adjust angle, power, and projectile, then throw.</p>
  <p id="playerHp" data-testid="player-hp">P1 Cat HP: 100/100</p>
  <p id="cpuHp" data-testid="cpu-hp">CPU Dog HP: 100/100</p>
  <p id="turnCounter" data-testid="turn-counter">Turn 1</p>
  <p id="aim-status" data-testid="aim-status">Aim: right</p>
  <p id="power-status" data-testid="power-status">Power: high</p>
  <div id="turnBanner" class="hidden"><span id="turnBannerLabel">Get Ready</span><strong id="turnBannerTitle">P1 Cat</strong></div>
</main>
`;

const CPU_TRANSITION_DOM = `
<main id="playRoot">
  <div id="modeLabel">Mode: 1P vs CPU / Easy</div>
  <div id="gameplaySurface">
    <canvas id="gameCanvas" data-testid="game-canvas" width="800" height="600"></canvas>
  </div>
  <div id="weaponBar" class="is-hidden" data-testid="weapon-bar">
    <button class="weapon-bar-button is-active" data-weapon-key="normal">Normal</button>
  </div>
  <p id="matchNote">P1 Cat is stepping in.</p>
  <p id="controls-hint" data-testid="controls-hint">P1 Cat is stepping in.</p>
  <p id="playerHp" data-testid="player-hp">P1 Cat HP: 100/100</p>
  <p id="cpuHp" data-testid="cpu-hp">CPU Dog HP: 100/100</p>
  <p id="turnCounter" data-testid="turn-counter">Turn 1</p>
  <p id="aim-status" data-testid="aim-status">Aim: center</p>
  <p id="power-status" data-testid="power-status">Power: medium</p>
  <div id="turnBanner"><span id="turnBannerLabel">Get Ready</span><strong id="turnBannerTitle">P1 Cat</strong></div>
</main>
`;

const CPU_END_DOM = `
<main id="playRoot">
  <div id="modeLabel">Mode: 1P vs CPU / Easy</div>
  <div id="gameplaySurface">
    <canvas id="gameCanvas" data-testid="game-canvas" width="800" height="600"></canvas>
  </div>
  <div id="weaponBar" class="is-hidden" data-testid="weapon-bar">
    <button class="weapon-bar-button is-active" data-weapon-key="normal">Normal</button>
  </div>
  <p id="matchNote">Attempt converted into a win.</p>
  <p id="controls-hint" data-testid="controls-hint">Clean direct hit.</p>
  <p id="playerHp" data-testid="player-hp">P1 Cat HP: 78/100</p>
  <p id="cpuHp" data-testid="cpu-hp">CPU Dog HP: 0/100</p>
  <p id="turnCounter" data-testid="turn-counter">Turn 2</p>
  <div id="endOverlay">
    <h2 id="endTitle">P1 Cat Wins</h2>
    <p id="endSubtitle">Winning shot landed cleanly.</p>
  </div>
</main>
`;

const CPU_END_VARIANT_DOM = `
<main id="playRoot">
  <div id="modeLabel">Mode: 1P vs CPU / Easy</div>
  <div id="gameplaySurface">
    <canvas id="gameCanvas" data-testid="game-canvas" width="800" height="600"></canvas>
  </div>
  <p id="controls-hint" data-testid="controls-hint">Clean direct hit.</p>
  <div id="endOverlay">
    <h2 id="endTitle">Player 1 Cat wins!</h2>
    <p id="endSubtitle">Winning shot landed cleanly.</p>
  </div>
</main>
`;

describe("cat-and-dog plugin", () => {
  it("bootstraps by navigating to the configured real-game URL and waiting for settle", async () => {
    const previousUrl = process.env.GAME_BOTS_CAT_AND_DOG_URL;
    process.env.GAME_BOTS_CAT_AND_DOG_URL = "https://cat-and-dog-p6qd.onrender.com/play/desktop/";

    try {
      const session = await catAndDogWebPlugin.createSession({});
      const environment = new RecordingEnvironmentSession();
      await session.bootstrap(environment);

      expect(environment.executedActions).toEqual([
        {
          kind: "navigate",
          url: "https://cat-and-dog-p6qd.onrender.com/play/desktop/"
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

  it("keeps the existing tester smoke path intact", async () => {
    const session = await catAndDogWebPlugin.createSession({});
    const snapshot = await session.translate({
      capturedAt: new Date().toISOString(),
      modes: ["dom"],
      payload: {
        url: "https://cat-and-dog-p6qd.onrender.com/play/desktop/",
        domHtml: LANDING_DOM
      },
      summary: "sample"
    });

    expect(snapshot.semanticState).toMatchObject({
      status: "landing",
      routePath: "/play/desktop/",
      hasAppRoot: true,
      hasModeSelection: true,
      hasTwoPlayerOption: true,
      hasPlayCpuOption: true,
      gameplayEntered: false,
      menuVisible: true,
      outcome: "not-started",
      modeSelectionExecuted: false,
      gameplayInteractionExecuted: false
    });

    expect((await session.actions(snapshot)).map((action) => action.actionId)).toEqual(["select-two-player-mode"]);
    expect(await session.resolveAction({ actionId: "select-two-player-mode" }, snapshot)).toEqual([
      {
        kind: "click",
        target: {
          selector: "#playLocalButton, #play-2-player, [data-testid='play-2-player'], button[data-mode='two-player'], [data-testid='play-local']"
        }
      },
      {
        kind: "wait",
        durationMs: 500
      }
    ]);

    const gameplayEntrySnapshot = buildSnapshot({
      semanticState: {
        ...buildSnapshot().semanticState,
        status: "gameplay",
        hasModeSelection: false,
        hasTwoPlayerOption: false,
        hasPlayCpuOption: false,
        hasPlayableSurface: true,
        hasGameplayHud: true,
        hasGameplayControls: true,
        aimStatusText: "Aim: center",
        aimDirection: "center",
        powerStatusText: "Power: medium",
        gameplayEntered: true,
        menuVisible: false,
        weaponBarVisible: true,
        selectedWeaponKey: "normal",
        modeLabelText: "Mode: 2 Players",
        playerTurnReady: true,
        outcome: "in-progress",
        modeSelectionExecuted: true
      }
    });
    expect((await session.actions(gameplayEntrySnapshot)).map((action) => action.actionId)).toEqual(["adjust-aim-left"]);
    expect(await session.resolveAction({ actionId: "adjust-aim-left" }, gameplayEntrySnapshot)).toEqual([
      {
        kind: "keypress",
        key: "A"
      },
      {
        kind: "wait",
        durationMs: 250
      }
    ]);

    const closingSnapshot = await session.translate({
      capturedAt: new Date().toISOString(),
      modes: ["dom"],
      payload: {
        url: "https://cat-and-dog-p6qd.onrender.com/play/desktop/",
        domHtml: GAMEPLAY_DOM
      },
      summary: "post-action"
    });
    expect(closingSnapshot.semanticState).toMatchObject({
      status: "gameplay",
      hasPlayableSurface: true,
      hasGameplayHud: true,
      hasGameplayControls: true,
      aimStatusText: "Aim: left",
      aimDirection: "left",
      powerStatusText: "Power: medium",
      gameplayInputApplied: true,
      gameplayEntered: true,
      playerHpValue: 100,
      cpuHpValue: 100,
      turnCounter: 1,
      shotResolved: false,
      turnBannerVisible: false
    });
    expect(await session.actions(closingSnapshot)).toEqual([]);
  });

  it("maps the player-until-win flow through CPU setup, battle, and end-state outcome detection", async () => {
    const session = await catAndDogWebPlugin.createSession({
      profileId: CAT_AND_DOG_PLAYER_UNTIL_WIN_PROFILE_ID
    });

    const openingSnapshot = await session.translate({
      capturedAt: new Date().toISOString(),
      modes: ["dom"],
      payload: {
        url: "https://cat-and-dog-p6qd.onrender.com/play/desktop/",
        domHtml: LANDING_DOM
      },
      summary: "landing"
    });
    expect(openingSnapshot.semanticState).toMatchObject({
      menuVisible: true,
      cpuSetupVisible: false,
      hasPlayCpuOption: true,
      gameplayEntered: false,
      outcome: "not-started"
    });
    expect((await session.actions(openingSnapshot)).map((action) => action.actionId)).toEqual(["open-cpu-setup"]);

    expect(await session.resolveAction({ actionId: "open-cpu-setup" }, openingSnapshot)).toEqual([
      {
        kind: "click",
        target: {
          selector: "#playCpuButton, [data-testid='play-vs-cpu'], button[data-mode='cpu']"
        }
      },
      {
        kind: "wait",
        durationMs: 400
      }
    ]);

    const cpuSetupSnapshot = await session.translate({
      capturedAt: new Date().toISOString(),
      modes: ["dom"],
      payload: {
        url: "https://cat-and-dog-p6qd.onrender.com/play/desktop/",
        domHtml: CPU_SETUP_DOM
      },
      summary: "cpu-setup"
    });
    expect(cpuSetupSnapshot.semanticState).toMatchObject({
      menuVisible: true,
      cpuSetupVisible: true,
      startCpuAvailable: true,
      gameplayEntered: false
    });
    expect((await session.actions(cpuSetupSnapshot)).map((action) => action.actionId)).toEqual(["start-cpu-match"]);

    expect(
      await session.resolveAction(
        {
          actionId: "start-cpu-match",
          params: {
            difficulty: "easy"
          }
        },
        cpuSetupSnapshot
      )
    ).toEqual([
      {
        kind: "click",
        target: {
          selector: "#difficultyPanel [data-difficulty='easy']"
        }
      },
      {
        kind: "wait",
        durationMs: 200
      },
      {
        kind: "click",
        target: {
          selector: "#startCpuButton, [data-testid='start-cpu-match']"
        }
      },
      {
        kind: "wait",
        durationMs: 700
      }
    ]);

    const battleSnapshot = await session.translate({
      capturedAt: new Date().toISOString(),
      modes: ["dom"],
      payload: {
        url: "https://cat-and-dog-p6qd.onrender.com/play/desktop/",
        domHtml: CPU_BATTLE_DOM
      },
      summary: "battle"
    });
    expect(battleSnapshot.semanticState).toMatchObject({
      gameplayEntered: true,
      playerTurnReady: true,
      selectedWeaponKey: "normal",
      turnBannerVisible: false,
      turnBannerLabelText: "Get Ready",
      outcome: "in-progress",
      modeLabelText: "Mode: 1P vs CPU / Easy",
      playerHpValue: 100,
      cpuHpValue: 100,
      turnCounter: 1,
      shotResolutionCategory: "aiming",
      shotResolved: false
    });
    expect((await session.actions(battleSnapshot)).map((action) => action.actionId)).toEqual(["execute-planned-shot"]);

    const transitionSnapshot = await session.translate({
      capturedAt: new Date().toISOString(),
      modes: ["dom"],
      payload: {
        url: "https://cat-and-dog-p6qd.onrender.com/play/desktop/",
        domHtml: CPU_TRANSITION_DOM
      },
      summary: "transition"
    });
    expect(transitionSnapshot.semanticState).toMatchObject({
      gameplayEntered: true,
      playerTurnReady: false,
      turnBannerVisible: true,
      turnBannerLabelText: "Get Ready",
      turnBannerTitleText: "P1 Cat",
      shotResolutionCategory: "turn-start",
      outcome: "in-progress"
    });
    expect((await session.actions(transitionSnapshot)).map((action) => action.actionId)).toEqual(["wait-for-turn-resolution"]);

    expect(
      await session.resolveAction(
        {
          actionId: "execute-planned-shot",
          params: {
            weaponKey: "normal",
            angleDirection: "right",
            angleTapCount: 2,
            powerDirection: "up",
            powerTapCount: 2,
            settleMs: 160,
            turnResolutionWaitMs: 2400
          }
        },
        battleSnapshot
      )
    ).toEqual([
      {
        kind: "keypress",
        key: "1"
      },
      {
        kind: "wait",
        durationMs: 120
      },
      {
        kind: "keypress",
        key: "D"
      },
      {
        kind: "keypress",
        key: "D"
      },
      {
        kind: "keypress",
        key: "W"
      },
      {
        kind: "keypress",
        key: "W"
      },
      {
        kind: "wait",
        durationMs: 160
      },
      {
        kind: "keypress",
        key: "Space"
      },
      {
        kind: "wait",
        durationMs: 1200
      }
    ]);

    const endSnapshot = await session.translate({
      capturedAt: new Date().toISOString(),
      modes: ["dom"],
      payload: {
        url: "https://cat-and-dog-p6qd.onrender.com/play/desktop/",
        domHtml: CPU_END_DOM
      },
      summary: "end"
    });
    expect(endSnapshot.isTerminal).toBe(true);
    expect(endSnapshot.semanticState).toMatchObject({
      endVisible: true,
      endTitleText: "P1 Cat Wins",
      outcome: "win",
      playerHpValue: 78,
      cpuHpValue: 0,
      turnCounter: 2,
      shotResolved: true
    });
    expect(await session.actions(endSnapshot)).toEqual([]);

    const endVariantSnapshot = await session.translate({
      capturedAt: new Date().toISOString(),
      modes: ["dom"],
      payload: {
        url: "https://cat-and-dog-p6qd.onrender.com/play/desktop/",
        domHtml: CPU_END_VARIANT_DOM
      },
      summary: "end-variant"
    });
    expect(endVariantSnapshot.semanticState).toMatchObject({
      endVisible: true,
      endTitleText: "Player 1 Cat wins!",
      outcome: "win",
      shotResolved: true
    });
  });
});
