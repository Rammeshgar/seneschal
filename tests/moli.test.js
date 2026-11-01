'use strict';

// Run through the isolated owner verifier. No real Moli, network, account or browser.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { EventEmitter } = require('node:events');
const { PassThrough } = require('node:stream');
const { validateInput, launchConfig, childEnvironment, createReader, createProtocol, startStdio, TOOL, launchRuntime } = require('../scripts/moli-mcp.cjs');

function fixture() {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'moli-fixture-'));
  const scratchRoot = path.join(parent, 'scratch');
  const children = [], calls = [], timers = new Map(); let nextTimer = 0;
  const reader = createReader({ scratchRoot, runtime: () => ({ executable: '/dummy/moli' }),
    schedule(fn, ms) { const id = ++nextTimer; timers.set(id, { fn, ms }); return id; }, unschedule(id) { timers.delete(id); },
    spawnChild(executable, args, options) {
      calls.push({ executable, args, options });
      const child = new EventEmitter(); child.stdout = new PassThrough(); child.stderr = new PassThrough();
      child.killed = 0; child.kill = () => { child.killed++; child.emit('close', null); return true; };
      children.push(child); return child;
    }
  });
  return { reader, children, calls, timers, cleanup() { reader.cancel(); fs.rmSync(parent, { recursive: true, force: true }); } };
}

test('Moli accepts only one public URL, never file paths, private hosts or arbitrary options', () => {
  assert.equal(validateInput({ url: 'https://example.com/article?q=1' }), 'https://example.com/article?q=1');
  for (const input of [null, [], {}, { url: '--eval=bad' }, { url: 'file:///C:/secret' }, { url: 'javascript:alert(1)' },
    { url: 'http://localhost/' }, { url: 'https://127.1/' }, { url: 'https://[::1]/' }, { url: 'http://100.64.0.1/' },
    { url: 'https://desktop.tail123.ts.net/' }, { url: 'https://host.local/' }, { url: 'https://host/' },
    { url: 'https://user:password@example.com/' }, { url: 'https://example.com:4196/' }, { url: 'https://example.com/#secret' },
    { url: 'https://example.com/', eval: 'bad' }, { url: 'https://example.com/', headers: { Authorization: 'dummy' } }]) assert.throws(() => validateInput(input));
  assert.equal(TOOL.annotations.readOnlyHint, false); // Page JavaScript can itself issue network requests.
});

test('optional Moli registration preserves Brave, providers and stricter permissions without shell launch', () => {
  const original = { provider: { openai: { models: { dummy: { name: 'Dummy' } } } }, mcp: { playwright: { type: 'local', command: ['dummy'], enabled: true } },
    permission: { 'seneschal_moli_*': 'deny', edit: 'ask' }, agent: { plan: { permission: { edit: 'deny' } }, build: { permission: { 'seneschal_moli_*': 'deny' } } } };
  const content = JSON.stringify(original), runtime = { node: 'C:\\Program Files\\nodejs\\node.exe', script: 'C:\\Seneschal\\scripts\\moli-mcp.cjs' };
  assert.equal(launchConfig(content, null), content);
  const result = JSON.parse(launchConfig(content, runtime));
  assert.deepEqual(result.mcp.playwright, original.mcp.playwright); assert.deepEqual(result.provider, original.provider);
  assert.deepEqual(result.mcp.seneschal_moli.command, ['/mnt/c/Program Files/nodejs/node.exe', runtime.script]);
  assert.equal(result.permission['seneschal_moli_*'], 'deny'); assert.equal(result.agent.plan.permission['seneschal_moli_*'], 'deny');
  assert.equal(result.agent.build.permission['seneschal_moli_*'], 'deny'); assert.equal(result.agent.plan.permission.edit, 'deny');
  const defaults = JSON.parse(launchConfig('{}', runtime)); assert.equal(defaults.permission['seneschal_moli_*'], 'ask');
  const conflict = JSON.stringify({ mcp: { seneschal_moli: { enabled: false, type: 'remote', url: 'https://fixture.invalid' } } });
  assert.equal(launchConfig(conflict, runtime), conflict);
  assert.equal(launchConfig('{}', runtime, { mcpNames: ['seneschal_moli'] }), '{}');
  const inherited = JSON.parse(launchConfig('{}', runtime, { permission: 'deny', agentPermissions: { plan: 'deny' } }));
  assert.equal(inherited.permission['seneschal_moli_*'], 'deny'); assert.equal(inherited.agent.plan.permission['seneschal_moli_*'], 'deny');
  for (const bad of ['[]', 'null', '{"mcp":[]}', '{"permission":[]}']) assert.throws(() => launchConfig(bad, runtime));
  assert.throws(() => launchConfig('{}', { ...runtime, script: '/relative' }));
});

