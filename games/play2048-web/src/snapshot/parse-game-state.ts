import type { ObservationFrame } from "@game-bots/environment-sdk";

export interface ParsedPlay2048State {
  hasGameContainer: boolean;
  score: number;
  bestScore: number;
  tileCount: number;
  status: "loading" | "playing" | "won" | "over";
}

function stripHtmlTags(input: string): string {
  return input.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

function readClassList(classAttribute: string): readonly string[] {
  return classAttribute.split(/\s+/).map((token) => token.trim()).filter((token) => token.length > 0);
}

function hasClassToken(classAttribute: string, classToken: string): boolean {
  return readClassList(classAttribute).includes(classToken);
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function extractContainerContentByClass(html: string, classToken: string): string {
  const escapedClassToken = escapeRegex(classToken);
  const pattern = new RegExp(
    `<[^>]*class=["'][^"']*\\b${escapedClassToken}\\b[^"']*["'][^>]*>([\\s\\S]*?)<\\/[^>]+>`,
    "i"
  );
  return pattern.exec(html)?.[1] ?? "";
}

function extractFirstNumber(value: string): number {
  const match = value.match(/-?\d+/);
  if (!match) {
    return 0;
  }

  const parsed = Number.parseInt(match[0], 10);
  return Number.isNaN(parsed) ? 0 : parsed;
}

function extractNumberByClass(html: string, classToken: string): number {
  const containerContent = extractContainerContentByClass(html, classToken);
  return extractFirstNumber(stripHtmlTags(containerContent));
}

function countElementsByClassToken(html: string, classToken: string): number {
  let count = 0;
  for (const match of html.matchAll(/class=["']([^"']+)["']/gi)) {
    if (hasClassToken(match[1] ?? "", classToken)) {
      count += 1;
    }
  }

  return count;
}

function hasClassTokenOnElement(html: string, classToken: string): boolean {
  for (const match of html.matchAll(/class=["']([^"']+)["']/gi)) {
    if (hasClassToken(match[1] ?? "", classToken)) {
      return true;
    }
  }

  return false;
}

function resolveStatus(html: string, hasGameContainer: boolean): ParsedPlay2048State["status"] {
  if (!hasGameContainer) {
    return "loading";
  }

  if (hasClassTokenOnElement(html, "game-over")) {
    return "over";
  }

  if (hasClassTokenOnElement(html, "game-won")) {
    return "won";
  }

  return "playing";
}

export function parsePlay2048State(frame: ObservationFrame): ParsedPlay2048State {
  const html = typeof frame.payload.domHtml === "string" ? frame.payload.domHtml : "";
  const hasGameContainer = hasClassTokenOnElement(html, "game-container");

  return {
    hasGameContainer,
    score: extractNumberByClass(html, "score-container"),
    bestScore: extractNumberByClass(html, "best-container"),
    tileCount: countElementsByClassToken(html, "tile"),
    status: resolveStatus(html, hasGameContainer)
  };
}
