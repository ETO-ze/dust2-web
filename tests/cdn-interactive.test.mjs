import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {readMaskedCredentials,parseInteractiveArgs} from '../scripts/cdn/publish-interactive.mjs';

function terminal(){
 const input=new EventEmitter();input.isTTY=true;input.isRaw=false;input.isPaused=()=>true;
 input.setRawMode=value=>{input.isRaw=value;};input.resume=()=>{};input.pause=()=>{};
 const captured=[];return {input,output:{write:value=>captured.push(value)},text:()=>captured.join('')};
}
test('protected input masks pasted credentials, preserves CRLF typeahead and restores terminal state',async()=>{
 const io=terminal();const promise=readMaskedCredentials(io.input,io.output);
 assert.equal(io.input.isRaw,true);
 io.input.emit('data',Buffer.from('fake-access-id\r\nfake-secret-value\r\n'));
 assert.deepEqual(await promise,{accessKeyId:'fake-access-id',secretAccessKey:'fake-secret-value'});
 assert.equal(io.input.isRaw,false);
 assert(!io.text().includes('fake-access-id'));assert(!io.text().includes('fake-secret-value'));
 assert.equal(io.input.listenerCount('data'),0);
});
test('cancellation, non-TTY and oversized input never disclose credential values',async()=>{
 assert.throws(()=>readMaskedCredentials({isTTY:false}),/interactive local terminal/);
 const io=terminal();const promise=readMaskedCredentials(io.input,io.output);
 io.input.emit('data',Buffer.from('partial-secret\x03'));
 await assert.rejects(promise,/cancelled/);assert(!io.text().includes('partial-secret'));assert.equal(io.input.isRaw,false);
 const over=terminal();const pending=readMaskedCredentials(over.input,over.output);
 over.input.emit('data',Buffer.from('x'.repeat(513)));await assert.rejects(pending,/oversized/);assert.equal(over.input.isRaw,false);
});
test('interactive upload refuses custom endpoints or secret-bearing command flags before input',()=>{
 const endpoint='https://'+'a'.repeat(32)+'.r2.cloudflarestorage.com';
 const opts=parseInteractiveArgs(['--manifest','local.json','--endpoint',endpoint,'--bucket','dustii-downloads']);
 assert.equal(opts.bucket,'dustii-downloads');assert(opts.ready.endsWith('READY.json'));
 assert.throws(()=>parseInteractiveArgs(['--manifest','a','--endpoint','https://attacker.example/','--bucket','bucket']));
 assert.throws(()=>parseInteractiveArgs(['--secret','a']));
 assert.throws(()=>parseInteractiveArgs(['--manifest','a','--manifest','b']));
});
