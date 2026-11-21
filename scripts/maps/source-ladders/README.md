# Restoring original ladder meshes

The `1.4.0-perf.6.1` map pool retains the original NAV ladder spans. Its simplified render lost rungs on eleven Train assemblies, part of the second wooden ladder on Mirage and the upper rails on Vertigo. This build restores the selected components at the transforms of the original rendered meshes. The physics and navigation files stay in the base release.

Install the repository dependencies with `npm ci`. Use Blender 5.0.1, Node.js and Python 3.11 or newer. Binary reproduction of the distributed gzip streams was verified using Python 3.14.2 with zlib-ng 1.3.1.

The base must be the sealed nine-map directory from the pre-fix release. Supply the matching Source glTF exports with adjacent buffers and referenced textures. Train and Vertigo use the material-named exports. Mirage uses the original textured export. The selection manifest pins each export, its binary, the input render files and the gameplay map hash.

```sh
python scripts/maps/build-source-ladder-overlay.py \
  --base /path/to/base/maps-v1 --output /path/to/new/ladder-package \
  --blender /path/to/blender \
  --source de_train=/path/to/de_train/named/map.gltf \
  --source de_vertigo=/path/to/de_vertigo/named/map.gltf \
  --source de_mirage=/path/to/de_mirage/raw/map.gltf
```

Include only the `--source` options needed for a partial build. The builder validates each input, replaces only faces geometrically matching those original components, and appends one indexed render batch per map. Train's grated treads are simplified independently with an 8 mm error limit. The two simpler assemblies retain their original triangles.

Apply the files from `overlay/` to a copy of the base pool after verifying the original hashes in `overlay-files.json`. Replace only the matching map IDs in `catalog.json` with `catalog-replacements.json`. The per-map receipts identify every removed tile face and both final render hashes. Run `node scripts/maps/qa-ladders.mjs /path/to/updated/maps-v1` to exercise all 21 NAV spans, including both dismount directions.
