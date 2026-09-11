import { PNG } from "pngjs";
import { createHash, randomUUID } from "node:crypto";
import type { Demonstration } from "@game-bots/game-sdk";
import { newMemory, type Transition } from "../src/local/memory.js";
import { decodeGrid, features } from "../src/local/vision.js";
export const behavior = { id: "11111111-1111-4111-8111-111111111111", processName: "synthetic", cameraMode: "pointer" as const };
export function scene(kind = 0, targetX = 0, duplicate = false) {
  const png = new PNG({ width: 96, height: 72 });
  for (let y = 0; y < 72; y++) for (let x = 0; x < 96; x++) {
    let rgb = kind === 0 ? [30 + Math.floor(x / 12) * 9, 50 + Math.floor(y / 12) * 12, 70] : kind === 1 ? [70, 150 + Math.floor(y / 12) * 9, 40] : [210, 35, 170];
    for (const center of duplicate ? [targetX, 72] : [targetX]) if (center && Math.abs(x - center) <= 6 && Math.abs(y - 36) <= 6) rgb = ((x - center + 6) % 4 < 2) !== ((y - 30) % 4 < 2) ? [245, 30, 30] : [20, 220, 230];
    const i = (y * 96 + x) * 4; for (let c = 0; c < 3; c++) png.data[i + c] = rgb[c]!; png.data[i + 3] = 255;
  }
  return PNG.sync.write(png);
}
export const sha = (png: Uint8Array) => createHash("sha256").update(png).digest("hex");
export const state = (kind = 0) => features(decodeGrid(scene(kind)));
export function memoryFixture() {
  const m = newMemory(behavior), demoId = randomUUID();
  m.imports.push({ id: demoId, hash: "test", annotation: { behaviorId: behavior.id, demonstrationId: demoId, recovery: false } });
  const transition: Transition = { id: `${demoId}:0`, demoId, frameId: 0, before: state(), after: state(1), actions: [{ kind: "hold", keys: ["KeyW"], buttons: [], durationMs: 600 }], targetId: null, targetBefore: null, targetAfter: null, prior: "success", terminal: true, recovery: false, samples: 1, disabled: false };
  m.transitions.push(transition); return { m, transition };
}
export function demonstration(images = [scene(), scene(1)]): Demonstration {
  return { version: 1, id: randomUUID(), behaviorId: behavior.id, name: "synthetic", goal: "change panel", cameraMode: "pointer", createdAt: new Date().toISOString(), endedAt: new Date().toISOString(),
    target: { handle: "1", pid: 1, processStartedAt: "1", processName: behavior.processName, title: "synthetic", dpi: 96, bounds: { x: 0, y: 0, width: 96, height: 72 } }, outcome: "success", outcomeNote: "synthetic label", captureReason: "test", warnings: [],
    frames: images.map((png, i) => ({ id: i, atMs: i * 800, capturedAt: new Date().toISOString(), eventCount: i * 2, geometry: "same", sha256: sha(png), file: `frames/${i}.png`, heldKeys: [], heldButtons: [] })),
    events: [{ atMs: 0, action: { kind: "key-down", key: "KeyW" } }, { atMs: 750, action: { kind: "key-up", key: "KeyW" } }] };
}
