// Export the review list from the exact catalogue the authoritative room accepts.
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {SKINS} from '../../shared/skins.js';
import {getWeapon} from '../../shared/weapons.js';
import {AGENT_ARM_ASSETS} from '../../shared/agent-arm-assets.js';

const repo = path.resolve(import.meta.dirname, '../..');
const reference = JSON.parse(fs.readFileSync(process.argv[2] || path.join(repo, 'artifacts/skin-library-review/reference.json'), 'utf8'));
const out = process.argv[3] || path.join(repo, 'public/assets/weapons/cs2-skins/library');
const text = {'Factory New':'崭新出厂', 'Minimal Wear':'略有磨损', 'Field-Tested':'久经沙场', 'Well-Worn':'破损不堪', 'Battle-Scarred':'战痕累累'};
const key = row => row.weapon + '/' + row.paintkit;
const sourceById = new Map(reference.rows.map(row => [key(row), row]));
const market = new Map(JSON.parse(fs.readFileSync(new URL('./popular-skins.json',import.meta.url),'utf8')).map(s=>[s.file,s.marketVolume30d]));
const used = new Map();
const checked = new Set();
function verify(file, bytes, hash) {
  if (checked.has(hash)) return;
  const buffer = fs.readFileSync(path.join(repo, 'public', file));
  if (buffer.length !== bytes || createHash('sha256').update(buffer).digest('hex') !== hash) throw Error('Asset mismatch: ' + file);
  checked.add(hash);
}
function fromSource(r) {
  return { category:r.category, weapon:r.weaponName, weaponEn:r.weaponNameEn, name:r.name, english:r.nameEn, phase:r.phase || '', kit:r.paintkit, min:r.wearMin, max:r.wearMax };
}
const playable = SKINS.map(s => {
  verify(s.model, s.bytes, s.sha256);
  verify(s.preview, s.previewBytes, s.previewSha256);
  if (s.animation) verify(s.animation.model, s.animation.bytes, s.animation.sha256);
  const row = sourceById.get(key(s));
  if (s.condition !== 'Vanilla' && (!row || s.wear < row.wearMin || s.wear > row.wearMax)) throw Error('Unsupported weapon/paint/wear: ' + s.id);
  const item = row ? fromSource(row) : {category:s.weapon==='knife'?'刀具':'枪械', weapon:s.vanillaWeaponName || s.englishName, weaponEn:s.vanillaWeaponNameEn || (s.animationFamily === 'm9'?'M9 Bayonet':'Butterfly Knife'), name:'原厂涂装', english:'Vanilla', phase:'', kit:null, min:null, max:null};
  Object.assign(item, {id:s.id, gameName:s.name, slot:getWeapon(s.weapon).name, state:s.isDefault?'默认装备':'可选装备',
    added:/\/cs2-skins\/(?:stock-guns|popular|knives)\//.test(s.model), condition:text[s.condition] || '原厂涂装', wear:row?s.wear:null,
    bytes:s.bytes+(s.animation?.bytes || 0), model:s.model, hash:s.sha256});
  if(s.collection==='popular')item.marketVolume30d=market.get(s.id);
  if(row) used.set(key(row), item);
  return item;
});
const arms = Object.values(AGENT_ARM_ASSETS);
const glove = reference.rows.find(r => r.category === '手套' && r.paintkit === arms[0].gloves.paintkit);
if (!glove || arms.some(a => a.gloves.paintkit !== glove.paintkit || a.gloves.wear !== arms[0].gloves.wear)) throw Error('Agent gloves changed');
for(const a of arms)verify(a.model,a.bytes,a.sha256);
const fixed = {...fromSource(glove),state:'随探员装备',condition:text[arms[0].gloves.exterior],wear:arms[0].gloves.wear};
used.set(key(glove), fixed);
const rows = reference.rows.map(r => {
  const item = used.get(key(r));
  return {...fromSource(r),state:item?.state || '仅参考',added:item?.added || false,gameName:item?.gameName || '',id:item?.id || ''};
});
const sorted = list => list.sort((a,b)=>a.weaponEn.localeCompare(b.weaponEn,'en')||Number(b.state==='默认装备')-Number(a.state==='默认装备')||a.name.localeCompare(b.name,'zh-CN')||Number(a.kit)-Number(b.kit));
const actual = sorted([...playable,fixed]);
const data = {actual, rows:sorted(rows), date:reference.source.manifestDate, manifest:reference.source.manifest, equipped:playable.length};
function csv(file, columns, list) {
  const field = value => '"' + String(value ?? '').replaceAll('"', '""') + '"';
  const lines = [columns.map(c=>c[0]), ...list.map(row=>columns.map(c=>row[c[1]]))];
  fs.writeFileSync(path.join(out,file),'\uFEFF'+lines.map(line=>line.map(field).join(',')).join('\r\n')+'\r\n');
}
fs.mkdirSync(out,{recursive:true});
const columns = [['类别','category'],['武器／手套','weapon'],['英文装备名','weaponEn'],['官方涂装','name'],['英文涂装','english'],['阶段','phase'],['Paint Kit','kit'],['官方最低磨损','min'],['官方最高磨损','max'],['网页状态','state'],['网页显示名称','gameName'],['网页 ID','id']];
csv('loadout.csv',[...columns,['本次新增','added'],['Skinport 近30天成交件数','marketVolume30d'],['装备外观','condition'],['使用磨损','wear'],['模型及附加动画字节','bytes'],['模型路径','model'],['模型 SHA-256','hash']],actual);
csv('reference.csv',columns,data.rows);
const template = fs.readFileSync(new URL('./skin-library-template.html',import.meta.url),'utf8');
fs.writeFileSync(path.join(out,'index.html'),template.replace('/*__LIBRARY_DATA__*/',()=>JSON.stringify(data).replaceAll('<','\\u003c')));
console.log(JSON.stringify({equippable:playable.length,fixed:1,added:playable.filter(a=>a.added).length,reference:rows.length,verifiedAssets:checked.size}));
