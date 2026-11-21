import legacy from './legacy-optional-music.json' with {type:'json'};
import monstercat from './monstercat-music.json' with {type:'json'};
import actionCues from './music-action-cues.json' with {type:'json'};

// The two original kits already have a CDN release; only their action cue is new.
// Other kits can be served in full by the game gateway until a CDN release includes them.
export function musicReleaseClips(baseKits={}) {
  const kits = {...baseKits, ...legacy, ...monstercat};
  return Object.entries(actionCues).flatMap(([id,startAction])=>
    Object.values({...kits[id]?.cues,startAction}));
}

export function packagedMusicAssets() {
  return musicReleaseClips().map(({file,bytes,sha256})=>({
    id:file.split('/')[0],path:'assets/audio/music/optional/'+file,bytes,sha256,
  }));
}
