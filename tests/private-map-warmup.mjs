import test from 'node:test';
import assert from 'node:assert/strict';
import {warmPrivateMap} from '../client/private-map-warmup.js';

function fixture(){
 const log=[],shared={isTexture:true},sky={isTexture:true},hidden={isTexture:true};let time=0;
 const root={background:sky,traverseVisible(fn){fn({material:[{visible:true,map:shared,normalMap:shared},{visible:false,map:hidden}]});}};
 const rotation={y:.4,clone(){return{y:this.y};},copy(value){this.y=value.y;return this;}};
 const renderer={autoClear:false,getContext:()=>({isContextLost:()=>false}),initTexture(texture){log.push(['texture',texture]);time+=15;},render(_scene,camera){log.push(['render',camera.rotation?.y]);time+=7;},clearDepth(){},info:{reset(){log.push(['reset']);}}};
 return {log,shared,hidden,rotation,args:{renderer,scene:root,camera:{rotation,updateMatrixWorld(){}},gunScene:{traverseVisible(fn){fn({material:{visible:true,map:shared}});}},gunCamera:{},yieldFrame:async()=>{log.push(['yield']);time++;},now:()=>time}};
}
test('private GPU warmup uploads shared textures once, yields, renders before returning and restores view',async()=>{
 const f=fixture(),result=await warmPrivateMap(f.args);
 assert.equal(result.textures,2);assert.equal(f.log.filter(e=>e[0]==='texture').length,2);
 assert(!f.log.some(e=>e[1]===f.hidden));assert.equal(f.log.filter(e=>e[0]==='render').length,8);
 assert(f.log.findIndex(e=>e[0]==='yield')<f.log.findIndex(e=>e[0]==='render'));
 assert(f.log.findLastIndex(e=>e[0]==='texture')<f.log.findIndex(e=>e[0]==='render'));
 assert.equal(f.rotation.y,.4);assert.equal(f.args.renderer.autoClear,false);assert.equal(f.log.at(-1)[0],'reset');
});
test('cancelled warmup never starts a first render',async()=>{
 const f=fixture(),abort=new AbortController();f.args.signal=abort.signal;f.args.yieldFrame=async()=>abort.abort();
 await assert.rejects(warmPrivateMap(f.args),{name:'AbortError'});assert(!f.log.some(e=>e[0]==='render'));
});
test('render failure restores camera and renderer; graphics loss fails before uploading',async()=>{
 const f=fixture();f.args.renderer.render=()=>{throw Error('upload failed');};
 await assert.rejects(warmPrivateMap(f.args),/upload failed/);assert.equal(f.rotation.y,.4);assert.equal(f.args.renderer.autoClear,false);
 const lost=fixture();lost.args.renderer.getContext=()=>({isContextLost:()=>true});
 await assert.rejects(warmPrivateMap(lost.args),/显卡/);assert.equal(lost.log.length,0);
});
