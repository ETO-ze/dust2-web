import test from 'node:test';
import assert from 'node:assert/strict';
import {createCloudflarePlan} from '../scripts/cdn/plan-cloudflare.mjs';

test('Cloudflare plan keeps game authority separate and staged public access disabled',()=>{
 const plan=createCloudflarePlan({releaseId:'20261004-cdn-01'});
 assert.equal(plan.mode,'plan-only');
 assert.deepEqual(plan.createBucket,{name:'dustii-downloads',locationHint:'apac',storageClass:'Standard'});
 assert.equal(plan.placement.guaranteedHongKong,false);
 assert.equal(plan.customDomain.enabled,false);
 assert.equal(plan.customDomain.zoneId,null);
 assert.equal(plan.proposedDownloadConfig.assetBaseURL,'https://downloads.duskrain.cn/releases/20261004-cdn-01/assets/');
 assert.equal(plan.proposedDownloadConfig.mapBaseURL,'https://downloads.duskrain.cn/releases/20261004-cdn-01/maps/');
 assert.equal(plan.proposedDownloadConfig.fallbackToGameServer,false);
 assert.equal(plan.rollout.replaceExistingRulesets,false);
 assert.equal(plan.rollout.automaticActivation,false);
 assert(!('socketURL' in plan.proposedDownloadConfig));
 assert.deepEqual(plan.cors.rules[0].allowed.methods,['GET','HEAD']);
 assert.equal(plan.objectHeaders.gzipContentEncoding,null);
 assert.match(plan.objectHeaders.cacheControl,/no-transform/);
});

test('plan rejects cross-host injection and unsafe identifiers before creating any output',()=>{
 for(const releaseId of ['../other','a/b','a%2fb','a b','a"',''])assert.throws(()=>createCloudflarePlan({releaseId}));
 for(const hostname of ['x" or true','https://downloads.duskrain.cn','a/b','user@a.com','a.com:443','-bad.com','a..com'])
  assert.throws(()=>createCloudflarePlan({releaseId:'r1',hostname}));
 for(const bucket of ['A-bucket','a/../b','ab','a.b','bucket-'])assert.throws(()=>createCloudflarePlan({releaseId:'r1',bucket}));
 for(const origin of ['*','https://cs2.duskrain.cn/','http://cs2.duskrain.cn','https://user@cs2.duskrain.cn','https://cs2.duskrain.cn/?token=x'])
  assert.throws(()=>createCloudflarePlan({releaseId:'r1',origins:[origin]}));
 assert.throws(()=>createCloudflarePlan({releaseId:'r1',zoneId:'wrong'}));
});
