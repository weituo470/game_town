import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { transformWithEsbuild } from 'vite';
import * as THREE from 'three';
import * as catalog from '../src/lib/catalog.js';
import * as lookMath from '../src/components/town/firstPerson.js';

const file = new URL('../src/components/town/PlayerController.jsx', import.meta.url);
const require = createRequire(file);
const controller = await transformWithEsbuild(fs.readFileSync(file, 'utf8'), 'PlayerController.jsx', { loader: 'jsx', jsx: 'automatic', format: 'cjs' });
const lookSource = await transformWithEsbuild(fs.readFileSync(new URL('../src/components/town/FirstPersonLook.jsx', import.meta.url), 'utf8'), 'FirstPersonLook.jsx', { loader: 'jsx', format: 'cjs' });
const lookModule = { exports: {} };
vm.runInNewContext(lookSource.code, {
  module: lookModule, exports: lookModule.exports,
  require(id) { if (id === './firstPerson.js') return lookMath; if (id === 'react' || id === '@react-three/fiber') return {}; throw Error(id); },
});

function emitter() {
  const listeners = new Map();
  return {
    addEventListener(type, fn) { if (!listeners.has(type)) listeners.set(type, new Set()); listeners.get(type).add(fn); },
    removeEventListener(type, fn) { listeners.get(type)?.delete(fn); },
    emit(type, details = {}) { const event = { type, target: { tagName: 'BODY' }, preventDefault() {}, isTrusted: true, ...details }; for (const fn of [...(listeners.get(type) || [])]) fn(event); },
  };
}

function all(node, result = []) { if (Array.isArray(node)) node.forEach(child => all(child, result)); else if (node?.props) { result.push(node); all(node.props.children, result); } return result; }
function harness(initial = {}) {
  const refs = [], effects = [], pending = [];
  let cursor = 0, frame, time = 0, tree, explorations = 0;
  const win = emitter(), doc = { ...emitter(), hidden: false, pointerLockElement: null, defaultView: win };
  const canvas = { ...emitter(), ownerDocument: doc, style: { touchAction: 'pan-y' }, setPointerCapture() {}, hasPointerCapture() { return false; } };
  canvas.requestPointerLock = () => { doc.pointerLockElement = canvas; doc.emit('pointerlockchange'); };
  doc.exitPointerLock = () => { doc.pointerLockElement = null; doc.emit('pointerlockchange'); };
  let camera = new THREE.PerspectiveCamera(70, 1280 / 720, .08, 420);
  const size = { width: 1280, height: 720 }, inputRef = { current: {} }, playerPoseRef = { current: null }, flightRef = { current: {} };
  let props = { Model: 'Avatar', inputRef, playerPoseRef, flightRef, active: true, viewMode: 'first-person', onStartExploring() { explorations++; }, ...initial };
  const module = { exports: {} };
  vm.runInNewContext(controller.code, {
    module, exports: module.exports, window: win, document: doc, performance: { now: () => time },
    require(id) {
      if (id === 'react') return {
        useRef(value) { const slot = cursor++; return refs[slot] ||= { current: value }; },
        useEffect(callback, deps) { const slot = cursor++, previous = effects[slot]; if (!previous || deps.some((d, i) => d !== previous.deps[i])) pending.push(() => { previous?.cleanup?.(); effects[slot] = { deps, cleanup: callback() }; }); },
      };
      if (id === '@react-three/fiber') return { useFrame(callback) { frame = callback; }, useThree: () => ({ camera, size, invalidate() {} }) };
      if (id === '../../lib/catalog') return catalog;
      if (id === './FirstPersonLook.jsx') return { __esModule: true, default: 'Look' };
      return require(id);
    },
  });
  let binding;
  function render(changes = {}) { props = { ...props, ...changes }; cursor = 0; tree = module.exports.default(props); while (pending.length) pending.shift()(); binding?.sync(); return tree; }
  render();
  binding = lookModule.exports.bindFirstPersonLook(canvas, () => all(tree).find(node => node.type === 'Look').props);
  return {
    window: win, document: doc, canvas, inputRef, flightRef, render, size,
    pose: () => playerPoseRef.current, look: () => all(tree).find(node => node.type === 'Look').props.lookRef,
    avatar: () => all(tree).find(node => node.props.self),
    camera: () => camera, explorations: () => explorations,
    frame(count = 1) { for (let i = 0; i < count; i++) { time += 1000 / 60; frame({}, 1 / 60); } },
    setCamera(next) { camera = next; },
    dispose() { binding.dispose(); for (const effect of effects) effect?.cleanup?.(); },
  };
}

