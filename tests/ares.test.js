'use strict';
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const { allowedRoute } = require('../scripts/private-access-policy.cjs');
const root = path.resolve(__dirname, '..'), read = name => fs.readFileSync(path.join(root, name), 'utf8');
const code = read('app/ares.js');
function fixture(saved = 'false', loading, layoutValue = null, dockVersion = 'top-v1') {
  const elements = {}, events = {}, storage = {}, views = [];
  const element = id => elements[id] ||= { hidden: true, checked: false, style: {}, textContent: '', attrs: {}, events: {}, setAttribute(name, value) { this.attrs[name] = value; }, addEventListener(name, callback) { this.events[name] = callback; }, replaceChildren() {}, focus() { this.focused = true; }, getBoundingClientRect() { return id === 'composerForm' ? { top: 580, right: 380 } : { bottom: 150 }; } };
  const document = { readyState: 'loading', hidden: false, getElementById: element, addEventListener(name, callback) { events[name] = callback; } };
  const reduced = { matches: false, addEventListener() {} };
  const window = { innerWidth: 390, innerHeight: 844, matchMedia: () => reduced, addEventListener(name, callback) { events[name] = callback; } };
  const intersections = [];
  window.IntersectionObserver = class { constructor(callback) { intersections.push(callback); } observe() {} };
  vm.runInNewContext(code, { window, document, localStorage: { getItem: key => key === 'seneschal-ares-layout' ? layoutValue : key === 'seneschal-ares-dock-layout' ? dockVersion : saved, setItem(key, value) { storage[key] = value; } }, Float32Array });
  const loadScene = loading || (async () => ({ createAresView(host, callbacks) { const view = { states: [], disposed: false, setState(value) { this.states.push(value); }, setCamera(yaw, pitch) { this.camera = [yaw, pitch]; }, setPaused(value) { this.paused = value; }, setVisible(value) { this.visible = value; }, resize() {}, dispose() { this.disposed = true; } }; views.push(view); Promise.resolve().then(callbacks.ready); return view; } }));
  window.SeneschalAres.init({ loadScene });
  return { ares: window.SeneschalAres, elements, window, document, events, storage, views, reduced, intersections };
}
const settled = () => new Promise(resolve => setImmediate(resolve));

test('top sidebar migration docks once without changing visibility, minimized choice or camera', async () => {
  const layout = JSON.stringify({ floating: true, minimized: true, yaw: .6, pitch: .2, width: 240, height: 280 });
  const migrated = fixture('false', undefined, layout, null); await settled();
  const value = JSON.parse(migrated.storage['seneschal-ares-layout']);
  assert.equal(value.floating, false); assert.equal(value.minimized, true); assert.equal(value.yaw, .6); assert.equal(value.pitch, .2);
  assert.equal(migrated.storage['seneschal-ares-dock-layout'], 'top-v1'); assert.equal(migrated.elements.aresCompanion.hidden, true);
  const current = fixture('true', undefined, layout); await settled();
  assert.equal(current.storage['seneschal-ares-layout'], undefined, 'subsequent custom floating positions survive');
});

test('scrolling the companion off screen stops rendering and returning restores visibility', async () => {
  const f = fixture('true'); await settled();
  f.intersections[0]([{ isIntersecting: false }]); assert.equal(f.views[0].visible, false);
  f.ares.setState('Speaking'); assert.equal(f.views[0].visible, false, 'state updates cannot restart an off-screen scene');
  f.intersections[0]([{ isIntersecting: true }]); assert.equal(f.views[0].visible, true);
  f.elements.aresMinimize.events.click(); f.intersections[0]([{ isIntersecting: true }]); assert.equal(f.views[0].visible, false, 'minimized does not resume graphics');
});

