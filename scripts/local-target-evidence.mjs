// Read-only annotation comparisons on saved screenshots; never dispatches controls.
import { readFile, writeFile } from 'node:fs/promises';
import { decodeGrid, patchAt, searchTarget } from '../packages/agent-player/dist/local/vision.js';
const dir = 'artifacts/desktop-teach-b492ac52-d61a-49bc-a20c-892350e9feb4/frames';
const current = decodeGrid(await readFile('artifacts/roblox-validation-2026-09-12/continuation/current.png'));
const report = [];
for (const annotation of [
  { frameId: 15, point: { x: .4, y: .68 }, size: .06 },
  { frameId: 14, point: { x: .4, y: .69 }, size: .05 },
  { frameId: 9, point: { x: .456, y: .385 }, size: .05 },
]) {
  const patch = patchAt(decodeGrid(await readFile(`${dir}/${annotation.frameId}.png`)), annotation.point.x, annotation.point.y, annotation.size, annotation.size);
  const frames = [];
  if (patch) for (const id of [7, 8, 9, 10, 13, 14, 15, 16]) frames.push({ id, ...searchTarget(decodeGrid(await readFile(`${dir}/${id}.png`)), patch) });
  report.push({ annotation, frames, current: patch ? searchTarget(current, patch) : null });
}
await writeFile('artifacts/roblox-validation-2026-09-12/continuation/target-comparison.json', JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
