// Bounded real Windows input on the owned fixture. This is synthetic replay, never a human demonstration.
import { spawn } from 'node:child_process';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { setTimeout as wait } from 'node:timers/promises';
import assert from 'node:assert/strict';
import { WindowsDesktopSession } from '../packages/environment-windows/dist/index.js';
const out = `artifacts/macro-native-${Date.now()}`;
await mkdir(out, { recursive: true });
const fixture = spawn('packages/environment-windows/bin/DesktopFixture.exe', [`${out}/fixture.log`], { stdio: 'pipe', windowsHide: false });
const signal = new AbortController().signal;
let session;
const results = [];
const command = async value => { fixture.stdin.write(value + '\n'); await wait(150); };
async function connect() {
  session = new WindowsDesktopSession();
  const target = (await session.listWindows()).find(w => w.pid === fixture.pid); assert.ok(target);
  await session.bind(target, 30000, 6000); await command('activate'); await session.focus(); await wait(200); await session.resume();
  const observation = await session.observe();
  await session.execute({ kind: 'move', point: { x: .5, y: .5 } }, observation.geometry, signal);
  return observation;
}
async function released() {
  const state = await session.health(); assert.deepEqual(state.heldKeys, []); assert.deepEqual(state.heldButtons, []);
  await command('state'); assert.match((await readFile(`${out}/fixture.log`, 'utf8')).trim().split(/\r?\n/).filter(line => line.startsWith('physical ')).at(-1), /W=False Left=False Right=False/);
}
try {
  await wait(1000);
  let obs = await connect(); await writeFile(`${out}/before.png`, obs.png);
  const small = await session.observeMacro(); assert.equal(small.png.readUInt32BE(16), 320); assert.equal(small.png.readUInt32BE(20), 240);
  const events = [{ atMs: 0, action: { kind: 'key-down', key: 'KeyW' } }, { atMs: .125, action: { kind: 'button-down', button: 'right' } }];
  for (let i = 0; i < 400; i++) events.push({ atMs: 10.25 + i * 2, action: { kind: 'relative-move', dx: i % 2 ? -1 : 1, dy: 0 } });
  events.splice(103, 0, { atMs: 210.5, action: { kind: 'key-down', key: 'KeyD' } });
  events.push({ atMs: 810.5, action: { kind: 'key-up', key: 'KeyD' } }, { atMs: 811, action: { kind: 'button-up', button: 'right' } }, { atMs: 812.75, action: { kind: 'key-up', key: 'KeyW' } }, { atMs: 813, action: { kind: 'release-all' } });
  events.sort((a, b) => a.atMs - b.atMs);
  const replay = session.executeTimeline(events, obs.geometry, signal);
  await wait(100); await command('state');
  assert.match((await readFile(`${out}/fixture.log`, 'utf8')).split(/\r?\n/).filter(line => line.startsWith('physical ')).at(-1), /W=True Left=False Right=True/);
  const report = await replay;
  assert.equal(report.error, null, JSON.stringify(report)); assert.equal(report.completed, events.length);
  assert.ok(report.maxLatenessMs < 100); assert.equal(report.samples.length, events.length);
  assert.deepEqual(report.samples.map(s => s.recordedMs), events.map(e => e.atMs));
  for (let i = 1; i < report.samples.length; i++) assert.ok(Math.abs((report.samples[i].scheduledMs - report.samples[0].scheduledMs) - events[i].atMs) < .001);
  await released(); await writeFile(`${out}/after.png`, (await session.observe()).png);
  results.push({ test: '407-edge overlapping timeline at 500 mouse packets/second', ...report });
  const holding = [{ atMs: 0, action: { kind: 'key-down', key: 'KeyW' } }, { atMs: .1, action: { kind: 'button-down', button: 'right' } }, { atMs: 2500, action: { kind: 'release-all' } }];
  const cancel = new AbortController(); const pending = session.executeTimeline(holding, obs.geometry, cancel.signal); await wait(150); cancel.abort();
  const cancelled = await pending; assert.equal(cancelled.completed, 2); assert.match(cancelled.error, /cancel/i); await released(); results.push({ test: 'cancellation', ...cancelled });
  const paused = session.executeTimeline(holding, obs.geometry, signal); await wait(150); await session.pause();
  const pausedReport = await paused; assert.equal(pausedReport.completed, 2); await released(); await session.resume(); results.push({ test: 'pause', ...pausedReport });
  const moved = session.executeTimeline(holding, obs.geometry, signal); await wait(150); await command('move-window');
  const geometry = await moved; assert.match(geometry.error, /geometry/i); await released(); results.push({ test: 'geometry loss', ...geometry });
  await session.resume(); obs = await session.observe();
  const emergency = session.executeTimeline(holding, obs.geometry, signal); await wait(150); await command('emergency');
  const stopped = await emergency; assert.match(stopped.error, /F8/); await released(); results.push({ test: 'F8', ...stopped });
  await session.close(); session = undefined;
  // Real screenshot capture lifecycle, with software input still excluded from human recording.
  session = new WindowsDesktopSession(); const target = (await session.listWindows()).find(w => w.pid === fixture.pid);
  await session.configureHotkeys({ record: 'F6', bot: 'F7', stopRecording: 'F9' });
  await session.recordingCommand('prepare', { target, delayMs: 0, maxDurationMs: 3000, macroVisual: true, pointerMode: 'auto' });
  await session.recordingCommand('start'); await wait(1600);
  const state = await session.recordingCommand('stop'); const frames = await session.recordingFrames();
  assert.equal(state.captureStarted, true); assert.ok(frames.length >= 2); assert.equal(frames[0].atMs, 0);
  assert.equal(frames.at(-1).atMs, state.events.at(-1).atMs); assert.equal(frames.at(-1).heldKeys.length, 0);
  for (let i = 0; i < frames.length; i++) await writeFile(`${out}/recording-${i}.png`, frames[i].png);
  results.push({ test: 'Macro screenshot and raw registration lifecycle', state, frames: frames.map(({ png, ...f }) => ({ ...f, bytes: png.length })) });
  await writeFile(`${out}/results.json`, JSON.stringify({ results, realGame: 'Roblox window unavailable. No human capture or game outcome claim.' }, null, 2));
  console.log(JSON.stringify({ out, events: report.completed, maxLatenessMs: report.maxLatenessMs, meanLatenessMs: report.meanLatenessMs, finalLatenessMs: report.samples.at(-1).latenessMs, checks: results.map(r => r.test) }, null, 2));
} finally { await session?.close(); fixture.stdin.write('close\n'); fixture.stdin.end(); }
