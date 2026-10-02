// Dedicated, rooted Android QA emulator only; never run against a user's phone.
import {execFileSync} from 'node:child_process';
import fs from 'node:fs';
import assert from 'node:assert/strict';
const root=process.env.DUSTII_BUILD_ROOT||'D:/CodexBuilds/dust2-online-1.2.0';
const adb=(...args)=>execFileSync('H:/playfround/.android-build-tools/sdk/platform-tools/adb.exe',['-s','emulator-5584',...args],{maxBuffer:16*1024**2}).toString();
assert.equal(adb('shell','getprop','ro.kernel.qemu').trim(),'1');
const app='cn.duskrain.dustii';
adb('shell','am','force-stop',app);
const info=()=>adb('shell','dumpsys','package',app).split('\n').map(s=>s.trim()).filter(s=>/^(userId|versionCode|versionName)=/.test(s));
const hashes=()=>adb('shell',"cd '/data/user/0/cn.duskrain.dustii/app_webview/Default/Local Storage/leveldb' && sha256sum *").trim().split('\n').sort();
const before={info:info(),hashes:hashes()};assert.ok(before.info.includes('versionName=1.1.0'));assert.ok(before.hashes.length>=4);
assert.match(adb('install','-r',root+'/releases/DustII-Android-1.2.0.apk'),/Success/);
const after={info:info(),hashes:hashes()};assert.ok(after.info.includes('versionName=1.2.0'));
assert.equal(after.info.find(s=>s.startsWith('userId=')),before.info.find(s=>s.startsWith('userId=')));
assert.deepEqual(after.hashes,before.hashes);
fs.writeFileSync(root+'/android-upgrade.json',JSON.stringify({before,after,checks:['official signed 1.1 -> 1.2 update accepted','same application UID','all existing localStorage files preserved byte-for-byte before first launch'],physicalDevice:false},null,2));
adb('shell','am','start','-n',app+'/cn.duskrain.dustii.MainActivity');
console.log('PASS official signed APK upgrade and localStorage preservation');
