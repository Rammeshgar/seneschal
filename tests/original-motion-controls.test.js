'use strict';

// UI routing and lifecycle tests use deterministic fake renderer geometry.
// Actual pixels/motion are tested separately by the original-world raster suite.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { browser } = require('./wallpapers-host-fixture.cjs');
const { catalog } = require('../app/wallpapers.js');
const originals = {
  citylight: ['traffic', 'lanterns', 'cat', 'signal', 'lights', 'puddles'],
  'pixel-city': ['traffic', 'kitchen', 'cat', 'signal', 'lights', 'puddles'],
  'lunar-relay': ['rover', 'drone', 'surveyor', 'signal', 'lights', 'dust'],
  'orbital-foundry': ['cargo', 'repair', 'robot', 'signal', 'lights', 'vent']
};
const opened = id => { const f = browser({ selected: id, gallery: true }); f.host.open(); f.host.openPreview(); f.flush(); return f; };
const effects = f => f.engines.at(-1).state.effects;
const centerEvent = spot => ({ clientX: 10 + spot.x + spot.w / 2, clientY: 20 + spot.y + spot.h / 2 });

test('four originals expose six distinct named actions in the agreed order', () => {
  for (const [id, expected] of Object.entries(originals)) {
    const world = catalog.find(item => item.id === id);
    assert.deepEqual(world.actions.map(item => item[0]), expected);
    assert.equal(new Set(world.actions.map(item => item[1])).size, 6);
    assert.ok(world.actions.every(item => item[1].length > 5));
  }
  assert.equal(catalog.filter(world => world.kind === 'afterlight').length, 5);
});

test('all 24 original hotspots dispatch their exact action, not the first action', () => {
  for (const id of Object.keys(originals)) {
    const f = opened(id), stage = f.nodes.get('atmospherePreviewStage');
    assert.equal(f.host.hotspots().length, 6);
    for (const spot of f.host.hotspots()) {
      const event = centerEvent(spot);
      stage.emit('pointermove', event);
      assert.equal(f.host.diagnostics().hoveredAction, spot.action);
      assert.match(f.nodes.get('atmosphereHoverLabel').textContent, /click or use/);
      const before = effects(f).length;
      stage.emit('click', event);
      assert.equal(effects(f).length, before + 1);
      assert.equal(effects(f).at(-1), spot.action);
      assert.equal(f.host.diagnostics().lastAction, spot.action);
      assert.match(f.nodes.get('atmosphereActionFeedback').textContent, /triggered/);
    }
    const count = effects(f).length;
    stage.emit('click', { clientX: 20, clientY: 30 });
    stage.emit('click', { clientX: 2000, clientY: 2000 });
    assert.equal(effects(f).length, count, 'empty scene space and outside clicks do nothing');
    stage.emit('pointerleave'); assert.equal(f.host.diagnostics().hoveredAction, '');
    assert.equal(f.frames.size, 1); f.host.dispose(); assert.equal(f.frames.size, 0);
  }
});

test('letterboxed full-scene coordinates and overlays match 960 by 540 artwork', () => {
  const f = opened('orbital-foundry'), stage = f.nodes.get('atmospherePreviewStage');
  f.resize({ left: 10, top: 20, width: 480, height: 600 });
  const layer = f.nodes.get('atmosphereHotspots');
  assert.equal(layer.style.width, '480px'); assert.equal(layer.style.height, '270px');
  assert.equal(layer.style.left, '0px'); assert.equal(layer.style.top, '165px');
  const spot = f.host.hotspots()[4];
  stage.emit('click', { clientX: 10 + (spot.x + spot.w / 2) * .5, clientY: 20 + 165 + (spot.y + spot.h / 2) * .5 });
  assert.equal(effects(f).at(-1), 'lights');
  stage.emit('click', { clientX: 240, clientY: 40 });
  stage.emit('click', { clientX: 240, clientY: 590 });
  assert.equal(effects(f).length, 1, 'letterbox bars cannot fire actions');
  const reads = f.rectReads(); for (let i = 0; i < 60; i++) f.step();
  assert.equal(f.rectReads(), reads, 'animation loop never measures DOM layout');
  f.host.dispose(); assert.ok(f.resizes.every(item => !item.live));
});

