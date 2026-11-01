'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const { PassThrough } = require('node:stream');
const { createActivity, normalizeSession, linuxPath, shellQuote } = require('../scripts/activity-server');
const row = { id: 'opencode:ses_demo', source: 'opencode', sourceSessionId: 'ses_demo', displayTitle: 'A real session', metrics: { totalTokens: 0, inputTokens: 0, outputTokens: 17, cacheReadTokens: 0, reasoningTokens: 3 }, activityCounts: { toolCalls: 0 }, totalTurns: 1, estimatedCost: 0 };
function fixture(t, responder = () => ({}), portCheck = async () => false, scheduler = {}) {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'seneschal-activity-'));
  // The mocked WSL runtime requires a Windows drive path. On POSIX this is a
  // unique relative scratch directory, not a real Windows installation.
  const root = process.platform === 'win32' ? temporary : 'C:\\seneschal-fixture\\' + path.basename(temporary);
  if (root !== temporary) fs.mkdirSync(root);
  const calls = [], scripts = [], processes = [];
  let main;
  const spawnProcess = () => {
    const proc = new EventEmitter(); proc.stdin = new PassThrough(); proc.stdout = new PassThrough(); proc.stderr = new PassThrough(); proc.killed = false;
    proc.kill = () => { proc.killed = true; proc.emit('close', 0); };
    let script = ''; proc.stdin.on('data', data => { script += data; });
    proc.stdin.on('finish', () => setImmediate(() => {
      scripts.push(script);
      if (script.includes("'start'")) {
        main = proc;
        const owner = script.match(/'([a-f0-9]{16})' '[a-f0-9]{32}'/)[1];
        proc.stdout.write('SENESCHAL_ACTIVITY_RUNTIME ' + JSON.stringify({ version: '0.1.7', owner }) + '\n');
      } else { if (script.includes("'stop'")) main?.emit('close', 0); proc.emit('close', 0); }
    }));
    processes.push(proc); return proc;
  };
  const fetcher = async (address, options) => {
    const url = new URL(address); calls.push({ url, method: options.method });
    let value = url.pathname === '/health' ? { database: 'connected', ready: true, version: '0.1.1', sync: { phase: 'idle', scheduler } } : url.pathname === '/api/v1/sources/opencode' ? { sources: [{ sessionCount: 2 }] } : await responder(url, options);
    if (value instanceof Error) throw value;
    return { ok: !value?.httpError, status: value?.httpError || 200, json: async () => value };
  };
  const manager = createActivity({ root, distribution: 'Ubuntu', linuxHome: '/home/test', fetcher, spawnProcess, portCheck, sleeper: () => new Promise(resolve => setImmediate(resolve)) });
  t.after(async () => { await manager.dispose(); fs.rmSync(root, { recursive: true, force: true }); if (root !== temporary) fs.rmSync(temporary, { recursive: true, force: true }); });
  const route = (suffix, query = '', method = 'GET') => manager.handle({ method }, '/workspace/activity' + suffix, new URLSearchParams(query));
  return { manager, route, calls, scripts, processes };
}
test('normalization preserves measured zero and distinguishes missing metrics', () => {
  const result = normalizeSession(row);
  assert.equal(result.tokens.totalTokens, 0); assert.equal(result.toolCalls, 0); assert.equal(result.estimatedCost, 0);
  assert.equal(result.tokens.cacheWriteTokens, null); assert.equal(result.messages, null); assert.equal(result.pricingStatus, 'unknown');
  assert.throws(() => normalizeSession({ ...row, source: 'codex' }), /incompatible/);
  assert.equal(linuxPath('C:\\Some Folder\\app'), '/mnt/c/Some Folder/app');
  assert.equal(shellQuote("a'b"), "'a'\\''b'"); assert.throws(() => linuxPath('\\\\remote\\share'), /local Windows/);
});
test('stopped service never reads an unrelated listener; concurrent starts share one runtime', async t => {
  const f = fixture(t);
  await assert.rejects(f.route('/sessions'), error => error.statusCode === 409);
  assert.equal(f.calls.length, 0);
  const [a,b] = await Promise.all([f.manager.start(), f.manager.start()]);
  assert.equal(a.phase, 'ready'); assert.equal(b.version, '0.1.7'); assert.equal(f.processes.length, 1);
  assert.match(f.scripts[0], /agent-trail@0\.1\.7/); assert.match(f.scripts[0], /indexes/);
});
test('unknown port owner prevents startup without killing any process', async t => {
  const f = fixture(t, undefined, async port => port === 8078);
  await assert.rejects(f.manager.start(), error => error.statusCode === 409 && /Another local service/.test(error.message));
  assert.equal(f.processes.length, 0); assert.equal((await f.manager.status()).owned, false);
});

