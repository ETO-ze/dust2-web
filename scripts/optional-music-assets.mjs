import {musicReleaseClips} from '../shared/packaged-music-assets.js';

// This is the release inventory only. Players still fetch their selected cues on demand.
export function optionalMusicClips(manifest){
  return musicReleaseClips(manifest.kits);
}
