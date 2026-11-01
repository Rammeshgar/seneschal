'use strict';

// Synthetic services only. Execute through verify-private-access.ps1, not against a live engine.
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { COOKIE, SESSION_MS, PAIR_MS, validateConfig, requestPath, requestBoundary, allowedRoute, readCookie, createSessions } = require('../scripts/private-access-policy.cjs');
const { createGateway, pairPage, sanitize } = require('../scripts/private-access-gateway.cjs');
const { setupMobileNavigation, setupInspectorNavigation } = require('../app/private-access.js');
const vm = require('node:vm');
const { checkServe, windowsAclArgs, ensureEmptyPreparationDirectory } = require('../scripts/private-access.cjs');
const { createPhoneAccessControl, localBoundary } = require('../scripts/phone-access-control.cjs');
const config = { hostname: 'fixture.tail123.ts.net', owner: 'fixture@gmail.com', port: 4200, upstreamPort: 4196 };
const adminKey = 'A'.repeat(43), localToken = 'B'.repeat(43);
const origin = `https://${config.hostname}`;
const mock = (method = 'GET', url = '/', headers = {}) => ({ method, url, headers: { host: config.hostname, 'tailscale-user-login': config.owner, ...headers }, rawHeaders: [], socket: { remoteAddress: '127.0.0.1' } });

function recoveryFixture(reader = async () => true) {
  const source = fs.readFileSync(path.join(__dirname, '../app/app.js'), 'utf8');
  const code = source.slice(source.indexOf('  function createConnectionRecovery('), source.indexOf('  async function recoverConnectionState('));
  const context = { AbortController, setTimeout, clearTimeout }; vm.createContext(context); vm.runInContext(code, context, { timeout: 100 });
  const timers = new Map(), events = []; let timerID = 0, online = true, visible = true;
  const recovery = context.createConnectionRecovery({ read: signal => reader(signal), reconnect: () => events.push('connect'), close: () => events.push('close'), status: value => events.push(value), online: () => online, visible: () => visible,
    setTimer: (fn, delay) => { const id = ++timerID; timers.set(id, { fn, delay }); return id; }, clearTimer: id => timers.delete(id) });
  const flush = async () => { for (let i = 0; i < 30; i++) await Promise.resolve(); };
  async function tick(delay = 0) { const entry = [...timers].find(([, item]) => item.delay === delay); assert.ok(entry, `timer ${delay} exists`); timers.delete(entry[0]); entry[1].fn(); await flush(); }
  return { recovery, timers, events, tick, flush, online: value => { online = value; }, visible: value => { visible = value; } };
}

test('connection recovery coalesces wake signals and catches up when a stream opens', async () => {
  let release, reads = 0;
  const fixture = recoveryFixture(async () => { reads++; if (reads === 1) await new Promise(resolve => { release = resolve; }); return true; });
  fixture.recovery.request(); await fixture.tick();
  fixture.recovery.request(); fixture.recovery.opened(); fixture.recovery.request(false);
  assert.equal(reads, 1); assert.equal(fixture.events.filter(value => value === 'connect').length, 1);
  release(); await fixture.flush(); await fixture.tick();
  assert.equal(reads, 2); assert.equal(fixture.events.at(-1), 'reconnecting');
  fixture.recovery.opened(); await fixture.tick(); assert.equal(fixture.events.at(-1), 'live');
  fixture.recovery.dispose(); assert.equal(fixture.timers.size, 0);
});

test('offline and background pause stop reads; foreground/online recovery never submits work', async () => {
  let reads = 0; const fixture = recoveryFixture(async () => { reads++; return true; });
  fixture.online(false); fixture.recovery.offline(); fixture.recovery.request();
  assert.equal(fixture.timers.size, 0); assert.equal(fixture.events.at(-1), 'offline');
  fixture.online(true); fixture.visible(false); fixture.recovery.pause(); fixture.recovery.request(); assert.equal(fixture.timers.size, 0);
  fixture.visible(true); fixture.recovery.request(); await fixture.tick(); assert.equal(reads, 1);
  fixture.recovery.dispose(); fixture.recovery.request(); fixture.recovery.opened(); assert.equal(fixture.timers.size, 0);
});

test('failed recovery backs off and expiration stops reconnecting until explicit pairing', async () => {
  const fixture = recoveryFixture(async () => { throw Error('offline fixture'); });
  fixture.recovery.request(); await fixture.tick(); await fixture.tick(1000); await fixture.tick(2000); await fixture.tick(4000);
  assert.ok([...fixture.timers.values()].some(item => item.delay === 8000)); fixture.recovery.dispose();
  for (const status of [401, 403]) {
    const expired = recoveryFixture(async () => { const error = Error('expired'); error.status = status; throw error; });
    expired.recovery.request(); await expired.tick(); assert.equal(expired.events.at(-1), 'expired'); assert.ok(expired.events.includes('close'));
    expired.recovery.request(); expired.recovery.opened(); expired.recovery.failed(); assert.equal(expired.timers.size, 0);
  }
});

test('recovery request timeout aborts the read and releases the single-flight lock', async () => {
  const fixture = recoveryFixture(signal => new Promise((_, reject) => signal.addEventListener('abort', () => reject(Error('fixture timeout')), { once: true })));
  fixture.recovery.request(); await fixture.tick(); await fixture.tick(12000);
  assert.ok([...fixture.timers.values()].some(item => item.delay === 1000));
  fixture.recovery.dispose(); assert.equal(fixture.timers.size, 0);
});

test('new events during catch-up back off snapshot reads without restarting a healthy stream', async () => {
  const fixture = recoveryFixture(async () => false);
  fixture.recovery.opened(); await fixture.tick(); await fixture.tick(250); await fixture.tick(500);
  assert.ok([...fixture.timers.values()].some(item => item.delay === 1000));
  assert.equal(fixture.events.filter(value => value === 'connect').length, 0);
  fixture.recovery.dispose();
});

function recoverySnapshotFixture(handler) {
  const source = fs.readFileSync(path.join(__dirname, '../app/app.js'), 'utf8');
  const code = source.slice(source.indexOf('  async function recoverConnectionState('), source.indexOf('  function bindConnectionRecovery('));
  const calls = [], renders = [], state = { currentSessionID: 'ses_fixture', currentDirectory: '/fixture', sessions: [{ id: 'ses_fixture', directory: '/fixture' }], statuses: {}, permissions: [], messages: ['old'], userScrolledAway: true, attachments: ['draft attachment'] };
  const context = { state, CustomEvent: class { constructor(type) { this.type = type; } }, window: { dispatchEvent: event => calls.push({ event: event.type }) }, selectedSession: () => state.sessions.find(session => session.id === state.currentSessionID), normalizeSession: value => value, mergePermissionSnapshot: value => value,
    renderProjects() {}, renderSessions() {}, renderHeader() {}, renderUsage() {}, renderMessages: scroll => renders.push(scroll), renderPermissions() {},
    api: async (route, options) => {
      calls.push({ route, options });
      if (handler) return handler(route, options, context);
      if (route === '/global/health') return { healthy: true }; if (route === '/session') return [{ id: 'ses_fixture', directory: '/fixture' }];
      if (route === '/session/status') return { ses_fixture: { type: 'idle' } }; if (route === '/permission') return [{ id: 'per_fixture' }]; return ['latest'];
    } };
  vm.createContext(context); vm.runInContext(code, context, { timeout: 100 });
  return { context, state, calls, renders };
}

test('reconnect catch-up only reads and preserves drafts, scroll and pending decision state', async () => {
  const fixture = recoverySnapshotFixture(); const signal = new AbortController().signal;
  const result = await fixture.context.recoverConnectionState(signal);
  assert.equal(result, true); assert.deepEqual(fixture.state.messages, ['latest']); assert.equal(fixture.state.statuses.ses_fixture.type, 'idle');
  assert.equal(fixture.state.userScrolledAway, true); assert.deepEqual(fixture.state.attachments, ['draft attachment']); assert.deepEqual(fixture.renders, [false]);
  assert.ok(fixture.calls.filter(call => call.route).every(call => !call.options.method && !call.options.body && call.options.signal === signal));
  assert.ok(fixture.calls.some(call => call.event === 'seneschal-question-refresh'));
});

test('late recovery snapshots cannot overwrite a different session or a newer event', async () => {
  for (const change of ['session', 'revision', 'messages']) {
    let release; const gate = new Promise(resolve => { release = resolve; });
    const fixture = recoverySnapshotFixture(async (route) => { await gate; if (route === '/global/health') return { healthy: true }; if (route === '/session/status') return {}; return []; });
    const reading = fixture.context.recoverConnectionState(new AbortController().signal);
    if (change === 'session') fixture.state.currentSessionID = 'ses_other';
    if (change === 'revision') fixture.state.streamRevision = 1;
    if (change === 'messages') fixture.state.messageRefreshID++;
    release(); assert.equal(await reading, false); assert.deepEqual(fixture.state.messages, ['old']); assert.deepEqual(fixture.renders, []);
  }
});

test('automatic recovery is bound to online, wake and history restore with no task replay hooks', () => {
  const source = fs.readFileSync(path.join(__dirname, '../app/app.js'), 'utf8');
  const code = source.slice(source.indexOf('  function bindConnectionRecovery('), source.indexOf('  function connectEvents('));
  for (const event of ['online', 'offline', 'visibilitychange', 'pageshow', 'pagehide']) assert.ok(code.includes(`"${event}"`));
  assert.match(code, /event\.persisted/); assert.match(code, /45000/);
  assert.doesNotMatch(code, /sendPrompt|replyPermission|abortSession|runAgentBoard|newSession|refreshAll/);
  const html = fs.readFileSync(path.join(__dirname, '../app/index.html'), 'utf8');
  assert.match(html, /id="connectionRecoveryStatus" role="status" aria-live="polite" aria-atomic="true" hidden/);
});

test('phone provider metadata preserves bounded thinking names without provider options', () => {
  const variants = { medium: { apiKey: 'fixture-secret', reasoningEffort: 'medium' }, high: { headers: { authorization: 'fixture-secret' } }, constructor: {}, 'bad.name': {}, ['x'.repeat(41)]: {} };
  const filtered = sanitize('/api/provider', { all: [{ id: 'openai', models: { fixture: { id: 'fixture', variants, options: { secret: 'fixture-secret' } } } }] });
  assert.deepEqual(filtered.all[0].models.fixture.variants, { medium: {}, high: {} });
  assert.equal(JSON.stringify(filtered).includes('fixture-secret'), false);
  const many = Object.fromEntries(Array.from({ length: 50 }, (_, i) => [`level${i}`, { secret: 'fixture-secret' }]));
  const bounded = sanitize('/api/provider', { all: [{ models: { fixture: { variants: many } } }] });
  assert.equal(Object.keys(bounded.all[0].models.fixture.variants).length, 32);
  for (const value of [null, 'medium', ['high']]) assert.deepEqual(sanitize('/api/provider', { all: [{ models: { fixture: { variants: value } } }] }).all[0].models.fixture.variants, {});
});

function promptPolicyFixture(rules = [], overrides = {}) {
  const source = fs.readFileSync(path.join(__dirname, '../app/app.js'), 'utf8');
  const code = source.slice(source.indexOf('  function promptToolRestrictions('), source.indexOf('  async function sendPrompt('));
  let current = structuredClone(rules);
  const calls = [], confirmations = [];
  const context = { state: { tools: ['read', 'edit', 'bash', 'playwright_browser_navigate', 'seneschal_moli_search', 'blender_scene'], promptSubmissions: new Set() },
    AbortController, setTimeout, clearTimeout, window: { confirm: message => { confirmations.push(message); return overrides.agree ?? true; } },
    api: async (route, options) => {
      calls.push({ route, options });
      if (overrides.api) return overrides.api(route, options, context);
      if (route === '/session/status') return overrides.busy ? { ses_fixture: { type: 'busy' } } : {};
      if (route === '/global/health') return { healthy: true, version: overrides.unsupported ? 'fixture-unsupported' : '1.19.0' };
      // Match the release handler: PATCH merges, prompt tools replace before execution.
      if (options.method === 'PATCH') { current = [...current, ...(options.body.permission || [])]; return { permission: current }; }
      if (options.method === 'POST') {
        const replacements = Object.entries(options.body.tools || {}).map(([permission, enabled]) => ({ permission, action: enabled ? 'allow' : 'deny', pattern: '*' }));
        if (replacements.length) current = replacements;
        return null;
      }
      return { id: 'ses_fixture', permission: current };
    } };
  vm.createContext(context); vm.runInContext(code, context, { timeout: 100 });
  return { context, calls, confirmations };
}
const legacyToolRules = () => ['read', 'write', 'edit', 'bash', 'task', 'webfetch', 'websearch', 'glob', 'grep'].map(permission => ({ permission, pattern: '*', action: 'allow' }));

test('prompts never grant tool approval; Build and Plan inherit, restricted modes only deny', async () => {
  const { context, calls } = promptPolicyFixture();
  for (const mode of ['build', 'plan']) assert.equal(context.promptToolRestrictions(mode), undefined);
  for (const mode of ['chat', 'observe', 'read', 'browser']) assert.ok(Object.values(context.promptToolRestrictions(mode)).every(value => value === false));
  assert.equal(context.promptToolRestrictions('browser').seneschal_moli_search, undefined);
  assert.equal(context.promptToolRestrictions('browser').blender_scene, false);
  assert.equal(context.promptToolRestrictions('read').read, undefined);
  await context.submitSessionInput('ses_fixture', '/fixture', { agent: 'build', parts: [], variant: 'high' });
  const request = calls.find(call => call.options.method === 'POST');
  assert.equal(request.options.body.tools, undefined); assert.equal(request.options.body.variant, 'high');
  await assert.rejects(context.submitSessionInput('ses_other', '/fixture', { tools: { bash: true } }), /cannot be granted/);
  assert.equal(calls.filter(call => call.options.method === 'POST').length, 1);
});

