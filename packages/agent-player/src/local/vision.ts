import { PNG } from "pngjs";
import type { LocalRegion } from "@game-bots/game-sdk";

export const WIDTH = 96, HEIGHT = 72, FEATURE_SIZE = 168;
export interface ImageGrid { rgb: number[]; }
export interface TargetPatch { rgb: number[]; width: number; height: number; }
export interface Match { x: number; y: number; confidence: number; margin: number; scale: number; }
const clamp = (v: number) => Math.max(0, Math.min(1, v));
const rounded = (v: number) => Math.round(v * 1000) / 1000;

/** Decode only bounded PNGs. Called in a worker, never the GUI/controller event loop. */
export function decodeGrid(bytes: Uint8Array): ImageGrid {
  const buffer = Buffer.from(bytes);
  if (buffer.length < 24 || buffer.length > 16 * 1024 * 1024 || buffer.subarray(0, 8).toString("hex") !== "89504e470d0a1a0a") throw new Error("Invalid or oversized local screenshot");
  const w = buffer.readUInt32BE(16), h = buffer.readUInt32BE(20);
  if (!w || !h || w * h > 16000000) throw new Error("Local vision supports screenshots up to 16 megapixels");
  const png = PNG.sync.read(buffer); const rgb: number[] = [];
  for (let y = 0; y < HEIGHT; y++) for (let x = 0; x < WIDTH; x++) {
    for (let c = 0; c < 3; c++) {
      let sum = 0;
      for (const sy of [.25, .75]) for (const sx of [.25, .75]) {
        const px = Math.min(w - 1, Math.floor((x + sx) * w / WIDTH));
        const py = Math.min(h - 1, Math.floor((y + sy) * h / HEIGHT));
        sum += png.data[(py * w + px) * 4 + c]! / 255;
      }
      rgb.push(rounded(sum / 4));
    }
  }
  return { rgb };
}
function pixel(image: ImageGrid, x: number, y: number, c: number) {
  return image.rgb[(Math.max(0, Math.min(HEIGHT - 1, Math.round(y))) * WIDTH + Math.max(0, Math.min(WIDTH - 1, Math.round(x)))) * 3 + c]!;
}
/** Coarse spatial colour + position-independent channel histograms; no bitmap identity. */
export function features(image: ImageGrid, region: LocalRegion = { x: 0, y: 0, width: 1, height: 1 }): number[] {
  const cells = new Array<number>(144).fill(0), counts = new Array<number>(48).fill(0), hist = new Array<number>(24).fill(0);
  let total = 0;
  for (let y = 0; y < HEIGHT; y++) for (let x = 0; x < WIDTH; x++) {
    const nx = (x / WIDTH - region.x) / region.width, ny = (y / HEIGHT - region.y) / region.height;
    if (nx < 0 || ny < 0 || nx >= 1 || ny >= 1) continue;
    const cell = Math.floor(ny * 6) * 8 + Math.floor(nx * 8); counts[cell]!++; total++;
    for (let c = 0; c < 3; c++) { const v = pixel(image, x, y, c); cells[cell * 3 + c]! += v; hist[c * 8 + Math.min(7, Math.floor(v * 8))]!++; }
  }
  return [...cells.map((v, i) => rounded(v / Math.max(1, counts[Math.floor(i / 3)]!))), ...hist.map(v => rounded(v / Math.max(1, total)))];
}
export function similarity(a: readonly number[], b: readonly number[]): number {
  if (a.length !== FEATURE_SIZE || b.length !== FEATURE_SIZE) return 0;
  let best = Infinity;
  // Small camera translations can shift coarse cells; charge for the shift to retain spatial meaning.
  for (const dx of [-1, 0, 1]) for (const dy of [-1, 0, 1]) {
    let distance = 0, n = 0;
    for (let y = 0; y < 6; y++) for (let x = 0; x < 8; x++) {
      if (x + dx < 0 || x + dx >= 8 || y + dy < 0 || y + dy >= 6) continue;
      for (let c = 0; c < 3; c++) { distance += Math.abs(a[(y * 8 + x) * 3 + c]! - b[((y + dy) * 8 + x + dx) * 3 + c]!); n++; }
    }
    best = Math.min(best, distance / n + (Math.abs(dx) + Math.abs(dy)) * .025);
  }
  let hist = 0; for (let i = 144; i < FEATURE_SIZE; i++) hist += Math.abs(a[i]! - b[i]!);
  return clamp(1 - best * 2.8 - hist / 6 * .25);
}
export function visualChange(a: readonly number[], b: readonly number[]): number {
  return a.slice(0, 144).reduce((n, v, i) => n + Math.abs(v - b[i]!), 0) / 144;
}
export function patchAt(image: ImageGrid, x: number, y: number, width = .12, height = .16): TargetPatch | null {
  if (x - width / 2 < 0 || x + width / 2 > 1 || y - height / 2 < 0 || y + height / 2 > 1) return null;
  const rgb: number[] = [];
  for (let py = 0; py < 9; py++) for (let px = 0; px < 9; px++) for (let c = 0; c < 3; c++) rgb.push(pixel(image, (x + (px / 8 - .5) * width) * WIDTH, (y + (py / 8 - .5) * height) * HEIGHT, c));
  const mean = rgb.reduce((n, v) => n + v, 0) / rgb.length;
  if (rgb.reduce((n, v) => n + (v - mean) ** 2, 0) / rgb.length < .004) return null;
  return { rgb, width, height };
}
function patchScore(image: ImageGrid, target: TargetPatch, x: number, y: number, scale: number): number {
  let error = 0, dot = 0, aa = 0, bb = 0, sa = 0, sb = 0;
  for (let py = 0; py < 9; py++) for (let px = 0; px < 9; px++) for (let c = 0; c < 3; c++) {
    const a = target.rgb[(py * 9 + px) * 3 + c]!;
    const b = pixel(image, x + (px / 8 - .5) * target.width * WIDTH * scale, y + (py / 8 - .5) * target.height * HEIGHT * scale, c);
    sa += a; sb += b; aa += a * a; bb += b * b; dot += a * b; error += Math.abs(a - b);
  }
  const n = 243, denom = Math.sqrt(Math.max(0, aa - sa * sa / n) * Math.max(0, bb - sb * sb / n));
  const correlation = denom < .01 ? 0 : (dot - sa * sb / n) / denom;
  return clamp(.65 * Math.max(0, correlation) + .35 * Math.max(0, 1 - error / n * 3));
}
/** Multiscale, translation-search matching. Reject featureless and ambiguous repeated targets. */
export function matchTarget(image: ImageGrid, target: TargetPatch): Match | null {
  const candidates: { x: number; y: number; confidence: number; scale: number }[] = [];
  for (const scale of [.8, 1, 1.25]) {
    const hw = target.width * WIDTH * scale / 2, hh = target.height * HEIGHT * scale / 2;
    for (let y = Math.ceil(hh); y < HEIGHT - hh; y += 3) for (let x = Math.ceil(hw); x < WIDTH - hw; x += 3) candidates.push({ x, y, scale, confidence: patchScore(image, target, x, y, scale) });
  }
  candidates.sort((a, b) => b.confidence - a.confidence);
  const seeds = candidates.slice(0, 4);
  for (const seed of seeds) for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
    const x = seed.x + dx, y = seed.y + dy;
    if (x < target.width * WIDTH * seed.scale / 2 || x > WIDTH - target.width * WIDTH * seed.scale / 2 || y < target.height * HEIGHT * seed.scale / 2 || y > HEIGHT - target.height * HEIGHT * seed.scale / 2) continue;
    candidates.push({ x, y, scale: seed.scale, confidence: patchScore(image, target, x, y, seed.scale) });
  }
  candidates.sort((a, b) => b.confidence - a.confidence);
  const best = candidates[0]; if (!best || best.confidence < .78) return null;
  const second = candidates.find(c => Math.hypot((c.x - best.x) / (target.width * WIDTH), (c.y - best.y) / (target.height * HEIGHT)) > .85);
  const margin = best.confidence - (second?.confidence ?? 0);
  if (margin < .045) return null;
  return { ...best, x: best.x / WIDTH, y: best.y / HEIGHT, margin };
}
