import type { EnvironmentAction, EnvironmentSession, ObservationFrame } from "@game-bots/environment-sdk";
import type { GameActionRequest, GameActionSpec, GameSession, GameSnapshot, TestScenario } from "@game-bots/game-sdk";
import type { Evaluator } from "@game-bots/runtime-core";

import { CHESS_COM_PLAYER_COMPUTER_PROFILE_ID } from "./profiles.js";
import { CHESS_COM_SMOKE_SCENARIO } from "./scenarios/smoke.scenario.js";
import { CHESS_COM_SELECTORS } from "./selectors.js";
import { parseChessComBoard, squareCenter } from "./snapshot/parse-board.js";

const EXECUTE_CHESS_MOVE_ACTION: GameActionSpec = {
  actionId: "execute-chess-move",
  description: "Drag a detected Chess.com piece from one board square to another."
};

const WAIT_FOR_CHESS_BOARD_ACTION: GameActionSpec = {
  actionId: "wait-for-chess-board",
  description: "Wait briefly for the Chess.com computer board or bot response."
};

function resolveChessComUrl(): string {
  const raw = (process.env.GAME_BOTS_CHESS_COM_URL ?? CHESS_COM_SELECTORS.defaultUrl).trim();
  const parsed = new URL(raw);
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new Error(`Unsupported GAME_BOTS_CHESS_COM_URL protocol '${parsed.protocol}'.`);
  }
  return parsed.toString();
}

export class ChessComGameSession implements GameSession {
  private readonly isComputerPlayerProfile: boolean;

  constructor(private readonly context: { profileId?: string } = {}) {
    this.isComputerPlayerProfile = context.profileId === CHESS_COM_PLAYER_COMPUTER_PROFILE_ID;
  }

  async bootstrap(environment: EnvironmentSession): Promise<void> {
    await environment.execute({
      kind: "navigate",
      url: resolveChessComUrl()
    });
    await environment.execute({
      kind: "wait",
      durationMs: 6000
    });
    await environment.execute({
      kind: "click-if-visible",
      target: {
        selector: "dialog button:has-text('Start'), [data-cy='intro-modal'] button:has-text('Start'), .cc-modal-component-v2 button:has-text('Start'), dialog button"
      }
    });
    await environment.execute({
      kind: "wait",
      durationMs: 1000
    });
    await environment.execute({
      kind: "click-if-visible",
      target: {
        selector: "button:has-text('Play'), [role='button']:has-text('Play'), .ui_v5-button-component:has-text('Play')"
      }
    });
    await environment.execute({
      kind: "wait",
      durationMs: 10000
    });
  }

  async translate(frame: ObservationFrame): Promise<GameSnapshot> {
    const runtimeProbe = frame.payload.runtimeProbe;
    const runtimeValue = runtimeProbe && typeof runtimeProbe === "object" && "value" in runtimeProbe
      ? (runtimeProbe as { value?: unknown }).value
      : null;
    const board = parseChessComBoard({
      html: typeof frame.payload.domHtml === "string" ? frame.payload.domHtml : null,
      runtimeProbe: runtimeValue,
      url: typeof frame.payload.url === "string" ? frame.payload.url : null,
      title: typeof frame.payload.title === "string" ? frame.payload.title : null
    });

    return {
      title: "Chess.com Computer",
      isTerminal: this.isComputerPlayerProfile ? Boolean(board.outcome) : board.boardDetected,
      semanticState: {
        status: board.unsafeHumanMatchmaking
          ? "unsafe-human-matchmaking"
          : board.boardDetected
            ? "board-detected"
            : "loading",
        boardDetected: board.boardDetected,
        orientation: board.orientation,
        sideToMove: board.sideToMove,
        botColor: board.orientation,
        fen: board.fen,
        pieceCount: board.pieces.length,
        pieces: board.pieces.map((piece) => ({ ...piece })),
        boardBounds: board.boardBounds ? { ...board.boardBounds } : null,
        unsafeHumanMatchmaking: board.unsafeHumanMatchmaking,
        safetyReason: board.safetyReason,
        outcome: board.outcome,
        lastMove: board.lastMove
      },
      metrics: {
        pieceCount: board.pieces.length
      }
    };
  }

  async actions(_snapshot: GameSnapshot): Promise<readonly GameActionSpec[]> {
    return [EXECUTE_CHESS_MOVE_ACTION, WAIT_FOR_CHESS_BOARD_ACTION];
  }

  async resolveAction(request: GameActionRequest, _snapshot: GameSnapshot): Promise<readonly EnvironmentAction[]> {
    if (request.actionId === WAIT_FOR_CHESS_BOARD_ACTION.actionId) {
      return [
        {
          kind: "wait",
          durationMs: readNumberParam(request.params, "durationMs", 1200)
        }
      ];
    }

    if (request.actionId !== EXECUTE_CHESS_MOVE_ACTION.actionId) {
      throw new Error(`Unsupported Chess.com action '${request.actionId}'.`);
    }

    const from = readStringParam(request.params, "from");
    const to = readStringParam(request.params, "to");
    const orientation = readStringParam(request.params, "orientation") === "black" ? "black" : "white";
    const bounds = readBoundsParam(request.params);
    if (!from || !to || !bounds) {
      throw new Error("Chess move action requires from, to, and board bounds.");
    }

    const fromPoint = squareCenter(from, bounds, orientation);
    const toPoint = squareCenter(to, bounds, orientation);
    if (!fromPoint || !toPoint) {
      throw new Error(`Cannot resolve Chess.com board coordinates for move ${from}${to}.`);
    }

    return [
      {
        kind: "mouse-drag",
        from: fromPoint,
        to: toPoint,
        steps: 24
      }
    ];
  }

  async evaluators(): Promise<readonly Evaluator[]> {
    return [];
  }

  async scenarios(): Promise<readonly TestScenario[]> {
    return [CHESS_COM_SMOKE_SCENARIO];
  }
}

function readStringParam(params: GameActionRequest["params"], key: string): string | null {
  const value = params?.[key];
  return typeof value === "string" && value.length > 0 ? value : null;
}

function readNumberParam(params: GameActionRequest["params"], key: string, fallback: number): number {
  const value = params?.[key];
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function readBoundsParam(params: GameActionRequest["params"]): {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
} | null {
  const value = params?.boardBounds;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const record = value as Record<string, unknown>;
  const x = typeof record.x === "number" ? record.x : null;
  const y = typeof record.y === "number" ? record.y : null;
  const width = typeof record.width === "number" ? record.width : null;
  const height = typeof record.height === "number" ? record.height : null;
  return x !== null && y !== null && width !== null && height !== null ? { x, y, width, height } : null;
}
