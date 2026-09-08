# CS2 default skin assets

Extracted and baked on 2026-09-08 from the owner's installed Counter-Strike 2 files, read-only:

`E:\steam\steamapps\common\Counter-Strike Global Offensive\game\csgo\pak01_dir.vpk`

VPK directory SHA-256: `4cb1f01a132b3ff86af9d831e58ce5436a0a876639f16383588a647723f24e32`.

Geometry, textures and inventory images remain the property of Valve and their original workshop creators. These are source-derived assets for this personal web prototype; they are not CC0, a newly licensed asset pack, or an official Valve web game.

| Browser file | Actual paintkit | Source UV body |
| --- | --- | --- |
| `ak47-wild-lotus.glb` | 724 / `cu_ak_island_floral` | `body_legacy` |
| `m4a1-blue-phosphor.glb` | 1017 / `am_m4a1s_bluesmoke` | `body_hd` |
| `awp-gungnir.glb` | 756 / `gs_awp_gungnir` | `body_legacy` |
| `glock-emerald.glb` | 1119 / `am_emerald_marbleized_glock` | `body_legacy` |
| `usp-printstream.glb` | 1142 / `cu_usp_printstream` | `body_legacy` |
| `karambit-sapphire.glb` | 416 / `am_sapphire_marbleized` | `body_legacy` |

Paintkit IDs and legacy flags were checked against the installed `scripts/items/items_game.txt`. The real USP-S and Karambit model geometry was exported; neither is a renamed Glock/default knife.

## What is exact, and what is approximated

- The source weapon geometry, UVs, normals, mesh names, skin weights and original weapon bone hierarchy are preserved. Only the appropriate HD/legacy mesh is visible. Empty sticker-gap geometry is omitted; the AWP keeps its separate scope-glass primitive.
- Wild Lotus, Gungnir and Printstream use the actual full-color paintkit texture in the original UV space. Gungnir and Printstream include their original finish normal maps.
- Sapphire, Emerald and Blue Phosphor use the actual `smoke2`/`smoke` paintkit images as successive RGB layer masks, the four source paint colors, the source pattern scale/rotation and the weapon's paint-by-number masks. Inventory preview pictures are never applied to the 3D meshes.
- This is a local pristine (`wear = 0`) PBR bake. Pattern offsets are deterministically zero. They are not claimed to equal a particular CS2 inventory seed. The complete Source2 compositing shader, its wear/grunge randomization, finish color adjustments and exact patina/pearlescent response are not ported. Paint/no-paint blending and metallic-region conversion are approximations, and highlights/color intensity may differ from CS2 under browser lighting.
- Alpha is interpreted as finish data, not image transparency. For anodized regions the documented inverted 0–127 roughness range is mapped to glTF roughness. Printstream's original pearl mask feeds `KHR_materials_iridescence`; its thickness and strength are a browser approximation, not an exact conversion of `g_flPearlescentScale = 20`.
- Base color is embedded at 2048 pixels; ORM and normal maps are at most 1024 pixels. Original full-resolution extracted inputs remain under `output/cs2-skins/source/` and original skinned GLBs under `output/cs2-skins/{weapon}/{weapon}.glb` in the local workspace.

## Integration contract

Each GLB has one outer node named `normalization`. It applies a 180-degree Y rotation and a centering translation. Its children keep the original Source2Viewer scene roots, bone hierarchy and transforms unchanged. Source coordinates are metres, +Y up, +Z muzzle. Normalized coordinates are metres, +Y up, -Z muzzle.

`manifest.json` records the normalization matrix and its inverse, source bounds, normalized/source bone positions, mesh names, hashes and paint parameters. For original first-person animation, remove/reset only the `normalization` transform. Clone a skinned weapon with `SkeletonUtils.clone`; plain `Object3D.clone(true)` does not clone the skeleton correctly. Weapon animations are supplied separately by the real viewmodel asset package; these GLBs retain compatible named bones but contain no baked animation clips.

