'use strict';

// Pure host fixtures only: no Seneschal bootstrap, real DOM, canvas package,
// private files, sockets, processes, audio, providers, or application sessions.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const sourcePath = path.join(__dirname, '..', 'app', 'wallpapers.js');
const source = fs.readFileSync(sourcePath, 'utf8');
const { catalog, defaults, normalize, normalizeScene } = require(sourcePath);
const plain = value => JSON.parse(JSON.stringify(value));

const { browser } = require('./wallpapers-host-fixture.cjs');
test('host catalog adds Citylight alongside all eight existing pixel worlds', () => {
  assert.equal(new Set(catalog.map(world => world.id)).size, catalog.length);
  for (const id of ['orbit', 'still', 'citylight', 'pixel-city', 'lunar-relay', 'orbital-foundry', 'afterlight-city', 'afterlight-observatory', 'afterlight-sleeper', 'afterlight-pelagic', 'afterlight-sanctuary']) assert.ok(catalog.some(world => world.id === id), id);
  assert.equal(catalog.filter(world => world.kind !== 'css').length, 9);
  assert.equal(catalog.filter(world => world.kind === 'afterlight').length, 5);
  const citylight = catalog.find(world => world.id === 'citylight');
  assert.equal(citylight.name, 'Citylight'); assert.equal(citylight.kind, 'legacy'); assert.equal(citylight.group, 'Seneschal originals');
  assert.ok(catalog.filter(world => world.kind !== 'css').every(world => world.actions.length >= 3));
});

test('preferences normalize invalid versions and clamp bounded values', () => {
  assert.equal(normalize({ version: 2, quality: 60, rotation: true }).quality, defaults().quality);
  const value = normalize({ version: 1, quality: 600, strength: 400, conversationStrength: 80, minutes: 2, paused: 'true', animateConversation: true, scenes: { 'pixel-city': { palette: 'bad', weather: 'snow', worldGlow: -3, worldActivity: 999, worldFeature: false } } });
  assert.equal(value.quality, 30); assert.equal(value.strength, 100); assert.equal(value.conversationStrength, 40); assert.equal(value.minutes, 10); assert.equal(value.paused, false);
  assert.equal(value.scenes['pixel-city'].palette, 'auto'); assert.equal(value.scenes['pixel-city'].weather, 'snow'); assert.equal(value.scenes['pixel-city'].worldGlow, 0); assert.equal(value.scenes['pixel-city'].worldActivity, 100); assert.equal(value.scenes['pixel-city'].worldFeature, false);
  assert.equal(normalizeScene(null, 'afterlight-city').weather, 'rain');
});

test('unknown saved selection and unavailable storage are harmless', () => {
  for (const options of [{ selected: 'unknown' }, { deniedStorage: true }]) { const f = browser(options); assert.equal(f.host.diagnostics().selected, 'orbit'); assert.equal(f.frames.size, 0); f.host.dispose(); }
});

test('animated legacy scene owns exactly one frame chain and stops while hidden', () => {
  const f = browser(); assert.equal(f.frames.size, 1); f.step(); f.step(); assert.equal(f.frames.size, 1);
  const count = f.host.diagnostics().renders; f.hidden(true); assert.equal(f.frames.size, 0); f.step(10000); assert.equal(f.host.diagnostics().renders, count);
  f.hidden(false); assert.equal(f.frames.size, 1); f.host.sync(); f.host.sync(); assert.equal(f.frames.size, 1); f.host.dispose(); assert.equal(f.frames.size, 0);
});

test('manual pause and reduced motion keep a single still frame without scheduled work', () => {
  const f = browser(); f.host.change('paused', true); assert.equal(f.frames.size, 0);
  f.host.change('worldGlow', 20, true); assert.equal(f.frames.size, 0); assert.equal(f.rendererLog.at(-1).prefs.worldGlow, 20);
  f.host.change('paused', false); assert.equal(f.frames.size, 1); f.reduced(true); assert.equal(f.frames.size, 0);
  f.host.change('quality', 60); assert.equal(f.frames.size, 0); f.reduced(false); assert.equal(f.frames.size, 1); f.host.dispose();
});

test('conversation quiet mode freezes motion unless explicitly enabled', () => {
  const f = browser(); f.mutate('data-session-active', 'true'); assert.equal(f.frames.size, 0); assert.equal(f.doc.documentElement.dataset.motionPaused, 'true');
  f.host.change('animateConversation', true); assert.equal(f.frames.size, 1); f.mutate('data-session-active', 'false'); assert.equal(f.frames.size, 1);
  f.host.dispose();
});

