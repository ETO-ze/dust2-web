/** Run one map per process. No imports of GameRoom/index before MAP bootstrap. */
import {loadPrivateMapRuntime} from './private-map-runtime.js';
const directory=process.env.DUSTII_PRIVATE_MAP_DIRECTORY;
if(!directory)throw Error('DUSTII_PRIVATE_MAP_DIRECTORY is required');
const privateMap=loadPrivateMapRuntime(directory,{id:process.env.DUSTII_PRIVATE_MAP_ID,libraryUrl:process.env.DUSTII_PRIVATE_LIBRARY_URL||''});
const {startGameServer}=await import('./index.js');
const service=await startGameServer({port:Number(process.env.PORT||3012),host:process.env.HOST||'127.0.0.1',privateMap,indexFile:'private.html'});
console.log(JSON.stringify({service:'dust2-private-game',mapId:privateMap.mapId,mapSignature:privateMap.mapSignature,port:service.port,rssMiB:Math.round(process.memoryUsage().rss/1048576),maxRooms:1}));
for(const signal of ['SIGTERM','SIGINT'])process.once(signal,async()=>{await service.close();process.exit(0);});