test('close-third-person jetpack: visible avatar launches, close boom follows altitude, release never switches view', () => {
  const app = harness();
  app.window.emit('keydown', { code: 'Space', repeat: false }); app.frame(70);
  assert.ok(app.pose().jetpack && app.pose().thrusting && app.pose().y > 5);
  assert.equal(app.explorations(), 0, 'close third person never requests the distant follow camera');
  assert.ok(app.avatar(), 'the local avatar remains rendered while flying');
  const boom = app.camera().position.distanceTo(new THREE.Vector3(app.pose().x,app.pose().y+lookMath.CLOSE_THIRD_PERSON.targetHeight,app.pose().z));
  assert.ok(boom > 3.8 && boom < 4.8);
  assert.ok(app.camera().position.y > app.pose().y + 2);
  assert.equal(app.camera().fov,58);
  assert.equal(app.flightRef.current.flying, true);
  const height = app.pose().y;
  app.window.emit('keyup', { code: 'Space' }); app.frame();
  assert.equal(app.pose().thrusting, false); assert.ok(app.pose().y < height);
  app.frame(200); assert.equal(app.pose().y, 0); assert.equal(app.explorations(), 0);
  assert.ok(app.camera().isPerspectiveCamera); app.dispose();
});

test('close-third-person jetpack: mouse lock can orbit and steer with W while thrust remains held', () => {
  const app = harness();
  app.canvas.emit('click', { pointerType: 'mouse' });
  app.window.emit('keydown', { code: 'Space', repeat: false }); app.frame(50);
  const yaw = app.look().current.yaw;
  app.document.emit('mousemove', { movementX: (Math.PI / 2 - yaw) / lookMath.LOOK_SENSITIVITY, movementY: 0 });
  const origin = { ...app.pose() };
  app.window.emit('keydown', { code: 'KeyW' }); app.frame(15);
  assert.ok(app.pose().x > origin.x + 1.5, 'W follows the new +X gaze, not the isometric axes');
  assert.ok(Math.abs(app.pose().z - origin.z) < .01);
  assert.equal(app.pose().thrusting, true);
  const direction = app.camera().getWorldDirection(new THREE.Vector3());
  assert.ok(direction.x > .9); assert.ok(Math.abs(direction.z)<.01);
  assert.ok(app.camera().position.x < app.pose().x-3.8, 'camera stays behind the visible player');
  app.dispose();
});

test('close-third-person jetpack: second-finger orbit coexists with touch direction and held engine', () => {
  const app = harness(); app.size.width = 390; app.size.height = 844;
  app.camera().aspect=390/844;app.render();
  app.inputRef.current.jetHeld = true; app.inputRef.current.jumpRequested = 1; app.frame(50);
  assert.equal(app.camera().fov,62);
  const expectedMobile=lookMath.closeThirdPersonCamera(app.pose(),app.look().current.yaw,app.look().current.pitch,{aspect:390/844});
  assert.ok(app.camera().position.distanceTo(new THREE.Vector3(...Object.values(expectedMobile.position)))<1e-9, 'mobile renderer uses the portrait boom including collision retreat');
  app.canvas.emit('pointerdown', { pointerId: 9, pointerType: 'touch', isPrimary: false, clientX: 200, clientY: 300, button: 0 });
  app.canvas.emit('pointermove', { pointerId: 9, pointerType: 'touch', clientX: 420, clientY: 260 });
  const yaw = app.look().current.yaw, origin = { ...app.pose() };
  app.inputRef.current.forward = true; app.frame(10);
  assert.ok(yaw > .4); assert.ok(app.pose().x > origin.x);
  assert.equal(app.pose().thrusting, true); assert.ok(app.pose().y > origin.y);
  app.canvas.emit('pointerup', { pointerId: 9, pointerType: 'touch' });
  assert.equal(app.inputRef.current.jetHeld, true, 'ending the look gesture does not release another finger');
  app.inputRef.current.jetHeld = false; app.inputRef.current.forward = false; app.frame();
  assert.equal(app.pose().thrusting, false); app.dispose();
});

test('close-third-person jetpack: Esc-style unlock or focus loss cuts thrust without dropping the camera to ground', () => {
  for (const operation of ['unlock', 'blur']) {
    const app = harness(); app.canvas.emit('click', { pointerType: 'mouse' });
    app.window.emit('keydown', { code: 'Space', repeat: false }); app.frame(60);
    const altitude = app.pose().y;
    if (operation === 'unlock') app.document.exitPointerLock(); else app.window.emit('blur');
    assert.equal(app.pose().y, altitude); assert.equal(app.pose().thrusting, false);
    app.frame(10); assert.ok(app.pose().y < altitude); assert.ok(app.camera().position.y > 1.7);
    assert.equal(app.explorations(), 0); app.dispose();
  }
});

