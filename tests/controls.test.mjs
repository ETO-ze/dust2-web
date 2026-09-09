import test from 'node:test';
import assert from 'node:assert/strict';
import { GameControls, CONTROL_ACTIONS, DEFAULT_BINDINGS, formatBinding } from '../client/controls.js';

class Target extends EventTarget { constructor() { super(); this.document = new EventTarget(); this.document.hidden = false; } }
function storage(initial = null) { return { value: initial, getItem() { return this.value; }, setItem(key, value) { this.value = value; } }; }
function event(target, type, fields = {}) {
  const value = new Event(type, { cancelable: true });
  for (const [key, field] of Object.entries(fields)) Object.defineProperty(value, key, { value: field });
  target.dispatchEvent(value); return value;
}
function setup(options = {}) {
  const target = new Target(), callbacks = [], saved = storage();
  const controls = new GameControls({ target, storage: saved, onAction: (action, state) => callbacks.push({ action, ...state }), ...options });
  return { target, callbacks, saved, controls, press: (code, fields) => event(target, 'keydown', { code, ...fields }), release: code => event(target, 'keyup', { code }) };
}

test('CS defaults expose implemented actions and preserve short jump/reload presses until consumed', () => {
  const { controls, press, release, callbacks } = setup();
  for (const [code, action] of [['Space', 'jump'], ['KeyR', 'reload']]) {
    assert.equal(press(code).defaultPrevented, true); release(code);
    assert.equal(controls.down(action), false); assert.equal(controls.consume(action), true); assert.equal(controls.consume(action), false);
  }
  assert.deepEqual(callbacks.map(({action,pressed})=>[action,pressed]), [['jump',true],['jump',false],['reload',true],['reload',false]]);
  assert.deepEqual(DEFAULT_BINDINGS.drop, ['KeyG']);
  assert.deepEqual(DEFAULT_BINDINGS.lastWeapon, ['KeyQ']); assert.deepEqual(DEFAULT_BINDINGS.menu, ['Escape']); controls.destroy();
});

test('two physical keys for one held action release only after both keys lift; OS repeat does not retrigger', () => {
  const { controls, press, release, callbacks } = setup();
  press('ShiftLeft'); press('ShiftLeft', {repeat:true}); press('ShiftRight'); release('ShiftLeft');
  assert.equal(controls.down('walk'), true); assert.equal(callbacks.length, 1);
  release('ShiftRight'); assert.equal(controls.down('walk'), false); assert.equal(callbacks.length, 2);
  assert.equal(controls.consume('walk'), true); assert.equal(controls.consume('walk'), false); controls.destroy();
});

test('held Tab cancels every browser repeat, closes on release/blur, and leaves menu navigation available', () => {
  let playing=true; const {controls,press,release,target,callbacks}=setup({enabled:()=>playing});
  assert.equal(press('Tab').defaultPrevented,true);
  for(let i=0;i<12;i++) assert.equal(press('Tab',{repeat:true}).defaultPrevented,true);
  assert.equal(callbacks.length,1); assert.equal(controls.down('scoreboard'),true);
  release('Tab'); assert.equal(controls.down('scoreboard'),false);
  press('Tab'); event(target,'blur'); assert.equal(controls.down('scoreboard'),false);
  playing=false;
  assert.equal(press('Tab').defaultPrevented,false);
  assert.equal(press('Tab',{repeat:true}).defaultPrevented,false);
  controls.destroy();
});

test('form fields, composition, disabled gameplay, focus and blur cannot trigger or stick movement', () => {
  let enabled = true; const { controls, press, release, target } = setup({ enabled:()=>enabled });
  const input = {nodeType:1,closest: selector=>selector.includes('input') ? {} : null};
  assert.equal(press('KeyW',{target:input}).defaultPrevented,false); assert.equal(controls.down('forward'),false);
  press('KeyW',{isComposing:true}); assert.equal(controls.down('forward'),false);
  enabled=false;press('KeyW');assert.equal(controls.down('forward'),false);enabled=true;
  press('KeyW');event(target,'focusin',{target:input});assert.equal(controls.down('forward'),false);
  press('Space');event(target,'blur');assert.equal(controls.down('jump'),false);assert.equal(controls.consume('jump'),false);
  press('KeyW');enabled=false;release('KeyW');assert.equal(controls.down('forward'),false); controls.destroy();
});