test('Moli fetch uses fresh storage, network limits and an empty allowlisted environment', async () => {
  const f = fixture();
  try {
    const pending = f.reader.read({ url: 'https://example.com/' });
    const { args, options } = f.calls[0];
    assert.equal(options.shell, false); assert.equal(options.windowsHide, true);
    assert.ok(args.includes('--block-private-networks')); assert.ok(args.includes('100.64.0.0/10'));
    assert.ok(args.includes('--http-max-response-size')); assert.ok(args.includes('--fail'));
    assert.equal(args.at(-1), 'https://example.com/');
    for (const forbidden of ['--eval', '--profile-dir', '--cookie-file', '--header', '--http-proxy', 'serve']) assert.equal(args.includes(forbidden), false);
    assert.deepEqual(Object.keys(options.env).sort(), Object.keys(childEnvironment('dummy')).sort());
    assert.equal(options.env.OPENCODE_SERVER_PASSWORD, undefined); assert.equal(options.env.HTTP_PROXY, undefined);
    assert.equal(options.env.HOME, options.cwd); assert.equal(options.env.USERPROFILE, options.cwd);
    f.children[0].stdout.write(Buffer.from('Example page')); f.children[0].emit('close', 0);
    const output = await pending; assert.match(output, /Source: https:\/\/example.com\//); assert.match(output, /Untrusted website content/);
    assert.match(output, /Example page/); assert.equal(fs.existsSync(options.cwd), false); assert.equal(f.timers.size, 0);
  } finally { f.cleanup(); }
});

test('Moli refuses concurrent work and cancels timed-out owned children without automatic fallback', async () => {
  const f = fixture();
  try {
    const pending = f.reader.read({ url: 'https://example.com/' });
    await assert.rejects(f.reader.read({ url: 'https://example.org/' }), /busy/); assert.equal(f.calls.length, 1);
    [...f.timers.values()].find(timer => timer.ms === 25000).fn();
    await assert.rejects(pending, /time limit/); assert.equal(f.children[0].killed, 1); assert.equal(f.calls.length, 1);
    const second = f.reader.read({ url: 'https://example.org/' }); f.reader.cancel(); await assert.rejects(second, /cancelled/);
    assert.equal(f.children[1].killed, 1); assert.equal(f.timers.size, 0);
  } finally { f.cleanup(); }
});

test('oversized Moli output, noisy diagnostics, empty pages and errors never become successful evidence', async () => {
  for (const kind of ['output', 'diagnostics', 'empty', 'exit', 'spawn']) {
    const f = fixture();
    try {
      const pending = f.reader.read({ url: 'https://example.com/' });
      const rejected = assert.rejects(pending);
      if (kind === 'output') f.children[0].stdout.write(Buffer.alloc(512 * 1024 + 1));
      if (kind === 'diagnostics') f.children[0].stderr.write(Buffer.alloc(16385));
      if (kind === 'empty') f.children[0].emit('close', 0);
      if (kind === 'exit') { f.children[0].stderr.write('secret dummy provider-key'); f.children[0].emit('close', 22); }
      if (kind === 'spawn') f.children[0].emit('error', Error('secret dummy credential'));
      await rejected;
      assert.equal(f.calls.length, 1); assert.equal(f.timers.size, 0);
    } finally { f.cleanup(); }
  }
});

test('Moli MCP negotiates its lifecycle, exposes only page reading and reports failures honestly', async () => {
  const sent = [], calls = []; let cancel = 0;
  const handle = createProtocol({ read: async input => { calls.push(input); return 'Untrusted fixture'; }, cancel() { cancel++; } });
  const send = message => sent.push(message);
  await handle({ jsonrpc: '2.0', id: 0, method: 'tools/list' }, send); assert.equal(sent.at(-1).error.code, -32600);
  await handle({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18' } }, send);
  assert.equal(sent.at(-1).result.protocolVersion, '2025-06-18'); assert.deepEqual(sent.at(-1).result.capabilities, { tools: {} });
  await handle({ jsonrpc: '2.0', method: 'notifications/initialized' }, send);
  await handle({ jsonrpc: '2.0', id: 2, method: 'tools/list' }, send); assert.deepEqual(sent.at(-1).result.tools, [TOOL]);
  await handle({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'read_page', arguments: { url: 'https://example.com/' } } }, send);
  assert.equal(sent.at(-1).result.content[0].text, 'Untrusted fixture'); assert.equal(calls.length, 1);
  await handle({ jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'submit_form' } }, send); assert.equal(sent.at(-1).error.code, -32602);
  await handle({ jsonrpc: '2.0', id: 5, method: 'unsupported' }, send); assert.equal(sent.at(-1).error.code, -32601);
  await handle({ jsonrpc: '2.0', method: 'notifications/cancelled', params: { requestId: 3 } }, send); assert.equal(cancel, 0);
});

test('Moli stdio is newline JSON only and cancels its reader when the client disconnects', async () => {
  const input = new PassThrough(), output = new PassThrough(), lines = []; let cancel = 0;
  output.on('data', chunk => lines.push(chunk.toString()));
  startStdio(input, output, { cancel() { cancel++; }, read: async () => 'fixture' });
  input.write('{bad}\n');
  const request = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18' } }) + '\n';
  input.write(request.slice(0, 10)); input.write(request.slice(10));
  await new Promise(resolve => setImmediate(resolve));
  const messages = lines.join('').trim().split('\n').map(JSON.parse);
  assert.equal(messages[0].error.code, -32700); assert.equal(messages[1].result.serverInfo.name, 'seneschal-moli');
  input.end(); await new Promise(resolve => setImmediate(resolve)); assert.ok(cancel > 0);
});

test('Moli integration stays optional, qualified and separate from the Brave launch path', () => {
  const server = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  const app = fs.readFileSync(path.join(__dirname, '..', 'app', 'app.js'), 'utf8');
  const verifier = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'verify-private-access.ps1'), 'utf8');
  const { qualifiedFiles } = require('../scripts/private-access.cjs');
  assert.match(server, /modelConfig = moliLaunchConfig\(modelConfig, runtime, moliExistingSettings\(\)\)/);
  assert.match(server, /spawn\(brave, \[url\]/); assert.match(server, /"playwright_\*", "seneschal_moli_\*", "blender_\*"/);
  assert.match(app, /\^\(playwright_\|seneschal_moli_\)/);
  for (const name of ['scripts/moli-mcp.cjs', 'tests/moli.test.js']) { assert.ok(qualifiedFiles.includes(name)); assert.ok(verifier.includes(`'${name}'`)); }
  assert.ok(verifier.includes("'/code/tests/moli.test.js'"));
  if (process.platform !== 'win32') assert.equal(launchRuntime(), null);
});
