import type { ObservationFrame } from "@game-bots/environment-sdk";

import { CAT_AND_DOG_SELECTORS } from "../selectors.js";

export interface CatAndDogShellState {
  hasAppRoot: boolean;
  hasPlayableSurface: boolean;
  routePath: string;
  status: "loading" | "ready";
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

export function parseCatAndDogShell(frame: ObservationFrame): CatAndDogShellState {
  const domHtml = typeof frame.payload.domHtml === "string" ? frame.payload.domHtml : "";
  const url = typeof frame.payload.url === "string" ? frame.payload.url : "";

  const hasAppRoot = hasAnySelector(domHtml, CAT_AND_DOG_SELECTORS.appRootCandidates);
  const hasPlayableSurface = hasAnySelector(domHtml, CAT_AND_DOG_SELECTORS.playableSurfaceCandidates);

  return {
    hasAppRoot,
    hasPlayableSurface,
    routePath: parseUrlPath(url),
    status: hasAppRoot || hasPlayableSurface ? "ready" : "loading"
  };
}