test('renderer switching cancels old loops, disposes legacy caches, and preserves per-world settings', () => {
  const f = browser(); const first = f.engines[0];
  f.host.change('worldGlow', 22, true); f.host.select('afterlight-city'); assert.equal(first.dead, true); assert.equal(f.frames.size, 1); assert.equal(f.host.diagnostics().legacyRAF, false);
  f.host.change('worldGlow', 81, true); f.host.select('lunar-relay'); assert.equal(f.frames.size, 1);
  f.host.select('pixel-city'); assert.equal(f.host.preferences().scenes['pixel-city'].worldGlow, 22); assert.equal(f.host.preferences().scenes['afterlight-city'].worldGlow, 81);
  f.host.select('still'); assert.equal(f.frames.size, 0); f.host.dispose();
});

test('Citylight uses its own renderer while City Nocturne keeps the legacy factory', () => {
  const f = browser({ selected: 'citylight' });
  const citylight = f.engines.at(-1);
  assert.equal(citylight.id, 'citylight'); assert.equal(citylight.factory, 'citylight'); assert.equal(citylight.canvas, f.canvas);
  assert.equal(f.host.diagnostics().selected, 'citylight'); assert.equal(f.host.diagnostics().lastError, ''); assert.equal(f.frames.size, 1);
  f.host.effect(catalog.find(world => world.id === 'citylight').actions[0][0]);
  assert.equal(f.rendererLog.at(-1).id, 'citylight');
  f.host.select('pixel-city');
  assert.equal(citylight.dead, true); assert.equal(f.engines.at(-1).id, 'pixel-city'); assert.equal(f.engines.at(-1).factory, 'legacy');
  assert.equal(f.engines.at(-1).canvas, f.canvas); assert.equal(f.frames.size, 1);
  f.host.select('citylight'); assert.equal(f.engines.at(-1).factory, 'citylight'); assert.equal(f.frames.size, 1);
  f.hidden(true); assert.equal(f.frames.size, 0); f.host.dispose();
});

test('saved eight-world preferences and selection remain compatible after adding Citylight', () => {
  const stored = { version: 1, quality: 15, strength: 62, minutes: 5, shuffle: true, scenes: {
    'pixel-city': { palette: 'sakura', weather: 'mist', worldGlow: 23, worldActivity: 41, intensity: 29, worldFeature: false },
    'afterlight-sanctuary': { palette: 'ember', weather: 'clear', worldGlow: 83, worldActivity: 67, intensity: 72, worldFeature: true }
  } };
  const f = browser({ selected: 'pixel-city', stored });
  assert.equal(f.host.diagnostics().selected, 'pixel-city'); assert.equal(f.engines.at(-1).factory, 'legacy');
  const prior = plain(f.host.preferences());
  assert.deepEqual(prior.scenes['pixel-city'], normalizeScene(stored.scenes['pixel-city'], 'pixel-city'));
  assert.deepEqual(prior.scenes['afterlight-sanctuary'], normalizeScene(stored.scenes['afterlight-sanctuary'], 'afterlight-sanctuary'));
  assert.equal(prior.quality, 15); assert.equal(prior.strength, 62); assert.equal(prior.minutes, 5); assert.equal(prior.shuffle, true);
  assert.deepEqual(prior.scenes.citylight, normalizeScene(undefined, 'citylight'));
  f.host.select('citylight'); f.host.change('worldGlow', 94, true);
  f.host.select('pixel-city'); assert.deepEqual(plain(f.host.preferences().scenes['pixel-city']), prior.scenes['pixel-city']);
  f.host.select('citylight'); assert.equal(f.host.preferences().scenes.citylight.worldGlow, 94);
  assert.deepEqual(plain(f.host.preferences().scenes['afterlight-sanctuary']), prior.scenes['afterlight-sanctuary']);
  f.host.dispose();
});

test('automatic palette follows theme while explicit palette remains stable', () => {
  const f = browser(); assert.equal(f.rendererLog.at(-1).prefs.palette, 'nocturne');
  f.mutate('data-theme', 'day'); assert.equal(f.rendererLog.at(-1).prefs.palette, 'ember');
  f.host.change('palette', 'sakura', true); f.mutate('data-theme', 'night'); assert.equal(f.rendererLog.at(-1).prefs.palette, 'sakura'); f.host.dispose();
});

