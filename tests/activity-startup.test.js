'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { createActivityStartup, localPreferenceBoundary } = require('../scripts/activity-server');
const { allowedRoute } = require('../scripts/private-access-policy.cjs');
function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'seneschal-startup-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const calls = [], create = (start = options => { calls.push(options); }) => createActivityStartup({ root, start });
  return { root, calls, create, manager: create() };
}
test('Activity startup is off by default, and reading/saving preferences never starts a service', async t => {
  const f = fixture(t);
  assert.equal(f.manager.get().enabled, false); await f.manager.run(); assert.equal(f.calls.length, 0);
  f.manager.set({ enabled: true }); assert.equal(f.calls.length, 0); assert.equal(f.create().get().enabled, true);
  f.manager.set({ enabled: false }); assert.equal(f.create().get().enabled, false); assert.equal(f.calls.length, 0);
});
test('opt-in starts once per host with installation disabled; turning it off does not stop anything', async t => {
  const f = fixture(t); f.manager.set({ enabled: true });
  const nextHost = f.create(); await Promise.all([nextHost.run(), nextHost.run()]);
  assert.deepEqual(f.calls, [{ allowInstall: false }]);
  nextHost.set({ enabled: false }); assert.equal(f.calls.length, 1);
  await f.create().run(); assert.equal(f.calls.length, 1);
});
test('startup failures remain contained and expose a safe PC preparation message', async t => {
  const f = fixture(t); f.manager.set({ enabled: true });
  const manager = f.create(() => { throw Error('fixture-private-details'); });
  await assert.doesNotReject(manager.run()); assert.match(manager.get().startupError, /Open Activity on this PC/);
  assert.equal(JSON.stringify(manager.get()).includes('fixture-private-details'), false);
});
test('invalid and corrupt preferences fail closed and are never overwritten', async t => {
  const f = fixture(t);
  for (const value of [null, {}, { enabled: 'true' }, { enabled: true, extra: true }]) assert.throws(() => f.manager.set(value));
  fs.mkdirSync(path.join(f.root, 'data'));
  const file = path.join(f.root, 'data/activity-preferences.json');
  fs.writeFileSync(file, '{broken');
  assert.throws(() => f.manager.get()); assert.throws(() => f.manager.set({ enabled: true }));
  await f.manager.run(); assert.equal(f.calls.length, 0); assert.equal(fs.readFileSync(file, 'utf8'), '{broken');
});
test('preference writes preserve other settings and reject linked stores', async t => {
  const f = fixture(t); fs.mkdirSync(path.join(f.root, 'data'));
  const settings = path.join(f.root, 'data/settings.json'); fs.writeFileSync(settings, 'fixture-original');
  f.manager.set({ enabled: true }); assert.equal(fs.readFileSync(settings, 'utf8'), 'fixture-original');
  assert.deepEqual(fs.readdirSync(path.join(f.root, 'data')).sort(), ['activity-preferences.json', 'settings.json']);
  if (process.platform !== 'win32') {
    fs.unlinkSync(path.join(f.root, 'data/activity-preferences.json'));
    fs.symlinkSync(settings, path.join(f.root, 'data/activity-preferences.json'));
    assert.throws(() => f.manager.get()); assert.throws(() => f.manager.set({ enabled: false }));
    assert.equal(fs.readFileSync(settings, 'utf8'), 'fixture-original');
  }
});
test('startup preferences are exact-local-origin PC controls, never exposed to the phone', () => {
  const base = { method: 'POST', headers: { host: '127.0.0.1:4196', origin: 'http://127.0.0.1:4196', 'content-type': 'application/json' }, rawHeaders: [], socket: { remoteAddress: '127.0.0.1' } };
  assert.doesNotThrow(() => localPreferenceBoundary(base, 4196));
  assert.doesNotThrow(() => localPreferenceBoundary({ ...base, method: 'GET', headers: { host: base.headers.host } }, 4196));
  for (const extra of [{ origin: 'null' }, { origin: 'https://foreign.invalid' }, { origin: undefined }, { host: 'localhost:4196' }, { 'tailscale-user-login': 'fixture' }, { 'content-encoding': 'gzip' }]) assert.throws(() => localPreferenceBoundary({ ...base, headers: { ...base.headers, ...extra } }, 4196));
  assert.throws(() => localPreferenceBoundary({ ...base, rawHeaders: ['Origin', base.headers.origin, 'Origin', base.headers.origin] }, 4196));
  assert.throws(() => localPreferenceBoundary({ ...base, socket: { remoteAddress: '192.0.2.1' } }, 4196));
  for (const method of ['GET', 'POST', 'PATCH', 'DELETE']) assert.equal(allowedRoute(method, '/workspace/activity/preferences'), false);
});
test('server startup hook is non-blocking and preference requests pass the local boundary', () => {
  const server = fs.readFileSync(path.join(__dirname, '../server.js'), 'utf8');
  assert.match(server, /proxy\.once\("listening", \(\) => \{\s*void activityStartup\.run\(\)/);
  assert.match(server, /localPreferenceBoundary\(request, publicPort\)/);
  const { qualifiedFiles } = require('../scripts/private-access.cjs');
  assert.ok(qualifiedFiles.includes('scripts/activity-server.js')); assert.ok(qualifiedFiles.includes('tests/activity-startup.test.js'));
});