test('close-third-person jetpack: entering while airborne retains travel heading and altitude', () => {
  const app = harness({ viewMode: 'follow' });
  app.pose().x = 0; app.pose().z = 10; app.pose().y = 12; app.pose().vy = 0; app.pose().jetpack = true; app.pose().yaw = Math.PI / 2;
  app.inputRef.current.jetHeld = true;
  app.render({ viewMode: 'first-person' });
  assert.ok(Math.abs(app.look().current.yaw - Math.PI / 2) < 1e-9);
  assert.equal(app.look().current.pitch, .12);
  assert.equal(app.pose().y, 12, 'camera change does not teleport or reset flight');
  app.frame(); assert.ok(app.camera().position.y > 13); app.dispose();
});

test('follow camera: RMB orbit updates real perspective matrices and camera-relative movement without locking',()=>{
  const app=harness({viewMode:'follow'});app.frame();
  assert.equal(app.camera().fov,50);assert.ok(app.avatar());
  const yaw=app.look().current.yaw;
  app.canvas.emit('pointerdown',{pointerId:3,pointerType:'mouse',button:0,buttons:1,clientX:200,clientY:200});
  app.canvas.emit('pointermove',{pointerId:3,pointerType:'mouse',buttons:1,clientX:300,clientY:100});
  assert.equal(app.look().current.yaw,yaw);
  app.canvas.emit('pointerdown',{pointerId:4,pointerType:'mouse',button:2,buttons:2,clientX:200,clientY:200});
  app.canvas.emit('pointermove',{pointerId:4,pointerType:'mouse',buttons:2,clientX:200+(Math.PI/2-yaw)/lookMath.LOOK_SENSITIVITY,clientY:200});
  app.frame();const direction=app.camera().getWorldDirection(new THREE.Vector3());
  assert.ok(direction.x>.75&&Math.abs(direction.z)<1e-9);
  app.pose().y=60;app.pose().jetpack=true;app.pose().vy=0;
  app.inputRef.current.hoverToggle=1;app.frame();
  const origin={...app.pose()};app.window.emit('keydown',{code:'KeyW'});app.frame(12);
  assert.ok(app.pose().x>origin.x+1);assert.ok(Math.abs(app.pose().z-origin.z)<1e-9);
  assert.equal(app.pose().hovering,true);assert.equal(app.document.pointerLockElement,null);
  app.canvas.emit('pointerup',{pointerId:4,pointerType:'mouse',button:2,buttons:0});
  const releasedYaw=app.look().current.yaw;
  app.canvas.emit('pointermove',{pointerId:4,pointerType:'mouse',buttons:0,clientX:0,clientY:0});
  assert.equal(app.look().current.yaw,releasedYaw);app.dispose();
});

test('jetpack H: toggles once while Space is held, locks altitude, repeat cannot retrigger, new Space resumes',()=>{
  const app=harness();app.window.emit('keydown',{code:'Space',repeat:false});app.frame(400);
  assert.ok(app.pose().y>30,'flight passes the former 24 metre limit');
  app.window.emit('keydown',{code:'KeyH',repeat:false});app.frame();
  const height=app.pose().y;assert.equal(app.pose().hovering,true);assert.equal(app.pose().thrusting,false);
  assert.equal(app.flightRef.current.hovering,true);assert.equal(app.pose().vy,0);
  app.window.emit('keydown',{code:'KeyH',repeat:true});app.frame(90);
  assert.equal(app.pose().y,height);assert.equal(app.pose().hovering,true);
  app.window.emit('keyup',{code:'KeyH'});app.window.emit('keyup',{code:'Space'});app.frame();
  app.window.emit('keydown',{code:'Space',repeat:false});app.frame(30);
  assert.equal(app.pose().hovering,false);assert.equal(app.pose().thrusting,true);assert.ok(app.pose().y>height);
  app.dispose();
});

test('jetpack H: second toggle descends and touch toggle is consumed once with held-engine suppression',()=>{
  const app=harness();app.inputRef.current.jetHeld=true;app.frame(80);
  app.inputRef.current.hoverToggle=1;app.frame();const height=app.pose().y;
  assert.equal(app.inputRef.current.hoverToggle,0);assert.equal(app.pose().hovering,true);
  app.frame(60);assert.equal(app.pose().y,height);
  app.inputRef.current.hoverToggle=1;app.frame();assert.equal(app.pose().hovering,false);
  assert.ok(app.pose().y<height,'the already-held engine cannot override a second H toggle');
  app.inputRef.current.jetHeld=false;app.frame();app.inputRef.current.jetHeld=true;app.frame(30);
  assert.equal(app.pose().thrusting,true);app.dispose();
});