test('paused Afterlight preference redraw and action do not rewind its clock or reseed preview effects', () => {
  const f = browser({ selected: 'afterlight-city' }); const state = f.engines.at(-1).state;
  f.step(); f.step(); f.host.change('paused', true); const time = state.time;
  assert.ok(time > 19); assert.equal(state.renderAtCalls, 1);
  f.host.change('worldGlow', 72, true); f.host.change('strength', 42); f.mutate('data-theme', 'day'); f.host.effect('train');
  assert.equal(state.time, time); assert.equal(state.renderAtCalls, 1); assert.equal(state.effects.at(-1), 'train'); assert.ok(state.renderCurrentCalls >= 4);
  assert.equal(state.manualPause, true); assert.equal(f.frames.size, 0); f.host.dispose();
});

test('reselecting the current Afterlight card does not rewind its live clock', () => {
  const f = browser({ selected: 'afterlight-city' }); const state = f.engines.at(-1).state;
  f.step(); f.step(); const time = state.time; const previews = state.renderAtCalls;
  f.host.select('afterlight-city'); assert.equal(state.time, time); assert.equal(state.renderAtCalls, previews); assert.equal(f.frames.size, 1); f.host.dispose();
});

test('rotation counts active viewing only and never immediately repeats a world', () => {
  const f = browser(); f.host.change('minutes', 1); f.host.change('rotation', true); assert.equal(f.intervals.size, 1);
  f.tick(1); f.host.change('paused', true); assert.equal(f.intervals.size, 0); f.tick(600); assert.equal(f.host.diagnostics().selected, 'pixel-city');
  f.host.change('paused', false); for (let i = 0; i < 59; i++) f.tick(1);
  const choices = catalog.filter(world => world.kind !== 'css'), current = choices.findIndex(world => world.id === 'pixel-city');
  assert.equal(f.host.diagnostics().selected, choices[(current + 1) % choices.length].id);
  f.host.change('shuffle', true); const prior = f.host.diagnostics().selected; f.host.next(); assert.notEqual(f.host.diagnostics().selected, prior);
  f.hidden(true); assert.equal(f.intervals.size, 0); f.hidden(false); assert.equal(f.intervals.size, 1); f.host.dispose(); assert.equal(f.intervals.size, 0);
});

test('rotation visits all nine pixel worlds without replacement and shuffle has no immediate repeats', () => {
  const f = browser({ selected: 'citylight' });
  const expected = catalog.filter(world => world.kind !== 'css').map(world => world.id), visited = [];
  for (let i = 0; i < expected.length; i++) { visited.push(f.host.diagnostics().selected); f.host.next(); assert.equal(f.frames.size, 1); }
  assert.equal(new Set(visited).size, 9); assert.deepEqual([...visited].sort(), [...expected].sort());
  assert.equal(f.host.diagnostics().selected, 'citylight');
  f.host.change('shuffle', true);
  for (let i = 0; i < 30; i++) { const prior = f.host.diagnostics().selected; f.host.next(); assert.notEqual(f.host.diagnostics().selected, prior); }
  f.host.dispose(); assert.equal(f.frames.size, 0);
});

test('gallery has keyboard-native named choices and selected state', () => {
  const f = browser({ gallery: true }); const buttons = f.nodes.get('atmosphereGallery').querySelectorAll('[data-world]');
  assert.equal(buttons.length, catalog.length);
  for (const button of buttons) { assert.equal(button.tagName, 'BUTTON'); assert.equal(button.type, 'button'); assert.ok(button.children.some(child => child.className === 'atmosphere-card-caption')); }
  assert.equal(buttons.find(button => button.dataset.world === 'pixel-city').getAttribute('aria-pressed'), 'true');
  const citylight = buttons.find(button => button.dataset.world === 'citylight');
  assert.equal(citylight.children.find(child => child.className === 'atmosphere-card-caption').children[0].textContent, 'Citylight');
  assert.equal(citylight.children.find(child => child.tagName === 'IMG').src, '/workspace/assets/wallpapers/citylight.png');
  citylight.emit('click'); assert.equal(citylight.getAttribute('aria-pressed'), 'true'); assert.equal(f.nodes.get('atmosphereName').textContent, 'Citylight');
  assert.equal(f.nodes.get('atmospherePreviewName').textContent, 'Citylight'); assert.equal(f.nodes.get('atmosphereActions').children.length, catalog.find(world => world.id === 'citylight').actions.length);
  assert.ok(f.nodes.get('atmosphereActions').children.every(button => button.tagName === 'BUTTON' && button.type === 'button' && button.textContent));
  f.host.select('afterlight-sleeper'); assert.equal(buttons.find(button => button.dataset.world === 'afterlight-sleeper').getAttribute('aria-pressed'), 'true'); f.host.dispose();
});

