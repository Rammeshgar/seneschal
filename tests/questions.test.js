'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { normalizeRequest, validateAnswers, createController, transport, install } = require('../app/questions.js');
const { allowedRoute, requestBoundary } = require('../scripts/private-access-policy.cjs');
const pending = (id = 'que_fixture', sessionID = 'ses_fixture') => ({ id, sessionID, questions: [{ header: 'Proceed', question: 'Which action?', options: [{ label: 'Read page', description: 'Public information only' }, { label: 'Cancel', description: 'Do not continue' }], multiple: false, custom: true }] });
const scope = { sessionID: 'ses_fixture', directory: '/fixture/project' };
const tick = () => new Promise(resolve => setImmediate(resolve));

test('question payloads are bounded and preserve single, multiple and custom choices as text', () => {
  const raw = pending(); raw.questions[0].question = '<img src=x onerror=bad()> Which action?';
  assert.equal(normalizeRequest(raw).questions[0].question, raw.questions[0].question);
  for (const value of [null, {}, { ...raw, id: '../bad' }, { ...raw, sessionID: 'other' }, { ...raw, questions: [] },
    { ...raw, questions: [{ ...raw.questions[0], question: 'x'.repeat(8001) }] },
    { ...raw, questions: [{ ...raw.questions[0], options: [{ label: 'Same' }, { label: 'Same' }] }] }]) assert.equal(normalizeRequest(value), null);
  const multiple = normalizeRequest({ ...raw, questions: [{ ...raw.questions[0], multiple: true, custom: false }] });
  assert.equal(multiple.questions[0].multiple, true); assert.equal(multiple.questions[0].custom, false);
});

test('question answers require explicit valid choices or custom text for every question', () => {
  const request = normalizeRequest(pending());
  assert.deepEqual(validateAnswers(request, [['Read page']]), [['Read page']]);
  assert.deepEqual(validateAnswers(request, [['My own answer']]), [['My own answer']]);
  for (const answers of [[], [[]], [['Read page', 'Cancel']], [[' ']], [['x'.repeat(2001)]], [null]]) assert.throws(() => validateAnswers(request, answers));
  request.questions[0].custom = false; assert.throws(() => validateAnswers(request, [['Other']]));
  request.questions[0].multiple = true; assert.deepEqual(validateAnswers(request, [['Read page', 'Cancel']]), [['Read page', 'Cancel']]);
});

test('question recovery on session selection and refresh is read-only and scoped to the selected session', async () => {
  const calls = [], controller = createController({ request: async (url, options) => { calls.push({ url, options }); return [pending(), pending('que_elsewhere', 'ses_other')]; } });
  controller.setContext(scope); await tick(); await controller.refresh();
  assert.equal(controller.state.requests.length, 1); assert.equal(controller.state.requests[0].sessionID, scope.sessionID);
  assert.equal(calls.length, 2); assert.ok(calls.every(call => call.url === '/question' && !call.options.method && call.options.directory === scope.directory));
  controller.dispose(); await controller.refresh(); assert.equal(calls.length, 2);
});

test('late question snapshots from a previous session cannot populate the new session', async () => {
  let resolveOld;
  const controller = createController({ request: async (_url, options) => options.directory === '/fixture/project' ? new Promise(resolve => { resolveOld = resolve; }) : [pending('que_new', 'ses_new')] });
  controller.setContext(scope); controller.setContext({ sessionID: 'ses_new', directory: '/fixture/new' }); await tick();
  resolveOld([pending()]); await tick();
  assert.equal(controller.state.requests[0].id, 'que_new'); assert.equal(controller.state.context.sessionID, 'ses_new');
});

test('only explicit question reply or dismissal posts to the matching request and directory', async () => {
  const calls = [], controller = createController({ request: async (url, options) => { calls.push({ url, options }); return options.method ? null : [pending()]; } });
  controller.setContext(scope); await tick();
  assert.equal(await controller.reply('que_unknown', [['Read page']]), false);
  assert.equal(await controller.reply('que_fixture', [['Read page']]), true);
  assert.equal(calls[1].url, '/question/que_fixture/reply'); assert.deepEqual(calls[1].options.body, { answers: [['Read page']] });
  assert.equal(calls[1].options.directory, scope.directory); assert.equal(controller.state.requests.length, 0);
  controller.handleEvent({ type: 'question.asked', properties: pending('que_dismiss') });
  await controller.reject('que_dismiss'); assert.equal(calls[2].url, '/question/que_dismiss/reject'); assert.deepEqual(calls[2].options.body, {});
  assert.equal(calls.some(call => /permission|prompt_async|command/.test(call.url)), false);
});

