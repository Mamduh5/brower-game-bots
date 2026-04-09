import type { ObservationFrame } from "@game-bots/environment-sdk";

export interface ParsedBoardState {
  rows: readonly string[];
  status: string;
  inputDisabled: boolean;
  submitDisabled: boolean;
}

function extractTextById(html: string, id: string): string {
  const pattern = new RegExp(`<[^>]+id=["']${id}["'][^>]*>([\\s\\S]*?)</[^>]+>`, "i");
  const match = pattern.exec(html);

  if (!match) {
    return "";
  }

  return (match[1] ?? "").replace(/<[^>]+>/g, "").trim();
}

function elementHasAttribute(html: string, id: string, attribute: string): boolean {
  const pattern = new RegExp(`<[^>]+id=["']${id}["'][^>]*\\b${attribute}\\b[^>]*>`, "i");
  return pattern.test(html);
}

export function parseBoard(frame: ObservationFrame): ParsedBoardState {
  const html = typeof frame.payload.domHtml === "string" ? frame.payload.domHtml : "";
  const rows = [...html.matchAll(/data-row=["']\d+["'][^>]*>([\s\S]*?)<\/div>/gi)].map((match) =>
    (match[1] ?? "").replace(/<[^>]+>/g, "").trim()
  );

  return {
    rows,
    status: extractTextById(html, "status"),
    inputDisabled: elementHasAttribute(html, "guess-input", "disabled"),
    submitDisabled: elementHasAttribute(html, "submit-guess", "disabled")
  };
}
