'use strict';

// Isolated host UI fixture: no private files, real app, sockets, audio or providers.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const sourcePath = path.join(__dirname, '..', 'app', 'wallpapers.js');
const source = fs.readFileSync(sourcePath, 'utf8');
const { catalog } = require(sourcePath);
const plain = value => JSON.parse(JSON.stringify(value));

class Target {
  constructor() { this.listeners = new Map(); }
  addEventListener(type, fn) { if (!this.listeners.has(type)) this.listeners.set(type, new Set()); this.listeners.get(type).add(fn); }
  removeEventListener(type, fn) { this.listeners.get(type)?.delete(fn); }
  dispatchEvent(event) { event.target ||= this; for (const fn of [...(this.listeners.get(event.type) || [])]) fn(event); return true; }
  emit(type, detail = {}) { return this.dispatchEvent({ type, ...detail }); }
}

function browser({ selected = 'pixel-city', stored, hidden = false, reduced = false, gallery = false, deniedStorage = false, failDraw = false } = {}) {
  const queued = [], nodes = new Map(), frames = new Map(), intervals = new Map(), observations = [], resizes = [], writes = [], engines = [];
  let now = 100, nextId = 1, rectReads = 0;
  class Node extends Target {
    constructor(tag = 'div', id = '') { super(); this.tagName = tag.toUpperCase(); this.id = id; this.children = []; this.dataset = {}; this.attributes = {}; this.style = { setProperty: (key, value) => { this.style[key] = value; } }; this.parentNode = null; this.open = false; this.hidden = false; this.width = 0; this.height = 0; this.type = ''; this.value = ''; this.checked = false; this.disabled = false; }
    append(...items) { for (const item of items) { item.remove?.(); this.children.push(item); item.parentNode = this; } }
    before(item) { item.remove?.(); const list = this.parentNode.children; list.splice(list.indexOf(this), 0, item); item.parentNode = this.parentNode; }
    after(item) { item.remove?.(); const list = this.parentNode.children; list.splice(list.indexOf(this) + 1, 0, item); item.parentNode = this.parentNode; }
    remove() { if (!this.parentNode) return; const siblings = this.parentNode.children; const i = siblings.indexOf(this); if (i >= 0) siblings.splice(i, 1); this.parentNode = null; }
    replaceChildren(...items) { this.children.forEach(item => { item.parentNode = null; }); this.children = []; this.append(...items); }
    setAttribute(name, value) { this.attributes[name] = String(value); }
    getAttribute(name) { return this.attributes[name] ?? null; }
    querySelectorAll(selector) { const all = []; const visit = node => { for (const child of node.children) { if (selector === '[data-world]' && child.dataset.world !== undefined || selector === '[data-pref]' && child.dataset.pref !== undefined) all.push(child); visit(child); } }; visit(this); return all; }
    showModal() { this.open = true; }
    close() { if (!this.open) return; this.open = false; queued.push(() => this.emit('close')); }
    focus() { if (doc.activeElement !== this) doc.activeElement?.emit('blur'); doc.activeElement = this; this.emit('focus'); }
    getBoundingClientRect() { rectReads++; return this.rect || { left: 10, top: 20, width: 960, height: 540 }; }
  }
  const doc = new Target();
  doc.hidden = hidden; doc.documentElement = new Node('html'); doc.documentElement.dataset.theme = 'night';
  doc.documentElement.dataset.sessionActive = 'false'; doc.activeElement = null;
  doc.createElement = tag => new Node(tag); doc.createComment = () => new Node('#comment');
  doc.getElementById = id => nodes.get(id) || null;
  const node = (id, tag = 'div', parent) => { const item = new Node(tag, id); nodes.set(id, item); parent?.append(item); return item; };
  const panel = node('panel'), canvas = node('pixelCity', 'canvas', panel);
  // The host delegates all pixels to render APIs. A getContext method asserts
  // the public canvas shape without importing a native canvas dependency.
  canvas.getContext = () => ({});
  const mql = new Target(); mql.matches = reduced;
  const root = new Target(); root.document = doc;
  const data = new Map([['atelier-motion', JSON.stringify(selected)]]);
  if (stored !== undefined) data.set('seneschal-atmosphere.v1', JSON.stringify(stored));
  root.localStorage = {
    getItem(key) { if (deniedStorage) throw Error('Storage denied'); return data.get(key) || null; },
    setItem(key, value) { if (deniedStorage) throw Error('Storage denied'); writes.push(key); data.set(key, value); }
  };
  root.matchMedia = () => mql; root.performance = { now: () => now };
  root.requestAnimationFrame = fn => { const id = nextId++; frames.set(id, fn); return id; };
  root.cancelAnimationFrame = id => frames.delete(id);
  root.setInterval = (fn, ms) => { const id = nextId++; intervals.set(id, { fn, ms }); return id; };
  root.clearInterval = id => intervals.delete(id);
  root.CustomEvent = class { constructor(type, options) { this.type = type; this.detail = options?.detail; } };
  root.MutationObserver = class { constructor(fn) { this.fn = fn; observations.push(this); } observe() { this.live = true; } disconnect() { this.live = false; } };
  root.ResizeObserver = class { constructor(fn) { this.fn = fn; resizes.push(this); } observe() { this.live = true; } disconnect() { this.live = false; } };
  const rendererLog = [];
  const testSpots = id => (catalog.find(world => world.id === id)?.actions || []).map(([action, label], index) => ({ action, label, x: 50 + index * 145, y: 210, w: 90, h: 70 }));
  const legacyRenderer = (id, factory, targetCanvas) => {
    const state = { effects: [] };
    const api = { id, factory, canvas: targetCanvas, state, dead: false, hotspots: () => testSpots(id), hitTest(x, y) { state.point = { x, y }; return testSpots(id).find(spot => x >= spot.x && x <= spot.x + spot.w && y >= spot.y && y <= spot.y + spot.h) || null; }, draw(t, p) { if (failDraw) throw Error('Synthetic renderer failure'); rendererLog.push({ id, factory, time: t, prefs: plain(p) }); }, effect(action, time) { state.effects.push(action); rendererLog.push({ id, factory, action, time }); }, dispose() { api.dead = true; } };
    engines.push(api); return api;
  };
  root.SeneschalLegacyWorlds = { create(id, targetCanvas) { return legacyRenderer(id, 'legacy', targetCanvas); } };
  root.SeneschalCitylight = { create(targetCanvas) { return legacyRenderer('citylight', 'citylight', targetCanvas); } };
  root.SeneschalAfterlight = { create() {
    const state = { selected: null, dead: false, manualPause: true, hostPaused: true, frame: 0, time: 0, renderAtCalls: 0, renderCurrentCalls: 0, prefs: {}, effects: [] };
    let engineRAF = 0;
    const cancel = () => { if (engineRAF) root.cancelAnimationFrame(engineRAF); engineRAF = 0; };
    const tick = () => { engineRAF = 0; state.frame++; state.time += .1; schedule(); };
    const schedule = () => { if (!state.dead && !state.manualPause && !state.hostPaused && !engineRAF && !doc.hidden) engineRAF = root.requestAnimationFrame(tick); };
    const api = {
      state, select(id) { state.selected = id; }, set(value) { Object.assign(state.prefs, plain(value)); },
      pause(value) { state.manualPause = value; if (value) cancel(); else schedule(); }, hostPause(value) { state.hostPaused = value; if (value) cancel(); else schedule(); },
      renderAt(time) { state.renderAtCalls++; state.time = time; state.manualPause = true; cancel(); state.frame++; }, renderCurrent() { state.renderCurrentCalls++; state.frame++; },
      effect(action) { state.effects.push(action); }, pointer(x, y, click) { state.point = { x, y, click }; }, hotspots: () => testSpots(state.selected), showHotspots() {},
      diagnostics() { return { ...state, scheduledFrames: engineRAF ? 1 : 0 }; }, dispose() { state.dead = true; cancel(); }
    }; engines.push(api); return api;
  } };
  if (gallery) {
    const dialog = node('atmosphereDialog', 'dialog');
    for (const id of ['atmosphereGallery', 'atmosphereName', 'atmosphereDescription', 'atmosphereSceneControls', 'atmosphereActions', 'atmosphereStatus', 'atmosphereConversationHint']) node(id, 'div', dialog);
    for (const id of ['atmosphereClose', 'atmospherePreviewButton', 'atmosphereNext', 'atmospherePause', 'atmosphereReset', 'atmosphereEnableConversation']) node(id, 'button', dialog);
    for (const [key, type, scene] of [['strength', 'range', false], ['quality', 'select-one', false], ['paused', 'checkbox', false], ['animateConversation', 'checkbox', false], ['rotation', 'checkbox', false], ['minutes', 'select-one', false], ['shuffle', 'checkbox', false], ['palette', 'select-one', true], ['worldGlow', 'range', true]]) {
      const input = node('pref-' + key, 'input', dialog); input.type = type; input.dataset.pref = key; input.dataset.scene = String(scene);
    }
    const preview = node('atmospherePreview', 'dialog');
    for (const id of ['atmospherePreviewName', 'atmospherePreviewStatus', 'atmospherePreviewActions', 'atmospherePreviewStage', 'atmosphereHoverLabel', 'atmosphereActionFeedback']) node(id, 'div', preview);
    node('atmosphereHotspots', 'div', nodes.get('atmospherePreviewStage'));
    for (const id of ['atmospherePreviewClose', 'atmospherePreviewPause', 'atmospherePreviewNext', 'atmosphereShowHotspots']) node(id, 'button', preview);
    node('motionSwitch', 'button'); node('settingsDialog', 'dialog');
  }
  vm.runInNewContext(source, { window: root, globalThis: root, console }, { filename: sourcePath });
  const host = root.SeneschalAtmosphere.create({ canvas });
  const flush = () => { for (const callback of queued.splice(0)) callback(); };
  return {
    root, doc, host, canvas, panel, nodes, mql, data, writes, frames, intervals, engines, rendererLog, resizes,
    rectReads: () => rectReads,
    resize(rect) { nodes.get('atmospherePreviewStage').rect = rect; for (const observer of resizes) if (observer.live) observer.fn(); },
    flush,
    failDraw(value) { failDraw = Boolean(value); },
    step(ms = 100) { now += ms; const batch = [...frames]; frames.clear(); for (const [, callback] of batch) callback(now); flush(); },
    tick(seconds = 1) { now += seconds * 1000; for (const { fn } of [...intervals.values()]) fn(); flush(); },
    hidden(value) { doc.hidden = value; doc.emit('visibilitychange'); flush(); },
    reduced(value) { mql.matches = value; mql.emit('change', { matches: value }); flush(); },
    mutate(name, value) { const key = name === 'data-theme' ? 'theme' : 'sessionActive'; doc.documentElement.dataset[key] = value; for (const observer of observations) if (observer.live) observer.fn([{ attributeName: name }]); flush(); }
  };
}

module.exports = { browser, Target };