test('an ambiguous question reply never retries automatically and requires a manual status check', async () => {
  let posts = 0;
  const controller = createController({ request: async (_url, options) => { if (options.method) { posts++; throw Error('dummy connection lost'); } return [pending()]; } });
  controller.setContext(scope); await tick(); await controller.reply('que_fixture', [['Read page']]);
  assert.equal(controller.state.uncertain, 'que_fixture'); assert.match(controller.state.error, /not confirmed/);
  await controller.refresh(); await controller.reply('que_fixture', [['Read page']]); assert.equal(posts, 1);
  await controller.refresh(true); assert.equal(controller.state.uncertain, ''); assert.equal(posts, 1);
});

test('answered question events remove requests and stale snapshots cannot resurrect them', async () => {
  const controller = createController({ request: async () => [pending()] }); controller.setContext(scope); await tick();
  controller.handleEvent({ type: 'question.replied', properties: { sessionID: scope.sessionID, requestID: 'que_fixture' } });
  await controller.refresh(); assert.equal(controller.state.requests.length, 0);
  controller.handleEvent({ type: 'question.asked', properties: pending() }); assert.equal(controller.state.requests.length, 0);
  controller.handleEvent({ type: 'question.asked', properties: pending('que_next') });
  controller.handleEvent({ type: 'question.rejected', properties: { sessionID: scope.sessionID, requestID: 'que_next' } });
  assert.equal(controller.state.requests.length, 0);
});

test('question events win over an in-flight stale snapshot and brief snapshot lag preserves the panel', async () => {
  let complete;
  const controller = createController({ request: () => new Promise(resolve => { complete = resolve; }) });
  controller.setContext(scope); controller.handleEvent({ type: 'question.asked', properties: pending() }); complete([]); await tick();
  assert.equal(controller.state.requests.length, 1);
  for (let index = 0; index < 3; index++) { const refresh = controller.refresh(); complete([]); await refresh; assert.equal(controller.state.requests.length, index < 2 ? 1 : 0); }
});

test('double clicks and a session switch never create queued or cross-session question submissions', async () => {
  let complete, posts = 0;
  const controller = createController({ request: async (_url, options) => options.method ? (posts++, new Promise(resolve => { complete = resolve; })) : [pending()] });
  controller.setContext(scope); await tick(); const first = controller.reply('que_fixture', [['Read page']]);
  assert.equal(await controller.reject('que_fixture'), false); assert.equal(posts, 1);
  controller.setContext({ sessionID: 'ses_other', directory: '/fixture/other' }); await tick(); complete(null); await first;
  assert.equal(controller.state.context.sessionID, 'ses_other'); assert.equal(controller.state.requests.length, 0); assert.equal(posts, 1);
});

test('question transport preserves same-origin credentials, JSON bodies and GET-only recovery', async () => {
  const calls = [], fetcher = async (url, options) => { calls.push({ url, options }); return { ok: true, status: options.method === 'GET' ? 200 : 204, json: async () => [pending()] }; };
  await transport(fetcher, '/question', { directory: scope.directory });
  await transport(fetcher, '/question/que_fixture/reply', { method: 'POST', directory: scope.directory, body: { answers: [['Read page']] } });
  assert.equal(calls[0].options.method, 'GET'); assert.equal(calls[0].options.body, undefined);
  assert.equal(calls[1].options.credentials, 'same-origin'); assert.equal(calls[1].options.headers['Content-Type'], 'application/json');
  assert.deepEqual(JSON.parse(calls[1].options.body), { answers: [['Read page']] }); assert.match(calls[1].url, /directory=%2Ffixture%2Fproject/);
  await assert.rejects(transport(async () => ({ ok: false, status: 403 }), '/question', { directory: scope.directory }), /Question request failed/);
});

function fakeDocument() {
  const document = { activeElement: null }, all = [];
  function element(tag) {
    const value = { tag, children: [], attrs: {}, events: {}, hidden: false, open: false, checked: false, value: '', textContent: '', isConnected: true,
      append(...children) { this.children.push(...children); }, replaceChildren(...children) { this.children = [...children]; },
      setAttribute(name, content) { this.attrs[name] = content; }, removeAttribute(name) { delete this.attrs[name]; },
      addEventListener(name, callback) { this.events[name] = callback; }, focus() { document.activeElement = this; },
      showModal() { this.open = true; }, close() { this.open = false; this.events.close?.(); } };
    all.push(value); return value;
  }
  document.createElement = element; document.body = element('body'); const dock = element('section'); dock.hidden = true;
  document.getElementById = id => id === 'questionDock' ? dock : null;
  document.querySelector = selector => selector === 'dialog[open]' ? all.find(item => item.tag === 'dialog' && item.open) || null : null;
  return { document, dock, all };
}

