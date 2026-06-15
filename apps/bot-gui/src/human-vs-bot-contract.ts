export type CatAndDogSide = "cat" | "dog";

export interface CatAndDogTwoPlayerMatchConfig {
  readonly mode: "human-vs-bot";
  readonly humanSide: CatAndDogSide;
  readonly botSide: CatAndDogSide;
  readonly requestedDifficulty?: string;
  readonly strategyMode?: string;
}

export interface CatAndDogTurnSnapshot {
  readonly activeSide: CatAndDogSide | null;
  readonly turnNumber: number | null;
  readonly canAcceptHumanInput: boolean;
  readonly canAcceptBotInput: boolean;
}

export interface CatAndDogShotChoice {
  readonly side: CatAndDogSide;
  readonly shotNumber: number;
  readonly weaponKey: string | null;
  readonly targetAngle: number | null;
  readonly targetPower: number | null;
  readonly preparedAngle?: number | null;
  readonly preparedPower?: number | null;
  readonly source: "human" | "bot";
  readonly reason?: string | null;
}

export interface CatAndDogShotOutcome {
  readonly shotNumber: number;
  readonly side: CatAndDogSide;
  readonly damageDealt: number | null;
  readonly damageTaken: number | null;
  readonly hitCategory: string | null;
  readonly resolutionCategory: string | null;
  readonly playerHpAfter: number | null;
  readonly opponentHpAfter: number | null;
}

export type CatAndDogHumanVsBotTelemetryEvent =
  | {
      readonly type: "match-started";
      readonly at: string;
      readonly config: CatAndDogTwoPlayerMatchConfig;
    }
  | {
      readonly type: "turn-observed";
      readonly at: string;
      readonly turn: CatAndDogTurnSnapshot;
    }
  | {
      readonly type: "shot-selected";
      readonly at: string;
      readonly choice: CatAndDogShotChoice;
    }
  | {
      readonly type: "shot-resolved";
      readonly at: string;
      readonly outcome: CatAndDogShotOutcome;
    };

export function getHumanSide(config: CatAndDogTwoPlayerMatchConfig): CatAndDogSide {
  return config.humanSide;
}

export function getBotSide(config: CatAndDogTwoPlayerMatchConfig): CatAndDogSide {
  return config.botSide;
}

export function isBotTurn(config: CatAndDogTwoPlayerMatchConfig, turn: CatAndDogTurnSnapshot): boolean {
  return turn.activeSide === config.botSide && turn.canAcceptBotInput;
}

export function isHumanTurn(config: CatAndDogTwoPlayerMatchConfig, turn: CatAndDogTurnSnapshot): boolean {
  return turn.activeSide === config.humanSide && turn.canAcceptHumanInput;
}

