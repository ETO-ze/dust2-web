# Original CS2 weapon loadout assets

These tools read the locally installed Counter-Strike 2 VPK. They do not change the
Steam installation. Valve and the original workshop creators retain their rights.
Generated game assets are intentionally excluded from Git; the runtime asset lock
provides the downloadable, hash-verified release files.

Run from the repository root with the Source2Viewer CLI available in
`tools/source2viewer/Source2Viewer-CLI.exe`:

```powershell
node scripts/weapon-assets/index-paintkits.mjs
node scripts/weapon-assets/export.mjs --models --animations
node scripts/weapon-assets/extract-finishes.mjs
python scripts/weapon-assets/prepare-position.py
node scripts/weapon-assets/bake-finishes.mjs
node scripts/weapon-assets/export-utility.mjs
node scripts/weapon-assets/pack-utility.mjs
python scripts/weapon-assets/pack-animations.py
node scripts/weapon-assets/export-audio.mjs
python scripts/weapon-assets/validate-assets.py
node scripts/weapon-assets/verify-packed-texture.mjs
```

`CS2_GAME_DIR` may override the installed game directory. Exports use an exclusive
`artifacts/s2v-export.lock`; only one Source2Viewer process runs at a time. Each
export process sends temporary files to the H-drive artifact directory without
changing operating-system environment variables.

`default-skins.json` records all 24 chosen finishes. Every selected paintkit has an
official minimum wear below 0.07. Galil Chatterbox is deliberately replaced by
Sugar Rush because Chatterbox begins at 0.35 and has no Factory New variant.

The GLBs retain original geometry, skin joints, weapon-specific animation tracks,
correct legacy/HD UV bodies, original paint patterns and inventory previews.
NoPaint is read from the source composite A channel (or the dedicated HD input).
Packed textures resize RGB and A independently, after materializing raw channels.
An image library's normal transparency premultiplication would otherwise erase
valid AO beneath a zero wear mask and turn worn edges into bright false scratches.
The pristine bake thresholds the wear/no-paint mask and honours Custom Paint Job
alpha below 128 as increased durability, while retaining deliberate paint masking.
See [Valve's finish guide](https://www.counter-strike.net/workshop/workshopfinishes).
No additional scratch or dirt layer is generated. The selected appearance is the
pristine endpoint of a browser PBR approximation; it does not reproduce Valve's
entire Source 2 composite shader, seed numbering, wear simulation, or exact
pearlescence. Glock Fade uses the original float object-position map and palette
to keep the gradient continuous across the separate slide UV islands.

Base models and textures for HE, flashbang and smoke grenades are also original
CS2 assets. Their draw, idle, inspect, pin pull and both throw animations are in
the combined viewmodel bundle. Dual Berettas retain separate left/right weapon
joints and firing clips. SSG 08 Dragonfire uses its matching legacy animation set.

Audio is read from the original weapon sound event definitions, exported with
Source2Viewer and converted to MP3 at 44.1 kHz with a -3 dB gain. The exporter
merges new banks into the existing manifest and preserves earlier feedback audio.
