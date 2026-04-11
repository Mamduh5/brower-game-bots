import type { ObservationFrame } from "@game-bots/environment-sdk";

import { CAT_AND_DOG_SELECTORS } from "../selectors.js";

export interface CatAndDogShellState {
  hasAppRoot: boolean;
  hasModeSelection: boolean;
  hasTwoPlayerOption: boolean;
  hasPlayCpuOption: boolean;
  hasPlayableSurface: boolean;
  hasGameplayHud: boolean;
  hasGameplayControls: boolean;
  aimStatusText: string | null;
  aimDirection: "left" | "right" | "center" | "unknown";
  powerStatusText: string | null;
  gameplayInputApplied: boolean;
  hasStartControl: boolean;
  gameplayEntered: boolean;
  routePath: string;
  status: "loading" | "landing" | "gameplay";
  menuVisible: boolean;
  cpuSetupVisible: boolean;
  startCpuAvailable: boolean;
  weaponBarVisible: boolean;
  selectedWeaponKey: string | null;
  modeLabelText: string | null;
  matchNoteText: string | null;
  canvasHintVisible: boolean;
  canvasHintText: string | null;
  canvasHintCategory: "none" | "instructional" | "turn-status" | "combat-result" | "cpu-planning" | "unknown";
  turnBannerVisible: boolean;
  turnBannerLabelText: string | null;
  turnBannerTitleText: string | null;
  playerHpText: string | null;
  playerHpValue: number | null;
  playerHpMax: number | null;
  cpuHpText: string | null;
  cpuHpValue: number | null;
  cpuHpMax: number | null;
  hpTrackingAvailable: boolean;
  turnCounterText: string | null;
  turnCounter: number | null;
  progressSignalSource: "hp" | "combat-hint" | "turn-only" | "unavailable";
  shotResolutionCategory:
    | "none"
    | "turn-start"
    | "aiming"
    | "windup"
    | "direct-hit"
    | "splash-hit"
    | "wall-hit"
    | "miss"
    | "heal"
    | "cpu-planning"
    | "unknown";
  shotResolved: boolean;
  endVisible: boolean;
  endTitleText: string | null;
  endSubtitleText: string | null;
  playerTurnReady: boolean;
  outcome: "not-started" | "in-progress" | "win" | "loss" | "unknown";
}

function parseUrlPath(rawUrl: string): string {
  if (!rawUrl) {
    return "/";
  }

  try {
    const parsed = new URL(rawUrl);
    return parsed.pathname || "/";
  } catch {
    return "/";
  }
}

function domIncludesSelectorHint(domHtml: string, selector: string): boolean {
  if (!domHtml) {
    return false;
  }

  if (selector.startsWith("#")) {
    const id = selector.slice(1);
    return domHtml.includes(`id="${id}"`) || domHtml.includes(`id='${id}'`);
  }

  if (selector.startsWith(".")) {
    const className = selector.slice(1);
    return domHtml.includes(`class="${className}"`) || domHtml.includes(`class='${className}'`) || domHtml.includes(className);
  }

  if (selector === "main") {
    return domHtml.includes("<main");
  }

  if (selector === "canvas") {
    return domHtml.includes("<canvas");
  }

  if (selector.includes("[data-testid='")) {
    const token = selector.match(/data-testid='([^']+)'/)?.[1] ?? "";
    return token.length > 0 && (domHtml.includes(`data-testid="${token}"`) || domHtml.includes(`data-testid='${token}'`));
  }

  return domHtml.includes(selector);
}

function hasAnySelector(domHtml: string, selectors: readonly string[]): boolean {
  return selectors.some((selector) => domIncludesSelectorHint(domHtml, selector));
}

function extractElementOpenTagById(domHtml: string, elementId: string): string | null {
  if (!domHtml) {
    return null;
  }

  const id = escapeRegExp(elementId);
  const match = domHtml.match(new RegExp(`<([a-zA-Z0-9:-]+)[^>]*\\bid=(["'])${id}\\2[^>]*>`, "i"));
  return match?.[0] ?? null;
}

