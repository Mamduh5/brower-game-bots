import { WindowsDesktopSession } from '../packages/environment-windows/dist/index.js';
import { mkdir, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { setTimeout as wait } from 'node:timers/promises';
const label=process.argv[2] ?? 'controls', kind=process.argv[3] ?? 'move';
if(!/^[a-z0-9-]+$/.test(label)) throw Error('Invalid label');
const out=`artifacts/roblox-validation-2026-09-12/${label}`; await mkdir(out,{recursive:true});
const s=new WindowsDesktopSession(), results=[];
try {
 const target=(await s.listWindows()).find(w=>w.processName==='RobloxPlayerBeta'); if(!target) throw Error('Current target unavailable');
 await s.bind(target,15000); await s.focus(); await wait(250); await s.resume();
 let o=await s.observe(); await writeFile(`${out}/before.png`,o.png);
 if(kind==='emergency') {
   await s.execute({kind:'key-down',key:'KeyW'},o.geometry,new AbortController().signal);
   await new Promise((resolve,reject)=>{const p=spawn('powershell.exe',['-NoProfile','-File','scripts/desktop-test-input.ps1','-TargetHandle',target.handle,'-Keys','F8','-HoldMs','150'],{windowsHide:true,stdio:'pipe'});p.on('exit',c=>c?reject(Error('F8 input failed')):resolve());});
   await wait(200); const health=await s.health(); await writeFile(`${out}/results.json`,JSON.stringify({target,health},null,2));
   if(health.armed||health.heldKeys.length||health.heldButtons.length||!/F8/.test(health.reason)) throw Error('F8 cleanup failed');
   console.log(JSON.stringify(health));
 } else {
 const actions=kind==='camera' ? [{kind:'move',point:{x:.5,y:.5}},{kind:'button-down',button:'right'},{kind:'relative-move',dx:60,dy:0},{kind:'wait',durationMs:150},{kind:'release-all'}]
 : kind==='interact' ? [{kind:'hold',keys:['KeyE'],buttons:[],durationMs:600}]
 : kind==='left' ? [{kind:'click',button:'left',point:{x:.5,y:.5},durationMs:50}]
 : [{kind:'hold',keys:['KeyW'],buttons:[],durationMs:600},{kind:'hold',keys:['KeyW','KeyA'],buttons:[],durationMs:250},{kind:'hold',keys:['KeyD'],buttons:[],durationMs:250}];
 for(const [i,a] of actions.entries()){await s.execute(a,o.geometry,new AbortController().signal); await wait(250); o=await s.observe(); await writeFile(`${out}/${i}.png`,o.png); results.push({action:a,health:await s.health(),sha256:o.sha256});}
 await s.releaseAll(); await writeFile(`${out}/results.json`,JSON.stringify({target,results,finalHealth:await s.health()},null,2)); console.log(JSON.stringify(results));
 }
} finally {await s.close();}
