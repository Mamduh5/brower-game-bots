// Supervised real-window capture test. Software input is deliberately NOT recorded as human input.
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { setTimeout as wait } from 'node:timers/promises';
import { createHash } from 'node:crypto';
const out = 'artifacts/roblox-validation-2026-09-12';
const api = async (route, body) => { const r = await fetch(`http://127.0.0.1:5178/api/desktop/${route}`, body ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } : {}); const v = await r.json(); if (!r.ok) throw Error(JSON.stringify(v)); return v; };
const target = (await api('windows')).windows.find(w => w.processName === 'RobloxPlayerBeta'); assert.ok(target);
const input = (keys, ms) => new Promise((resolve, reject) => { const p = spawn('powershell.exe', ['-NoProfile', '-File', 'scripts/desktop-test-input.ps1', '-TargetHandle', target.handle, '-Keys', keys, '-HoldMs', String(ms)], { windowsHide: true, stdio: 'pipe' }); let output = ''; p.stdout.on('data', d => output += d); p.stderr.on('data', d => output += d); p.on('exit', c => c ? reject(Error(output)) : resolve(output)); });
const results = [];
try {
  for (let i = 0; i < 3; i++) {
    const start = await api('recording/start', { target, startMethod: 'delay', delayMs: 1500, maxDurationMs: 12000, teaching: { behaviorId: '3469c15f-a55c-48a1-8231-e7eb51aba611', name: 'collect egg', cameraMode: 'pointer' } });
    if (i === 0) await input('S', 1800);
    let state;
    for (let n = 0; n < 50; n++) { state = await api('recording/state'); if (state.recording.status === 'recording') break; await wait(150); }
    assert.equal(state.recording.status, 'recording', JSON.stringify(state));
    console.log(`Session ${i + 1} recording: physical input can now be captured`);
    await input(i === 1 ? 'AW' : 'W', 350); await wait(700);
    await input(i === 1 ? 'DS' : 'S', 350); await wait(900);
    await api('recording/stop', {});
    const id = start.teaching.demonstrationId, dir = `artifacts/desktop-teach-${id}`;
    const demo = JSON.parse(await readFile(`${dir}/demonstration.json`, 'utf8'));
    assert.ok(demo.frames.length >= 2);
    for (const f of demo.frames) {
      assert.equal(createHash('sha256').update(await readFile(`${dir}/${f.file}`)).digest('hex'), f.sha256);
      assert.ok(Date.parse(f.capturedAt) >= Date.parse(demo.createdAt) && Date.parse(f.capturedAt) <= Date.parse(demo.endedAt));
      assert.ok(f.atMs <= demo.events.at(-1).atMs + 150);
    }
    assert.ok((await api('teaching/behaviors')).behaviors.find(b => b.id === demo.behaviorId).examples.some(e => e.demonstrationId === id));
    results.push({ id, durationMs: Date.parse(demo.endedAt) - Date.parse(demo.createdAt), capturedMs: demo.events.at(-1).atMs, events: demo.events.length, gameplayEvents: demo.events.filter(e => e.action.kind !== 'release-all').length, frames: demo.frames.length, outcome: demo.outcome, warnings: demo.warnings });
    console.log(JSON.stringify(results.at(-1)));
  }
} finally { await api('recording/stop', {}); await writeFile(`${out}/recorder-results.json`, JSON.stringify({ target, method: 'Real screen capture and native OS input. Injected input is excluded from human recorder; gameplay event validation requires physical input.', results }, null, 2)); }
