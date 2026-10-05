import test from 'node:test';
import assert from 'node:assert/strict';
import {MapTacticalGraph} from '../server/map-tactical-graph.js';
import {selectPrivateRoute,routeLength} from '../server/private-map-navigation.js';
const n=(id,x,z,neighbors)=>({id,x,y:0,z,hull:0,neighbors});
const graph=new MapTacticalGraph({sites:{}},[n(0,0,0,[1,2,3]),n(1,5,-3,[4]),n(2,5,0,[4]),n(3,5,3,[4]),n(4,10,0,[])],{standAllowed:()=>true,edgeAllowed:()=>true});

test('private routes vary by round while retaining validated links and bounded detours',()=>{
 const chosen=new Set();for(let round=0;round<6;round++){const c=selectPrivateRoute(graph,0,4,{round,seat:0,role:'rotator'});chosen.add(c.path[1].id);assert.ok(routeLength(c.path)<=14+6);for(let i=1;i<c.path.length;i++)assert.ok(c.path[i-1].neighbors.includes(c.path[i].id));}
 assert.ok(chosen.size>=2);
});
test('confirmed contact and teammate congestion influence choices without live enemy data',()=>{
 const clear=selectPrivateRoute(graph,0,4,{round:0,role:'rotator'});
 const danger=selectPrivateRoute(graph,0,4,{round:0,role:'rotator',reports:[{kind:'visual',confidence:1,point:{x:5,y:0,z:0}}],teammates:[{x:5,y:0,z:0,alive:true}]});
 assert.notDeepEqual(danger.path.map(n=>n.id),clear.path.map(n=>n.id));
 const dead=selectPrivateRoute(graph,0,4,{round:0,role:'rotator',teammates:[{x:5,y:0,z:0,alive:false}],reports:[{confidence:0,point:{x:5,y:0,z:0}}]});assert.deepEqual(dead.path,clear.path);
});
test('trade follows its validated squad lane; no route never falls back to direct movement',()=>{
 const preferred=[graph.nodes.get(0),graph.nodes.get(3),graph.nodes.get(4)];assert.equal(selectPrivateRoute(graph,0,4,{role:'trade',preferred}).path,preferred);
 const blocked=new MapTacticalGraph({sites:{}},[...graph.nodes.values()],{standAllowed:()=>true,edgeAllowed:()=>false});assert.equal(selectPrivateRoute(blocked,0,4).path,null);
});
