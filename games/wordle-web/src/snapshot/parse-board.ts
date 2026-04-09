import type { ObservationFrame } from "@game-bots/environment-sdk";

export interface ParsedBoardState {
  rows: readonly string[];
  status: string;
}

function extractTextById(html: string, id: string): string {
  const pattern = new RegExp(`<[^>]+id=["']${id}["'][^>]*>([\\s\\S]*?)</[^>]+>`, "i");
  const match = pattern.exec(html);

  if (!match) {
    return "";
  }

  return (match[1] ?? "").replace(/<[^>]+>/g, "").trim();
}

export function parseBoard(frame: ObservationFrame): ParsedBoardState {
  const html = typeof frame.payload.domHtml === "string" ? frame.payload.domHtml : "";
  const rows = [...html.matchAll(/data-row=["']\d+["'][^>]*>([\s\S]*?)<\/div>/gi)].map((match) =>
    (match[1] ?? "").replace(/<[^>]+>/g, "").trim()
  );

  return {
    rows,
    status: extractTextById(html, "status")
  };
}