test('conflicting key binds reject without mutation, then explicitly swap and persist', () => {
  const { controls, press, saved } = setup(); const before = controls.getBindings();
  const reject=controls.setBinding('forward','KeyS');assert.equal(reject.reason,'conflict');assert.equal(reject.action,'back');assert.deepEqual(controls.getBindings(),before);
  press('KeyW');const swap=controls.setBinding('forward','KeyS',{conflict:'swap'});assert.equal(swap.ok,true);assert.equal(controls.down('forward'),false);
  assert.deepEqual(controls.getBindings().forward,['KeyS']);assert.deepEqual(controls.getBindings().back,['KeyW']);
  const loaded=new GameControls({target:null,storage:saved});assert.deepEqual(loaded.getBindings(),controls.getBindings());
  const detached=controls.getBindings();detached.forward.push('KeyZ');assert.deepEqual(controls.getBindings().forward,['KeyS']);
  controls.resetDefaults();assert.deepEqual(controls.getBindings(),DEFAULT_BINDINGS);assert.equal(JSON.parse(saved.value).version,1);controls.destroy();loaded.destroy();
});

test('wheel can add jump while retaining Space, produces consumable pulses and defaults to both weapon directions', () => {
  const { controls, target, callbacks }=setup();
  event(target,'wheel',{deltaY:-100});event(target,'wheel',{deltaY:100});
  assert.equal(controls.consume('previousWeapon'),true);assert.equal(controls.consume('nextWeapon'),true);
  const rejected=controls.setBinding('jump','WheelDown',{slot:1});assert.equal(rejected.reason,'conflict');
  controls.setBinding('jump','WheelDown',{slot:1,conflict:'swap'});
  assert.deepEqual(controls.getBindings().jump,['Space','WheelDown']);assert.deepEqual(controls.getBindings().nextWeapon,[]);
  assert.equal(event(target,'wheel',{deltaY:10}).defaultPrevented,true);
  assert.equal(controls.down('jump'),false);assert.equal(controls.consume('jump'),true);assert.equal(controls.consume('jump'),false);
  assert.deepEqual(callbacks.slice(-2).map(c=>[c.action,c.pressed]),[['jump',true],['jump',false]]);
  controls.setBinding('jump','WheelUp',{slot:2,conflict:'swap'});assert.equal(controls.getBindings().jump.length,3);controls.destroy();
});

test('capture intercepts gameplay, supports explicit conflict confirmation, and Escape cancels without rebinding', () => {
  const {controls,press,target,callbacks}=setup();
  controls.beginCapture('reload');press('KeyF');assert.equal(controls.capture.conflict.action,'inspect');assert.equal(callbacks.length,0);
  controls.confirmSwap();assert.equal(controls.capture,null);assert.deepEqual(controls.getBindings().reload,['KeyF']);assert.deepEqual(controls.getBindings().inspect,['KeyR']);
  controls.beginCapture('jump',1);press('Escape');assert.equal(controls.capture,null);assert.deepEqual(controls.getBindings().jump,['Space']);
  controls.beginCapture('jump',1);event(target,'wheel',{deltaY:-1});assert.equal(controls.capture.conflict.action,'previousWeapon');controls.confirmSwap();
  assert.deepEqual(controls.getBindings().jump,['Space','WheelUp']);assert.equal(callbacks.length,0);controls.destroy();
});

test('mouse ownership can remain external; supported mouse rebinding and key labels are explicit', () => {
  const external=setup({mouse:false});event(external.target,'mousedown',{button:0});assert.equal(external.controls.down('fire'),false);external.controls.destroy();
  const {controls,target}=setup();event(target,'mousedown',{button:2});assert.equal(controls.down('altFire'),true);event(target,'mouseup',{button:2});assert.equal(controls.down('altFire'),false);
  assert.equal(formatBinding('WheelUp'),'滚轮向上');assert.equal(formatBinding('KeyQ'),'Q');assert.equal(formatBinding('Mouse2'),'鼠标右键');controls.destroy();
});

test('bad persistence is safe, unavailable storage does not prevent play, and disposal removes all listeners', () => {
  for(const value of ['{bad',JSON.stringify({version:999,bindings:{}}),JSON.stringify({version:1,bindings:{forward:['KeyS']}})]) {
    const controls=new GameControls({target:null,storage:storage(value)});assert.deepEqual(controls.getBindings(),DEFAULT_BINDINGS);controls.destroy();
  }
  const fixture=setup({storage:{getItem(){throw Error('blocked')},setItem(){throw Error('blocked')}}});
  assert.equal(fixture.controls.setBinding('reload','KeyZ').ok,true);assert.ok(fixture.controls.persistenceError);fixture.press('KeyZ');assert.equal(fixture.controls.consume('reload'),true);
  fixture.controls.destroy();const count=fixture.callbacks.length;fixture.press('KeyW');assert.equal(fixture.callbacks.length,count);assert.equal(fixture.controls.down('forward'),false);
});