test('automatic Activity startup uses an installed runtime and never invokes npm', async t => {
  const f = fixture(t); await f.manager.start({ allowInstall: false });
  assert.equal(f.scripts.some(script => /npm install/.test(script)), false);
  assert.ok(f.scripts.some(script => /prepare its runtime/.test(script)));
});
test('history enforces OpenCode scope and limits; wrong-source child reads are rejected first', async t => {
  const f = fixture(t, url => url.pathname.endsWith('/opencode:foreign') ? { ...row, id: 'opencode:foreign', source: 'codex' } : { sessions: [row], pagination: { total: 1, limit: 100, offset: 0, hasMore: false } });
  await f.manager.start();
  const result = await f.route('/sessions', 'source=codex&limit=999&offset=0&q=demo');
  assert.equal(result.sessions[0].sourceSessionId, 'ses_demo');
  const last = f.calls.at(-1).url;
  assert.equal(last.searchParams.get('source'), 'opencode'); assert.equal(last.searchParams.get('limit'), '100');
  assert.equal(last.searchParams.get('includeChildren'), 'true');
  await assert.rejects(f.route('/sessions/opencode:foreign/turns'), /incompatible/);
  assert.ok(!f.calls.some(call => call.url.pathname.includes('opencode:foreign/turns')));
  await assert.rejects(f.route('/sessions', 'offset=-1'), error => error.statusCode === 400);
  await assert.rejects(f.route('/sessions/%2Fetc%2Fpasswd'), error => error.statusCode === 400);
  await assert.rejects(f.route('/start', '', 'GET'), error => error.statusCode === 405);
});
test('lookup uses source IDs and conversation search validates its source', async t => {
  const f = fixture(t, url => url.pathname.endsWith('/lookup') ? row : { results: [{ source: 'codex', sessionId: 'foreign' }] });
  await f.manager.start();
  assert.equal((await f.route('/lookup', 'key=ses_demo')).id, 'opencode:ses_demo');
  assert.equal(f.calls.at(-1).url.searchParams.get('source'), 'opencode');
  await assert.rejects(f.route('/search', 'q=hello'), /incompatible/);
  await assert.rejects(f.route('/search'), error => error.statusCode === 400);
});
test('overview returns explicit period attribution and partial-feature warnings', async t => {
  const f = fixture(t, url => url.pathname.endsWith('/top-models') ? { httpError: 404 } : url.pathname.endsWith('/aggregates') ? { totalTokens: 0, totalCost: 0 } : url.pathname.endsWith('/daily-tokens') ? { days: [] } : { projects: [] });
  await f.manager.start();
  const result = await f.route('/overview', 'window=30d&source=codex');
  assert.equal(result.totals.totalTokens, 0); assert.equal(result.models, null); assert.equal(result.warnings.length, 1);
  assert.match(result.rankingBasis, /latest recorded model/); assert.match(result.costBasis, /billing/);
  const daily = f.calls.find(call => call.url.pathname.endsWith('/daily-tokens')).url;
  assert.equal(daily.searchParams.get('days'), '30'); assert.equal(daily.searchParams.get('source'), 'opencode');
  await assert.rejects(f.route('/overview', 'window=forever'), error => error.statusCode === 400);
});
test('refresh is coalesced, checks parser errors, and owned restart/stop are serialized', async t => {
  let release;
  const pending = new Promise(resolve => { release = resolve; });
  const f = fixture(t, async url => url.pathname.endsWith('/sync') ? pending : {});
  await f.manager.start();
  const a = f.manager.sync(), b = f.manager.sync();
  await assert.rejects(f.route('/rebuild', '', 'POST'), error => error.statusCode === 409);
  release({ syncResult: { errors: [] } });
  const values = await Promise.all([a,b]); assert.ok(values[0].lastSyncAt);
  assert.equal(f.calls.filter(call => call.url.pathname.endsWith('/sync')).length, 1);
  await f.route('/restart', '', 'POST');
  assert.equal(f.scripts.filter(script => script.includes("'start'")).length, 2);
  await f.route('/stop', '', 'POST'); assert.equal((await f.manager.status()).phase, 'stopped');
});
test('failed sync is not presented as a successful index refresh', async t => {
  const f = fixture(t, () => ({ syncResult: { errors: ['malformed source'] } }));
  await f.manager.start(); await assert.rejects(f.manager.sync(), /could not be indexed/);
  assert.match((await f.manager.status()).lastError, /could not be indexed/);
  assert.equal((await f.manager.status()).phase, 'degraded');
  assert.equal((await f.manager.status()).complete, false);
});
test('runtime health uses the packaged scheduler active and queued flags', async t => {
  const scheduler = { active: true, queued: false };
  const f = fixture(t, undefined, undefined, scheduler);
  const initial = await f.manager.start(); assert.equal(initial.phase, 'indexing'); assert.equal(initial.complete, false);
  scheduler.active = false; scheduler.queued = true; assert.equal((await f.manager.status()).phase, 'indexing');
  scheduler.queued = false; assert.equal((await f.manager.status()).phase, 'ready');
});
test('rebuilding moves only the stopped derived index into a recoverable backup', t => {
  const { spawnSync } = require('node:child_process');
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'seneschal-rebuild-'));
  t.after(() => fs.rmSync(folder, { recursive: true, force: true }));
  const index = path.join(folder, 'index'); fs.mkdirSync(index);
  const source = path.join(folder, 'original-opencode.db'); fs.writeFileSync(source, 'original');
  for (const file of ['ingest.db', 'ingest.db-wal', 'ingest.db-shm']) fs.writeFileSync(path.join(index, file), file);
  const script = path.join(__dirname, '../scripts/agent-trail-runtime.cjs');
  const args = [script, 'rebuild', folder, index, source, 'a'.repeat(16), 'b'.repeat(32)];
  const result = spawnSync(process.execPath, args, { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  const backup = JSON.parse(result.stdout).backup;
  assert.equal(fs.readFileSync(source, 'utf8'), 'original');
  assert.deepEqual(fs.readdirSync(backup).sort(), ['ingest.db','ingest.db-shm','ingest.db-wal']);
  assert.ok(!fs.existsSync(path.join(index, 'ingest.db')));
});
test('runtime refuses to rebuild an active index or stop another process identity', t => {
  const { spawnSync } = require('node:child_process');
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'seneschal-owner-'));
  t.after(() => fs.rmSync(folder, { recursive: true, force: true }));
  fs.writeFileSync(path.join(folder, 'runtime.json'), JSON.stringify({ pid: process.pid, owner: 'a'.repeat(16), nonce: 'b'.repeat(32) }));
  const script = path.join(__dirname, '../scripts/agent-trail-runtime.cjs');
  let result = spawnSync(process.execPath, [script,'stop',folder,folder,folder,'a'.repeat(16),'c'.repeat(32)], { encoding: 'utf8' });
  assert.notEqual(result.status, 0); assert.match(result.stderr, /not owned/);
  result = spawnSync(process.execPath, [script,'rebuild',folder,folder,folder,'a'.repeat(16),'b'.repeat(32)], { encoding: 'utf8' });
  assert.notEqual(result.status, 0); assert.match(result.stderr, /already owns/);
});
test('late source-ID lookup cannot overwrite a newer Activity view', async () => {
  const vm = require('node:vm');
  const source = fs.readFileSync(path.join(__dirname, '../app/activity.js'), 'utf8');
  const match = source.match(/  async function openSession\([\s\S]+?(?=\n  async function poll\()/);
  assert.ok(match);
  let resolveLookup;
  const lookup = new Promise(resolve => { resolveLookup = resolve; });
  const state = { view: 'sessions', sequence: 0 }, dialog = { open: true };
  const context = vm.createContext({ state, dialog, open: async () => {}, request: () => lookup, render: () => assert.fail('stale lookup rendered'), feedback: () => assert.fail('stale feedback rendered'), loadDetail: () => assert.fail('stale detail loaded') });
  vm.runInContext(match[0], context);
  const pending = context.openSession('ses_old');
  await Promise.resolve();
  state.view = 'usage'; ++state.sequence;
  resolveLookup(row); await pending;
  assert.equal(state.view, 'usage'); assert.equal(state.selectedId, undefined);
});
