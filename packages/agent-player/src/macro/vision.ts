import { PNG } from "pngjs";
import type { MacroFeature, MacroFrame } from "@game-bots/game-sdk";

export interface Motion { dx: number; dy: number; scale: number; confidence: number; inliers: number; spread: number; pairs: [number, number][] }
const W = 160, H = 120;
/** Bounded corner patches, with top/bottom UI and the usual central avatar region excluded. */
export function macroFeatures(bytes: Uint8Array): MacroFeature[] {
  const buffer = Buffer.from(bytes);
  if (buffer.length < 24 || buffer.length > 16 * 1024 * 1024 || buffer.subarray(0, 8).toString("hex") !== "89504e470d0a1a0a" || buffer.readUInt32BE(16) * buffer.readUInt32BE(20) > 16000000) throw new Error("Invalid Macro screenshot");
  const png = PNG.sync.read(buffer), gray = new Float64Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const at = (Math.min(png.height - 1, Math.floor((y + .5) * png.height / H)) * png.width + Math.min(png.width - 1, Math.floor((x + .5) * png.width / W))) * 4;
    gray[y * W + x] = (png.data[at]! * .299 + png.data[at + 1]! * .587 + png.data[at + 2]! * .114) / 255;
  }
  const candidates: { x: number; y: number; score: number }[] = [];
  for (let y = 24; y < 104; y += 2) for (let x = 8; x < 152; x += 2) {
    if (x > 66 && x < 94 && y > 55) continue;
    let xx = 0, yy = 0, xy = 0;
    for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) {
      const n = (y + j) * W + x + i, gx = gray[n + 1]! - gray[n - 1]!, gy = gray[n + W]! - gray[n - W]!;
      xx += gx * gx; yy += gy * gy; xy += gx * gy;
    }
    const score = (xx + yy - Math.sqrt((xx - yy) ** 2 + 4 * xy * xy)) / 2;
    if (score > .015) candidates.push({ x, y, score });
  }
  candidates.sort((a, b) => b.score - a.score);
  const result: MacroFeature[] = [];
  for (const c of candidates) {
    if (result.some(f => Math.hypot(f.x - c.x, f.y - c.y) < 9)) continue;
    const patch: number[] = [];
    for (let y = -3; y <= 3; y++) for (let x = -3; x <= 3; x++) patch.push(gray[(c.y + y) * W + c.x + x]!);
    const mean = patch.reduce((n, v) => n + v, 0) / 49;
    const sd = Math.sqrt(patch.reduce((n, v) => n + (v - mean) ** 2, 0) / 49);
    if (sd < .04) continue;
    result.push({ x: c.x, y: c.y, descriptor: patch.map(v => Math.round(Math.max(-4, Math.min(4, (v - mean) / sd)) * 100) / 100), persistence: 1 });
    if (result.length >= 96) break;
  }
  return result;
}
const distance = (a: MacroFeature, b: MacroFeature) => a.descriptor.reduce((n, v, i) => n + Math.abs(v - b.descriptor[i]!), 0) / 49;
/** Mutual distinctive patch matches + deterministic robust scale/translation consensus.
 * Missing objects are unmatched; independently moving objects become geometric outliers.
 */
export function macroMotion(a: readonly MacroFeature[], b: readonly MacroFeature[], stableOnly = true): Motion {
  const empty: Motion = { dx: 0, dy: 0, scale: 1, confidence: 0, inliers: 0, spread: 0, pairs: [] };
  const matches: [number, number][] = [];
  const costs = a.map(x => b.map(y => distance(x, y)));
  for (let i = 0; i < a.length; i++) {
    if (stableOnly && a[i]!.persistence < 2) continue;
    const order = costs[i]!.map((cost, j) => ({ cost, j })).sort((x, y) => x.cost - y.cost);
    if (order.length < 2 || order[0]!.cost > .62 || order[0]!.cost >= order[1]!.cost * .78) continue;
    const j = order[0]!.j;
    if (costs.some((row, k) => k !== i && row[j]! <= order[0]!.cost)) continue;
    matches.push([i, j]);
  }
  if (matches.length < 8) return empty;
  let best: [number, number][] = [], bestScale = 1, bestDx = 0, bestDy = 0;
  const tryModel = (scale: number, dx: number, dy: number) => {
    if (scale < .75 || scale > 1.3) return;
    const inliers = matches.filter(([i, j]) => Math.hypot((a[i]!.x - 80) * scale + 80 + dx - b[j]!.x, (a[i]!.y - 60) * scale + 60 + dy - b[j]!.y) <= 2.5);
    const weight = (pairs: [number, number][]) => pairs.reduce((n, [i]) => n + Math.min(4, a[i]!.persistence), 0);
    if (weight(inliers) > weight(best)) { best = inliers; bestScale = scale; bestDx = dx; bestDy = dy; }
  };
  for (let n = 0; n < matches.length; n++) {
    const [i, j] = matches[n]!, p = a[i]!, q = b[j]!;
    tryModel(1, q.x - p.x, q.y - p.y);
    for (let m = n + 1; m < Math.min(matches.length, n + 9); m++) {
      const [k, l] = matches[m]!, u = a[k]!, v = b[l]!;
      const denom = (u.x - p.x) ** 2 + (u.y - p.y) ** 2;
      if (denom < 400) continue;
      const scale = ((v.x - q.x) * (u.x - p.x) + (v.y - q.y) * (u.y - p.y)) / denom;
      tryModel(scale, q.x - 80 - (p.x - 80) * scale, q.y - 60 - (p.y - 60) * scale);
    }
  }
  const cells = new Set(best.map(([i]) => `${Math.floor(a[i]!.x / 40)},${Math.floor(a[i]!.y / 30)}`));
  const spread = cells.size;
  const confidence = Math.min(1, best.length / 16) * Math.min(1, spread / 6) * (best.length / matches.length);
  return { dx: bestDx, dy: bestDy, scale: bestScale, confidence, inliers: best.length, spread, pairs: best };
}
export function strengthenMacroFrames(frames: MacroFrame[]): void {
  // Track persistent, consensus scene features through adjacent observations in both directions.
  for (let i = 1; i < frames.length; i++) {
    const before = frames[i - 1]!, after = frames[i]!;
    const fit = macroMotion(before.features, after.features, false);
    if (fit.confidence < .55) continue;
    for (const [a, b] of fit.pairs) after.features[b]!.persistence = Math.min(160, before.features[a]!.persistence + 1);
  }
  for (let i = frames.length - 2; i >= 0; i--) {
    const before = frames[i]!, after = frames[i + 1]!;
    const fit = macroMotion(before.features, after.features, false);
    if (fit.confidence < .55) continue;
    for (const [a, b] of fit.pairs) before.features[a]!.persistence = Math.max(before.features[a]!.persistence, after.features[b]!.persistence);
  }
}
export function alignmentClass(m: Motion): "good" | "small" | "wrong" {
  if (m.confidence < .65 || m.inliers < 12 || m.spread < 5) return "wrong";
  if (Math.hypot(m.dx, m.dy) <= 2.5 && Math.abs(m.scale - 1) <= .02) return "good";
  if (Math.hypot(m.dx, m.dy) <= 12 && Math.abs(m.scale - 1) <= .08) return "small";
  return "wrong";
}