test('optional hotspot overlays are named native buttons and keep focus through preference changes', () => {
  for (const id of Object.keys(originals)) {
    const f = opened(id), layer = f.nodes.get('atmosphereHotspots'), toggle = f.nodes.get('atmosphereShowHotspots');
    assert.equal(layer.hidden, true); assert.equal(toggle.getAttribute('aria-pressed'), 'false');
    toggle.emit('click'); assert.equal(layer.hidden, false); assert.equal(toggle.getAttribute('aria-pressed'), 'true');
    assert.equal(layer.children.length, 6);
    layer.children.forEach((button, index) => {
      assert.equal(button.tagName, 'BUTTON'); assert.equal(button.type, 'button');
      assert.equal(button.getAttribute('aria-keyshortcuts'), String(index + 1));
      assert.match(button.getAttribute('aria-label'), new RegExp('^' + (index + 1) + '\\. '));
      assert.ok(button.style.left.endsWith('%')); assert.ok(button.style.width.endsWith('%'));
      button.emit('click'); assert.equal(effects(f).at(-1), originals[id][index]);
    });
    const focused = layer.children[2]; focused.focus();
    assert.equal(f.host.diagnostics().hoveredAction, originals[id][2]);
    f.host.change('worldGlow', 24, true); f.host.change('quality', 60);
    assert.equal(layer.children[2], focused); assert.equal(f.doc.activeElement, focused);
    toggle.emit('click'); assert.equal(layer.hidden, true); f.host.dispose();
  }
});

test('preview-only keys 1 through 6 fire all 24 actions without capturing typing or modified shortcuts', () => {
  for (const [id, actions] of Object.entries(originals)) {
    const f = opened(id), preview = f.nodes.get('atmospherePreview');
    actions.forEach((action, index) => {
      let prevented = false;
      preview.emit('keydown', { key: String(index + 1), preventDefault() { prevented = true; } });
      assert.equal(effects(f).at(-1), action); assert.equal(prevented, true);
    });
    const count = effects(f).length;
    for (const modifier of ['altKey', 'ctrlKey', 'metaKey', 'repeat', 'defaultPrevented']) preview.emit('keydown', { key: '1', [modifier]: true });
    for (const tagName of ['INPUT', 'TEXTAREA', 'SELECT']) preview.emit('keydown', { key: '2', target: { tagName } });
    preview.emit('keydown', { key: '3', target: { isContentEditable: true } });
    preview.emit('keydown', { key: '0' }); preview.emit('keydown', { key: '7' });
    assert.equal(effects(f).length, count);
    preview.close(); f.flush(); preview.emit('keydown', { key: '1' });
    assert.equal(effects(f).length, count); f.host.dispose();
  }
});

test('six action buttons are keyboard-native and persist across pause and slider changes', () => {
  const f = opened('lunar-relay'), list = f.nodes.get('atmospherePreviewActions');
  assert.equal(list.children.length, 6);
  const button = list.children[3]; button.focus();
  f.host.change('worldActivity', 79, true); f.host.change('paused', true);
  assert.equal(list.children[3], button); assert.equal(f.doc.activeElement, button);
  for (const [index, item] of list.children.entries()) {
    assert.equal(item.tagName, 'BUTTON'); assert.equal(item.getAttribute('aria-keyshortcuts'), String(index + 1));
    item.emit('click'); assert.equal(effects(f).at(-1), originals['lunar-relay'][index]);
    assert.equal(f.frames.size, 0); assert.match(f.nodes.get('atmosphereActionFeedback').textContent, /still-frame result/);
  }
  f.host.dispose();
});

test('quiet conversations explain their still frame and offer an explicit opt-in, not a changed default', () => {
  const f = browser({ selected: 'orbital-foundry', gallery: true });
  assert.equal(f.host.preferences().animateConversation, false);
  f.mutate('data-session-active', 'true');
  assert.equal(f.host.diagnostics().motionState, 'quiet'); assert.equal(f.frames.size, 0);
  assert.match(f.nodes.get('atmosphereStatus').textContent, /quiet conversation/);
  assert.match(f.nodes.get('atmosphereConversationHint').textContent, /still frame by default/);
  assert.equal(f.nodes.get('atmosphereEnableConversation').hidden, false);
  f.host.open(); assert.equal(f.frames.size, 0);
  f.nodes.get('atmosphereEnableConversation').emit('click');
  assert.equal(f.host.preferences().animateConversation, true);
  assert.equal(f.nodes.get('pref-animateConversation').checked, true);
  assert.equal(f.nodes.get('atmosphereEnableConversation').hidden, true);
  assert.equal(f.frames.size, 0, 'opening the gallery still pauses the background');
  f.nodes.get('atmosphereDialog').close(); f.flush(); assert.equal(f.frames.size, 1);
  f.host.dispose();
});