test('right sidebar is ordered mascot, compact Pulse, settings with stable section identities', () => {
  const html = read('app/index.html'), sidebar = html.slice(html.indexOf('<aside class="inspector"'), html.indexOf('</aside>', html.indexOf('<aside class="inspector"')));
  assert.ok(sidebar.indexOf('id="aresSidebarSlot"') < sidebar.indexOf('data-inspector-section="pulse"'));
  assert.ok(sidebar.indexOf('data-inspector-section="pulse"') < sidebar.indexOf('id="inspectorContent"'));
  for (const key of ['pulse', 'permissions', 'tools', 'browser', 'creative', 'code', 'budget', 'providers']) assert.equal(sidebar.split(`data-inspector-section="${key}"`).length - 1, 1);
  for (const id of ['aresSidebarSlot', 'eventRate', 'ambientRate', 'pulseLabel', 'eventCount', 'versionText']) assert.equal(html.split(`id="${id}"`).length - 1, 1);
  assert.match(sidebar, /inspector-pulse collapsed/); assert.match(sidebar, /pulse-summary/);
  const app = read('app/app.js'); assert.match(app, /const key = section\.dataset\.inspectorSection \|\| keys\[index\]/);
  assert.match(app, /button\.setAttribute\("aria-controls", content\.map/);
});

test('composer keeps Upload and Options on the left; Mascot sits beside Voice before Send', () => {
  const html=read('app/index.html'), start=html.indexOf('id="composerOptionsPanel"'), end=html.indexOf('</details>',start), tools=html.slice(start,end);
  const ids=['agentSelect','modelVariantSelect','skillsButton'];
  for(let i=1;i<ids.length;i++)assert.ok(tools.indexOf(`id="${ids[i-1]}"`)<tools.indexOf(`id="${ids[i]}"`));
  assert.equal(tools.includes('id="attachFilesButton"'),false);assert.equal(tools.includes('id="voiceButton"'),false);
  const footer=html.slice(html.indexOf('<div class="composer-footer">'),html.indexOf('</form>',html.indexOf('<div class="composer-footer">')));
  assert.ok(footer.indexOf('id="attachFilesButton"')<footer.indexOf('id="composerOptions"'));
  assert.match(footer, /class="send-group"[\s\S]*id="voiceButton"[\s\S]*id="sendButton"/);
  assert.ok(footer.indexOf('id="aresToggle"')<footer.indexOf('id="voiceButton"'));
  assert.ok(footer.indexOf('id="aresToggle"')>footer.indexOf('class="send-group"'));
  const button=footer.match(/<button[^>]+id="voiceButton"[^>]*>/)[0], arrow=footer.match(/<button[^>]+id="voiceMenuButton"[^>]*>/)[0];
  assert.doesNotMatch(button,/popovertarget|aria-expanded/);assert.match(arrow,/popovertarget="voiceOptionsPanel"/);assert.match(arrow,/aria-label="Voice options"/);
  const source=read('app/app.js'), section=source.slice(source.indexOf('  function bindVoiceControls()'),source.indexOf('  function bindEvents()',source.indexOf('  function bindVoiceControls()')));
  const calls=[],nodes={};
  const node=id=>nodes[id]||=( {events:{},attrs:{},open:false,style:{},addEventListener(name,fn){this.events[name]=fn;},getAttribute(name){return this.attrs[name];},setAttribute(name,value){this.attrs[name]=value;},click(){calls.push(id);},matches(){return this.open;},hidePopover(){this.open=false;},showPopover(){this.open=true;},focus(){calls.push('focus '+id);},getBoundingClientRect(){return {left:100,top:500};}} );
  const context=vm.createContext({ $:selector=>node(selector), document:{querySelectorAll:()=>[]}, els:{mic:node('#micButton'),talk:node('#talkButton')},window:{addEventListener(){}},innerWidth:900,innerHeight:700 });
  vm.runInContext(section+';bindVoiceControls();',context);
  node('#voiceButton').events.click();assert.deepEqual(calls,['#talkButton']);
  calls.length=0;node('#micButton').attrs['aria-pressed']='true';node('#voiceButton').events.click();assert.deepEqual(calls,['#micButton']);
  calls.length=0;node('#voiceOptionsPanel').open=true;node('#voiceOptionsPanel').events.toggle();assert.equal(node('#voiceMenuButton').attrs['aria-expanded'],'true');assert.deepEqual(calls,[]);
});

test('Seneschal controls persist visibility, preserve voice independence and return keyboard focus on close', async () => {
  const f = fixture(); assert.equal(f.elements.aresCompanion.hidden, true); assert.equal(f.views.length, 0);
  f.elements.aresToggle.events.click(); await settled();
  assert.equal(f.views.length, 1); assert.equal(f.elements.aresCompanion.hidden, false); assert.equal(f.elements.aresToggle.attrs['aria-pressed'], 'true');
  f.ares.setState('Listening'); f.ares.setState('Speaking'); assert.equal(f.elements.aresStatus.textContent, 'Speaking');
  f.elements.aresMotion.events.click(); assert.equal(f.views[0].paused, true);
  f.elements.aresClose.events.click(); assert.equal(f.views[0].disposed, true); assert.equal(f.elements.aresToggle.focused, true);
  assert.equal(f.storage['seneschal-ares-visible'], 'false'); assert.equal(f.elements.aresEnabled.checked, false);
  assert.doesNotMatch(code, /getUserMedia|sendPrompt|replyPermission|prompt_async|nvidia-speech\/|SpeechRecognition/);
});

test('late scene imports cannot reopen a hidden Seneschal; missing renderer remains a visible error', async () => {
  let release, created = 0; const waiting = new Promise(resolve => { release = resolve; });
  const f = fixture('false', () => waiting);
  f.elements.aresToggle.events.click(); f.elements.aresClose.events.click();
  release({ createAresView() { created++; } }); await settled(); assert.equal(created, 0); assert.equal(f.elements.aresCompanion.hidden, true);
  const failed = fixture('false', async () => { throw Error('synthetic load failure'); });
  failed.elements.aresToggle.events.click(); await settled(); assert.match(failed.elements.aresStatus.textContent, /could not load.*restart Seneschal/i);
  failed.ares.setState('Speaking'); assert.match(failed.elements.aresStatus.textContent, /could not load/);
});

test('small keyboard viewports, background tabs and reduced motion pause without changing the stored choice', async () => {
  const f = fixture('true'); await settled(); const view = f.views[0];
  f.document.hidden = true; f.events.visibilitychange(); assert.equal(view.visible, false);
  f.document.hidden = false; f.reduced.matches = true; f.events.visibilitychange(); assert.equal(view.paused, true);
  f.elements.composerForm.getBoundingClientRect = () => ({ top: 220, right: 380 }); f.events.resize();
  assert.equal(f.elements.aresCompanion.hidden, true); assert.equal(f.storage['seneschal-ares-visible'], 'true');
  f.events.beforeunload(); assert.equal(view.disposed, true);
});

test('pointer movement and resize are bounded above the composer; cancelled gestures restore previous geometry', async () => {
  const f = fixture('true'); await settled(); const panel = f.elements.aresCompanion;
  const start = { ...panel.style }, event = (x, y) => ({ pointerId: 3, button: 0, isPrimary: true, clientX: x, clientY: y, preventDefault() {} });
  f.elements.aresDrag.events.pointerdown(event(100, 100)); f.elements.aresDrag.events.pointermove(event(60, 70));
  assert.ok(parseFloat(panel.style.left) < parseFloat(start.left));
  f.elements.aresDrag.events.pointercancel(); assert.equal(panel.style.left, start.left); assert.equal(panel.style.top, start.top);
  f.elements.aresDrag.events.pointerdown(event(100, 100)); f.elements.aresDrag.events.pointermove(event(-10000, 10000)); f.elements.aresDrag.events.pointerup();
  assert.ok(parseFloat(panel.style.left) >= 8); assert.ok(parseFloat(panel.style.top) + parseFloat(panel.style.height) <= 572);
  assert.equal(JSON.parse(f.storage['seneschal-ares-layout']).floating, true);
  f.elements.aresResize.events.pointerdown(event(100, 100)); f.elements.aresResize.events.pointermove(event(10000, 10000)); f.elements.aresResize.events.pointerup();
  assert.ok(parseFloat(panel.style.width) <= 374); assert.ok(parseFloat(panel.style.top) + parseFloat(panel.style.height) <= 572);
});

test('minimize suspends graphics, maximize does not start voice, and Restore and Reset preserve the conversation', async () => {
  const f = fixture('true'); await settled(); let voiceClicks = 0;
  f.elements.aresStage.appendChild = function(child) { child.parentNode = this; };
  f.elements.aresStage.showModal = function() { this.open = true; }; f.elements.aresStage.close = function() { this.open = false; };
  f.elements.talkButton = { click() { voiceClicks++; } };
  f.elements.aresMinimize.events.click(); assert.equal(f.views[0].visible, false); assert.equal(f.elements.aresMinimize.attrs['aria-expanded'], 'false');
  assert.equal(JSON.parse(f.storage['seneschal-ares-layout']).minimized, true);
  f.elements.aresMaximize.events.click(); assert.equal(f.elements.aresStage.open, true); assert.equal(f.views[0].visible, true); assert.equal(voiceClicks, 0);
  f.elements.aresTalk.events.click(); assert.equal(voiceClicks, 1);
  f.ares.setState('Listening'); assert.equal(f.elements.aresTalk.textContent, 'Stop Talk');
  f.elements.aresStage.events.cancel({ preventDefault() {} }); assert.equal(f.elements.aresStage.open, false); assert.equal(voiceClicks, 1); assert.equal(f.views[0].disposed, false);
  f.elements.aresReset.events.click(); assert.equal(JSON.parse(f.storage['seneschal-ares-layout']).floating, false); assert.equal(f.views[0].visible, true);
  assert.equal(f.elements.aresStatus.textContent, 'Listening', 'layout controls leave Talk state unchanged');
});

test('malformed or extreme saved geometry cannot strand the companion off screen', async () => {
  for (const saved of ['invalid JSON', 'null', '{"width":999999,"height":999999,"x":-100,"y":100,"floating":true}']) {
    const f = fixture('true', undefined, saved); await settled(); const style = f.elements.aresCompanion.style;
    assert.ok(Number.isFinite(parseFloat(style.left))); assert.ok(parseFloat(style.left) >= 8);
    assert.ok(parseFloat(style.left) + parseFloat(style.width) <= 382); assert.ok(parseFloat(style.top) + parseFloat(style.height) <= 572);
  }
});

test('legacy floating positions are constrained to the conversation instead of overlapping sidebar controls', async () => {
  const f = fixture('true', undefined, '{"floating":true,"width":210,"height":260,"x":1,"y":1}'); await settled();
  f.document.querySelector = selector => selector === '.conversation-panel' ? { getBoundingClientRect: () => ({ left: 30, right: 350 }) } : null;
  f.events.resize(); const style = f.elements.aresCompanion.style;
  assert.ok(parseFloat(style.left) >= 38); assert.ok(parseFloat(style.left) + parseFloat(style.width) <= 342);
});

test('drag preview crosses into the entire sidebar; cancel restores geometry and release docks without covering controls', async () => {
  const f = fixture('true', undefined, '{"floating":true,"width":210,"height":260,"x":0,"y":0}'); await settled();
  const classes = new Set(['open']), inspector = f.elements.inspector;
  inspector.classList = { contains: value => classes.has(value), toggle(value, on) { if (on) classes.add(value); else classes.delete(value); } };
  inspector.getBoundingClientRect = () => ({ left: 250, right: 390, top: 150, bottom: 844 });
  f.elements.aresSidebarSlot.appendChild = function(child) { child.parentNode = this; };
  f.document.querySelector = selector => selector === '.conversation-panel' ? { getBoundingClientRect: () => ({ left: 0, right: 250 }) } : null;
  f.events.resize(); const initial = { ...f.elements.aresCompanion.style };
  const event = (x, y) => ({ pointerId: 7, button: 0, isPrimary: true, clientX: x, clientY: y, preventDefault() {} });
  f.elements.aresDrag.events.pointerdown(event(60, 180));
  f.elements.aresDrag.events.pointermove(event(330, 600));
  const preview = f.elements.aresCompanion.style;
  assert.ok(parseFloat(preview.left) + parseFloat(preview.width) > 250);
  assert.ok(parseFloat(preview.top) + parseFloat(preview.height) > 580, 'drag can reach the empty lower sidebar');
  assert.equal(f.elements.aresCompanion.hidden, false); assert.equal(classes.has('ares-drop-target'), true);
  assert.equal(f.elements.aresStatus.textContent, 'Release to dock in sidebar');
  f.elements.aresDrag.events.pointercancel(event(330, 600));
  assert.deepEqual(f.elements.aresCompanion.style, initial); assert.equal(classes.has('ares-drop-target'), false);
  classes.delete('open');
  f.elements.aresDrag.events.pointerdown(event(60, 180)); f.elements.aresDrag.events.pointermove(event(330, 300));
  assert.equal(classes.has('ares-drop-target'), false, 'closed sidebar is not a drop target');
  f.elements.aresDrag.events.pointerup(event(330, 300));
  assert.equal(JSON.parse(f.storage['seneschal-ares-layout']).floating, true);
  assert.ok(parseFloat(f.elements.aresCompanion.style.left) + parseFloat(f.elements.aresCompanion.style.width) <= 242);
  classes.add('open');
  f.elements.aresDrag.events.pointerdown(event(60, 180)); f.elements.aresDrag.events.pointermove(event(330, 300));
  f.elements.aresDrag.events.pointerup(event(330, 300));
  assert.equal(f.elements.aresCompanion.parentNode, f.elements.aresSidebarSlot, 'upper-half drop docks too');
  assert.equal(JSON.parse(f.storage['seneschal-ares-layout']).floating, false); assert.equal(classes.has('ares-drop-target'), false);
});

test('camera touch, keyboard and reset change only orientation; cancellation restores it and saved angles reload', async () => {
  const f = fixture('true'); await settled(); const before = { ...f.elements.aresCompanion.style }, host = f.elements.aresCanvas;
  const event = (x, y) => ({ pointerId: 4, isPrimary: true, button: 0, clientX: x, clientY: y, preventDefault() {} });
  host.events.pointerdown(event(0, 0)); host.events.pointermove(event(60, 20)); host.events.pointerup(event(60, 20));
  assert.ok(Math.abs(f.views[0].camera[0]) > 0.5); assert.deepEqual(f.elements.aresCompanion.style, before);
  const saved = f.storage['seneschal-ares-layout'], angles = [...f.views[0].camera];
  host.events.pointerdown(event(0, 0)); host.events.pointermove(event(40, 40)); host.events.pointercancel(event(40, 40));
  assert.deepEqual(f.views[0].camera, angles); assert.equal(f.storage['seneschal-ares-layout'], saved);
  const restored = fixture('true', undefined, saved); await settled(); assert.deepEqual(restored.views[0].camera, angles);
  host.events.keydown({ key: 'ArrowUp', preventDefault() {}, stopPropagation() {} }); assert.ok(f.views[0].camera[1] > angles[1]);
  f.elements.aresCameraReset.events.click(); assert.deepEqual(f.views[0].camera, [0, 0]);
  assert.equal(f.views[0].disposed, false); assert.equal(f.elements.aresStatus.textContent, 'Idle');
});

test('mascot routes are exact, read-only and retain restrictive content security policy', () => {
  for (const route of ['/workspace/ares.js', '/workspace/ares-scene.js', '/workspace/ares.css', '/workspace/assets/ares/ares.glb', '/workspace/assets/ares/three.module.js', '/workspace/assets/ares/GLTFLoader.js', '/workspace/assets/ares/BufferGeometryUtils.js']) {
    assert.equal(allowedRoute('GET', route), true); assert.equal(allowedRoute('POST', route), false);
  }
  for (const route of ['/workspace/assets/ares/other.js', '/workspace/assets/ares/ares.glb/extra', '/workspace/ares/config', '/workspace/assets/other.glb']) assert.equal(allowedRoute('GET', route), false);
  assert.doesNotMatch(read('server.js'), /wasm-unsafe-eval|worker-src[^"\n]*blob:/);
  assert.doesNotMatch(read('scripts/private-access-gateway.cjs'), /wasm-unsafe-eval|worker-src[^"\n]*blob:/);
});

test('branded Seneschal retains six clips, badge and mouth shapes without external buffers or Draco', () => {
  const bytes = fs.readFileSync(path.join(root, 'app/assets/ares/ares.glb'));
  assert.equal(bytes.readUInt32LE(0), 0x46546c67); assert.ok(bytes.length < 8 * 1024 * 1024);
  const gltf = JSON.parse(bytes.toString('utf8', 20, 20 + bytes.readUInt32LE(12)));
  assert.equal(gltf.animations.length, 6); for (const name of ['Seneschal_Idle', 'Seneschal_Listening', 'Seneschal_Thinking', 'Seneschal_Speaking', 'Seneschal_Greeting', 'Seneschal_Playful']) assert.ok(gltf.animations.some(clip => clip.name === name));
  assert.equal(gltf.buffers.some(item => item.uri), false); assert.equal((gltf.images || []).some(item => item.uri), false);
  assert.equal((gltf.extensionsUsed || []).includes('KHR_draco_mesh_compression'), false);
  assert.ok(gltf.meshes.some(mesh => mesh.extras?.targetNames?.includes('viseme_AA')));
  assert.ok(gltf.nodes.some(node => node.name === 'WEB | 08 | Seneschal icon badge'));
  assert.ok(gltf.images.length >= 1 && gltf.images.every(image => Number.isInteger(image.bufferView)), 'badge image is packed, not a remote request');
  assert.ok(gltf.meshes.length < 65, 'web-only rigid-material batching limits draw calls');
  for (const clip of gltf.animations) assert.equal(clip.channels.filter(channel => channel.target.path === 'weights').length, 1);
  const scene = read('app/ares-scene.js'); assert.doesNotMatch(scene, /https?:\/\/|getUserMedia|new AudioContext/);
  assert.match(scene, /powerPreference: 'low-power'/); assert.match(scene, /1000 \/ 30/); assert.match(scene, /renderer\.dispose\(\)/);
  assert.match(scene, /Seneschal_\$\{key\}/);
  assert.match(scene, /clip\.tracks\.filter\(track => !track\.name\.endsWith\('\.morphTargetInfluences'\)\)/, 'body tracks cannot fight the live mouth controller');
  assert.match(scene, /cache: 'no-store'/);
  assert.match(scene, /parser\.textureLoader = new THREE\.TextureLoader\(parser\.options\.manager\)/, 'embedded badge uses img-src, not a blocked blob fetch');
  assert.match(scene, /textureFailed.*Embedded mascot artwork could not be decoded/, 'missing textures must not masquerade as a successful load');
});

test('speech mouth has smooth bounded targets, real silence and an explicit browser approximation', () => {
  const scene = read('app/ares-scene.js'), context = vm.createContext({});
  vm.runInContext(scene.slice(scene.indexOf('export function companionMouthTargets'), scene.indexOf('export function createAresView')).replace('export ', ''), context);
  const targets = context.companionMouthTargets;
  const silence = targets('Speaking', 0, 1);
  assert.equal(silence.viseme_AA + silence.viseme_EE + silence.viseme_OO, 0); assert.equal(silence.viseme_MBP, 1);
  assert.ok(targets('Idle', 0, 0).Mouth_Smile > 0); assert.equal(targets('Listening', 1, 0).viseme_AA, 0);
  for (const level of [-1, 0, 0.1, 0.4, 1, 100, NaN]) for (let t = 0; t < 5; t += 0.017) {
    const current = targets('Speaking', level, t), next = targets('Speaking', level, t + 0.001);
    assert.ok(Object.values(current).every(value => Number.isFinite(value) && value >= 0 && value <= 1));
    assert.ok(Math.abs(Object.values(current).reduce((a, b) => a + b, 0) - 1) < 1e-8);
    assert.ok(Object.keys(current).every(key => Math.abs(next[key] - current[key]) < 0.03), 'no phoneme hard-switches');
  }
  const quiet = targets('Speaking', 0.05, 1);
  assert.ok(quiet.viseme_AA + quiet.viseme_EE + quiet.viseme_OO > 0.40, 'quiet speech is lifted rather than disappearing');
  const browser = targets('Speaking', -1, 1);
  assert.ok(browser.viseme_MBP <= 0.35, 'browser approximation has clearly open syllables');
});

test('closer mascot framing retains a padded whole-character fit at every camera angle and card aspect', () => {
  const scene = read('app/ares-scene.js'), context = vm.createContext({});
  vm.runInContext(scene.slice(scene.indexOf('export function fittedCameraDistance'), scene.indexOf('export function companionMouthTargets')).replace('export ', ''), context);
  const size = { x: 1.9, y: 2.2, z: 1.5 }, vertical = Math.tan(38 * Math.PI / 360);
  for (const aspect of [0.45, 0.8, 1, 1.85, 2.5, 4]) for (const pitch of [-1.15, -0.5, 0, 0.5, 1.15]) for (let yaw = -Math.PI; yaw < Math.PI; yaw += Math.PI / 12) {
    const distance = context.fittedCameraDistance(size, aspect, yaw, pitch, 38);
    const old = Math.hypot(size.x, size.y, size.z) / 2 / Math.sin(Math.min(Math.atan(vertical), Math.atan(vertical * aspect))) * 1.08;
    assert.ok(distance < old, 'camera is closer than the original framing');
    let occupied = 0;
    for (const x of [-size.x / 2, size.x / 2]) for (const y of [-size.y / 2, size.y / 2]) for (const z of [-size.z / 2, size.z / 2]) {
      const depth = distance - (Math.cos(pitch) * Math.sin(yaw) * x + Math.sin(pitch) * y + Math.cos(pitch) * Math.cos(yaw) * z);
      const right = Math.cos(yaw) * x - Math.sin(yaw) * z, up = -Math.sin(pitch) * Math.sin(yaw) * x + Math.cos(pitch) * y - Math.sin(pitch) * Math.cos(yaw) * z;
      occupied = Math.max(occupied, Math.abs(right) / (depth * vertical * aspect), Math.abs(up) / (depth * vertical));
      assert.ok(depth > 0 && Math.abs(right) / (depth * vertical * aspect) <= 1 / 1.08 + 1e-10 && Math.abs(up) / (depth * vertical) <= 1 / 1.08 + 1e-10, 'all corners stay inside the padded camera frame');
    }
    assert.ok(Math.abs(occupied - 1 / 1.08) < 1e-10, 'model fills the frame up to the safety margin rather than leaving the old extra space');
  }
});

test('the integrated Seneschal control is outside collapsed Options and cannot submit a prompt', () => {
  const html = read('app/index.html'), start = html.indexOf('<details class="composer-options"'), end = html.indexOf('</details>', start);
  assert.ok(html.indexOf('id="aresToggle"') > end); assert.match(html, /id="aresToggle" type="button"/);
  for (const id of ['aresToggle', 'aresEnabled', 'aresCompanion', 'aresClose', 'aresMotion']) assert.equal(html.split(`id="${id}"`).length - 1, 1);
  assert.match(html, /id="aresEnabled" aria-describedby="aresHelp"/); assert.match(html, /id="aresStatus" role="status" aria-live="polite"/);
  assert.match(read('app/app.js'), /SeneschalAres\?\.setState\(active \?/);
  assert.match(read('app/nvidia-speech.js'), /SeneschalAres\.setAnalyser\(analyser\)/);
});

test('NVIDIA playback exposes only a local level analyser and clears it on completion or Stop', async () => {
  const levels = [], connections = [], sources = [], calls = [];
  const analyser = { connect(value) { connections.push(value); }, disconnect() { this.disconnected = true; } };
  const window = { SeneschalAres: { setAnalyser(value) { levels.push(value); } }, AudioContext: class {
    constructor() { this.state = 'running'; this.destination = 'speakers'; }
    async decodeAudioData() { return 'synthetic decoded audio'; }
    createAnalyser() { return analyser; }
    createBufferSource() { const node = { connect(value) { connections.push(value); }, start() { this.started = true; }, stop() {}, disconnect() {} }; sources.push(node); return node; }
    async close() { this.state = 'closed'; }
  } };
  const controls = { voiceServiceSelect: { value: 'nvidia' }, nvidiaVoiceConsent: { checked: true } };
  vm.runInNewContext(read('app/nvidia-speech.js'), { window, document: { getElementById: id => controls[id] }, localStorage: { getItem: () => '{}' }, AbortController, setTimeout, clearTimeout, fetch: async (url, options) => { calls.push({ url, options }); return { ok: true, arrayBuffer: async () => new ArrayBuffer(1) }; } });
  let ended = 0;
  const callbacks = { onState() {}, onEnd() { ended++; }, onError(error) { assert.fail(error.message); } };
  await window.SeneschalNvidiaVoice.speak('Synthetic speech test', callbacks);
  assert.equal(levels.at(-1), analyser); assert.equal(analyser.fftSize, 256); assert.equal(sources[0].started, true);
  assert.deepEqual(connections, [analyser, 'speakers']);
  sources[0].onended(); assert.equal(levels.at(-1), null); assert.equal(ended, 1); assert.equal(analyser.disconnected, true);
  await window.SeneschalNvidiaVoice.speak('Another synthetic test', callbacks);
  const lateCompletion = sources[1].onended;
  window.SeneschalNvidiaVoice.stop(); assert.equal(levels.at(-1), null);
  assert.equal(sources[1].onended, null, 'Stop detaches the playback handler');
  lateCompletion(); assert.equal(ended, 1, 'late playback completion cannot resume Talk after Stop');
  assert.equal(calls.length, 2); assert.ok(calls.every(call => call.url === '/workspace/nvidia-speech/speak'));
});

test('a missing mascot script explains the stale host without sending anything or pretending it enabled', () => {
  const app = read('app/app.js'), start = app.indexOf('  function bindAresAvailability('), end = app.indexOf('  function bindComposerOptions(', start);
  const elements = { aresEnabled: { checked: true }, aresAvailability: { hidden: true }, aresToggle: {} };
  for (const element of Object.values(elements)) element.addEventListener = function(name, callback) { this[name] = callback; };
  const window = {};
  const context = vm.createContext({ window, $: selector => elements[selector.slice(1)] });
  vm.runInContext(app.slice(start, end) + '\nbindAresAvailability();', context);
  elements.aresToggle.click(); assert.equal(elements.aresAvailability.hidden, false); assert.match(elements.aresAvailability.textContent, /restart Seneschal only/); assert.equal(elements.aresEnabled.checked, false);
  elements.aresEnabled.checked = true; window.SeneschalAres = {}; elements.aresEnabled.change(); assert.equal(elements.aresEnabled.checked, true, 'loaded companion owns its controls');
});