## Selection-card previews

`previews/{ak47,m4a1,awp,glock,usp,karambit}.webp` are 420-pixel-wide-or-smaller transparent images decoded from the game's own `panorama/images/econ/default_generated/*_light_png.vtex_c` inventory resources. Their exact original resource names and hashes are listed in the manifest. They are UI thumbnails only.

## Tools and references

- [Source2Viewer / ValveResourceFormat](https://github.com/ValveResourceFormat/ValveResourceFormat), official CLI version 20.0.6980. Local export used GLB, material export, adapted glTF textures and the animation-export path to retain bones/skin.
- [Source2Viewer format support](https://s2v.app/ValveResourceFormat/guides/format-support.html): composite materials can be dumped as KV3; executing the final paint compositor is not provided by this export workflow.
- [Valve CS2 Workshop Finishes guide](https://www.counter-strike.net/workshop/workshopfinishes): original-UV application, successive RGB layer opacities, paint-by-number regions, roughness-alpha range and original texture requirements.
- [Valve Custom Paint](https://www.counter-strike.net/workshop/wf_custompaint), [Anodized Multicolored](https://www.counter-strike.net/workshop/wf_anodizedmulticolored), [Gunsmith](https://www.counter-strike.net/workshop/wf_gunsmith).

Reproducible baker: `output/cs2-skins/bake-skins.mjs`. Every used source material/texture has a SHA-256 entry in `manifest.json`; final GLBs and previews also appear in `SHA256SUMS.txt`.

## Validation

The six GLBs were loaded and rendered independently with Three.js GLTFLoader and a RoomEnvironment PMREM at environment intensity 0.7. All six loaded without asset/JavaScript errors, produced finite metre-scale bounds centered within 3e-8 metres, retained their original skinning, and showed the corresponding source skin patterns. The AWP has two skinned draw primitives (body and scope glass); each other weapon has one. This validates browser asset loading and the preview, not equivalence to the complete CS2 renderer.

Local screenshot: `output/playwright/skin-atlas.png` (initial QA; superseded for the anodized finishes by the low-light checks below).

### Low-light follow-up and shader evidence

The final lighting check uses hemisphere 0.4, directional 1.2 and RoomEnvironment PMREM intensity 0.45. Evidence is retained as:

- `output/playwright/skin-lowlight-before.png`: initial low-light render.
- `output/playwright/skin-albedo-before.png`: unlit base-color diagnostic. The M4 is blue across its paintable body, with no large white panels.
- `output/playwright/skin-direct-only.png`: environment contribution disabled. The large pale reflections disappear.
- `output/playwright/skin-lowlight-corrected.png`: corrected anodized material under the same low-light setup.
- `output/playwright/skin-lowlight-angle.png`: same final materials and lighting, changed observation angle. The M4's pale reflected panels move and its blue body becomes darker. This is evidence of environment highlights, not a grey image painted on the mesh.

The installed `game/csgo_core/shaders_vulkan_dir.vpk` contains `shaders/vfx/csgo_customweapon_vulkan_50_{features,ps,vs}.vcs`. Source2Viewer decompiled these to `output/cs2-skins/shader/shaders/vfx/csgo_customweapon_vulkan_50.vfx` locally. Its actual parameter declarations establish:

- `g_tAmbientOcclusion` packs `TextureNoPaint1` into **A**, not B (decompiled line 428).
- `g_vColor0` through `g_vColor3` use `Expression(SrgbGammaToLinear(this))` (lines 675, 694, 711, 715).
- The Anodized Multicolored pattern is sampled as linear data (`SrgbRead(false)`, line 832).

The anodized baker now uses the verified A channel and mixes the original four colors in linear space before brightness and sRGB encoding. This reduces erroneous grey-substrate blending on the Glock. AK, AWP and USP files were left byte-identical during this focused correction; their complete durability-dependent paint compositor remains the documented approximation. No global weapon tint, emissive boost, or material metalness reduction was introduced to conceal the reflections.
