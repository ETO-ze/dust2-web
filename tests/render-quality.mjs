import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeClarity,renderPixelRatio} from '../shared/render-quality.js';
import {entryRenderQuality,flatMapSelected} from '../client/map-style.js';
import {preferences} from '../client/persistence.js';

test('mode entry overrides an older map style and render grade only for that map visit',()=>{
  const key='dust2.map-style.v1';
  const previous=preferences.getItem(key),previousMap=globalThis.__DUST2_PRIVATE_MAP__;
  try {
    preferences.setItem(key,'flat');
    globalThis.__DUST2_PRIVATE_MAP__={graphicsMode:'quality'};
    assert.equal(flatMapSelected(),false);
    assert.equal(entryRenderQuality('low'),'high');
    globalThis.__DUST2_PRIVATE_MAP__={flatOnly:true};
    assert.equal(flatMapSelected(),true);
    assert.equal(entryRenderQuality('high'),'low');
    delete globalThis.__DUST2_PRIVATE_MAP__;
    assert.equal(flatMapSelected(),true);
    assert.equal(entryRenderQuality('low'),'low');
  } finally {
    if(previousMap===undefined)delete globalThis.__DUST2_PRIVATE_MAP__;
    else globalThis.__DUST2_PRIVATE_MAP__=previousMap;
    if(previous===null)preferences.removeItem(key);
    else preferences.setItem(key,previous);
  }
});

test('mobile clear default quadruples drawing pixels without enabling shadows',()=>{
  const phone={width:844,height:390,dpr:3,mobile:true,quality:'low'};
  assert.equal(renderPixelRatio({...phone,clarity:'performance'}),1);
  assert.equal(renderPixelRatio(phone),2);
  assert.equal(renderPixelRatio({...phone,quality:'high'}),2);
  assert.equal(normalizeClarity('stale-value'),'clear');
});

test('mobile sharp and clear respect pixel budgets across rotation and large screens',()=>{
  for(const [width,height] of [[844,390],[390,844],[667,320],[1350,610],[2700,1220],[3840,2160]]){
    for(const [clarity,budget] of [['performance',921600],['clear',1600000],['sharp',2400000]]){
      const ratio=renderPixelRatio({width,height,dpr:3,mobile:true,clarity});
      assert.ok(Math.floor(width*ratio)*Math.floor(height*ratio)<=budget);
      assert.ok(ratio>0&&ratio<=3);
      assert.equal(ratio,renderPixelRatio({width:height,height:width,dpr:3,mobile:true,clarity}));
    }
  }
  assert.equal(renderPixelRatio({width:844,height:390,dpr:1,mobile:true,clarity:'sharp'}),1);
});

test('desktop keeps its existing pixel budget independently of phone clarity',()=>{
  for(const clarity of ['clear','sharp','performance']){
    assert.equal(renderPixelRatio({width:1280,height:720,dpr:2,clarity}),1);
    assert.equal(renderPixelRatio({width:1280,height:720,dpr:2,quality:'high',clarity}),1.5);
  }
});

test('flat preset renders the destination pixels independently of camera aspect and never exceeds device limits',async()=>{
  const {flatDrawingBuffer,normalizeFlatScale}=await import('../shared/render-quality.js');
  const stretch={width:1440,height:1080,displayWidth:1920,displayHeight:1080};
  assert.deepEqual(flatDrawingBuffer(stretch),{width:1920,height:1080,ratio:1});
  assert.equal(flatDrawingBuffer(stretch,{scale:.75}).ratio,.75);
  assert.equal(flatDrawingBuffer(stretch,{scale:1.5}).ratio,1.5);
  const mobile={displayWidth:870,displayHeight:390},base=flatDrawingBuffer(mobile,{dpr:3,mobile:true});
  assert.ok(base.ratio>2 && base.width*base.height*base.ratio**2<=2600000.001);
  const sharp=flatDrawingBuffer(mobile,{dpr:3,mobile:true,scale:1.5});
  assert.ok(sharp.ratio>base.ratio && sharp.width*sharp.height*sharp.ratio**2<=3400000.001);
  assert.equal(normalizeFlatScale('stale'),1);
  assert.equal(flatDrawingBuffer(stretch,{maxDimension:960}).ratio,.5);
});
