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

function parseOutcome(endVisible: boolean, endTitleText: string | null, gameplayEntered: boolean): CatAndDogShellState["outcome"] {
  if (!endVisible) {
    return gameplayEntered ? "in-progress" : "not-started";
  }

  const normalized = (endTitleText ?? "").trim().toLowerCase();
  if (!normalized) {
    return "unknown";
  }

  if (normalized.includes("p1 cat wins")) {
    return "win";
  }

  if (normalized.includes("cpu dog wins") || normalized.includes("p2 dog wins")) {
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
  const menuVisible =
    isVisibleElementById(domHtml, "menuOverlay") ||
    isVisibleElementById(domHtml, "mode-selection") ||
    (hasFallbackMenuText && !hasAnySelector(domHtml, CAT_AND_DOG_SELECTORS.playableSurfaceCandidates));
  const cpuSetupVisible = isVisibleElementById(domHtml, "difficultyPanel");
  const hasModeSelection =
    menuVisible ||
    hasAnySelector(domHtml, CAT_AND_DOG_SELECTORS.modeSelectionCandidates) ||
    hasFallbackMenuText;
  const hasTwoPlayerOption =
    (menuVisible && hasAnySelector(domHtml, CAT_AND_DOG_SELECTORS.twoPlayerButtonCandidates)) ||
    normalizedText.includes("2 player");
  const hasPlayCpuOption =
    (menuVisible && hasAnySelector(domHtml, CAT_AND_DOG_SELECTORS.playCpuButtonCandidates)) ||
    normalizedText.includes("play vs cpu");
  const hasPlayableSurface = hasAnySelector(domHtml, CAT_AND_DOG_SELECTORS.playableSurfaceCandidates);
  const hasGameplayHud = hasAnySelector(domHtml, CAT_AND_DOG_SELECTORS.gameplayHudCandidates);
  const hasGameplayControls =
    hasAnySelector(domHtml, CAT_AND_DOG_SELECTORS.gameplayControlsCandidates) ||
    (normalizedText.includes("a/d") && normalizedText.includes("w/s") && normalizedText.includes("1-5"));
  const aimStatusText = extractTextFromAnySelector(domHtml, CAT_AND_DOG_SELECTORS.aimStatusCandidates);
  const powerStatusText = extractTextFromAnySelector(domHtml, CAT_AND_DOG_SELECTORS.powerStatusCandidates);
  const aimDirection = parseAimDirection(aimStatusText);
  const gameplayInputApplied = aimDirection === "left" || aimDirection === "right";
  const hasStartControl = hasAnySelector(domHtml, CAT_AND_DOG_SELECTORS.startControlCandidates);
  const routePath = parseUrlPath(url);
  const weaponBarVisible = isVisibleElementById(domHtml, "weaponBar");
  const selectedWeaponKey = parseSelectedWeaponKey(domHtml);
  const modeLabelText = extractTextFromAnySelector(domHtml, CAT_AND_DOG_SELECTORS.modeLabelCandidates);
  const endVisible = isVisibleElementById(domHtml, "endOverlay");
  const endTitleText = extractTextFromAnySelector(domHtml, CAT_AND_DOG_SELECTORS.endTitleCandidates);
  const endSubtitleText = extractTextFromAnySelector(domHtml, CAT_AND_DOG_SELECTORS.endSubtitleCandidates);
  const startCpuAvailable = cpuSetupVisible && hasAnySelector(domHtml, CAT_AND_DOG_SELECTORS.startCpuButtonCandidates);
  const modeLabelNormalized = (modeLabelText ?? "").toLowerCase();
  const gameplayEntered =
    endVisible ||
    weaponBarVisible ||
    modeLabelNormalized.includes("1p vs cpu") ||
    modeLabelNormalized.includes("2 players") ||
    (hasPlayableSurface && !menuVisible && (hasGameplayHud || hasGameplayControls));
  const playerTurnReady = gameplayEntered && weaponBarVisible && !endVisible;
  const outcome = parseOutcome(endVisible, endTitleText, gameplayEntered);

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
    endVisible,
    endTitleText,
    endSubtitleText,
    playerTurnReady,
    outcome
  };
}
