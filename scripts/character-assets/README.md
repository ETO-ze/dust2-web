# Original CS2 agents and default gloves

The source is the user's local CS2 installation, read only. Runtime GLBs live in
`public/assets/characters-cs2/` and `public/assets/viewmodel/arms.glb`; the existing
asset mirror distributes these separately from Git.

- `items_game.txt` maps map-based defaults to CT `ctm_sas` and T `tm_phoenix`.
- Only `thirdperson_body` and `thirdperson_default_gloves` meshes are retained.
  First-person variants, skeleton placeholder meshes and 2,062 unrelated source
  animation clips are removed. World animations are a separate 33-clip bundle.
- Source coordinates are metres, forward **+Z**. The game turns the actor model
  by `Math.PI` to face its **-Z** movement frame. Native crouch clips replace
  vertical model squashing. Death uses `shared/death_chest_a.vnmclip_c`.
- First-person gloves are the actual `glove_sporty` viewmodel mesh, paintkit
  **10038 / sporty_green / Sport Gloves | Hedge Maze**. The source eight-colour
  palette, indexed colour mask, textile mask, Icarus pattern, normal map and
  surface/AO texture are baked into a compact glTF PBR material.
- Factory New uses float **0.060**, inherited from the source paint-kit defaults
  (`wear_remap_min=0.060`, `wear_remap_max=0.800`). At the minimum float this bake
  adds no damage, bleaching or grunge. This PBR approximation does not execute
  Source 2's proprietary glove compositor or claim pixel-identical wear.
- The original `weapon_arms` skeleton, including `wpn`, hands and fingers, remains
  intact. Four glove upper-arm twist bones are added under their corresponding
  animated upper-arm joints using their original local bind transforms.

Steam confirms the requested exterior and official product description:
[Sport Gloves | Hedge Maze (Factory New)](https://steamcommunity.com/market/listings/730/%E2%98%85%20Sport%20Gloves%20%7C%20Hedge%20Maze%20%28Factory%20New%29).

## Rebuild

Prerequisites: Python with Pillow, NumPy and ijson; Node; Source 2 Viewer CLI at
`tools/source2viewer/Source2Viewer-CLI.exe`. Set `CS2_GAME_DIR` for a non-default
installation. Use a single Source 2 Viewer export process; scripts coordinate via
`artifacts/s2v-export.lock`. Process-local temporary files stay on the workspace
drive, under `artifacts/export-temp`.

```text
node scripts/character-assets/export.mjs
python scripts/character-assets/pack.py
node scripts/character-assets/export-gloves.mjs
python scripts/character-assets/pack-gloves.py
node scripts/character-assets/verify.mjs
```

The model packer streams accessor tables from the large raw exports. Do not load
those raw gigabyte exports into the browser or copy them into public assets.

`client/player-assets.js` loads both models and filters clips to the bones each
agent actually owns. `choosePlayerAnimation()` selects native movement clips.

## Optional agents

Two original agents are exported separately for selection and on-demand loading:

- CT `ct-ava`: Special Agent Ava | FBI, item 5308,
  `agents/models/ctm_fbi/ctm_fbi_variantb.vmdl_c`.
- T `t-miami`: Sir Bloody Miami Darryl | The Professionals, item 4726,
  `agents/models/tm_professional/tm_professional_varf.vmdl_c`.

The item IDs, model mappings and names are verified against the installed
`items_game.txt` and English localization. They reuse the same 33 world animation
clips. All four agents have original inventory-image previews, not rendered or
invented replacements. Default SAS and Phoenix remain the starting selection.

```text
node scripts/character-assets/export-optional.mjs
python scripts/character-assets/pack-optional.py
node scripts/character-assets/verify.mjs
```

`public/assets/characters-cs2/optional-manifest.json` records the exact model and
preview paths, sizes and SHA-256 values for the client asset catalog. Optional
models stay under `characters-cs2/optional/` and share no extra animation bundle.