test('older blanket approvals require consent and idle/version checks; the prompt replaces rather than merges grants', async () => {
  const fixture = promptPolicyFixture(legacyToolRules()); let ready = false;
  await fixture.context.submitSessionInput('ses_fixture', '/fixture', { agent: 'build', parts: [] }, () => { ready = true; });
  assert.equal(ready, true); assert.equal(fixture.confirmations.length, 1);
  assert.match(fixture.confirmations[0], /Cancel sends nothing/);
  assert.deepEqual(fixture.calls.map(call => call.options.method || 'GET'), ['GET', 'GET', 'GET', 'GET', 'POST']);
  assert.equal(fixture.calls.some(call => call.options.method === 'PATCH'), false);
  const post = fixture.calls.find(call => call.options.method === 'POST');
  assert.deepEqual(JSON.parse(JSON.stringify(post.options.body.tools)), { __seneschal_inherit_policy__: false });
  const current = await fixture.context.api('/session/ses_fixture', {});
  assert.equal(current.permission.some(rule => rule.action === 'allow'), false);
  assert.equal(current.permission.length, 1);
  fixture.confirmations.length = 0;
  await fixture.context.submitSessionInput('ses_fixture', '/fixture', { agent: 'build' });
  assert.equal(fixture.confirmations.length, 0, 'neutral marker does not prompt on every subsequent turn');
});

test('cancel, active task, changed rules and failed reset never submit work or clear the draft', async () => {
  for (const overrides of [{ agree: false }, { busy: true }, { unsupported: true }]) {
    const fixture = promptPolicyFixture(legacyToolRules(), overrides); let ready = false;
    await assert.rejects(fixture.context.submitSessionInput('ses_fixture', '/fixture', { agent: 'build' }, () => { ready = true; }));
    assert.equal(ready, false); assert.equal(fixture.calls.some(call => call.options.method === 'POST'), false);
    assert.equal(fixture.calls.some(call => call.options.method === 'PATCH'), false);
    assert.equal(fixture.context.state.promptSubmissions.size, 0);
  }
  let reads = 0;
  const changed = promptPolicyFixture([], { api: async (route, options) => options.method ? null : route === '/session/status' ? {} : { permission: ++reads === 1 ? legacyToolRules() : [] } });
  await assert.rejects(changed.context.submitSessionInput('ses_fixture', '/fixture', {}), /changed/);
  assert.equal(changed.calls.some(call => call.options.method), false);
});

test('restricted mode transitions require confirmation, while custom session permissions are preserved', async () => {
  const chatRules = [{ permission: '*', action: 'deny', pattern: '*' }];
  const same = promptPolicyFixture(chatRules);
  await same.context.submitSessionInput('ses_fixture', '/fixture', { tools: { '*': false } });
  assert.equal(same.confirmations.length, 0); assert.equal(same.calls.some(call => call.options.method === 'PATCH'), false);
  const switching = promptPolicyFixture(chatRules);
  await switching.context.submitSessionInput('ses_fixture', '/fixture', { agent: 'build' });
  assert.equal(switching.confirmations.length, 1);
  const custom = [{ permission: 'bash', pattern: 'git status*', action: 'allow' }, { permission: 'edit', pattern: '*', action: 'ask' }];
  const preserved = promptPolicyFixture(custom);
  await preserved.context.submitSessionInput('ses_fixture', '/fixture', { agent: 'build' });
  assert.equal(preserved.calls.some(call => call.options.method === 'PATCH'), false);
  await assert.rejects(preserved.context.submitSessionInput('ses_fixture', '/fixture', { tools: { '*': false } }), /custom permission rules/);
  assert.equal(preserved.calls.filter(call => call.options.method === 'POST').length, 1);
});

test('permission preflight and prompt delivery are single-flight and never retry a lost response', async () => {
  let release; const waiting = new Promise(resolve => { release = resolve; });
  const fixture = promptPolicyFixture([], { api: async (route, options) => { if (options.method === 'POST') throw Error('fixture lost response'); await waiting; return { permission: [] }; } });
  const first = fixture.context.submitSessionInput('ses_fixture', '/fixture', {});
  await assert.rejects(fixture.context.submitSessionInput('ses_fixture', '/fixture', {}), /already submitting/);
  release();
  await assert.rejects(first, error => error.inputMayHaveReachedEngine === true);
  assert.equal(fixture.calls.filter(call => call.options.method === 'POST').length, 1);
  assert.equal(fixture.context.state.promptSubmissions.size, 0);
});

test('confirmation reading time consumes no network timeout budget', async () => {
  const fixture = promptPolicyFixture(legacyToolRules());
  const timers = new Map(); let nextTimer = 0; let checked = false;
  fixture.context.setTimeout = callback => { const id = ++nextTimer; timers.set(id, callback); return id; };
  fixture.context.clearTimeout = id => timers.delete(id);
  fixture.context.window.confirm = () => { checked = true; assert.equal(timers.size, 0, 'no network timer may run while the user reads the confirmation'); return true; };
  await fixture.context.submitSessionInput('ses_fixture', '/fixture', {});
  assert.equal(checked, true); assert.equal(timers.size, 0);
  assert.equal(fixture.calls.filter(call => call.options.method === 'POST').length, 1);
});

test('each network step still times out and an aborted compatibility check never submits', async () => {
  let expire; let timerCleared = false;
  const fixture = promptPolicyFixture(legacyToolRules(), { api: async (route, options) => {
    if (route === '/global/health') { expire(); assert.equal(options.signal.aborted, true); throw Error('fixture compatibility check timed out'); }
    return route === '/session/status' ? {} : { permission: legacyToolRules() };
  } });
  fixture.context.setTimeout = (callback, ms) => { assert.equal(ms, 15000); expire = callback; return 1; };
  fixture.context.clearTimeout = () => { timerCleared = true; };
  await assert.rejects(fixture.context.submitSessionInput('ses_fixture', '/fixture', {}), /timed out/);
  assert.equal(timerCleared, true); assert.equal(fixture.context.state.promptSubmissions.size, 0);
  assert.equal(fixture.calls.some(call => call.options.method === 'POST'), false);
});

test('the release PATCH merge contract cannot be mistaken for clearing; restricted reset keeps only denials', async () => {
  const fixture = promptPolicyFixture(legacyToolRules());
  const unchanged = await fixture.context.api('/session/ses_fixture', { method: 'PATCH', body: { permission: [] } });
  assert.equal(unchanged.permission.length, 9);
  await fixture.context.submitSessionInput('ses_fixture', '/fixture', { agent: 'build', tools: { '*': false } });
  const current = await fixture.context.api('/session/ses_fixture', {});
  assert.deepEqual(JSON.parse(JSON.stringify(current.permission)), [{ permission: '*', action: 'deny', pattern: '*' }]);
  const command = promptPolicyFixture(legacyToolRules());
  await assert.rejects(command.context.submitSessionInput('ses_fixture', '/fixture', {}, () => {}, 'command'), /normal message/);
  assert.equal(command.calls.some(call => call.options.method), false);
});

