import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeClarity,renderPixelRatio} from '../shared/render-quality.js';

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