test('gallery and preview pause the workspace, restore canvas location, and return keyboard focus', () => {
  const f = browser({ gallery: true }); const trigger = f.nodes.get('motionSwitch'); trigger.focus();
  f.host.open(trigger); assert.equal(f.nodes.get('atmosphereDialog').open, true); assert.equal(f.frames.size, 0);
  f.host.openPreview(); f.flush(); assert.equal(f.nodes.get('atmospherePreview').open, true); assert.equal(f.canvas.parentNode, f.nodes.get('atmospherePreviewStage')); assert.equal(f.frames.size, 1);
  f.nodes.get('atmospherePreview').close(); f.flush(); assert.equal(f.canvas.parentNode, f.panel); assert.equal(f.nodes.get('atmosphereDialog').open, true); assert.equal(f.doc.activeElement, f.nodes.get('atmospherePreviewButton')); assert.equal(f.frames.size, 0);
  f.nodes.get('atmosphereDialog').close(); f.flush(); assert.equal(f.doc.activeElement, trigger); assert.equal(f.frames.size, 1); f.host.dispose();
});

test('wallpaper launcher has a permanent labelled sidebar home outside Workspace tools', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'app', 'index.html'), 'utf8');
  assert.equal((html.match(/id="motionSwitch"/g) || []).length, 1);
  const footer = html.indexOf('<div class="sidebar-footer">'), launcher = html.indexOf('id="motionSwitch"'), tools = html.indexOf('id="workspaceToolsPanel"');
  assert.ok(footer < launcher && launcher < tools);
  assert.match(html.slice(launcher - 80, launcher + 550), /aria-label="Open wallpaper themes"/);
  assert.match(html.slice(launcher - 80, launcher + 550), /aria-controls="atmosphereDialog"/);
  assert.match(html.slice(launcher, launcher + 750), />Wallpapers</);
  const css = fs.readFileSync(path.join(__dirname, '..', 'app', 'styles.css'), 'utf8');
  assert.match(css, /left-panel-collapsed[^}]+\.sidebar-footer[^}]+display: flex/);
  assert.match(css, /wallpaper-shortcut[^}]+min-height: 44px/);
});

test('preview offers keyboard action buttons and forwards pointers only inside the art stage', () => {
  const f = browser({ gallery: true, selected: 'afterlight-city' }); f.host.open(); f.host.openPreview(); f.flush();
  const actions = f.nodes.get('atmospherePreviewActions').children; assert.equal(actions.length, 6); assert.ok(actions.every(action => action.tagName === 'BUTTON' && action.type === 'button' && action.textContent));
  actions[0].emit('click'); assert.equal(f.engines.at(-1).state.effects.at(-1), 'train');
  const stage = f.nodes.get('atmospherePreviewStage'); stage.emit('pointermove', { clientX: 490, clientY: 290 }); assert.deepEqual(plain(f.engines.at(-1).state.point), { x: 480, y: 270 });
  stage.emit('click', { clientX: 2000, clientY: 2000 }); assert.equal(f.engines.at(-1).state.point.click, undefined); f.host.dispose();
});

test('page lifecycle and disposal stop timers and detach preview canvas safely', () => {
  const f = browser({ gallery: true }); f.host.change('rotation', true); f.root.emit('pagehide'); assert.equal(f.frames.size, 0); assert.equal(f.intervals.size, 0);
  f.root.emit('pageshow'); assert.equal(f.frames.size, 1); assert.equal(f.intervals.size, 1);
  f.host.open(); f.host.openPreview(); f.flush(); f.host.dispose(); f.flush(); assert.equal(f.canvas.parentNode, f.panel); assert.equal(f.frames.size, 0); assert.equal(f.intervals.size, 0);
  f.hidden(false); f.reduced(false); f.root.emit('pageshow'); assert.equal(f.frames.size, 0); assert.equal(f.intervals.size, 0); f.host.dispose();
});