test('every app prompt path uses permission preflight, including board planning and slash commands', () => {
  const source = fs.readFileSync(path.join(__dirname, '../app/app.js'), 'utf8');
  assert.doesNotMatch(source, /await api\(`\/session\/[^\n]+\/(?:prompt_async|command)`/);
  assert.equal((source.match(/await submitSessionInput\(/g) || []).length, 4);
  assert.match(source, /if \(state.selectedAgent === "chat"\) \{ toast\("Switch to Build or Plan before running workspace commands/);
});

test('prompt options group only secondary tools and leave Send and Stop outside the dropdown', () => {
  const html = fs.readFileSync(path.join(__dirname, '../app/index.html'), 'utf8');
  const start = html.indexOf('<details class="composer-options"');
  const end = html.indexOf('</details>', start);
  assert.ok(start >= 0 && end > start);
  const options = html.slice(start, end);
  assert.doesNotMatch(options.slice(0, options.indexOf('>')), /\bopen\b/);
  for (const id of ['skillsButton', 'modelVariantSelect', 'agentSelect']) assert.ok(options.includes(`id="${id}"`));
  for (const id of ['sendButton', 'composerStopButton', 'voiceButton', 'attachFilesButton']) assert.equal(options.includes(`id="${id}"`), false);
  assert.match(html, /id="attachFilesButton" type="button"/);
  assert.ok(html.indexOf('id="attachFilesButton"') < start);
  for (const id of ['voiceButton', 'sendButton', 'composerStopButton']) assert.ok(html.slice(end).includes(`id="${id}"`));
  assert.match(options, /id="composerVoiceStatus" role="status" aria-live="polite" hidden/);
});

test('completed Bash collapses on desktop and phone without changing other desktop tools or manual choices', () => {
  const source = fs.readFileSync(path.join(__dirname, '../app/app.js'), 'utf8');
  const code = source.slice(source.indexOf('  function renderTool('), source.indexOf('  function renderPart('));
  const context = { state: { toolDetails: new Map() }, innerWidth: 390, escapeHTML: value => String(value).replaceAll('<', '&lt;').replaceAll('"', '&quot;') };
  vm.createContext(context); vm.runInContext(code, context, { timeout: 100 });
  const tool = { id: 'prt_fixture', tool: 'bash', state: { status: 'completed', title: 'Print a harmless message', output: '<fixture>' } };
  let html = context.renderTool(tool);
  assert.match(html, /^<details[^>]+><summary/); assert.doesNotMatch(html.slice(0, html.indexOf('>')), /\bopen\b/);
  assert.match(html, /&lt;fixture>/); assert.match(html, /pre tabindex="0" aria-label="bash output"/);
  for (const status of ['running', 'pending', 'error']) assert.match(context.renderTool({ ...tool, state: { ...tool.state, status } }), /^<details[^>]+ open>/);
  context.state.toolDetails.set(tool.id, true); assert.match(context.renderTool(tool), /^<details[^>]+ open>/);
  context.state.toolDetails.clear(); context.innerWidth = 1365;
  assert.doesNotMatch(context.renderTool(tool).split('>')[0], /\bopen\b/);
  assert.doesNotMatch(context.renderTool({ ...tool, tool: 'BASH' }).split('>')[0], /\bopen\b/);
  assert.match(context.renderTool({ ...tool, tool: 'read' }), /^<details[^>]+ open>/, 'non-Bash desktop defaults are unchanged');
  for (const status of ['running', 'pending', 'error']) assert.match(context.renderTool({ ...tool, state: { ...tool.state, status } }), /^<details[^>]+ open>/);
  context.state.toolDetails.set(tool.id, true); assert.match(context.renderTool(tool), /^<details[^>]+ open>/);
  context.state.toolDetails.set(tool.id, false); assert.doesNotMatch(context.renderTool(tool).split('>')[0], /\bopen\b/);
});

function approvalReplyFixture(handler = async () => null) {
  const source = fs.readFileSync(path.join(__dirname, '../app/app.js'), 'utf8');
  const code = source.slice(source.indexOf('  async function permissionRequest('), source.indexOf('  function renderAttachments('));
  const merge = source.slice(source.indexOf('  function mergePermissionSnapshot('), source.indexOf('  function toggleSessionPin('));
  assert.ok(code.includes('async function replyPermission('));
  const permission = { id: 'per_fixture', sessionID: 'ses_fixture' };
  const state = { sessions: [{ id: 'ses_fixture', directory: '/fixture/project' }], currentDirectory: '/fixture/other',
    permissions: [permission], permissionReplies: new Map(), permissionMisses: {}, statuses: {} };
  const requests = [], notices = [];
  const context = { state, AbortController, setTimeout, clearTimeout, selectedSession: () => state.sessions[0], sessionStatus: () => 'busy',
    api: async (route, options) => { requests.push({ route, options }); return handler(route, options, context); },
    renderPermissions() {}, log() {}, toast: (...args) => notices.push(args) };
  vm.createContext(context); vm.runInContext(code + merge, context, { timeout: 100 });
  return { context, permission, state, requests, notices };
}

test('approval decisions are explicit, single-flight and scoped to the permission project', async () => {
  for (const reply of ['once', 'always', 'reject']) {
    let release;
    const gate = new Promise(resolve => { release = resolve; });
    const f = approvalReplyFixture(async () => gate);
    const first = f.context.replyPermission(f.permission, reply);
    await f.context.replyPermission(f.permission, 'reject');
    assert.equal(f.requests.length, 1);
    assert.equal(f.requests[0].options.directory, '/fixture/project');
    assert.equal(f.requests[0].options.body.reply, reply);
    assert.equal(f.state.permissionReplies.get(f.permission.id).status, 'pending');
    release(); await first;
    assert.equal(f.state.permissions.length, 0);
    await f.context.replyPermission(f.permission, reply);
    assert.equal(f.requests.length, 1, 'resolved replies cannot be sent again');
  }
});

test('lost approval responses, authentication failures and server errors never trigger legacy retries', async () => {
  for (const status of [undefined, 400, 401, 403, 408, 409, 422, 429, 500, 502, 504]) {
    const f = approvalReplyFixture(async () => { throw Object.assign(Error('Fixture failure'), { status }); });
    await f.context.replyPermission(f.permission, 'once');
    assert.equal(f.requests.length, 1, `unexpected retry for ${status}`);
    assert.equal(f.state.permissionReplies.get(f.permission.id).status, 'uncertain');
    await f.context.replyPermission(f.permission, 'once');
    assert.equal(f.requests.length, 1, 'uncertainty must block another mutation');
    assert.equal(f.state.permissions.length, 1);
  }
});

test('only definitive missing-route responses permit one legacy approval request', async () => {
  for (const status of [404, 405]) {
    let count = 0;
    const f = approvalReplyFixture(async () => { if (++count === 1) throw Object.assign(Error('Fixture unsupported route'), { status }); });
    await f.context.replyPermission(f.permission, 'reject');
    assert.equal(f.requests.length, 2);
    assert.equal(f.requests[1].route, '/session/ses_fixture/permissions/per_fixture');
    assert.equal(f.requests[1].options.body.response, 'reject');
    assert.equal(f.requests[1].options.directory, '/fixture/project');
    assert.equal(f.state.permissions.length, 0);
  }
});

test('an ambiguous legacy reply remains locked and is never retried again', async () => {
  let count = 0;
  const f = approvalReplyFixture(async () => { if (++count === 1) throw Object.assign(Error('Fixture missing route'), { status: 404 }); throw Error('Fixture lost legacy response'); });
  await f.context.replyPermission(f.permission, 'once');
  await f.context.replyPermission(f.permission, 'once');
  assert.equal(f.requests.length, 2);
  assert.equal(f.state.permissionReplies.get(f.permission.id).status, 'uncertain');
});

test('manual approval status recovery reads only and requires another explicit decision', async () => {
  let statusPending = true;
  const f = approvalReplyFixture(async (route, options) => {
    if (options.method === 'POST') throw Error('Fixture lost response');
    return statusPending ? [f.permission] : [];
  });
  await f.context.replyPermission(f.permission, 'once');
  await f.context.checkPermissionReply(f.permission);
  assert.equal(f.requests.length, 2);
  assert.equal(f.requests[1].route, '/permission'); assert.equal(f.requests[1].options.method, undefined);
  assert.equal(f.requests[1].options.directory, '/fixture/project');
  assert.equal(f.state.permissionReplies.has(f.permission.id), false);
  await f.context.replyPermission(f.permission, 'reject');
  statusPending = false;
  await f.context.checkPermissionReply(f.permission);
  assert.equal(f.requests.filter(request => request.options.method === 'POST').length, 2);
  assert.equal(f.state.permissions.length, 0);
});

test('approval reply events beat lost responses and stale manual status snapshots', async () => {
  const first = approvalReplyFixture(async (_route, _options, context) => { context.completePermissionReply('per_fixture'); throw Error('Fixture response lost after event'); });
  await first.context.replyPermission(first.permission, 'once');
  assert.equal(first.state.permissionReplies.get(first.permission.id).status, 'resolved');
  assert.equal(first.requests.length, 1); assert.equal(first.notices.length, 0);
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const second = approvalReplyFixture(async (_route, options) => { if (options.method === 'POST') throw Error('Fixture lost response'); return gate; });
  await second.context.replyPermission(second.permission, 'once');
  const check = second.context.checkPermissionReply(second.permission);
  await second.context.checkPermissionReply(second.permission);
  assert.equal(second.requests.length, 2, 'status checks are single-flight too');
  second.context.completePermissionReply(second.permission.id);
  release([second.permission]); await check;
  assert.equal(second.state.permissionReplies.get(second.permission.id).status, 'resolved');
  assert.equal(second.context.mergePermissionSnapshot([second.permission]).length, 0);
});

test('failed or malformed approval status checks leave decisions locked without mutation', async () => {
  for (const invalid of [null, { unexpected: true }]) {
    const f = approvalReplyFixture(async (_route, options) => { if (options.method === 'POST') throw Error('Fixture lost response'); return invalid; });
    await f.context.replyPermission(f.permission, 'once'); await f.context.checkPermissionReply(f.permission);
    assert.equal(f.state.permissionReplies.get(f.permission.id).status, 'uncertain');
    assert.equal(f.state.permissionReplies.get(f.permission.id).checking, false);
    assert.equal(f.requests.filter(request => request.options.method === 'POST').length, 1);
  }
  const f = approvalReplyFixture(async () => { throw Error('Fixture offline'); });
  await f.context.replyPermission(f.permission, 'once'); await f.context.checkPermissionReply(f.permission);
  assert.match(f.state.permissionReplies.get(f.permission.id).message, /not resent/);
});

test('invalid and stale approval decisions are rejected without requests', async () => {
  const f = approvalReplyFixture();
  await f.context.replyPermission(f.permission, 'approve-everything');
  await f.context.replyPermission({ id: 'per_stale', sessionID: 'ses_fixture' }, 'once');
  assert.equal(f.requests.length, 0);
});

test('approval transport bounds waiting and clears its deadline without retrying', async () => {
  const f = approvalReplyFixture(async (_route, options) => { assert.equal(options.signal.aborted, true); throw Error('Fixture abort'); });
  let deadline = 0, cleared = 0;
  f.context.setTimeout = (fn, ms) => { deadline = ms; fn(); return 'fixture-timer'; };
  f.context.clearTimeout = timer => { assert.equal(timer, 'fixture-timer'); cleared++; };
  await f.context.replyPermission(f.permission, 'once');
  assert.equal(deadline, 15000); assert.equal(cleared, 1); assert.equal(f.requests.length, 1);
  assert.equal(f.state.permissionReplies.get(f.permission.id).status, 'uncertain');
});

test('API failures retain the HTTP status and forward cancellation without retries', async () => {
  const source = fs.readFileSync(path.join(__dirname, '../app/app.js'), 'utf8');
  const code = source.slice(source.indexOf('  async function api('), source.indexOf('  async function workspace('));
  const controller = new AbortController(); let calls = 0;
  const context = { withDirectory: value => value, fetch: async (_url, options) => { calls++; assert.equal(options.signal, controller.signal); return { ok: false, status: 405, statusText: 'Method Not Allowed', text: async () => 'Fixture unsupported route' }; } };
  vm.createContext(context); vm.runInContext(code, context, { timeout: 100 });
  await assert.rejects(context.api('/permission/per_fixture/reply', { method: 'POST', signal: controller.signal }), error => error.status === 405);
  assert.equal(calls, 1);
});

function workspaceRefreshFixture() {
  const source = fs.readFileSync(path.join(__dirname, '../app/app.js'), 'utf8');
  const implementation = source.slice(source.indexOf('  function setWorkspaceRefreshState('), source.indexOf('  function bindEvents()'));
  assert.ok(implementation.includes('async function refreshAll('));
  const nodes = new Map(['#refreshButton', '#workspaceRefreshButton', '#workspaceRefreshButton span', '#workspaceRefreshStatus'].map(selector => [selector, {
    disabled: false, attributes: {}, textContent: '', setAttribute(key, value) { this.attributes[key] = value; }
  }]));
  let release, fail;
  const gate = new Promise((resolve, reject) => { release = resolve; fail = reject; });
  const requests = [], notices = [], calls = [];
  const state = { refreshingWorkspace: false, currentDirectory: '/fixture', currentSessionID: 'session-existing', customDirectories: [], health: { healthy: true } };
  const session = { id: 'session-existing', directory: '/fixture' };
  const context = {
    state, $: selector => nodes.get(selector), els: { version: {} },
    api: async (route, options) => { requests.push({ route, options }); await gate; return route === '/session' ? [session] : route === '/global/health' ? { healthy: true, version: 'fixture' } : {}; },
    workspace: async route => { requests.push({ route }); await gate; return {}; },
    normalizeSession: value => value, directories: () => ['/fixture'], sessionProject: value => value.directory,
    ordinarySessions: () => [session], storage: { set() {} }, setConnection: (...args) => calls.push(args),
    refreshDirectoryData: async () => { calls.push('directory'); }, refreshInstructionData: async () => { calls.push('instructions'); },
    refreshMessages: async () => { calls.push('messages'); }, connectEvents: () => { calls.push('events'); },
    refreshWorkspaceMeta: () => { calls.push('metadata'); }, toast: (...args) => notices.push(args)
  };
  vm.createContext(context);
  vm.runInContext(implementation, context);
  return { context, nodes, state, requests, notices, calls, release, fail };
}

test('workspace refresh is shared, read-only, single-flight and preserves the selected session', async () => {
  const fixture = workspaceRefreshFixture();
  const first = fixture.context.refreshAll(true);
  await fixture.context.refreshAll(true);
  assert.equal(fixture.requests.length, 5, 'duplicate activation must not start another refresh');
  for (const selector of ['#refreshButton', '#workspaceRefreshButton']) {
    assert.equal(fixture.nodes.get(selector).disabled, true);
    assert.equal(fixture.nodes.get(selector).attributes['aria-busy'], 'true');
  }
  assert.equal(fixture.nodes.get('#workspaceRefreshButton span').textContent, 'Refreshing…');
  fixture.release(); await first;
  assert.equal(fixture.state.currentSessionID, 'session-existing');
  assert.equal(fixture.state.refreshingWorkspace, false);
  assert.equal(fixture.notices.length, 1);
  for (const selector of ['#refreshButton', '#workspaceRefreshButton']) {
    assert.equal(fixture.nodes.get(selector).disabled, false);
    assert.equal(fixture.nodes.get(selector).attributes['aria-busy'], 'false');
  }
  assert.match(fixture.nodes.get('#workspaceRefreshStatus').textContent, /Workspace refreshed/);
  assert.ok(fixture.requests.every(request => !request.options?.method), 'refresh must not submit work');
  assert.ok(fixture.calls.includes('events'));
  const app = fs.readFileSync(path.join(__dirname, '../app/app.js'), 'utf8');
  for (const id of ['refreshButton', 'workspaceRefreshButton']) assert.ok(app.includes(`$("#${id}").addEventListener("click", () => refreshAll(true))`));
  const html = fs.readFileSync(path.join(__dirname, '../app/index.html'), 'utf8');
  assert.match(html, /id="workspaceRefreshButton" type="button" aria-describedby="workspaceRefreshStatus"/);
  assert.match(html, /id="workspaceRefreshStatus" role="status" aria-live="polite"/);
});

test('workspace refresh failure restores both controls and allows an explicit retry', async () => {
  const fixture = workspaceRefreshFixture();
  const first = fixture.context.refreshAll(true);
  fixture.fail(new Error('fixture connection unavailable')); await first;
  assert.equal(fixture.state.refreshingWorkspace, false);
  for (const selector of ['#refreshButton', '#workspaceRefreshButton']) assert.equal(fixture.nodes.get(selector).disabled, false);
  assert.equal(fixture.nodes.get('#workspaceRefreshButton span').textContent, 'Refresh workspace');
  assert.match(fixture.nodes.get('#workspaceRefreshStatus').textContent, /could not finish.*fixture connection unavailable.*Try Refresh workspace again/);
  const requestCount = fixture.requests.length;
  await fixture.context.refreshAll(true);
  assert.equal(fixture.requests.length, requestCount + 5, 'retry is allowed only when explicitly activated');
  assert.equal(fixture.state.currentSessionID, 'session-existing');
});

test('Windows folder protection uses a numeric SID prefix and removes inherited grants', () => {
  const directory = 'C:\\Fixture\\private-access';
  assert.deepEqual(windowsAclArgs(directory, 'S-1-5-21-100-200-300-1001'), [directory, '/inheritance:r', '/grant:r', '*S-1-5-21-100-200-300-1001:(OI)(CI)F']);
  for (const sid of ['Everyone', '', 'S-1-5-21-100 /grant', '*S-1-5-21-100']) assert.throws(() => windowsAclArgs(directory, sid));
});

test('preparation retries only an empty ordinary directory, never overwrites existing settings', () => {
  let created = 0;
  const fake = { existsSync: () => true, lstatSync: () => ({ isDirectory: () => true, isSymbolicLink: () => false }), readdirSync: () => [], mkdirSync: () => { created++; } };
  ensureEmptyPreparationDirectory('/scratch/private-access', fake); assert.equal(created, 0);
  assert.throws(() => ensureEmptyPreparationDirectory('/scratch/private-access', { ...fake, readdirSync: () => ['admin-key.txt'] }));
  assert.throws(() => ensureEmptyPreparationDirectory('/scratch/private-access', { ...fake, lstatSync: () => ({ isDirectory: () => true, isSymbolicLink: () => true }) }));
  assert.throws(() => ensureEmptyPreparationDirectory('/scratch/private-access', { ...fake, lstatSync: () => ({ isDirectory: () => false, isSymbolicLink: () => false }) }));
  ensureEmptyPreparationDirectory('/scratch/private-access', { ...fake, existsSync: () => false }); assert.equal(created, 1);
});

test('only exact owner, host, loopback and same-origin mutations pass', () => {
  const cfg = validateConfig(config);
  assert.equal(requestBoundary(mock(), cfg).pathname, '/');
  assert.equal(requestBoundary(mock('POST', '/api/session', { origin }), cfg).pathname, '/api/session');
  for (const headers of [{ host: 'evil.example' }, { origin: 'https://evil.example' }, { 'tailscale-user-login': '' }, { 'tailscale-user-login': 'neighbour@gmail.com' }, { 'tailscale-user-login': ['fixture@gmail.com'] }, { 'content-encoding': 'gzip' }]) assert.throws(() => requestBoundary(mock('GET', '/', headers), cfg));
  assert.throws(() => requestBoundary(mock('POST'), cfg));
  const lan = mock(); lan.socket.remoteAddress = '192.168.1.20'; assert.throws(() => requestBoundary(lan, cfg));
  const duplicate = mock(); duplicate.rawHeaders = ['Origin', origin, 'origin', origin]; assert.throws(() => requestBoundary(duplicate, cfg));
  const forwarded = mock('GET', '/', { host: 'evil.example', 'x-forwarded-host': config.hostname, 'x-forwarded-proto': 'https' }); assert.throws(() => requestBoundary(forwarded, cfg));
});

test('ambiguous paths and remote launcher tokens cannot reach the allowlist', () => {
  for (const value of ['/api/../workspace/backup', '/api/%2e%2e/config', '/api/%252e%252e/config', '/api%2fsession', '/api\\session', '//evil.example/', '/api/session?ACCESS=secret', '/api/session?%61ccess=secret', '/api/%00', '/api/%zz', '/api//session', '/api/session#fragment']) assert.throws(() => requestPath(value));
  assert.equal(requestPath('/api/session?directory=C%3A%5CProjects').pathname, '/api/session');
  assert.equal(allowedRoute('POST', '/api/session/ses_fixture/prompt_async'), true);
  assert.equal(allowedRoute('POST', '/api/permission/per_fixture/reply'), true);
  for (const [method, url] of [['POST', '/workspace/approval-policy'], ['POST', '/workspace/instructions/save'], ['POST', '/workspace/backup'], ['POST', '/workspace/updates/install'], ['POST', '/workspace/engine-updates/install'], ['POST', '/workspace/activity/rebuild'], ['GET', '/classic'], ['POST', '/api/provider/key'], ['PATCH', '/api/config'], ['GET', '/api/new-future-admin-route']]) assert.equal(allowedRoute(method, url), false);
});

test('pair codes are single-use, expiring, attempt-limited; sessions persist only hashes', () => {
  let clock = 10000, saved;
  const sessions = createSessions({ now: () => clock, save: value => { saved = structuredClone(value); } });
  const code = sessions.pairCode(), paired = sessions.pair(code, 'My phone');
  assert.equal(sessions.authenticate(paired.token).label, 'My phone');
  assert.equal(JSON.stringify(saved).includes(paired.token), false);
  assert.equal(JSON.stringify(saved).includes(code.replaceAll('-', '')), false);
  assert.throws(() => sessions.pair(code, 'Replay'));
  const restored = createSessions({ state: saved, now: () => clock });
  assert.equal(restored.authenticate(paired.token).id, paired.session.id);
  restored.revoke(paired.session.id); assert.equal(restored.authenticate(paired.token), null);
  clock += SESSION_MS; assert.equal(sessions.authenticate(paired.token), null);
  const expired = sessions.pairCode(); clock += PAIR_MS; assert.throws(() => sessions.pair(expired, 'Late'));
  const limited = sessions.pairCode(); for (let n = 0; n < 5; n++) assert.throws(() => sessions.pair('0000', 'Wrong'));
  assert.throws(() => sessions.pair(limited, 'After limit'));
});

test('storage failure denies future access; corrupt stores fail closed; cookies are unambiguous', () => {
  let fail = false, revoked = false;
  const sessions = createSessions({ save: () => { if (fail) throw Error('fixture disk failure'); }, onRevoke: () => { revoked = true; } });
  const paired = sessions.pair(sessions.pairCode(), 'Phone'); fail = true;
  assert.throws(() => sessions.revoke(null)); assert.equal(sessions.authenticate(paired.token), null); assert.equal(revoked, true);
  assert.throws(() => createSessions({ state: { version: 0, sessions: [], pairing: null } }));
  assert.equal(readCookie(`${COOKIE}=${paired.token}; ${COOKIE}=${paired.token}`), '');
  assert.equal(readCookie(`${COOKIE}=${paired.token}`), paired.token);
  let clock = 10000, saved;
  const ticking = createSessions({ now: () => ++clock, save: next => { saved = next; } });
  ticking.pair(ticking.pairCode(), 'Clock fixture');
  assert.doesNotThrow(() => createSessions({ state: saved, now: () => clock }));
});

test('device limit and safe labels; local secrets are stripped from provider/config data', () => {
  const sessions = createSessions();
  for (let n = 0; n < 4; n++) sessions.pair(sessions.pairCode(), 'Phone\u0000');
  assert.equal(sessions.list()[0].label, 'Phone');
  assert.throws(() => sessions.pair(sessions.pairCode(), 'Fifth browser'));
  const configData = sanitize('/api/config', { provider: { dummy: { options: { apiKey: 'fixture-secret' } } }, permission: { bash: 'ask' }, agent: { build: { prompt: 'private prompt', permission: { edit: 'ask' }, options: { apiKey: 'fixture-secret' } } } });
  assert.equal(configData.permission.bash, 'ask'); assert.equal(JSON.stringify(configData).includes('fixture-secret'), false);
  const providers = sanitize('/api/provider', { connected: ['dummy'], all: [{ id: 'dummy', name: 'Dummy', options: { apiKey: 'fixture-secret' }, models: { test: { id: 'test', name: 'Fixture', options: { apiKey: 'fixture-secret' }, capabilities: { toolcall: true } } } }] });
  assert.equal(providers.all[0].models.test.capabilities.toolcall, true); assert.equal(JSON.stringify(providers).includes('fixture-secret'), false);
});

test('Serve conflicts and public Funnel are rejected without mutations', () => {
  checkServe({}, config.hostname, config.port);
  checkServe(null, config.hostname, config.port);
  const owned = { TCP: { 443: { HTTPS: true } }, Web: { [`${config.hostname}:443`]: { Handlers: { '/': { Proxy: 'http://127.0.0.1:4200' } } } }, AllowFunnel: { [`${config.hostname}:443`]: false } };
  checkServe(owned, config.hostname, config.port, true);
  assert.throws(() => checkServe(owned, config.hostname, config.port));
  assert.throws(() => checkServe({ ...owned, AllowFunnel: { [`${config.hostname}:443`]: true } }, config.hostname, config.port, true));
  assert.throws(() => checkServe({ ...owned, Foreground: { unknown: true } }, config.hostname, config.port, true));
  assert.throws(() => checkServe([], config.hostname, config.port));
});

async function fixture(t, { providerData, configData } = {}) {
  let clock = Date.now(); const calls = [];
  const host = http.createServer((req, res) => {
    calls.push({ method: req.method, url: req.url, headers: req.headers });
    if (req.url === '/api/event') { res.writeHead(200, { 'content-type': 'text/event-stream' }); res.write('data: {"type":"fixture.ready"}\n\n'); return; }
    if (req.url === '/') { res.writeHead(200, { 'content-type': 'text/html', 'set-cookie': `atelier_session=${localToken}` }); res.end('<html><head><link rel="stylesheet" href="/workspace/phone-access.css" /></head><body><main class="app-shell">Synthetic workspace</main><script src="/workspace/phone-access.js" defer></script></body></html>'); return; }
    if (req.url === '/api/config') { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(configData || { permission: { edit: 'ask' }, provider: { options: { apiKey: 'fixture-secret' } } })); return; }
    if (providerData && req.url === '/api/provider') { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(providerData)); return; }
    if (providerData && req.url === '/api/global/health') { res.writeHead(200, { 'content-type': 'application/json' }); res.end('{"healthy":true,"version":"fixture"}'); return; }
    if (providerData && req.url === '/api/path') { res.writeHead(200, { 'content-type': 'application/json' }); res.end('{"directory":"/scratch/project"}'); return; }
    if (providerData && req.url === '/api/session') { res.writeHead(200, { 'content-type': 'application/json' }); res.end('[{"id":"ses_fixture","title":"Synthetic existing session","directory":"/scratch/project"}]'); return; }
    if (providerData && req.url === '/workspace/session-projects') { res.writeHead(200, { 'content-type': 'application/json' }); res.end('{"ses_fixture":"/scratch/project"}'); return; }
    req.resume(); res.writeHead(200, { 'content-type': 'application/json', 'set-cookie': `atelier_session=${localToken}`, 'access-control-allow-origin': '*' }); res.end('{"fixture":true}');
  });
  await new Promise(resolve => host.listen(0, '127.0.0.1', resolve));
  const gateway = createGateway({ config: { ...config, upstreamPort: host.address().port }, upstreamToken: localToken, adminKey, now: () => clock });
  await new Promise(resolve => gateway.server.listen(0, '127.0.0.1', resolve));
  t.after(async () => { gateway.server.closeAllConnections(); host.closeAllConnections(); await Promise.all([new Promise(resolve => gateway.server.close(resolve)), new Promise(resolve => host.close(resolve))]); });
  const port = gateway.server.address().port;
  function request(url, { method = 'GET', cookie, headers = {}, payload = '' } = {}) {
    return new Promise((resolve, reject) => {
      const requestHeaders = Object.fromEntries(Object.entries({ host: config.hostname, 'tailscale-user-login': config.owner, ...(method === 'GET' ? {} : { origin }), ...(cookie ? { cookie } : {}), ...headers }).filter(([, value]) => value !== null));
      const req = http.request({ hostname: '127.0.0.1', port, path: url, method, headers: requestHeaders, timeout: 5000 }, res => {
        const chunks = []; res.on('data', c => chunks.push(c)); res.on('error', reject); res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, text: Buffer.concat(chunks).toString() }));
      }); req.on('error', reject); req.on('timeout', () => req.destroy(Error('Fixture timeout'))); req.end(payload);
    });
  }
  async function pair() {
    const code = gateway.sessions.pairCode();
    const response = await request('/remote/pair', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, payload: new URLSearchParams({ code, label: 'Fixture phone' }).toString() });
    assert.equal(response.status, 303);
    const cookie = response.headers['set-cookie'][0];
    assert.match(cookie, /Secure; HttpOnly; SameSite=Strict; Path=\//); assert.match(cookie, /Max-Age=43200/);
    return cookie.split(';')[0];
  }
  return { gateway, calls, request, pair, port, advance: ms => { clock += ms; } };
}

