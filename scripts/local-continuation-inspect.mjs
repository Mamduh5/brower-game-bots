import { readFile, writeFile, mkdir, copyFile } from 'node:fs/promises';
import { WindowsDesktopSession } from '../packages/environment-windows/dist/index.js';
import { decodeGrid, searchTarget, features, similarity } from '../packages/agent-player/dist/local/vision.js';
import { frameSkill, importDemonstration } from '../packages/agent-player/dist/local/training.js';
import { newMemory } from '../packages/agent-player/dist/local/memory.js';
const out = 'artifacts/roblox-validation-2026-09-12/continuation';
await mkdir(out, { recursive: true });
const file = 'data/desktop-local/3469c15f-a55c-48a1-8231-e7eb51aba611.json';
const m = JSON.parse(JSON.parse(await readFile(file, 'utf8')).payload);
const dir = 'artifacts/desktop-teach-b492ac52-d61a-49bc-a20c-892350e9feb4';
const demo = JSON.parse(await readFile(`${dir}/demonstration.json`, 'utf8'));
if (process.argv[2] === 'capture') {
  const s = new WindowsDesktopSession();
  try {
    const target = (await s.listWindows()).find(w => w.processName === 'RobloxPlayerBeta');
    if (!target) throw Error('Live Roblox unavailable');
    await s.bind(target, 10000); await s.focus();
    const o = await s.observe(); await writeFile(`${out}/current.png`, o.png);
    console.log(JSON.stringify({ target, health: await s.health() }));
  } finally { await s.close(); }
} else {
  const rows = [];
  for (let i = 0; i < demo.frames.length; i++) {
    const f = demo.frames[i], g = decodeGrid(await readFile(`${dir}/${f.file}`));
    let rejection = null;
    const skill = i < demo.frames.length - 1 ? frameSkill(demo, i, reason => { rejection = reason; }) : null;
    rows.push({ frame: f.id, atMs: f.atMs, heldKeys: f.heldKeys, heldButtons: f.heldButtons, rejection,
      skill,
      matches: m.targets.map(t => ({ id: t.id, ...searchTarget(g, t) })),
      events: demo.events.slice(f.eventCount, demo.frames[i + 1]?.eventCount).map(e => e.action) });
  }
  const imports = [];
  for (const annotated of [false, true]) {
    const fresh = newMemory({ id: m.behaviorId, processName: m.processName, cameraMode: m.cameraMode });
    const annotation = { ...m.imports[0].annotation }; if (!annotated) delete annotation.target;
    imports.push({ annotated, result: await importDemonstration(fresh, demo, annotation, async id => readFile(`${dir}/${demo.frames.find(f => f.id === id).file}`)), states: fresh.transitions.length });
  }
  const report = { currentStates: m.transitions.length, imports: m.imports, totalTransitions: demo.frames.length - 1,
    usableSkills: rows.filter(r => r.skill).length, comparisons: imports, transitions: m.transitions.map(t => ({ frame: t.frameId, actions: t.actions, targetBefore: t.targetBefore, targetAfter: t.targetAfter })), rows };
  const label = process.argv[2] ?? 'analysis';
  if (!/^[a-z0-9-]+$/.test(label)) throw Error('Invalid analysis label');
  await writeFile(`${out}/${label}.json`, JSON.stringify(report, null, 2));
  if (label === 'analysis') await copyFile(file, `${out}/starting-memory.json`);
  console.log(JSON.stringify({ ...report, rows: rows.map(({ matches, events, ...r }) => r) }, null, 2));
}