test('renderer failure must stop scheduling rather than spin in a failure loop', () => {
  const f = browser({ failDraw: true }); assert.match(f.host.diagnostics().lastError, /Synthetic renderer failure/);
  assert.equal(f.frames.size, 0); assert.equal(f.host.diagnostics().canAnimate, false); f.host.dispose();
});

test('a later render failure cannot enqueue another frame after cancellation', () => {
  const f = browser(); f.failDraw(true); f.step();
  assert.match(f.host.diagnostics().lastError, /Synthetic renderer failure/);
  assert.equal(f.frames.size, 0); f.host.dispose();
});

test('host persistence is namespaced and does not touch Afterlight standalone preferences', () => {
  const f = browser(); f.host.change('strength', 65); f.host.select('afterlight-city');
  assert.deepEqual([...new Set(f.writes)].sort(), ['atelier-motion', 'seneschal-atmosphere.v1']);
  assert.equal(JSON.parse(f.data.get('atelier-motion')), 'afterlight-city');
  assert.equal(JSON.parse(f.data.get('seneschal-atmosphere.v1')).strength, 65); f.host.dispose();
});

test('wallpaper scripts have explicit same-origin static and narrow private-access routes', () => {
  const appRoot = path.join(__dirname, '..');
  const html = fs.readFileSync(path.join(appRoot, 'app', 'index.html'), 'utf8');
  const server = fs.readFileSync(path.join(appRoot, 'server.js'), 'utf8');
  const { allowedRoute, requestPath } = require('../scripts/private-access-policy.cjs');
  for (const route of ['/workspace/wallpapers.js', '/workspace/wallpapers.css', '/workspace/wallpapers/legacy-worlds.js', '/workspace/wallpapers/citylight-world.js', '/workspace/wallpapers/afterlight-worlds.js', '/workspace/wallpapers/afterlight-engine.js']) {
    assert.ok(html.includes(route), `HTML must load ${route}`);
    assert.ok(server.includes('["' + route + '"'), `Server must explicitly serve ${route}`);
    assert.equal(allowedRoute('GET', route), true); assert.equal(allowedRoute('POST', route), false);
  }
  for (const route of ['/workspace/wallpapers/unknown.js', '/workspace/wallpapers/afterlight-engine.js.map', '/workspace/wallpapers/citylight-world.js.map', '/workspace/wallpapers/citylight-world-test.js', '/workspace/wallpapers/citylight-world.js/extra', '/workspace/wallpapers.exe', '/workspace/wallpapers/config.json']) assert.equal(allowedRoute('GET', route), false, route);
  for (const route of ['/workspace/wallpapers/../app.js', '/workspace/wallpapers/%2e%2e/app.js', '/workspace/wallpapers%2fafterlight-engine.js']) assert.throws(() => requestPath(route));
});

test('markup provides native labeled dialogs and keeps workspace art decorative', () => {
  const appRoot = path.join(__dirname, '..');
  const html = fs.readFileSync(path.join(appRoot, 'app', 'index.html'), 'utf8');
  const css = fs.readFileSync(path.join(appRoot, 'app', 'wallpapers.css'), 'utf8');
  assert.match(html, /<canvas\b[^>]*id="pixelCity"[^>]*aria-hidden="true"/);
  assert.match(html, /<dialog\b[^>]*id="atmosphereDialog"[^>]*aria-labelledby="atmosphereHeading"/);
  assert.match(html, /<dialog\b[^>]*id="atmospherePreview"[^>]*aria-labelledby="atmospherePreviewName"/);
  for (const id of ['atmospherePalette', 'atmosphereWeather', 'atmosphereIntensity', 'atmosphereActivity', 'atmosphereGlow', 'atmosphereStrength', 'atmosphereConversationStrength', 'atmosphereQuality', 'atmosphereMinutes']) assert.ok(html.includes('for="' + id + '"'), `${id} needs a visible label`);
  assert.match(css, /\.atmosphere-preview-stage \.pixel-city\s*\{[^}]*pointer-events:\s*none/);
  assert.match(css, /:focus-visible\s*\{[^}]*outline:/);
  assert.match(source, /prefers-reduced-motion:\s*reduce/);
  assert.doesNotMatch(source, /\b(?:fetch|WebSocket|EventSource|AudioContext|MediaRecorder|getUserMedia)\s*\(/);
});
