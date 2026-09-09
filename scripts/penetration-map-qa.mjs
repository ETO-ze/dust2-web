import fs from 'node:fs';
import {Vector3} from 'three';
import {initPhysics,raycastWorldSurfaces} from '../shared/physics.js';
import {traceBullet} from '../server/bullet-penetration.js';
import {getWeapon} from '../shared/weapons.js';
const raw=fs.readFileSync('public/assets/map/positions.f32'),positions=new Float32Array(raw.buffer,raw.byteOffset,raw.length/4),materials=fs.readFileSync('public/assets/map/penetration-materials.u8');initPhysics(positions,materials);
const samples={wood:[],metal:[],concrete:[]},a=new Vector3(),b=new Vector3(),c=new Vector3();
for(let i=0;i<materials.length;i+=3){
 const type=['concrete','wood','metal'][materials[i]];if(!type||samples[type].length>=6)continue;
 a.fromArray(positions,i*9);b.fromArray(positions,i*9+3);c.fromArray(positions,i*9+6);
 const normal=b.clone().sub(a).cross(c.clone().sub(a)).normalize();if(Math.abs(normal.y)>.4)continue;
 const center=a.clone().add(b).add(c).multiplyScalar(1/3),origin=center.clone().addScaledVector(normal,.6),direction=normal.clone().negate(),crossings=raycastWorldSurfaces(origin,direction,8);
 if(!crossings.length||Math.abs(crossings[0].distance-.6)>.02||crossings[0].material!==materials[i])continue;
 const result=traceBullet({origin,direction,weapon:getWeapon('awp'),shooter:{id:'qa',team:'CT'},players:[],now:0,rayHitPlayer:()=>null});
 const passed=result.segments.length>0;if(type==='concrete'?passed:!passed)continue;
 samples[type].push({triangle:i,origin:origin.toArray(),direction:direction.toArray(),first:crossings.slice(0,2),penetrations:result.penetrations,end:result.end});
 if(Object.values(samples).every(s=>s.length>=6))break;
}
const passed=Object.values(samples).every(s=>s.length>=3);fs.mkdirSync('artifacts/gameplay-qa',{recursive:true});fs.writeFileSync('artifacts/gameplay-qa/penetration-map.json',JSON.stringify({passed,samples},null,2));console.log(JSON.stringify({passed,counts:Object.fromEntries(Object.entries(samples).map(([k,v])=>[k,v.length]))}));if(!passed)process.exitCode=1;