function elementHasClass(openTag: string | null, className: string): boolean {
  if (!openTag) {
    return false;
  }

  const match = openTag.match(/\bclass=(["'])(.*?)\1/i);
  if (!match?.[2]) {
    return false;
  }

  return match[2]
    .split(/\s+/)
    .filter(Boolean)
    .includes(className);
}

function elementHasHiddenAttr(openTag: string | null): boolean {
  if (!openTag) {
    return false;
  }

  return /\bhidden(?:=|[\s>])/i.test(openTag);
}

function isVisibleElementById(domHtml: string, elementId: string): boolean {
  const openTag = extractElementOpenTagById(domHtml, elementId);
  if (!openTag) {
    return false;
  }

  return !elementHasHiddenAttr(openTag) && !elementHasClass(openTag, "hidden") && !elementHasClass(openTag, "is-hidden");
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function stripInnerTags(value: string): string {
  return value
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function toNormalizedText(domHtml: string): string {
  return domHtml
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function parseAimDirection(aimStatusText: string | null): "left" | "right" | "center" | "unknown" {
  if (!aimStatusText) {
    return "unknown";
  }

  const normalized = aimStatusText.toLowerCase();
  if (normalized.includes("left")) {
    return "left";
  }

  if (normalized.includes("right")) {
    return "right";
  }

  if (normalized.includes("center")) {
    return "center";
  }

  return "unknown";
}

function parseIntegerFromText(value: string | null): number | null {
  if (!value) {
    return null;
  }

  const match = value.match(/(\d+)/);
  if (!match?.[1]) {
    return null;
  }

  const parsed = Number.parseInt(match[1], 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseHpText(value: string | null): { current: number | null; max: number | null } {
  if (!value) {
    return { current: null, max: null };
  }

  const normalized = value.replace(/\s+/g, " ").trim();
  const paired = normalized.match(/(\d+)\s*\/\s*(\d+)/);
  if (paired?.[1] && paired[2]) {
    const current = Number.parseInt(paired[1], 10);
    const max = Number.parseInt(paired[2], 10);
    return {
      current: Number.isFinite(current) ? current : null,
      max: Number.isFinite(max) ? max : null
    };
  }

  return {
    current: parseIntegerFromText(normalized),
    max: null
  };
}

function parseShotResolutionCategory(
  canvasHintText: string | null,
  canvasHintCategory: CatAndDogShellState["canvasHintCategory"],
  playerTurnReady: boolean,
  turnBannerVisible: boolean,
  endVisible: boolean
): CatAndDogShellState["shotResolutionCategory"] {
  const normalized = (canvasHintText ?? "").trim().toLowerCase();
  if (!normalized) {
    if (playerTurnReady) {
      return "aiming";
    }

    return turnBannerVisible ? "turn-start" : "none";
  }

  if (canvasHintCategory === "turn-status" && (normalized.includes("stepping in") || normalized.includes("get ready"))) {
    return "turn-start";
  }

  if (canvasHintCategory === "instructional") {
    return playerTurnReady ? "aiming" : "cpu-planning";
  }

  if (canvasHintCategory === "turn-status" && normalized.includes("winds up")) {
    return "windup";
  }

  if (canvasHintCategory === "combat-result" && normalized.includes("heavy impact landed")) {
    return "direct-hit";
  }

  if (canvasHintCategory === "combat-result" && normalized.includes("wall hit and splash damage landed")) {
    return "splash-hit";
  }

  if (canvasHintCategory === "combat-result" && normalized.includes("heavy burst scatters shards")) {
    return "splash-hit";
  }

  if (canvasHintCategory === "combat-result" && normalized.includes("direct hit")) {
    return "direct-hit";
  }

  if (canvasHintCategory === "combat-result" && normalized.includes("splash damage")) {
    return "splash-hit";
  }

  if (canvasHintCategory === "combat-result" && (normalized.includes("wall hit") || normalized.includes("slammed into the wall"))) {
    return "wall-hit";
  }

  if (canvasHintCategory === "combat-result" && (normalized.includes("recovered") || normalized.includes("full hp") || normalized.includes("heal"))) {
    return "heal";
  }

  if (canvasHintCategory === "combat-result" && normalized.includes("missed clean")) {
    return "miss";
  }

  if (canvasHintCategory === "cpu-planning") {
    return "cpu-planning";
  }

  if (playerTurnReady) {
    return "aiming";
  }

  if (turnBannerVisible) {
    return "turn-start";
  }

  return "unknown";
}

function parseCanvasHintCategory(canvasHintText: string | null): CatAndDogShellState["canvasHintCategory"] {
  const normalized = (canvasHintText ?? "").trim().toLowerCase();
  if (!normalized) {
    return "none";
  }

  if (
    normalized.includes("adjust angle") ||
    normalized.includes("controls: a/d") ||
    normalized.includes("press a/d") ||
    normalized.includes("drag to aim") ||
    normalized.includes("release to fire") ||
    normalized.includes("pull back") ||
    normalized.includes("switched to")
  ) {
    return "instructional";
  }

  if (
    normalized.includes("stepping in") ||
    normalized.includes("get ready") ||
    normalized.includes("winds up")
  ) {
    return "turn-status";
  }

  if (
    normalized.includes("reading the wind") ||
    normalized.includes("plans to fire twice") ||
    normalized.includes("cheat shot") ||
    normalized.includes("sizes up") ||
    normalized.includes("deciding whether to patch up")
  ) {
    return "cpu-planning";
  }

  if (
    normalized.includes("direct hit") ||
    normalized.includes("heavy impact landed") ||
    normalized.includes("splash damage landed") ||
    normalized.includes("wall hit and splash damage landed") ||
    normalized.includes("heavy burst scatters shards") ||
    normalized.includes("shot slammed into the wall") ||
    normalized.includes("missed clean") ||
    normalized.includes("recovered") ||
    normalized.includes("full hp") ||
    normalized.includes("heal")
  ) {
    return "combat-result";
  }

  return "unknown";
}

function isPlayerActionableHintState(
  canvasHintCategory: CatAndDogShellState["canvasHintCategory"],
  canvasHintText: string | null,
  matchNoteText: string | null
): boolean {
  const hintNormalized = (canvasHintText ?? "").trim().toLowerCase();
  const noteNormalized = (matchNoteText ?? "").trim().toLowerCase();

  if (
    canvasHintCategory === "combat-result" ||
    canvasHintCategory === "cpu-planning" ||
    canvasHintCategory === "turn-status"
  ) {
    return false;
  }

  if (
    hintNormalized.includes("projectile launched") ||
    noteNormalized.includes("projectile launched") ||
    noteNormalized.includes("stepping in") ||
    noteNormalized.includes("sizes up")
  ) {
    return false;
  }

  return true;
}

function extractTextBySelectorHint(domHtml: string, selector: string): string | null {
  if (!domHtml) {
    return null;
  }

  if (selector.startsWith("#")) {
    const id = escapeRegExp(selector.slice(1));
    const match = domHtml.match(
      new RegExp(`<([a-zA-Z0-9:-]+)[^>]*\\bid=(["'])${id}\\2[^>]*>([\\s\\S]*?)<\\/\\1>`, "i")
    );
    return match?.[3] ? stripInnerTags(match[3]) : null;
  }

  if (selector.startsWith(".")) {
    const className = escapeRegExp(selector.slice(1));
    const match = domHtml.match(
      new RegExp(
        `<([a-zA-Z0-9:-]+)[^>]*\\bclass=(["'])[^"']*\\b${className}\\b[^"']*\\2[^>]*>([\\s\\S]*?)<\\/\\1>`,
        "i"
      )
    );
    return match?.[3] ? stripInnerTags(match[3]) : null;
  }

  if (selector.includes("[data-testid='")) {
    const token = selector.match(/data-testid='([^']+)'/)?.[1] ?? "";
    if (!token) {
      return null;
    }

    const escapedToken = escapeRegExp(token);
    const match = domHtml.match(
      new RegExp(`<([a-zA-Z0-9:-]+)[^>]*\\bdata-testid=(["'])${escapedToken}\\2[^>]*>([\\s\\S]*?)<\\/\\1>`, "i")
    );
    return match?.[3] ? stripInnerTags(match[3]) : null;
  }

  return null;
}

function extractTextFromAnySelector(domHtml: string, selectors: readonly string[]): string | null {
  for (const selector of selectors) {
    const text = extractTextBySelectorHint(domHtml, selector);
    if (text && text.length > 0) {
      return text;
    }
  }

  return null;
}

function stripNonVisibleSourceBlocks(domHtml: string): string {
  return domHtml
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "");
}

function parseSelectedWeaponKey(domHtml: string): string | null {
  if (!domHtml) {
    return null;
  }

  const match = domHtml.match(/<([a-zA-Z0-9:-]+)[^>]*>/gi);
  if (!match) {
    return null;
  }

  for (const openTag of match) {
    if (!/\bdata-weapon-key=(["'])([^"']+)\1/i.test(openTag) || !/\bclass=(["'])[^"']*\bis-active\b[^"']*\1/i.test(openTag)) {
      continue;
    }

    const keyMatch = openTag.match(/\bdata-weapon-key=(["'])([^"']+)\1/i);
    if (keyMatch?.[2]) {
      return keyMatch[2];
    }
  }

  return null;
}

function resolveProgressSignalSource(input: {
  playerHpValue: number | null;
  cpuHpValue: number | null;
  canvasHintCategory: CatAndDogShellState["canvasHintCategory"];
  turnBannerVisible: boolean;
  turnCounter: number | null;
}): CatAndDogShellState["progressSignalSource"] {
  if (input.playerHpValue !== null || input.cpuHpValue !== null) {
    return "hp";
  }

  if (input.canvasHintCategory === "combat-result") {
    return "combat-hint";
  }

  if (input.turnBannerVisible || input.turnCounter !== null) {
    return "turn-only";
  }

  return "unavailable";
}

function parseOutcome(endVisible: boolean, endTitleText: string | null, gameplayEntered: boolean): CatAndDogShellState["outcome"] {
  if (!endVisible) {
    return gameplayEntered ? "in-progress" : "not-started";
  }

  const normalized = (endTitleText ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\s]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!normalized) {
    return "unknown";
  }

  if (
    normalized.includes("p1 cat wins") ||
    /\bplayer\s*1\b.*\bcat\b.*\bwins?\b/.test(normalized) ||
    /\bcat\b.*\bwins?\b/.test(normalized)
  ) {
    return "win";
  }

  if (
    normalized.includes("cpu dog wins") ||
    normalized.includes("p2 dog wins") ||
    /\bcpu\b.*\bdog\b.*\bwins?\b/.test(normalized) ||
    /\bplayer\s*2\b.*\bdog\b.*\bwins?\b/.test(normalized) ||
    /\bdog\b.*\bwins?\b/.test(normalized)
  ) {
    return "loss";
  }

  return "unknown";
}

export function parseCatAndDogShell(frame: ObservationFrame): CatAndDogShellState {
  const domHtmlRaw = typeof frame.payload.domHtml === "string" ? frame.payload.domHtml : "";
  const domHtml = stripNonVisibleSourceBlocks(domHtmlRaw);
  const normalizedText = toNormalizedText(domHtml);
  const url = typeof frame.payload.url === "string" ? frame.payload.url : "";

  const hasAppRoot = hasAnySelector(domHtml, CAT_AND_DOG_SELECTORS.appRootCandidates);
  const hasFallbackMenuText = normalizedText.includes("play vs cpu") && normalizedText.includes("2 player");
  const overlayMenuVisible =
    isVisibleElementById(domHtml, "menuOverlay") ||
    isVisibleElementById(domHtml, "mode-selection");
  const menuVisible =
    overlayMenuVisible ||
    (hasFallbackMenuText && !hasAnySelector(domHtml, CAT_AND_DOG_SELECTORS.playableSurfaceCandidates));
  const cpuSetupVisible = menuVisible && isVisibleElementById(domHtml, "difficultyPanel");
  const hasModeSelection = menuVisible || (hasFallbackMenuText && !hasAnySelector(domHtml, CAT_AND_DOG_SELECTORS.playableSurfaceCandidates));
  const hasTwoPlayerOption =
    menuVisible &&
    (
      hasAnySelector(domHtml, CAT_AND_DOG_SELECTORS.twoPlayerButtonCandidates) ||
      normalizedText.includes("2 player")
    );
  const hasPlayCpuOption =
    menuVisible &&
    (
      hasAnySelector(domHtml, CAT_AND_DOG_SELECTORS.playCpuButtonCandidates) ||
      normalizedText.includes("play vs cpu")
    );
  const hasPlayableSurface = hasAnySelector(domHtml, CAT_AND_DOG_SELECTORS.playableSurfaceCandidates);
  const hasGameplayHud = hasAnySelector(domHtml, CAT_AND_DOG_SELECTORS.gameplayHudCandidates);
  const hasGameplayControls =
    hasAnySelector(domHtml, CAT_AND_DOG_SELECTORS.gameplayControlsCandidates) ||
    (normalizedText.includes("a/d") && normalizedText.includes("w/s") && normalizedText.includes("1-5"));
  const aimStatusText = extractTextFromAnySelector(domHtml, CAT_AND_DOG_SELECTORS.aimStatusCandidates);
  const powerStatusText = extractTextFromAnySelector(domHtml, CAT_AND_DOG_SELECTORS.powerStatusCandidates);
  const aimDirection = parseAimDirection(aimStatusText);
  const gameplayInputApplied = aimDirection === "left" || aimDirection === "right";
  const hasStartControl = menuVisible && hasAnySelector(domHtml, CAT_AND_DOG_SELECTORS.startControlCandidates);
  const routePath = parseUrlPath(url);
  const weaponBarVisible = isVisibleElementById(domHtml, "weaponBar");
  const selectedWeaponKey = parseSelectedWeaponKey(domHtml);
  const modeLabelText = extractTextFromAnySelector(domHtml, CAT_AND_DOG_SELECTORS.modeLabelCandidates);
  const matchNoteText = extractTextFromAnySelector(domHtml, CAT_AND_DOG_SELECTORS.matchNoteCandidates);
  const canvasHintVisible = isVisibleElementById(domHtml, "canvasHint");
  const canvasHintText = canvasHintVisible
    ? extractTextFromAnySelector(domHtml, CAT_AND_DOG_SELECTORS.canvasHintCandidates)
    : null;
  const canvasHintCategory = parseCanvasHintCategory(canvasHintText);
  const turnBannerVisible = isVisibleElementById(domHtml, "turnBanner");
  const turnBannerLabelText = turnBannerVisible
    ? extractTextFromAnySelector(domHtml, CAT_AND_DOG_SELECTORS.turnBannerLabelCandidates)
    : null;
  const turnBannerTitleText = turnBannerVisible
    ? extractTextFromAnySelector(domHtml, CAT_AND_DOG_SELECTORS.turnBannerTitleCandidates)
    : null;
  const playerHpText = extractTextFromAnySelector(domHtml, CAT_AND_DOG_SELECTORS.playerHpCandidates);
  const playerHp = parseHpText(playerHpText);
  const cpuHpText = extractTextFromAnySelector(domHtml, CAT_AND_DOG_SELECTORS.cpuHpCandidates);
  const cpuHp = parseHpText(cpuHpText);
  const hpTrackingAvailable = playerHp.current !== null || cpuHp.current !== null;
  const turnCounterText = extractTextFromAnySelector(domHtml, CAT_AND_DOG_SELECTORS.turnCounterCandidates);
  const turnCounter = parseIntegerFromText(turnCounterText);
  const endVisible = isVisibleElementById(domHtml, "endOverlay");
  const endTitleText = endVisible ? extractTextFromAnySelector(domHtml, CAT_AND_DOG_SELECTORS.endTitleCandidates) : null;
  const endSubtitleText = endVisible
    ? extractTextFromAnySelector(domHtml, CAT_AND_DOG_SELECTORS.endSubtitleCandidates)
    : null;
  const startCpuAvailable =
    cpuSetupVisible &&
    hasAnySelector(domHtml, CAT_AND_DOG_SELECTORS.startCpuButtonCandidates);
  const modeLabelNormalized = (modeLabelText ?? "").toLowerCase();
  const hasActiveModeLabel = modeLabelNormalized.includes("1p vs cpu") || modeLabelNormalized.includes("2 players");
  const gameplayEntered =
    endVisible ||
    weaponBarVisible ||
    hasActiveModeLabel ||
    (hasPlayableSurface && !menuVisible && (hasGameplayHud || hasGameplayControls));
  const playerTurnReady =
    gameplayEntered &&
    hasActiveModeLabel &&
    hasGameplayControls &&
    weaponBarVisible &&
    selectedWeaponKey !== null &&
    menuVisible !== true &&
    isPlayerActionableHintState(canvasHintCategory, canvasHintText, matchNoteText) &&
    turnBannerVisible !== true &&
    endVisible !== true;
  const shotResolutionCategory = parseShotResolutionCategory(
    canvasHintText,
    canvasHintCategory,
    playerTurnReady,
    turnBannerVisible,
    endVisible
  );
  const shotResolved =
    endVisible === true ||
    shotResolutionCategory === "direct-hit" ||
    shotResolutionCategory === "splash-hit" ||
    shotResolutionCategory === "wall-hit" ||
    shotResolutionCategory === "miss" ||
    shotResolutionCategory === "heal";
  const outcome = parseOutcome(endVisible, endTitleText, gameplayEntered);
  const progressSignalSource = resolveProgressSignalSource({
    playerHpValue: playerHp.current,
    cpuHpValue: cpuHp.current,
    canvasHintCategory,
    turnBannerVisible,
    turnCounter
  });

  const status: CatAndDogShellState["status"] = gameplayEntered
    ? "gameplay"
    : hasStartControl
      ? "landing"
      : hasAppRoot || hasPlayableSurface
        ? "landing"
        : "loading";

  return {
    hasAppRoot,
    hasModeSelection,
    hasTwoPlayerOption,
    hasPlayCpuOption,
    hasPlayableSurface,
    hasGameplayHud,
    hasGameplayControls,
    aimStatusText,
    aimDirection,
    powerStatusText,
    gameplayInputApplied,
    hasStartControl,
    gameplayEntered,
    routePath,
    status,
    menuVisible,
    cpuSetupVisible,
    startCpuAvailable,
    weaponBarVisible,
    selectedWeaponKey,
    modeLabelText,
    matchNoteText,
    canvasHintVisible,
    canvasHintText,
    canvasHintCategory,
    turnBannerVisible,
    turnBannerLabelText,
    turnBannerTitleText,
    playerHpText,
    playerHpValue: playerHp.current,
    playerHpMax: playerHp.max,
    cpuHpText,
    cpuHpValue: cpuHp.current,
    cpuHpMax: cpuHp.max,
    hpTrackingAvailable,
    turnCounterText,
    turnCounter,
    progressSignalSource,
    shotResolutionCategory,
    shotResolved,
    endVisible,
    endTitleText,
    endSubtitleText,
    playerTurnReady,
    outcome
  };
}
