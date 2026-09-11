import { readFile } from 'node:fs/promises';
import { decodeGrid, features, similarity } from '../packages/agent-player/dist/local/vision.js';
import { frameSkill } from '../packages/agent-player/dist/local/training.js';
const id=process.argv[2], image=process.argv[3];
if(!/^[a-f0-9-]{36}$/.test(id)) throw Error('Demonstration ID required');
const dir=`artifacts/desktop-teach-${id}`, demo=JSON.parse(await readFile(`${dir}/demonstration.json`,'utf8'));
const live=decodeGrid(await readFile(image));
for(const region of [{x:0,y:0,width:1,height:1},{x:.12,y:.2,width:.76,height:.58}]) {
 const state=features(live,region), frames=[];
 for(let i=0;i<demo.frames.length;i++) { const f=demo.frames[i]; frames.push({frame:f.id,similarity:similarity(state,features(decodeGrid(await readFile(`${dir}/${f.file}`)),region)),skill:i<demo.frames.length-1?frameSkill(demo,i):null,events:demo.events.slice(f.eventCount,demo.frames[i+1]?.eventCount).map(e=>e.action)}); }
 frames.sort((a,b)=>b.similarity-a.similarity); console.log(JSON.stringify({region,nearest:frames.slice(0,6)},null,2));
}