test('gateway denies unpaired/wrong identity; injects host banner without exporting local auth', { timeout: 15000 }, async t => {
  const f = await fixture(t);
  assert.equal((await f.request('/api/session')).status, 401);
  assert.equal((await f.request('/', { headers: { 'tailscale-user-login': 'neighbour@gmail.com' } })).status, 403);
  assert.equal(f.calls.length, 0);
  const cookie = await f.pair();
  const page = await f.request('/', { cookie }); assert.equal(page.status, 200); assert.match(page.text, /Runs on/); assert.equal(page.text.includes(localToken), false); assert.equal(page.headers['set-cookie'], undefined);
  assert.equal(page.text.includes('/workspace/phone-access.'), false);
  for (const route of ['/workspace/phone-access/status', '/workspace/phone-access.js', '/workspace/phone-access.css']) assert.equal((await f.request(route, { cookie })).status, 403);
  for (const action of ['start', 'pair', 'stop', 'revoke']) assert.equal((await f.request('/workspace/phone-access/' + action, { cookie, method: 'POST' })).status, 403);
  const result = await f.request('/api/session', { cookie, headers: { authorization: 'Bearer fixture-untrusted', 'x-forwarded-host': 'evil.example' } });
  assert.equal(result.status, 200); assert.equal(result.headers['access-control-allow-origin'], undefined);
  assert.equal(f.calls.at(-1).headers.cookie, `atelier_session=${localToken}`); assert.equal(f.calls.at(-1).headers.authorization, undefined); assert.equal(f.calls.at(-1).headers['tailscale-user-login'], undefined); assert.equal(f.calls.at(-1).headers['x-forwarded-host'], undefined);
  const clean = await f.request('/api/config', { cookie }); assert.equal(clean.text.includes('fixture-secret'), false);
  for (const route of ['/workspace/updates/install', '/workspace/approval-policy', '/workspace/backup', '/workspace/activity/rebuild']) assert.equal((await f.request(route, { cookie, method: 'POST' })).status, 403);
  assert.equal((await f.request('/api/session', { cookie, method: 'POST', headers: { origin: 'https://evil.example' } })).status, 403);
  assert.equal((await f.request('/remote/admin', { cookie, method: 'POST', headers: { authorization: `Bearer ${adminKey}`, 'content-type': 'application/json' }, payload: '{"action":"devices"}' })).status, 403);
  assert.equal((await f.request('/remote/admin', { method: 'POST', headers: { host: '127.0.0.1:4200', origin: null, 'tailscale-user-login': null, authorization: `Bearer ${adminKey}`, 'content-type': 'application/json' }, payload: '{"action":"devices"}' })).status, 200);
  assert.equal((await f.request('/remote/logout', { cookie, method: 'POST' })).status, 303);
  assert.equal((await f.request('/api/session', { cookie })).status, 401);
});

test('native pairing/logout forms preserve same-origin policy; null or foreign origins never mutate sessions', { timeout: 15000 }, async t => {
  const f = await fixture(t);
  const page = await f.request('/remote/pair');
  assert.equal(page.status, 200);
  assert.equal(page.headers['referrer-policy'], 'same-origin');
  assert.match(page.text, /<form method="post" action="\/remote\/pair">/);
  assert.match(page.headers['content-security-policy'], /form-action 'self'/);
  const code = f.gateway.sessions.pairCode();
  const payload = new URLSearchParams({ code, label: 'Fixture phone' }).toString();
  for (const badOrigin of ['null', null, 'https://evil.example']) {
    const denied = await f.request('/remote/pair', { method: 'POST', headers: { origin: badOrigin, 'content-type': 'application/x-www-form-urlencoded' }, payload });
    assert.equal(denied.status, 403);
    assert.equal(denied.headers['set-cookie'], undefined);
    assert.equal(f.gateway.sessions.list().length, 0);
  }
  const invalid = await f.request('/remote/pair', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, payload: 'code=INVALID&label=Fixture' });
  assert.equal(invalid.status, 400);
  assert.equal(invalid.headers['referrer-policy'], 'same-origin');
  assert.match(invalid.text, /role="alert"/);
  const paired = await f.request('/remote/pair', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, payload });
  assert.equal(paired.status, 303);
  assert.equal(paired.headers.location, '/');
  assert.equal(paired.headers['referrer-policy'], 'same-origin');
  const cookie = paired.headers['set-cookie'][0].split(';')[0];
  const workspace = await f.request('/', { cookie });
  assert.equal(workspace.status, 200);
  assert.equal(workspace.headers['referrer-policy'], 'same-origin');
  assert.match(workspace.text, /<form method="post" action="\/remote\/logout">/);
  for (const badOrigin of ['null', null, 'https://evil.example']) {
    assert.equal((await f.request('/remote/logout', { cookie, method: 'POST', headers: { origin: badOrigin } })).status, 403);
    assert.equal(f.gateway.sessions.list().length, 1);
  }
  assert.equal((await f.request('/remote/logout', { cookie, method: 'POST' })).status, 303);
  assert.equal(f.gateway.sessions.list().length, 0);
});

