// Bounded Local Learned run against the existing selected application; no cloud/model calls.
import { readFile, writeFile, mkdir, cp } from 'node:fs/promises';
import { setTimeout as wait } from 'node:timers/promises';
import { WindowsDesktopSession } from '../packages/environment-windows/dist/index.js';
const label = process.argv[2] ?? 'baseline';
if (!/^[a-z0-9-]+$/.test(label)) throw Error('Invalid attempt label');
const base = 'http://127.0.0.1:5178/api/desktop/';
const api = async (route, body) => { const r = await fetch(base + route, body ? { method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body) } : {}); const result = await r.json(); if (!r.ok) throw Error(JSON.stringify(result)); return result; };
const out = `artifacts/roblox-validation-2026-09-12/${label}`; await mkdir(out, { recursive: true });
await cp('data/desktop-local/3469c15f-a55c-48a1-8231-e7eb51aba611.json', `${out}/starting-memory.json`);
const target = (await api('windows')).windows.find(w => w.processName === 'RobloxPlayerBeta'); if (!target) throw Error('Live Roblox target unavailable');
// Separate read-only preflight lets the operator inspect social/payment UI before any input.
if (!process.argv.includes('--run')) {
 const s = new WindowsDesktopSession();
 try { await s.bind(target,10000); await s.focus(); const o=await s.observe(); await writeFile(`${out}/preflight.png`,o.png); await writeFile(`${out}/preflight.json`,JSON.stringify({target,at:Date.now(),geometry:o.geometry},null,2)); }
 finally { await s.close(); }
 console.log(`Inspect ${out}/preflight.png for the starting condition and prohibited UI, then run this label with --run within 60 seconds.`);
 process.exit(0);
}
const preflight=JSON.parse(await readFile(`${out}/preflight.json`,'utf8'));
if (Date.now()-preflight.at>60000 || Date.now()<preflight.at || JSON.stringify(preflight.target)!==JSON.stringify(target)) throw Error('Preflight is stale or live target changed; inspect a new preflight screenshot');
const request = { target, startMethod:'button', profile:{ version:1,name:'collect egg',mode:'local',learnedBehaviorId:'3469c15f-a55c-48a1-8231-e7eb51aba611',actions:[{kind:'wait',durationMs:100}],startDelayMs:0,intervalMs:500,maxDurationMs:30000,maxActions:35,localOptions:{finishOnSuccess:false,maxActionMs:600,minConfidence:.62,maxNoProgress:6,maxRecoveries:2} } };
const start = await api('start', request); await writeFile(`${out}/request.json`,JSON.stringify(request,null,2));
const states=[];
let endingReason;
try {
 for(let i=0;i<65;i++) { await wait(450); const {run} = await api('state'); states.push(run); if(run.status==='paused'||run.endedAt) { endingReason=run.reason; break; } }
} finally { await api('stop',{}); }
let run;
for(let i=0;i<30;i++) { ({run}=await api('state')); if(run.report) break; await wait(150); }
await writeFile(`${out}/telemetry.json`,JSON.stringify(states,null,2));
await writeFile(`${out}/final.json`,JSON.stringify(run,null,2));
await writeFile(`${out}/ending.json`,JSON.stringify({ reason: endingReason ?? 'Probe time budget', actions: run.actionCount, learner: run.intelligence },null,2));
if (run.report) { const dir=run.report.relativePath.split('/')[0]; await cp(`artifacts/${dir}`,`${out}/run`,{recursive:true}); }
console.log(JSON.stringify({label,runId:run.runId,status:run.status,actions:run.actionCount,reason:run.reason,history:run.history,intelligence:run.intelligence,report:run.report},null,2));
