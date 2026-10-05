import {MAP} from './map-data.js';

/** Bootstrap only: a process/tab owns exactly one fixed map. Existing imports
 * retain the MAP object reference; production never calls this function. */
export function configurePrivateMap(meta,nav,{mapSignature,physicsSha256,sourceSha256}={}) {
 if(!['de_dust2','de_mirage','de_inferno'].includes(meta?.id)||!Array.isArray(nav)||!meta.spawns?.T?.length||!meta.spawns?.CT?.length||!meta.sites?.A||!meta.sites?.B)throw Error('Invalid private map context');
 if(!/^[a-f0-9]{64}$/.test(mapSignature||'')||!physicsSha256||meta.sourceSha256!==sourceSha256)throw Error('Private map identity is not verified');
 if(MAP.private&&MAP.mapSignature!==mapSignature)throw Error('A running private process cannot change maps');
 const bounds={...meta.bounds};for(const axis of ['x','y','z']){if(!Number.isFinite(bounds.min?.[axis])||!Number.isFinite(bounds.max?.[axis]))throw Error('Invalid map bounds');bounds['min'+axis.toUpperCase()]=bounds.min[axis];bounds['max'+axis.toUpperCase()]=bounds.max[axis];}
 // Erase Dust II-only labels, coordinates and overview from the shared object.
 for(const key of Object.keys(MAP))delete MAP[key];
 Object.assign(MAP,meta,{private:true,mapSignature,physicsSha256,bounds,metersPerSourceUnit:.0254,nav:nav.filter(n=>n.hull===0||n.hull===undefined),labels:[],geometryUrl:null,collisionUrl:null,overview:null});
 return MAP;
}