test('question form has labeled native choices, custom input, explicit dismissal and close-without-reply', async () => {
  const { document, all } = fakeDocument(), events = {}, calls = [];
  const win = { addEventListener(name, fn) { events[name] = fn; }, setInterval() { return 1; }, clearInterval() {} };
  const ui = install(document, win, async (url, options) => { calls.push({ url, options }); return { ok: true, status: options.method === 'POST' ? 204 : 200, json: async () => [pending()] }; });
  ui.controller.setContext(scope); await tick(); assert.equal(ui.dialog.open, true); assert.equal(ui.dialog.attrs['aria-labelledby'], 'questionTitle');
  const field = ui.fields()[0]; assert.equal(field.choices[0].tag, 'input'); assert.equal(field.choices[0].type, 'radio');
  assert.ok(all.some(item => item.tag === 'label' && item.htmlFor === field.custom.id));
  assert.equal(field.choices.some(item => item.checked), false);
  await ui.form.events.submit({ preventDefault() {} }); assert.equal(calls.length, 1); assert.equal(field.group.attrs['aria-invalid'], 'true');
  field.custom.value = 'A custom reply'; ui.close(); assert.equal(ui.dialog.open, false); assert.equal(calls.length, 1);
  await ui.controller.refresh(); assert.equal(ui.dialog.open, false); ui.open();
  assert.equal(ui.fields()[0].custom.value, 'A custom reply'); // polling never rebuilds the active draft.
  ui.dialog.events.cancel({ preventDefault() {} }); assert.equal(calls.length, 2); ui.open();
  await ui.form.events.submit({ preventDefault() {} }); assert.equal(calls.length, 3);
  assert.deepEqual(JSON.parse(calls[2].options.body), { answers: [['A custom reply']] }); assert.equal(ui.dialog.open, false);
  assert.ok(all.some(item => item.tag === 'button' && item.textContent === 'Dismiss question'));
});

test('phone question routes are narrow, owner-authenticated and included in qualification', () => {
  for (const route of ['/workspace/questions.js', '/workspace/questions.css', '/api/question']) { assert.equal(allowedRoute('GET', route), true); assert.equal(allowedRoute('POST', route), false); }
  for (const route of ['/api/question/que_fixture/reply', '/api/question/que_fixture/reject']) { assert.equal(allowedRoute('POST', route), true); assert.equal(allowedRoute('GET', route), false); }
  for (const route of ['/api/question/que_fixture/delete', '/api/question/../reply', '/api/questions', '/api/question/que_fixture/reply/extra']) assert.equal(allowedRoute('POST', route), false);
  const config = { hostname: 'fixture.tail123.ts.net', owner: 'fixture@gmail.com', origin: 'https://fixture.tail123.ts.net' };
  const req = { method: 'POST', url: '/api/question/que_fixture/reply', headers: { host: config.hostname, origin: 'https://foreign.invalid', 'tailscale-user-login': config.owner }, socket: { remoteAddress: '127.0.0.1' } };
  assert.throws(() => requestBoundary(req, config), /origin/i);
  const { qualifiedFiles } = require('../scripts/private-access.cjs');
  const verifier = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'verify-private-access.ps1'), 'utf8');
  for (const file of ['app/questions.js', 'app/questions.css', 'tests/questions.test.js']) { assert.ok(qualifiedFiles.includes(file)); assert.ok(verifier.includes(`'${file}'`)); }
  const html = fs.readFileSync(path.join(__dirname, '..', 'app', 'index.html'), 'utf8');
  assert.ok(html.indexOf('/workspace/questions.js') < html.indexOf('/workspace/app.js'));
  const css = fs.readFileSync(path.join(__dirname, '..', 'app', 'questions.css'), 'utf8');
  assert.match(css, /min-height: 44px/); assert.match(css, /focus-visible/); assert.match(css, /position: sticky/); assert.match(css, /90dvh/);
});

test('question load failures distinguish auth, unsupported routes, bad format and temporary service failures', async () => {
  for (const [error, expected] of [[{ status: 401 }, /sign-in or phone pairing/], [{ status: 404 }, /does not expose/], [{ kind: 'format' }, /question format/], [{ status: 502 }, /temporarily unavailable/], [Error('offline'), /PC connection/]]) {
    const controller = createController({ request: async () => { throw error; } });
    controller.setContext(scope); await tick();
    assert.match(controller.state.error, expected); assert.equal(controller.state.requests.length, 0);
    controller.dispose();
  }
});

test('an incompatible question from another session cannot block this session, but its own bad format remains visible', async () => {
  let payload = [{ sessionID: 'ses_other', questions: null }];
  const controller = createController({ request: async () => payload }); controller.setContext(scope); await tick();
  assert.equal(controller.state.error, '');
  payload = [{ sessionID: scope.sessionID, questions: null }]; await controller.refresh();
  assert.match(controller.state.error, /question format/);
  payload = []; await controller.refresh(true); assert.equal(controller.state.error, '');
});