test('SSE is authenticated and closes on revocation or expiry; reconnect never submits work', { timeout: 15000 }, async t => {
  const f = await fixture(t); const cookie = await f.pair();
  // Do not await the returned closing promise before performing the revocation.
  let closure;
  const ready = new Promise(resolve => {
    const req = http.get({ hostname: '127.0.0.1', port: f.port, path: '/api/event', headers: { host: config.hostname, 'tailscale-user-login': config.owner, cookie } }, res => { res.resume(); closure = new Promise(done => res.on('close', done)); resolve(); });
    req.on('error', () => resolve()); t.after(() => req.destroy());
  });
  await ready; assert.ok(closure); f.gateway.sessions.revoke(f.gateway.sessions.list()[0].id); await closure;
  assert.equal((await f.request('/api/event', { cookie })).status, 401);
  const nextCookie = await f.pair();
  const expiredClosed = new Promise(resolve => {
    const req = http.get({ hostname: '127.0.0.1', port: f.port, path: '/api/event', headers: { host: config.hostname, 'tailscale-user-login': config.owner, cookie: nextCookie } }, res => { res.resume(); res.on('close', resolve); f.advance(SESSION_MS + 1); });
    req.on('error', resolve); t.after(() => req.destroy());
  });
  await expiredClosed;
  assert.equal(f.calls.some(call => call.method !== 'GET'), false);
});

test('pairing form has labels, error association and no inline executable script', () => {
  const html = pairPage('Wrong <code>'); assert.match(html, /label for="code"/); assert.match(html, /aria-invalid="true"/); assert.match(html, /role="alert"/); assert.match(html, /Wrong &lt;code&gt;/); assert.equal(html.includes('<script'), false);
  const client = fs.readFileSync(path.join(__dirname, '..', 'app', 'private-access.js'), 'utf8');
  assert.equal(client.includes('localStorage'), false); assert.equal(client.includes('prompt_async'), false);
});

test('a large raw provider catalog is redacted before the output limit and does not block session bootstrap', { timeout: 15000 }, async t => {
  const providerData = { connected: ['dummy'], default: { dummy: 'test' }, all: [{ id: 'dummy', name: 'Dummy', options: { unusedSchema: 'X'.repeat(3 * 1024 * 1024), apiKey: 'fixture-secret' }, models: { test: { id: 'test', name: 'Fixture model', capabilities: { toolcall: true }, options: { apiKey: 'fixture-secret' } } } }] };
  const f = await fixture(t, { providerData }); const cookie = await f.pair();
  const responses = await Promise.all(['/api/global/health', '/api/path', '/api/session', '/api/provider', '/workspace/session-projects'].map(route => f.request(route, { cookie })));
  for (const response of responses) assert.equal(response.status, 200);
  const models = JSON.parse(responses[3].text);
  assert.equal(models.all[0].models.test.name, 'Fixture model');
  assert.equal(models.all[0].models.test.capabilities.toolcall, true);
  assert.equal(responses[3].text.includes('fixture-secret'), false);
  assert.ok(Buffer.byteLength(responses[3].text) < 1024);
  assert.equal(JSON.parse(responses[2].text)[0].id, 'ses_fixture');
  assert.equal(JSON.parse(responses[4].text).ses_fixture, '/scratch/project');
});

test('oversized sanitized provider metadata is still refused', { timeout: 15000 }, async t => {
  const providerData = { connected: ['dummy'], all: [{ id: 'dummy', name: 'X'.repeat(8 * 1024 * 1024), models: {} }] };
  const f = await fixture(t, { providerData }); const cookie = await f.pair();
  const response = await f.request('/api/provider', { cookie });
  assert.equal(response.status, 502); assert.match(response.text, /Filtered host response exceeded/);
});

test('a catalog larger than 2 MiB after redaction retains model metadata and session bootstrap', { timeout: 15000 }, async t => {
  const modelCount = 8000;
  const models = Object.fromEntries(Array.from({ length: modelCount }, (_, index) => {
    const id = 'model-' + index;
    return [id, { id, providerID: 'dummy', name: 'Synthetic catalog model ' + index + ' — ' + 'display '.repeat(8), family: 'fixture',
      release_date: '2026-01-01', status: 'active',
      capabilities: { temperature: true, reasoning: true, attachment: false, toolcall: true, input: { text: true }, output: { text: true } },
      cost: { input: 1, output: 2, cache: { read: 0.1, write: 0.2 } }, limit: { context: 128000, input: 120000, output: 8000 },
      options: { apiKey: 'fixture-secret' } }];
  }));
  const providerData = { connected: ['dummy'], default: { dummy: 'model-0' }, all: [{ id: 'dummy', name: 'Dummy', models, options: { apiKey: 'fixture-secret' } }] };
  const expected = sanitize('/api/provider', providerData);
  const bytes = Buffer.byteLength(JSON.stringify(expected));
  assert.ok(bytes > 2 * 1024 * 1024 && bytes < 8 * 1024 * 1024);
  const f = await fixture(t, { providerData }); const cookie = await f.pair();
  const responses = await Promise.all(['/api/provider', '/api/session', '/workspace/session-projects'].map(route => f.request(route, { cookie })));
  for (const response of responses) assert.equal(response.status, 200);
  const result = JSON.parse(responses[0].text);
  assert.equal(Object.keys(result.all[0].models).length, modelCount);
  assert.deepEqual(result.default, expected.default);
  assert.deepEqual(result.all[0].models['model-7999'], expected.all[0].models['model-7999']);
  assert.equal(responses[0].text.includes('fixture-secret'), false);
  assert.equal(JSON.parse(responses[1].text)[0].id, 'ses_fixture');
  assert.equal(JSON.parse(responses[2].text).ses_fixture, '/scratch/project');
});

test('the provider exception does not enlarge the config response limit', { timeout: 15000 }, async t => {
  const f = await fixture(t, { configData: { permission: { edit: 'ask' }, provider: { options: { unusedSchema: 'X'.repeat(3 * 1024 * 1024), apiKey: 'fixture-secret' } } } });
  const cookie = await f.pair();
  const response = await f.request('/api/config', { cookie });
  assert.equal(response.status, 502); assert.match(response.text, /Host response exceeded/);
  assert.equal(response.text.includes('fixture-secret'), false);
});

test('raw provider input remains bounded even when unused fields would be stripped', { timeout: 15000 }, async t => {
  const providerData = { connected: ['dummy'], all: [{ id: 'dummy', name: 'Dummy', options: { unusedSchema: 'X'.repeat(16 * 1024 * 1024 + 1) }, models: {} }] };
  const f = await fixture(t, { providerData }); const cookie = await f.pair();
  const response = await f.request('/api/provider', { cookie });
  assert.equal(response.status, 502); assert.match(response.text, /Host response exceeded/);
});

// Minimal synthetic DOM, no browser execution or real user data.
function navigationFixture() {
  let doc;
  function node(id = '') {
    const classes = new Set(), attrs = new Map(), listeners = new Map(), captureModes = new Map();
    const result = {
      id, parent: null, children: [], beforeNodes: [], hidden: false, inert: false, focusCount: 0, attrs, listeners, captureModes,
      classList: { contains: key => classes.has(key), add: key => classes.add(key), remove: key => classes.delete(key), toggle: (key, value = !classes.has(key)) => value ? classes.add(key) : classes.delete(key) },
      setAttribute: (key, value) => attrs.set(key, value), removeAttribute: key => attrs.delete(key), getAttribute: key => attrs.get(key) ?? null, hasAttribute: key => attrs.has(key),
      focus: options => { result.focusCount++; result.lastFocusOptions = options; doc.activeElement = result; },
      contains: element => { for (let current = element; current; current = current.parent) if (current === result) return true; return false; },
      append: item => { item.parent = result; result.children.push(item); }, before: item => result.beforeNodes.push(item),
      remove: () => { if (result.parent) result.parent.children = result.parent.children.filter(item => item !== result); result.parent = null; },
      closest: selector => {
        for (let current = result; current; current = current.parent) {
          if (selector.split(',').some(part => {
            const token = part.trim();
            return token.startsWith('#') ? current.id === token.slice(1) : token.startsWith('.') ? current.classList.contains(token.slice(1)) : current.tag === token;
          })) return current;
        }
        return null;
      },
      addEventListener: (key, fn, options) => { listeners.set(key, [...(listeners.get(key) || []), fn]); captureModes.set(fn, options === true || options?.capture === true); },
      removeEventListener: (key, fn) => { const remaining = (listeners.get(key) || []).filter(item => item !== fn); if (remaining.length) listeners.set(key, remaining); else listeners.delete(key); captureModes.delete(fn); },
      fire: (key, event = {}) => { for (const fn of [...(listeners.get(key) || [])]) fn(event); }
    };
    return result;
  }
  doc = node();
  const home = node('homeButton'), sidebar = node('sidebar'), head = node(), inspector = node('inspector'), trigger = node('openInspectorButton'), closeInspector = node('closeInspectorButton');
  sidebar.append(head); inspector.append(closeInspector);
  sidebar.querySelector = () => head;
  const ids = { homeButton: home, inspector, openInspectorButton: trigger, closeInspectorButton: closeInspector };
  doc.querySelector = selector => selector === '.sidebar' ? sidebar : selector === 'dialog[open]' && doc.modal ? {} : null;
  doc.getElementById = id => ids[id] || null; doc.createElement = () => node(); doc.activeElement = home;
  const leftMedia = node(), rightMedia = node(); leftMedia.matches = true; rightMedia.matches = true;
  const observers = [];
  const view = {
    matchMedia: query => query.includes('680px') ? leftMedia : rightMedia,
    MutationObserver: class { constructor(fn) { this.fn = fn; observers.push(this); } observe() {} disconnect() { this.disconnected = true; } }
  };
  const event = extra => ({ prevented: false, stopped: false, preventDefault() { this.prevented = true; }, stopImmediatePropagation() { this.stopped = true; }, ...extra });
  const dispatchClick = (target, activate = () => {}) => {
    const click = event({ target }), route = [];
    for (let current = target; current; current = current.parent) route.push(current);
    if (!route.includes(doc)) route.push(doc);
    for (const capture of [true, false]) {
      for (const current of capture ? [...route].reverse() : route) {
        for (const fn of [...(current.listeners.get('click') || [])]) {
          if (current.captureModes.get(fn) !== capture) continue;
          fn(click);
          if (click.stopped) return click;
        }
      }
    }
    if (!click.prevented) activate();
    return click;
  };
  return { doc, view, home, sidebar, head, inspector, trigger, closeInspector, leftMedia, rightMedia, node, event,
    dispatchClick,
    notify: () => { for (const observer of observers) if (!observer.disconnected) observer.fn(); } };
}

test('mobile menu is separate from home and closes via button, Escape, outside taps and selection', () => {
  const f = navigationFixture(), cleanup = setupMobileNavigation(f.doc, f.view);
  const toggle = f.home.beforeNodes[0], close = f.head.children[0];
  assert.equal(toggle.type, 'button'); assert.equal(close.type, 'button');
  assert.equal(toggle.attrs.get('aria-label'), 'Open projects and sessions');
  assert.equal(f.home.attrs.get('aria-label'), 'Open workspace home');
  assert.equal(f.home.attrs.has('aria-expanded'), false); assert.equal(f.sidebar.inert, true);
  const click = f.event(); toggle.fire('click', click);
  assert.equal(f.sidebar.inert, false); assert.equal(toggle.attrs.get('aria-expanded'), 'true'); assert.equal(close.focusCount, 1);
  assert.equal(click.prevented, true); assert.equal(click.stopped, true);
  close.fire('click'); assert.equal(f.sidebar.inert, true); assert.equal(toggle.focusCount, 1);
  toggle.fire('click', f.event()); f.doc.fire('keydown', f.event({ key: 'Escape' })); assert.equal(f.sidebar.classList.contains('open'), false);
  toggle.fire('click', f.event()); f.doc.fire('click', f.event({ target: f.node() })); assert.equal(f.sidebar.classList.contains('open'), false);
  const selection = f.node(); selection.classList.add('session-open-button'); f.sidebar.append(selection);
  assert.equal(selection.closest('dialog'), null);
  assert.equal(selection.closest('.session-open-button'), selection);
  const selectionLabel = f.node(); selection.append(selectionLabel);
  assert.equal(selectionLabel.closest('dialog'), null);
  assert.equal(selectionLabel.closest('.session-open-button'), selection);
  toggle.fire('click', f.event()); f.doc.fire('click', f.event({ target: selection })); assert.equal(f.sidebar.classList.contains('open'), false);
  toggle.fire('click', f.event()); f.dispatchClick(selectionLabel); assert.equal(f.sidebar.classList.contains('open'), false);
  toggle.fire('click', f.event()); const homeClick = f.event(); f.home.fire('click', homeClick);
  assert.equal(f.sidebar.classList.contains('open'), false); assert.equal(homeClick.prevented, false); assert.equal(homeClick.stopped, false);
  toggle.fire('click', f.event()); f.leftMedia.matches = false; f.leftMedia.fire('change');
  assert.equal(f.sidebar.inert, false); f.home.fire('click'); assert.equal(f.sidebar.classList.contains('open'), false);
  cleanup(); assert.equal(f.doc.listeners.size, 0); assert.equal(f.home.listeners.size, 0); assert.equal(toggle.listeners.size, 0); assert.equal(f.leftMedia.listeners.size, 0);
  const css = fs.readFileSync(path.join(__dirname, '..', 'app', 'private-access.css'), 'utf8');
  assert.match(css, /\.remote-client \.brand-mark \{ opacity: 1; \}/);
  assert.match(css, /--remote-bar-height.*--remote-status-height.*--topbar/);
  assert.match(css, /\.remote-client \.topbar \{ grid-template-columns: 44px 44px minmax\(0, 1fr\) auto; \}/);
});

