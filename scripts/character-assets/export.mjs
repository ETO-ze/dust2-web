import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { readVpkIndex } from '../../tools/vpk-index.mjs';

const root = path.resolve(import.meta.dirname, '../..');
const stage = path.join(root, 'artifacts/characters-cs2');
const game = process.env.CS2_GAME_DIR || 'E:/steam/steamapps/common/Counter-Strike Global Offensive/game/csgo';
const vpk = path.join(game, 'pak01_dir.vpk');
const cli = path.join(root, 'tools/source2viewer/Source2Viewer-CLI.exe');
const temp = path.join(root, 'artifacts/export-temp');
fs.mkdirSync(stage, { recursive: true }); fs.mkdirSync(temp, { recursive: true });
const index = new Set(readVpkIndex(vpk).entries.map(entry => entry.path));
const models = { CT: 'agents/models/ctm_sas/ctm_sas.vmdl_c', T: 'agents/models/tm_phoenix/tm_phoenix.vmdl_c' };
const clips = {};
for (const family of ['rifle', 'pistol', 'knife']) {
  const base = `animation/anims/world/${family}/_default_${family}/`;
  const add = (action, stem) => { clips[`${family}/${action}`] = base + stem + '.vnmclip_c'; };
  add('idle', `idle_${family}`); add('crouchIdle', `idle_crouch_${family}`);
  for (const direction of ['n', 'e', 's', 'w']) add(`run_${direction}`, `run_${direction}_${family}`);
  add('walk', `walk_n_${family}`); add('crouchMove', `crouch_n_${family}`); add('jump', `jump_stand_${family}`);
}
clips['rifle/shoot'] = 'animation/anims/world/rifle/_default_rifle/shoot_rifle.vnmclip_c';
clips['rifle/reload'] = 'animation/anims/world/rifle/rifle_ak/reload_ak.vnmclip_c';
clips['pistol/shoot'] = 'animation/anims/world/pistol/pistol_glock/shoot_glock.vnmclip_c';
clips['pistol/reload'] = 'animation/anims/world/pistol/pistol_glock/reload_glock.vnmclip_c';
clips['knife/shoot'] = 'animation/anims/world/knife/_default_knife/frontswing_knife.vnmclip_c';
for(const [action,stem]of Object.entries({idle:'idle_grenade',crouchIdle:'idle_crouch_grenade',pullpin:'pullpin_grenade',crouchPullpin:'pullpin_crouch_grenade',throw:'throw_overhand_grenade',throwUnderhand:'throw_underhand_grenade',crouchThrow:'crouch_throw_far_grenade',crouchThrowUnderhand:'crouch_throw_near_grenade'}))clips['grenade/'+action]='animation/anims/world/grenade/_default_grenade/'+stem+'.vnmclip_c';
clips.death = 'animation/anims/world/shared/death_chest_a.vnmclip_c';
for (const resource of [...Object.values(models), ...Object.values(clips)]) if (!index.has(resource)) throw Error('Missing CS2 resource: ' + resource);
fs.writeFileSync(path.join(stage, 'source-index.json'), JSON.stringify({ installationBuild: '25175329', models, clips }, null, 2) + '\n');
if (process.argv.includes('--index-only')) process.exit(0);
const lockPath = path.join(root, 'artifacts/s2v-export.lock');
const lock = fs.openSync(lockPath, 'wx');
fs.writeFileSync(lock, JSON.stringify({ pid: process.pid, task: 'characters-cs2', startedAt: new Date().toISOString() }));
function valid(file) { if (!fs.existsSync(file)) return false; const b = Buffer.alloc(12), fd = fs.openSync(file, 'r'); fs.readSync(fd, b, 0, 12, 0); fs.closeSync(fd); return b.toString('ascii', 0, 4) === 'glTF' && b.readUInt32LE(8) === fs.statSync(file).size; }
function run(resource, file, model = false) {
  if (valid(file)) { console.log('verified existing ' + path.relative(stage, file)); return; }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const log = fs.openSync(file + '.log', 'w');
  const args = ['-i', vpk, '-f', resource, '-o', file, '-d', '--gltf_export_format', 'glb', '--game', path.join(game, 'gameinfo.gi')];
  args.push('--gltf_export_animations');
  if (model) args.push('--gltf_export_materials', '--gltf_textures_adapt', '--gltf_export_extras');
  const result = spawnSync(cli, args, { cwd: root, windowsHide: true, stdio: ['ignore', log, log], env: { ...process.env, TEMP: temp, TMP: temp }, timeout: 240000 });
  fs.closeSync(log);
  if (result.error || result.status || !valid(file)) throw Error('Failed ' + resource + ': ' + (result.error?.message || result.status));
  console.log(path.relative(stage, file) + ' ' + fs.statSync(file).size);
}
try {
  for (const [team, resource] of Object.entries(models)) run(resource, path.join(stage, 'raw', team, team + '.glb'), true);
  for (const [name, resource] of Object.entries(clips)) run(resource, path.join(stage, 'animations', name.replace('/', '-') + '.glb'));
} finally { fs.closeSync(lock); fs.unlinkSync(lockPath); }