test('jetpack H: ground, editable fields, UI controls and repeat cannot enable hover',()=>{
  const app=harness();app.window.emit('keydown',{code:'KeyH',repeat:false});app.frame();assert.equal(app.pose().hovering,false);
  app.window.emit('keyup',{code:'KeyH'});app.pose().y=50;app.pose().jetpack=true;
  for(const target of [{tagName:'INPUT'},{tagName:'TEXTAREA'},{tagName:'SELECT'},{isContentEditable:true},{tagName:'BUTTON'},{tagName:'SPAN',closest(){return {tagName:'BUTTON'};}}]){
    app.window.emit('keydown',{code:'KeyH',repeat:false,target});app.frame();assert.equal(app.pose().hovering,false);
  }
  app.window.emit('keydown',{code:'KeyH',repeat:true});app.frame();assert.equal(app.pose().hovering,false);
  app.dispose();
});

test('jetpack hover: focus, hidden document, modal, pointer cancellation and disconnect clear suspension',()=>{
  for(const action of ['blur','hidden','modal','pointercancel','disconnect']){
    const app=harness({viewMode:'follow'});app.pose().y=60;app.pose().jetpack=true;app.inputRef.current.hoverToggle=1;app.frame();
    assert.equal(app.pose().hovering,true);
    if(action==='blur')app.window.emit('blur');
    if(action==='hidden'){app.document.hidden=true;app.document.emit('visibilitychange');}
    if(action==='modal')app.render({active:false});
    if(action==='pointercancel'){
      app.canvas.emit('pointerdown',{pointerId:1,pointerType:'mouse',button:2,buttons:2,clientX:20,clientY:20});
      app.canvas.emit('pointercancel',{pointerId:1,pointerType:'mouse'});
    }
    if(action==='disconnect'){app.render({network:{status:'connected',selfId:'self',players:[]}});app.render({network:{status:'reconnecting'}});}
    app.frame();assert.equal(app.pose().hovering,false,action);assert.equal(app.flightRef.current.hovering,false,action);app.dispose();
  }
});

test('aerial camera: close and follow can look at overhead drones, look down at ground and expand only their far plane',()=>{
  for(const mode of ['first-person','follow']){
    const app=harness({viewMode:mode});app.pose().y=1000;app.pose().jetpack=true;app.inputRef.current.hoverToggle=1;
    app.look().current.pitch=1.4;app.frame();
    const up=app.camera().getWorldDirection(new THREE.Vector3());assert.ok(up.y>.8,mode);
    assert.ok(app.camera().far>1000);assert.ok(app.camera().near<=.1);
    app.look().current.pitch=-1;app.frame();app.camera().updateMatrixWorld(true);
    const feet=new THREE.Vector3(app.pose().x,app.pose().y,app.pose().z).project(app.camera());
    assert.ok(Math.abs(feet.x)<1&&Math.abs(feet.y)<1&&Math.abs(feet.z)<1,'the full-body avatar stays visible');
    const down=app.camera().getWorldDirection(new THREE.Vector3());assert.ok(down.y<-.9);
    const ground=app.camera().position.clone().addScaledVector(down,-app.camera().position.y/down.y).project(app.camera());
    assert.ok(ground.z>=-1&&ground.z<=1,'ground intersections are not far-clipped at high altitude');
    app.dispose();
  }
});

test('jetpack hover network: hover changes are sequenced and stale thrust patches cannot replace the newer input',()=>{
  const packets=[],player={id:'self',x:0,z:10.7,y:0,vy:0,yaw:0,seq:0,jetpack:false,thrusting:false,hovering:false};
  const network={status:'connected',selfId:'self',players:[player],snapshotRef:{current:{players:[player],selfId:'self',tick:1}},sendInput(packet){packets.push(packet);return true;}};
  const app=harness({network});app.frame();
  app.window.emit('keydown',{code:'Space',repeat:false});app.frame(80);
  assert.ok(app.pose().y>5);const oldThrust={...app.pose(),id:'self',seq:packets.at(-1).seq};
  app.window.emit('keydown',{code:'KeyH',repeat:false});app.frame();
  const hoverPacket=packets.at(-1);assert.equal(hoverPacket.hover,true);assert.equal(hoverPacket.thrust,false);
  assert.ok(hoverPacket.seq>oldThrust.seq);assert.equal(app.pose().hovering,true);const height=app.pose().y;
  network.snapshotRef.current={players:[oldThrust],selfId:'self',tick:2};app.frame();
  assert.equal(app.pose().y,height);assert.equal(app.pose().hovering,true);
  app.window.emit('blur');const stop=packets.at(-1);assert.equal(stop.stop,true);assert.ok(stop.seq>hoverPacket.seq);
  network.snapshotRef.current={players:[{...oldThrust,hovering:true,thrusting:false,vy:0,seq:hoverPacket.seq}],selfId:'self',tick:3};
  app.frame();assert.equal(app.pose().hovering,false);assert.ok(app.pose().y<height);app.dispose();
});