test('Workspace tools persist through phone feature selection until explicitly dismissed', () => {
  const f = navigationFixture(), tools = f.node('workspaceToolsButton'), panel = f.node('workspaceToolsPanel');
  tools.classList.add('rail-link'); f.sidebar.append(tools); f.sidebar.append(panel);
  const icon = f.node(); tools.append(icon);
  let popoverOpen = false, popoverCloses = 0;
  panel.matches = selector => selector === ':popover-open' && popoverOpen;
  panel.hidePopover = () => { popoverOpen = false; popoverCloses++; };
  panel.setAttribute('popover', 'auto');
  const getElementById = f.doc.getElementById;
  f.doc.getElementById = id => id === tools.id ? tools : id === panel.id ? panel : getElementById(id);
  const cleanup = setupMobileNavigation(f.doc, f.view), toggle = f.home.beforeNodes[0], close = f.head.children[0];
  const toolsClose = panel.children[0];
  assert.equal(toolsClose.type, 'button'); assert.equal(toolsClose.attrs.get('aria-label'), 'Close Workspace tools');
  assert.equal(panel.getAttribute('popover'), 'manual'); assert.equal(panel.hasAttribute('data-remote-persistent'), true);
  const openTools = () => {
    if (!f.sidebar.classList.contains('open')) toggle.fire('click', f.event());
    f.dispatchClick(icon, () => { popoverOpen = !popoverOpen; });
    assert.equal(popoverOpen, true);
    assert.equal(f.sidebar.classList.contains('open'), true);
    assert.equal(f.sidebar.inert, false);
  };
  // Execute the actual shared capture handler against the dummy menu.
  const app = fs.readFileSync(path.join(__dirname, '..', 'app', 'app.js'), 'utf8');
  const handler = app.match(/toolsPanel\.addEventListener\("click",[^\n]+/)[0];
  vm.runInNewContext(handler, { toolsPanel: panel });
  const featureIDs = ['workspaceRefreshButton', 'agentBoardRailButton', 'agentBoardHistoryRailButton', 'instructionsRailButton', 'chatGPTRailButton', 'openChatGPTUsageButton'];
  for (const id of featureIDs) {
    openTools();
    const item = f.node(id); item.tag = 'button'; item.classList.add('rail-link'); panel.append(item);
    const label = f.node(); item.append(label);
    let invoked = 0;
    item.addEventListener('click', () => {
      assert.equal(f.sidebar.inert, false, id);
      assert.equal(f.sidebar.classList.contains('open'), true, id);
      assert.equal(popoverOpen, true, id);
      invoked++;
      // A modal tool moves focus outside the drawer before navigation cleanup.
      f.doc.activeElement = f.node('toolDialog');
    });
    f.dispatchClick(label);
    assert.equal(invoked, 1, id);
    assert.equal(f.sidebar.inert, false, id); assert.equal(popoverOpen, true, id);
    assert.equal(f.doc.activeElement.id, 'toolDialog', id);
    const modal = f.node(); modal.tag = 'dialog'; const modalControl = f.node(); modal.append(modalControl);
    f.dispatchClick(modalControl);
    assert.equal(popoverOpen, true, id); assert.equal(f.sidebar.inert, false, id);
    toolsClose.fire('click'); assert.equal(popoverOpen, false); assert.equal(f.doc.activeElement, tools);
  }
  openTools();
  const escape = f.event({ key: 'Escape' }); f.doc.fire('keydown', escape);
  assert.equal(escape.prevented, true); assert.equal(f.sidebar.inert, false); assert.equal(popoverOpen, false);
  assert.equal(f.doc.activeElement, tools);
  f.doc.fire('keydown', f.event({ key: 'Escape' }));
  assert.equal(f.sidebar.inert, true);
  openTools(); close.fire('click');
  assert.equal(popoverOpen, false); assert.equal(f.sidebar.inert, true);
  openTools(); f.dispatchClick(f.node());
  assert.equal(popoverOpen, false); assert.equal(f.sidebar.inert, true);
  openTools(); f.home.fire('click', f.event());
  assert.equal(popoverOpen, false); assert.equal(f.sidebar.inert, true);
  assert.equal(popoverCloses, featureIDs.length + 4);
  // Desktop behavior is untouched by the remote mobile navigation handler.
  f.leftMedia.matches = false; f.leftMedia.fire('change'); popoverOpen = true;
  assert.equal(panel.getAttribute('popover'), 'auto'); assert.equal(panel.hasAttribute('data-remote-persistent'), false);
  const desktopItem = f.node(); desktopItem.tag = 'button'; desktopItem.classList.add('rail-link'); panel.append(desktopItem);
  f.dispatchClick(desktopItem);
  assert.equal(f.sidebar.inert, false); assert.equal(popoverOpen, false);
  cleanup(); assert.equal(f.doc.listeners.size, 0); assert.equal(f.doc.captureModes.size, 0);
  assert.equal(panel.children.includes(toolsClose), false); assert.equal(panel.getAttribute('popover'), 'auto');
});

test('Context hides while the inspector is open; close, Escape and outside taps restore its trigger', () => {
  const f = navigationFixture();
  const cleanupLeft = setupMobileNavigation(f.doc, f.view), cleanupRight = setupInspectorNavigation(f.doc, f.view);
  const toggle = f.home.beforeNodes[0];
  assert.equal(f.inspector.inert, true);
  toggle.fire('click', f.event()); f.trigger.fire('click', f.event()); f.notify();
  assert.equal(f.sidebar.classList.contains('open'), false); assert.equal(f.inspector.inert, false);
  assert.equal(f.trigger.hidden, true); assert.equal(f.trigger.attrs.get('aria-expanded'), 'true');
  assert.equal(f.closeInspector.attrs.get('aria-label'), 'Close agent context'); assert.equal(f.doc.activeElement, f.closeInspector);
  assert.equal(f.closeInspector.lastFocusOptions?.preventScroll, true);
  f.closeInspector.fire('click', f.event());
  assert.equal(f.inspector.inert, true); assert.equal(f.trigger.hidden, false); assert.equal(f.doc.activeElement, f.trigger);
  f.trigger.fire('click', f.event()); f.doc.fire('keydown', f.event({ key: 'Escape' })); assert.equal(f.inspector.classList.contains('open'), false);
  f.trigger.fire('click', f.event()); f.doc.modal = true;
  f.doc.fire('keydown', f.event({ key: 'Escape' })); assert.equal(f.inspector.classList.contains('open'), true);
  f.doc.modal = false; f.doc.fire('click', f.event({ target: f.node() })); assert.equal(f.inspector.classList.contains('open'), false);
  f.trigger.fire('click', f.event()); toggle.fire('click', f.event()); f.notify();
  assert.equal(f.inspector.classList.contains('open'), false); assert.equal(f.sidebar.classList.contains('open'), true);
  f.rightMedia.matches = false; f.rightMedia.fire('change'); assert.equal(f.inspector.inert, false); assert.equal(f.trigger.hidden, false);
  const desktopClick = f.event(); f.trigger.fire('click', desktopClick); assert.equal(desktopClick.stopped, false);
  cleanupLeft(); cleanupRight(); assert.equal(f.doc.listeners.size, 0); assert.equal(f.trigger.listeners.size, 0); assert.equal(f.closeInspector.listeners.size, 0);
  const css = fs.readFileSync(path.join(__dirname, '..', 'app', 'private-access.css'), 'utf8');
  assert.match(css, /\.remote-client:has\(#inspector\.open\) \.mobile-inspector-button \{ visibility: hidden; pointer-events: none; \}/);
  assert.match(css, /\.remote-client \.mobile-inspector-close \{ display: inline-grid; min-width: 44px; min-height: 44px;/);
  assert.match(css, /\.remote-client \.mobile-inspector-button \{ top: calc\(var\(--remote-bar-height\) \+ var\(--remote-status-height, 0px\) \+ 70px\); min-height: 44px;/);
});

test('narrow local PC context uses close, Escape and outside taps with focus restoration', () => {
  const f = navigationFixture(); f.doc.body = f.node();
  const app = fs.readFileSync(path.join(__dirname, '../app/app.js'), 'utf8');
  const implementation = app.slice(app.indexOf('  function bindContextDrawer('), app.indexOf('  function selectModel('));
  assert.ok(implementation.includes('function bindContextDrawer('));
  let closedModels = 0;
  vm.runInNewContext(implementation + '\nbindContextDrawer();', {
    document: f.doc, els: { inspector: f.inspector }, matchMedia: f.view.matchMedia, MutationObserver: f.view.MutationObserver,
    $: selector => selector === '.sidebar' ? f.sidebar : selector === '#openInspectorButton' ? f.trigger : f.closeInspector,
    closeModelPicker: () => closedModels++
  });
  assert.equal(f.inspector.inert, true);
  f.trigger.fire('click'); assert.equal(closedModels, 1);
  assert.equal(f.trigger.hidden, true); assert.equal(f.doc.activeElement, f.closeInspector);
  assert.equal(f.closeInspector.lastFocusOptions?.preventScroll, true);
  f.closeInspector.fire('click'); assert.equal(f.trigger.hidden, false); assert.equal(f.doc.activeElement, f.trigger);
  f.trigger.fire('click'); f.doc.fire('keydown', f.event({ key: 'Escape' }));
  assert.equal(f.inspector.classList.contains('open'), false);
  f.trigger.fire('click'); f.doc.modal = true; f.doc.fire('keydown', f.event({ key: 'Escape' }));
  assert.equal(f.inspector.classList.contains('open'), true, 'dialog Escape must not close the underlying drawer');
  f.doc.modal = false; f.doc.fire('click', f.event({ target: f.node() }));
  assert.equal(f.inspector.classList.contains('open'), false);
  f.rightMedia.matches = false; f.rightMedia.fire('change'); assert.equal(f.inspector.inert, false);
});

test('model picker explicit close restores focus and opening dismisses only the narrow context drawer', () => {
  const f = navigationFixture();
  const app = fs.readFileSync(path.join(__dirname, '../app/app.js'), 'utf8');
  const implementation = app.slice(app.indexOf('  function closeModelPicker('), app.indexOf('  function bindContextDrawer('));
  const button = f.node(), menu = f.node(), search = f.node(), groups = f.node(), close = f.node(), picker = f.node();
  menu.hidden = true;
  let renders = 0;
  const context = { document: f.doc, innerWidth: 480, els: { modelPicker: picker, modelPickerButton: button, modelPickerMenu: menu, modelSearch: search, modelPickerGroups: groups, inspector: f.inspector },
    $: () => close, requestAnimationFrame: fn => fn(), renderModelPicker: () => renders++, selectModel: () => { throw Error('No user selection was made'); } };
  vm.runInNewContext(implementation + '\nbindModelPicker();', context);
  f.inspector.classList.add('open'); button.fire('click');
  assert.equal(f.inspector.classList.contains('open'), false); assert.equal(menu.hidden, false);
  assert.equal(f.doc.activeElement, search); assert.equal(renders, 1);
  close.fire('click'); assert.equal(menu.hidden, true); assert.equal(f.doc.activeElement, button);
  button.fire('click'); f.doc.fire('keydown', f.event({ key: 'Escape' }));
  assert.equal(menu.hidden, true); assert.equal(button.attrs.get('aria-expanded'), 'false');
  context.innerWidth = 1440; f.inspector.classList.add('open'); button.fire('click');
  assert.equal(f.inspector.classList.contains('open'), true, 'wide desktop inspector must be unchanged');
});

test('the native home action clears remote mobile session selection without opening a drawer or changing local mobile behavior', () => {
  const appSource = fs.readFileSync(path.join(__dirname, '..', 'app', 'app.js'), 'utf8');
  const handler = appSource.match(/\$\("#homeButton"\)\.addEventListener\("click", \(\) => \{([\s\S]*?)\n    \}\);/);
  assert.ok(handler);
  for (const [width, remote, returnsHome] of [[400, true, true], [400, false, false], [1280, false, true]]) {
    const state = { currentSessionID: 'ses_fixture', messages: ['dummy message'] }, saved = [];
    let rendered = 0, toggled = 0;
    const context = vm.createContext({
      innerWidth: width, state, document: { body: { classList: { contains: () => remote } } },
      $: () => ({ classList: { toggle: () => toggled++ } }), storage: { set: (...args) => saved.push(args) }, renderAll: () => rendered++
    });
    vm.runInContext('(function () {' + handler[1] + '\n})()', context, { timeout: 100 });
    assert.equal(rendered, returnsHome ? 1 : 0); assert.equal(toggled, returnsHome ? 0 : 1);
    assert.equal(state.currentSessionID, returnsHome ? '' : 'ses_fixture');
    assert.equal(state.messages.length, returnsHome ? 0 : 1);
    if (returnsHome) assert.deepEqual(saved, [['atelier-session', '']]); else assert.deepEqual(saved, []);
  }
  const { qualifiedFiles } = require('../scripts/private-access.cjs');
  assert.ok(qualifiedFiles.includes('app/app.js'));
  const verifier = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'verify-private-access.ps1'), 'utf8');
  assert.ok(verifier.includes("'app/app.js'"));
  const client = fs.readFileSync(path.join(__dirname, '..', 'app', 'private-access.js'), 'utf8');
  assert.match(client, /addEventListener\('pagehide', event => \{ if \(event.persisted\) return;/);
});
test('new engine launches register current OpenAI models without Zen routing or auth changes', () => {
  const serverSource = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  const factory = serverSource.match(/function openCodeModelLaunchConfig\(content = ""\) \{[\s\S]*?\n\}\n\nfunction ensureOpenCodeModelCatalog/);
  assert.ok(factory);
  const context = vm.createContext({});
  vm.runInContext(factory[0].replace(/\n\nfunction ensureOpenCodeModelCatalog$/, ''), context, { timeout: 100 });
  const inherited = { model: 'openai/gpt-5.6-luna', permission: { edit: 'ask' }, provider: {
    openai: { options: { apiKey: 'dummy-key', baseURL: 'https://fixture.invalid/v1' }, models: { existing: { name: 'Existing fixture' } },
      whitelist: ['gpt-5.6-terra', 'gpt-5.6-luna', 'gpt-5.6-sol'], blacklist: ['blocked-fixture-model'] },
    opencode: { models: { zen: { name: 'Zen fixture' } } }
  } };
  context.content = JSON.stringify(inherited);
  const config = JSON.parse(vm.runInContext('openCodeModelLaunchConfig(content)', context, { timeout: 100 }));
  assert.deepEqual(config.provider.openai.options, inherited.provider.openai.options);
  assert.deepEqual(config.provider.opencode, inherited.provider.opencode);
  assert.deepEqual(config.permission, inherited.permission);
  assert.equal(config.model, inherited.model);
  assert.deepEqual(config.provider.openai.models.existing, inherited.provider.openai.models.existing);
  const expectedWhitelist = [...inherited.provider.openai.whitelist, 'gpt-6-astra', 'gpt-6.1-sol', 'gpt-6-sol', 'gpt-6-luna'];
  assert.deepEqual(config.provider.openai.whitelist, expectedWhitelist);
  assert.deepEqual(config.provider.openai.blacklist, inherited.provider.openai.blacklist);
  context.content = JSON.stringify(config);
  assert.deepEqual(JSON.parse(vm.runInContext('openCodeModelLaunchConfig(content)', context, { timeout: 100 })), config);
  const unrestricted = JSON.parse(vm.runInContext('openCodeModelLaunchConfig()', context, { timeout: 100 }));
  assert.equal(Object.hasOwn(unrestricted.provider.openai, 'whitelist'), false);
  context.content = JSON.stringify({ provider: { openai: { whitelist: [] } } });
  assert.deepEqual(JSON.parse(vm.runInContext('openCodeModelLaunchConfig(content)', context, { timeout: 100 })).provider.openai.whitelist, expectedWhitelist.slice(3));
  for (const id of ['gpt-6-astra', 'gpt-6.1-sol', 'gpt-6-sol', 'gpt-6-luna']) {
    const model = config.provider.openai.models[id];
    assert.equal(model.tool_call, true); assert.equal(model.reasoning, true);
    assert.deepEqual(model.modalities, { input: ['text', 'image'], output: ['text'] });
    assert.equal(model.limit.context, 1050000); assert.equal(model.limit.output, 128000);
  }
  assert.equal(config.provider.openai.models['gpt-6.1-sol'].variants.none, undefined);
  assert.ok(config.provider.openai.models['gpt-6-luna'].variants.none);
  assert.equal(JSON.parse(vm.runInContext('openCodeModelLaunchConfig()', context, { timeout: 100 })).provider.openai.options, undefined);
  for (const bad of ['{', 'null', '[]', '{"provider":[]}', '{"provider":{"openai":{"models":[]}}}']) {
    context.content = bad;
    assert.throws(() => vm.runInContext('openCodeModelLaunchConfig(content)', context, { timeout: 100 }));
  }
  const launch = serverSource.slice(serverSource.indexOf('function startUpstream()'), serverSource.indexOf('function openCodeModelLaunchConfig'));
  context.process = { env: { WSLENV: 'EXISTING/u', OPENCODE_CONFIG_CONTENT: JSON.stringify(inherited) } };
  context.moliLaunchRuntime = () => null; context.moliLaunchConfig = content => content;
  context.wslDistribution = 'Fixture'; context.launchDirectory = '/scratch'; context.host = '127.0.0.1'; context.upstreamPort = 4097;
  context.upstreamUsername = 'dummy'; context.upstreamPassword = 'dummy-password'; context.shuttingDown = false;
  context.spawn = (command, args, options) => { context.launchOptions = options; return { on() {} }; };
  context.shutdown = () => { context.stopped = true; }; context.console = { error() {}, warn() {} };
  vm.runInContext(launch + '\nstartUpstream()', context, { timeout: 100 });
  assert.ok(context.launchOptions.env.WSLENV.includes('OPENCODE_CONFIG_CONTENT/u'));
  assert.ok(context.launchOptions.env.WSLENV.startsWith('EXISTING/u:'));
  assert.equal(JSON.parse(context.launchOptions.env.OPENCODE_CONFIG_CONTENT).provider.openai.models['gpt-6.1-sol'].name, 'GPT-6.1 Sol');
  assert.deepEqual(JSON.parse(context.launchOptions.env.OPENCODE_CONFIG_CONTENT).provider.openai.whitelist, expectedWhitelist);
  context.launchOptions = null; context.moliLaunchRuntime = () => { throw Error('Dummy corrupted optional runtime'); };
  vm.runInContext('startUpstream()', context, { timeout: 100 });
  assert.ok(context.launchOptions); assert.equal(context.stopped, undefined);
  context.launchOptions = null; context.process.env.OPENCODE_CONFIG_CONTENT = '{';
  vm.runInContext('startUpstream()', context, { timeout: 100 });
  assert.equal(context.stopped, true); assert.equal(context.launchOptions, null);
});

test('the picker uses engine-reported OpenAI models and never synthesizes unavailable entries', () => {
  const appSource = fs.readFileSync(path.join(__dirname, '..', 'app', 'app.js'), 'utf8');
  const match = appSource.match(/  function flattenModels\(\) \{([\s\S]*?)\n  \}\n\n  function renderModels/);
  assert.ok(match);
  function flatten(models) {
    const state = { providers: { connected: ['openai'], all: [
      { id: 'openai', name: 'OpenAI', models },
      { id: 'google', name: 'Disconnected fixture', models: { 'gemini-3.7-flash': { id: 'gemini-3.7-flash' } } }
    ] } };
    const context = vm.createContext({ state });
    const result = vm.runInContext('(function () {' + match[1] + '\n})()', context, { timeout: 100 });
    return JSON.parse(JSON.stringify(result));
  }
  const known = { id: 'gpt-5.6-luna', name: 'Engine fixture Luna', capabilities: { toolcall: true, input: { text: true } }, cost: { input: 0.5, output: 2 }, limit: { context: 12345, output: 321 } };
  const fallback = { id: 'engine-reported-fallback', name: 'Engine fallback', capabilities: { toolcall: true, input: { text: true } } };
  const result = flatten({ known, fallback });
  assert.deepEqual(result.map(model => model.id), ['gpt-5.6-luna', 'engine-reported-fallback']);
  assert.deepEqual(flatten({ fallback, known }).map(model => model.id), ['gpt-5.6-luna', 'engine-reported-fallback']);
  assert.deepEqual(result[0].cost, known.cost); assert.deepEqual(result[0].limit, known.limit);
  assert.equal(result[0].value, 'openai/gpt-5.6-luna');
  assert.equal(result.some(model => model.id === 'gpt-6-luna'), false);
  assert.deepEqual(flatten({}), []);
  const actual = { id: 'gpt-6-luna', name: 'Registered fixture GPT-6 Luna', capabilities: { toolcall: true, input: { text: true } } };
  assert.equal(flatten({ actual })[0].id, 'gpt-6-luna');
  assert.deepEqual(flatten({ fallback, actual, known }).map(model => model.id), ['gpt-6-luna', 'gpt-5.6-luna', 'engine-reported-fallback']);
});

test('generic and OpenAI missing-model errors are not relabelled as Ox Alpha', () => {
  const appSource = fs.readFileSync(path.join(__dirname, '..', 'app', 'app.js'), 'utf8');
  const branch = appSource.split('\n').find(line => line.trim().startsWith('if (') && line.includes('detail = "Ox Alpha'));
  assert.ok(branch);
  function format(input) {
    const context = vm.createContext({ detail: input });
    return vm.runInContext(branch + '\ndetail', context, { timeout: 100 });
  }
  for (const error of [
    'Model not found: openai/gpt-6-luna. Did you mean: gpt-5.6-luna?',
    'ProviderModelNotFoundError: Model not found: openai/gpt-6-luna',
    'ProviderModelNotFoundError',
    'Model not found: opencode/another-fixture-model',
    'Service unavailable'
  ]) assert.equal(format(error), error);
  assert.match(format('Model not found: opencode/x-preview-f-free'), /^Ox Alpha is not available in the running PC engine/);
});

function controlFixture({ running = false, qualified = true, upstreamPort = 4196, asynchronousClose = false } = {}) {
  const calls = [], listeners = new Map(); let closed = 0, connectionsClosed = 0;
  const gateway = { server: { once: (event, callback) => listeners.set(event, callback), close: () => {
    closed++; running = false;
    if (asynchronousClose) queueMicrotask(() => listeners.get('close')?.()); else listeners.get('close')?.();
  }, closeAllConnections: () => { connectionsClosed++; } } };
  const control = {
    preparedConfig: () => ({ ...config, origin, upstreamPort }),
    requireQualification: () => { calls.push('qualification'); if (!qualified) throw Error('Private-access files changed after qualification. Re-run isolated verification.'); },
    start: async options => { assert.equal(options.quiet, true); calls.push('start'); running = true; return gateway; },
    administer: async (action, id, options) => {
      assert.equal(options.quiet, true); calls.push(action);
      if (!running) { const error = Error('Fixture absent'); error.code = 'ECONNREFUSED'; throw error; }
      if (action === 'devices') return { devices: [{ id: 'd'.repeat(24), label: 'Fixture phone', expiresAt: Date.now() + SESSION_MS, hash: 'fixture-only-hash', token: 'fixture-only-secret' }] };
      if (action === 'pair') return { code: '1234-1234-1234-1234-1234', expiresInMinutes: 10 };
      if (action === 'revoke') { assert.equal(id, 'd'.repeat(24)); return { revoked: true }; }
      if (action === 'disable') { running = false; if (calls.includes('start')) gateway.server.close(); return { disabled: true }; }
      throw Error('Unexpected fixture action');
    }
  };
  return { control, calls, gateway, closed: () => closed, connectionsClosed: () => connectionsClosed, setQualified: value => { qualified = value; } };
}

test('PC controls require exact loopback host and JSON mutation origin; ambiguous routes never mutate', () => {
  const req = (method = 'POST', url = '/workspace/phone-access/start', headers = {}) => ({ method, url, headers: { host: '127.0.0.1:4196', origin: 'http://127.0.0.1:4196', 'content-type': 'application/json', ...headers }, rawHeaders: [], socket: { remoteAddress: '127.0.0.1' } });
  assert.equal(localBoundary(req(), 4196), 'start');
  assert.equal(localBoundary(req('GET', '/workspace/phone-access/status', { origin: undefined }), 4196), 'status');
  for (const candidateOrigin of [undefined, 'null', origin, 'http://evil.example', 'http://127.0.0.1:4198']) assert.throws(() => localBoundary(req('POST', undefined, { origin: candidateOrigin }), 4196));
  for (const host of [config.hostname, 'localhost:4196', 'evil.example:4196', '127.0.0.1:4200']) assert.throws(() => localBoundary(req('POST', undefined, { host }), 4196));
  for (const url of ['/workspace/phone-access/start?access=x', '/workspace/phone-access/%73tart', '/workspace/phone-access//start', '/workspace/phone-access/../start', '/workspace/phone-access/prepare', '/workspace/phone-access/start/']) assert.throws(() => localBoundary(req('POST', url), 4196));
  assert.throws(() => localBoundary({ ...req(), socket: { remoteAddress: '192.168.1.8' } }, 4196));
  for (const headers of [{ 'tailscale-user-login': config.owner }, { origin: origin }, { 'content-type': 'text/plain' }, { 'content-encoding': 'gzip' }]) assert.throws(() => localBoundary(req('POST', undefined, headers), 4196));
  for (const name of ['Host', 'Origin', 'Cookie', 'Content-Type', 'Authorization']) assert.throws(() => localBoundary({ ...req(), rawHeaders: [name, 'a', name.toLowerCase(), 'b'] }, 4196));
  assert.throws(() => localBoundary(req('DELETE'), 4196));
});

test('PC controls never start on import/status; status projects only nonsecret device fields', async () => {
  const f = controlFixture({ running: true }); const c = createPhoneAccessControl({ control: f.control });
  assert.deepEqual(f.calls, []);
  const state = await c.status();
  assert.equal(state.state, 'running'); assert.equal(state.browserHours, 12); assert.equal(state.pairingMinutes, 10);
  assert.deepEqual(Object.keys(state.devices[0]).sort(), ['expiresAt', 'id', 'label']);
  assert.equal(JSON.stringify(state).includes('fixture-only'), false); assert.equal(JSON.stringify(state).includes(config.owner), false);
  assert.equal(f.calls.includes('start'), false);
  c.dispose(); assert.equal(f.closed(), 0); // A terminal-owned gateway is not this host's child.
});

test('stale qualification blocks start/pair but preserves authenticated emergency stop', async () => {
  const f = controlFixture({ running: true, qualified: false }), c = createPhoneAccessControl({ control: f.control });
  assert.equal((await c.status()).qualified, false);
  await assert.rejects(c.act('start'), /changed/); await assert.rejects(c.act('pair'), /changed/);
  assert.equal(f.calls.includes('start'), false); assert.equal(f.calls.includes('pair'), false);
  assert.equal((await c.act('stop')).stopped, true); assert.equal(f.calls.includes('disable'), true);
  assert.equal((await c.status()).state, 'stopped'); c.dispose();
});

test('explicit start is idempotent, pairing is silent and owned shutdown preserves sessions', async () => {
  for (const mode of ['synchronous', 'asynchronous', 'reentrant']) {
    const f = controlFixture({ asynchronousClose: mode === 'asynchronous' }), c = createPhoneAccessControl({ control: f.control });
    assert.equal((await c.status()).state, 'stopped');
    await c.act('start'); await c.act('start'); assert.equal(f.calls.filter(x => x === 'start').length, 1);
    const pair = await c.act('pair'); assert.match(pair.code, /^[A-F0-9]{4}(?:-[A-F0-9]{4}){4}$/);
    await c.act('revoke', { id: 'd'.repeat(24) });
    if (mode === 'reentrant') {
      const close = f.gateway.server.close;
      f.gateway.server.close = () => { close(); c.dispose(); };
    }
    c.dispose(); c.dispose();
    assert.equal(f.closed(), 1, mode); assert.equal(f.connectionsClosed(), 1, mode);
    assert.equal(f.calls.includes('disable'), false, mode);
    await new Promise(resolve => setImmediate(resolve));
    c.dispose(); assert.equal(f.closed(), 1, mode); assert.equal(f.connectionsClosed(), 1, mode);
    await assert.rejects(c.act('start'), /busy/);
  }
});

test('unknown services and occupied ports are not stopped, adopted or reported as safely stopped', async () => {
  const f = controlFixture(), c = createPhoneAccessControl({ control: f.control });
  f.control.administer = async () => { throw Error('Fixture secret-bearing failure'); };
  assert.equal((await c.status()).state, 'unknown');
  await assert.rejects(c.act('start')); await assert.rejects(c.act('stop'));
  assert.equal(f.calls.includes('start'), false); assert.equal(f.closed(), 0);
  c.dispose();
  const g = controlFixture(), d = createPhoneAccessControl({ control: g.control });
  g.control.start = async () => { const error = Error('Occupied'); error.code = 'EADDRINUSE'; throw error; };
  await assert.rejects(d.act('start'), { code: 'EADDRINUSE' }); d.dispose(); assert.equal(g.closed(), 0);
});

test('concurrent pairing/start clicks serialize through completion and are never auto-retried', async () => {
  const f = controlFixture({ running: true }); let release;
  const original = f.control.administer;
  f.control.administer = (action, ...rest) => action === 'pair' ? new Promise(resolve => { release = () => resolve({ code: '1234-1234-1234-1234-1234', expiresInMinutes: 10 }); }) : original(action, ...rest);
  const c = createPhoneAccessControl({ control: f.control });
  const first = c.act('pair');
  await assert.rejects(c.act('start'), /busy/); await assert.rejects(c.act('pair'), /busy/);
  assert.equal((await c.status()).busy, true); release(); await first;
  assert.equal((await c.status()).busy, false); c.dispose();
});

test('malformed action inputs and mismatched host ports do not reach administration', async () => {
  const f = controlFixture(), c = createPhoneAccessControl({ control: f.control });
  for (const [action, input] of [['prepare', {}], ['start', { script: 'fixture' }], ['stop', { id: 'd'.repeat(24) }], ['revoke', { id: 'invalid' }], ['revoke', { id: 'd'.repeat(24), extra: true }]]) await assert.rejects(c.act(action, input), /Invalid/);
  assert.deepEqual(f.calls, []); c.dispose();
  const g = controlFixture({ upstreamPort: 4198 }), d = createPhoneAccessControl({ control: g.control });
  assert.equal((await d.status()).state, 'blocked');
  await assert.rejects(d.act('start'), /port/); assert.equal(g.calls.includes('devices'), false); assert.equal(g.calls.includes('start'), false); d.dispose();
  const missing = createPhoneAccessControl({ control: { preparedConfig: () => { throw Error('Fixture missing'); } } });
  assert.equal((await missing.status()).state, 'needs-setup'); missing.dispose();
});

test('host shutdown during an explicit start closes only its newly created gateway', async () => {
  const f = controlFixture(); let release;
  f.control.start = () => new Promise(resolve => { release = () => resolve(f.gateway); });
  const c = createPhoneAccessControl({ control: f.control }), started = c.act('start');
  // act awaits the harmless dummy probe before it reaches start.
  await new Promise(resolve => setImmediate(resolve)); assert.ok(release);
  c.dispose(); release(); await assert.rejects(started, /stopping/);
  assert.equal(f.closed(), 1); assert.equal(f.calls.includes('disable'), false);
});

test('PC handler rejects unauthorized boundaries, oversized JSON and secret-bearing failures', async () => {
  const f = controlFixture({ running: true }), c = createPhoneAccessControl({ control: f.control });
  function request(payload = '{}', headers = {}) {
    const req = require('node:stream').Readable.from([Buffer.from(payload)]);
    Object.assign(req, { method: 'POST', url: '/workspace/phone-access/pair', headers: { host: '127.0.0.1:4196', origin: 'http://127.0.0.1:4196', 'content-type': 'application/json', ...headers }, socket: { remoteAddress: '127.0.0.1' }, rawHeaders: [] });
    return req;
  }
  let result; const send = (status, value) => { result = { status, value }; };
  await c.handle(request('{}', { origin: 'null' }), send); assert.equal(result.status, 403); assert.deepEqual(f.calls, []);
  for (const payload of ['null', '[]', '{', JSON.stringify({ code: 'x'.repeat(1100) }), '{"unexpected":true}']) { await c.handle(request(payload), send); assert.equal(result.status, 409); }
  assert.equal(f.calls.includes('pair'), false);
  f.control.administer = async () => { throw Error('fixture-api-key=DO-NOT-EXPORT'); };
  await c.handle(request(), send); assert.equal(result.status, 409); assert.equal(JSON.stringify(result).includes('DO-NOT-EXPORT'), false);
  c.dispose();
});

test('PC control markup is named and scroll-safe; remote and unattended actions remain absent', () => {
  const ui = fs.readFileSync(path.join(__dirname, '..', 'app', 'phone-access.js'), 'utf8');
  const css = fs.readFileSync(path.join(__dirname, '..', 'app', 'phone-access.css'), 'utf8');
  const server = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  const { qualifiedFiles } = require('../scripts/private-access.cjs');
  const verifier = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'verify-private-access.ps1'), 'utf8');
  for (const name of ['server.js', 'app/index.html', 'app/phone-access.js', 'app/phone-access.css', 'scripts/phone-access-control.cjs']) { assert.ok(qualifiedFiles.includes(name)); assert.ok(verifier.includes(`'${name}'`)); }
  assert.match(ui, /aria-labelledby.*phoneAccessTitle/); assert.match(ui, /dialog\.showModal\(\)/); assert.match(ui, /settings\.showModal\(\); opener\.focus\(\)/);
  assert.match(ui, /aria-describedby="phoneAccessCodeHelp"/); assert.match(ui, /role="status" aria-live="polite"/);
  assert.match(ui, /clearCode\(\)/); assert.match(ui, /controller\.abort\(\)/); assert.match(ui, /same-origin/);
  assert.match(ui, /if \(location\.hostname !== '127\.0\.0\.1'/);
  assert.match(css, /\.phone-access-head \{ display: flex; flex: none;/); assert.match(css, /\.phone-access-content \{ min-height: 0; overflow: auto;/); assert.match(css, /min-height: 44px/);
  assert.match(server, /if \(!isAuthorized\(request\)\) return rejectUnauthorized\(response\);/);
  assert.ok(server.indexOf('if (!isAuthorized(request)) return rejectUnauthorized(response);', server.indexOf('function startCustomProxy')) < server.indexOf('if (handleWorkspaceEndpoint(request, response, pathname)) return;', server.indexOf('function startCustomProxy')));
  assert.match(server, /phoneAccess\.dispose\(\)/);
  assert.equal(ui.includes('localStorage'), false); assert.equal(ui.includes('admin-key'), false);
});

test('phone controls exit remotely; the local synthetic dialog starts only on click and clears pairing display on close', async () => {
  const ui = fs.readFileSync(path.join(__dirname, '..', 'app', 'phone-access.js'), 'utf8');
  vm.runInNewContext(ui, { location: { hostname: config.hostname }, document: {}, fetch: () => { throw Error('Unexpected network'); } }, { timeout: 100 });
  const calls = [], timers = new Map(), intervals = new Map(); let nextTimer = 0, running = false, allowConfirm = true;
  const doc = { activeElement: null };
  function node() {
    const attrs = new Map(), listeners = new Map();
    return { attrs, listeners, children: [], dataset: {}, hidden: false, disabled: false, open: false, value: '', textContent: '',
      setAttribute(name, value) { attrs.set(name, value); }, getAttribute(name) { return attrs.get(name) || null; },
      append(...values) { this.children.push(...values); }, prepend(value) { this.children.unshift(value); }, replaceChildren() { this.children = []; },
      focus() { doc.activeElement = this; }, select() { this.selected = true; },
      addEventListener(name, listener) { listeners.set(name, listener); },
      close() { this.open = false; listeners.get('close')?.(); }, showModal() { this.open = true; }
    };
  }
  const grid = node(), settings = node(), dialog = node(), body = node();
  settings.open = true; settings.querySelector = () => grid;
  const ids = Object.fromEntries(['phoneAccessClose', 'phoneAccessState', 'phoneAccessDetail', 'phoneAccessRefresh', 'phoneAccessCode', 'phoneAccessPair', 'phoneAccessUrl', 'phoneAccessAddress', 'phoneAccessDevices', 'phoneAccessFeedback'].map(id => [id, node()]));
  const actions = Object.fromEntries(['start', 'pair', 'stop'].map(action => [action, Object.assign(node(), { dataset: { action } })]));
  dialog.querySelector = selector => selector.startsWith('#') ? ids[selector.slice(1)] : actions[selector.match(/data-action="(.*?)"/)[1]];
  dialog.querySelectorAll = selector => selector === '[data-action]' ? Object.values(actions) : ids.phoneAccessDevices.children.flatMap(item => item.children.filter(child => child.attrs?.has('data-revoke')));
  doc.querySelector = selector => selector === '#settingsDialog' ? settings : null;
  doc.createElement = tag => tag === 'dialog' ? dialog : node(); doc.body = body; doc.activeElement = settings;
  const context = vm.createContext({ location: { hostname: '127.0.0.1' }, document: doc, AbortController, confirm: () => allowConfirm,
    setTimeout: (fn, ms) => { const id = ++nextTimer; timers.set(id, { fn, ms }); return id; }, clearTimeout: id => timers.delete(id),
    setInterval: fn => { const id = ++nextTimer; intervals.set(id, fn); return id; }, clearInterval: id => intervals.delete(id), addEventListener: () => {},
    fetch: async (url, options) => {
      calls.push({ url, method: options.method, credentials: options.credentials, body: options.body });
      const action = url.split('/').at(-1); let result;
      if (action === 'status') result = { state: running ? 'running' : 'stopped', qualified: true, devices: [], message: 'Dummy fixture status', url: origin + '/' };
      else if (action === 'start') { running = true; result = { started: true, message: 'Dummy started' }; }
      else if (action === 'pair') result = { code: '1234-1234-1234-1234-1234', expiresInMinutes: 10 };
      else if (action === 'stop') { running = false; result = { stopped: true, message: 'Dummy stopped' }; }
      else throw Error('Unexpected UI fixture action');
      return { status: 200, ok: true, json: async () => result };
    }
  });
  vm.runInContext(ui, context, { timeout: 100 }); assert.equal(calls.length, 0);
  const flush = () => new Promise(resolve => setImmediate(resolve));
  const opener = grid.children[0]; opener.onclick(); await flush();
  assert.equal(dialog.open, true); assert.equal(settings.open, false); assert.equal(actions.start.disabled, false); assert.equal(actions.pair.disabled, true);
  assert.equal(calls.some(call => call.method === 'POST'), false);
  actions.start.onclick(); await flush(); assert.equal(actions.start.disabled, true); assert.equal(actions.pair.disabled, false);
  actions.pair.onclick(); actions.pair.onclick(); await flush();
  assert.equal(calls.filter(call => call.url.endsWith('/pair')).length, 1);
  assert.equal(ids.phoneAccessCode.value, '1234-1234-1234-1234-1234'); assert.equal(ids.phoneAccessPair.hidden, false); assert.equal(ids.phoneAccessCode.selected, true);
  const expire = [...timers.values()].find(timer => timer.ms === 600000); assert.ok(expire); expire.fn(); assert.equal(ids.phoneAccessCode.value, '');
  actions.pair.onclick(); await flush(); assert.notEqual(ids.phoneAccessCode.value, '');
  ids.phoneAccessClose.onclick(); assert.equal(ids.phoneAccessCode.value, ''); assert.equal(ids.phoneAccessPair.hidden, true); assert.equal(intervals.size, 0);
  assert.equal(settings.open, true); assert.equal(doc.activeElement, opener); assert.equal(calls.some(call => call.url.endsWith('/stop')), false);
  opener.onclick(); await flush(); allowConfirm = false; actions.stop.onclick(); await flush(); assert.equal(calls.some(call => call.url.endsWith('/stop')), false);
  allowConfirm = true; actions.stop.onclick(); await flush(); assert.equal(calls.filter(call => call.url.endsWith('/stop')).length, 1); assert.equal(actions.start.disabled, false);
  for (const call of calls.filter(call => call.method === 'POST')) { assert.equal(call.credentials, 'same-origin'); assert.equal(call.body, '{}'); }
  ids.phoneAccessClose.onclick(); assert.equal(intervals.size, 0);
});
