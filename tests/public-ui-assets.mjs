import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {assetDownloadURL,getDownloadOrigin,initDownloadOrigin} from '../client/download-origin.js';

const source=(await readFile(new URL('../client/image-asset-url.js',import.meta.url),'utf8')).replace(/^import[^\n]+\n/gm,'').replace(/export /g,'');
const delivery={schemaVersion:1,assetBaseURL:'https://downloads.test/releases/current/assets/',mapBaseURL:'https://downloads.test/releases/current/maps/',fallbackToGameServer:false};
await initDownloadOrigin({pageURL:'https://game.test/',fetcher:async()=>Response.json(delivery)});

function fixture({page='https://game.test/play/de_mirage/',bundled=false,privateMap=null}={}){
 const reads=[],properties=new Map(),image=(dataset)=>({dataset,alt:'',removeAttribute(name){if(name==='src')delete this._src;},set src(value){this._src=value;reads.push(value);},get src(){return this._src;}});
 const shared=[image({gameSrc:'assets/ui-cs2/T.svg'}),image({gameSrc:'assets/weapons/cs2-loadout/previews/awp-dragon-lore.webp'})];
 const map=image({mapImage:'de_dust2',mapSrc:'assets/valve-dust2/de_dust2_radar_psd.png'});
 const document={baseURI:page,documentElement:{style:{setProperty:(key,value)=>properties.set(key,value)}},querySelectorAll:selector=>selector==='img[data-game-src]'?shared:selector==='img[data-map-image]'||selector==='.loading-tactical img,.map-emblem img'?[map]:[]};
 const context=vm.createContext({URL,JSON,document,bundled,assetDownloadURL,getDownloadOrigin,initDownloadOrigin});
 if(privateMap)context.__DUST2_PRIVATE_MAP__=privateMap;
 vm.runInContext(source+'\nglobalThis.api={imageAssetURL,hydrateHomeImages,initHomeImages,prepareHomeMapImages};',context);
 return {api:context.api,document,reads,properties,map,shared};
}

test('home hydration loads only common UI from CDN, including hidden art, and never assigns a map radar',async()=>{
 const f=fixture();await f.api.initHomeImages();
 assert.deepEqual(f.reads,['https://downloads.test/releases/current/assets/ui-cs2/T.svg','https://downloads.test/releases/current/assets/weapons/cs2-loadout/previews/awp-dragon-lore.webp']);
 assert.equal(f.map.src,undefined);assert.equal(f.properties.has('--loading-map-cover'),false);
});

test('starting Dust II assigns its CDN radar and cover; starting Mirage uses only its verified radar/cover',()=>{
 const dust=fixture({page:'https://game.test/play/de_dust2/'});dust.api.prepareHomeMapImages('de_dust2');
 assert.equal(dust.map.src,'https://downloads.test/releases/current/assets/valve-dust2/de_dust2_radar_psd.png');
 assert.equal(dust.properties.get('--loading-map-cover'),'url("https://downloads.test/releases/current/assets/valve-dust2/de_dust2_1_png.png")');
 const mirage=fixture({privateMap:{mapId:'de_mirage',renderUrl:'https://game.test/maps/de_mirage/render/map.gltf'}});
 mirage.api.prepareHomeMapImages('de_mirage');
 assert.equal(mirage.map.src,'https://game.test/radars/de_mirage.png');assert.equal(mirage.properties.get('--loading-map-cover'),'url("https://game.test/previews/de_mirage.png")');
 assert.equal(mirage.reads.some(url=>url.includes('valve-dust2')),false);
});

test('installed art remains local and map configuration, other origins and private radar routes stay unchanged',()=>{
 const installed=fixture({page:'https://game.test/__installed__/',bundled:true});installed.api.hydrateHomeImages();
 assert.deepEqual(installed.reads,['assets/ui-cs2/T.svg','assets/weapons/cs2-loadout/previews/awp-dragon-lore.webp']);
 const web=fixture();
 for(const url of ['private-map.json','ws','/radars/de_mirage.png','/previews/de_mirage.png','https://another.test/assets/ui-cs2/T.svg','blob:https://game.test/cached-preview'])assert.equal(web.api.imageAssetURL(url),url);
 assert.equal(web.api.imageAssetURL('assets/ui-cs2/headshot.svg'),'https://downloads.test/releases/current/assets/ui-cs2/headshot.svg');
});

test('the home HTML cannot eagerly fetch hidden original map art, and its loading background defaults to none',async()=>{
 const html=await readFile(new URL('../index.html',import.meta.url),'utf8'),css=await readFile(new URL('../client/home-menu.css',import.meta.url),'utf8');
 const images=[...html.matchAll(/<img\b[^>]*>/g)].map(match=>match[0]);
 assert.equal(images.filter(tag=>/(?:\s)src=["'](?:\.\/)?\/?assets\//.test(tag)).length,0);
 assert.equal(images.filter(tag=>/data-map-image="de_dust2"/.test(tag)).length,1);
 assert.match(css,/#loading-screen \.loading-image \{ background-image: var\(--loading-map-cover, none\); \}/);
});