test('full preview escapes quiet conversation mode without changing the saved opt-in', () => {
  const f = browser({ selected: 'orbital-foundry', gallery: true });
  f.mutate('data-session-active', 'true'); f.host.open(); f.host.openPreview(); f.flush();
  assert.equal(f.host.preferences().animateConversation, false); assert.equal(f.frames.size, 1);
  assert.equal(f.host.diagnostics().motionState, 'live'); assert.match(f.nodes.get('atmospherePreviewStatus').textContent, /Live animation/);
  f.nodes.get('atmospherePreview').close(); f.flush();
  assert.equal(f.frames.size, 0); assert.equal(f.host.diagnostics().motionState, 'quiet'); f.host.dispose();
});

test('manual, reduced-motion and hidden pause reasons take precedence and never start an extra loop', () => {
  const f = opened('citylight');
  f.host.change('paused', true); assert.equal(f.host.diagnostics().motionState, 'paused');
  assert.match(f.nodes.get('atmospherePreviewStatus').textContent, /manually paused/); assert.equal(f.frames.size, 0);
  f.reduced(true); assert.equal(f.host.diagnostics().motionState, 'reduced');
  assert.match(f.nodes.get('atmospherePreviewStatus').textContent, /system Reduced motion/);
  f.host.change('animateConversation', true); f.host.change('paused', false); assert.equal(f.frames.size, 0);
  f.host.effect('signal'); assert.equal(f.frames.size, 0);
  f.reduced(false); assert.equal(f.frames.size, 1);
  f.hidden(true); assert.equal(f.host.diagnostics().motionState, 'hidden');
  assert.match(f.nodes.get('atmospherePreviewStatus').textContent, /window is hidden/); assert.equal(f.frames.size, 0);
  f.hidden(false); f.host.sync(); f.host.sync(); assert.equal(f.frames.size, 1); f.host.dispose();
});

test('gallery accurately distinguishes thumbnails from live scenes and old state clears on scene change', () => {
  const f = opened('citylight');
  f.host.effect('cat'); f.nodes.get('atmospherePreviewStage').emit('pointermove', centerEvent(f.host.hotspots()[2]));
  assert.equal(f.host.diagnostics().lastAction, 'cat');
  f.host.select('orbital-foundry');
  assert.equal(f.host.diagnostics().lastAction, ''); assert.equal(f.host.diagnostics().hoveredAction, '');
  assert.match(f.nodes.get('atmosphereActionFeedback').textContent, /Six actions/);
  assert.match(f.nodes.get('atmosphereHoverLabel').textContent, /Explore the details/);
  f.nodes.get('atmospherePreview').close(); f.flush();
  assert.equal(f.host.diagnostics().motionState, 'gallery'); assert.match(f.nodes.get('atmosphereStatus').textContent, /thumbnails are still images/);
  assert.equal(f.frames.size, 0); f.host.dispose();
});

test('new preview controls have visible names, statuses and no remote or audio hooks', () => {
  const appRoot = path.join(__dirname, '..');
  const html = fs.readFileSync(path.join(appRoot, 'app/index.html'), 'utf8');
  const css = fs.readFileSync(path.join(appRoot, 'app/wallpapers.css'), 'utf8');
  const source = fs.readFileSync(path.join(appRoot, 'app/wallpapers.js'), 'utf8');
  assert.match(html, /id="atmosphereShowHotspots"[^>]+aria-pressed="false"[^>]+aria-controls="atmosphereHotspots"/);
  assert.match(html, /id="atmosphereActionFeedback"[^>]+role="status"[^>]+aria-live="polite"/);
  assert.match(html, /id="atmosphereEnableConversation"[^>]+hidden>Enable conversation animation/);
  assert.match(css, /\.atmosphere-preview \[hidden\][^}]+display: none !important/);
  assert.match(css, /\.atmosphere-hotspot[^}]+pointer-events: auto/);
  assert.doesNotMatch(source, /\b(?:fetch|WebSocket|EventSource|AudioContext|MediaRecorder|getUserMedia)\s*\(/);
});
