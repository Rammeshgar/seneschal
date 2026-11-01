'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), os = require('node:os');
const { DatabaseSync } = require('node:sqlite');
const { snapshot, checkDatabase } = require('../scripts/backup-worker.cjs');
const { createBackupManager } = require('../scripts/backup-manager.cjs');
const files = require('../scripts/backup-files.cjs');
function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'backup-fixture-')), home = path.join(root, 'home');
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(home, '.local/share/opencode'), { recursive: true }); fs.mkdirSync(path.join(home, '.config/opencode'), { recursive: true }); fs.mkdirSync(path.join(root, 'data/instructions'), { recursive: true });
  const source = path.join(home, '.local/share/opencode/opencode.db'), db = new DatabaseSync(source);
  db.exec("PRAGMA journal_mode=WAL; CREATE TABLE message(id TEXT PRIMARY KEY, text TEXT); INSERT INTO message VALUES('msg_one','fixture private conversation')");
  t.after(() => { try { db.close(); } catch {} });
  fs.writeFileSync(path.join(home, '.config/opencode/opencode.json'), JSON.stringify({ model: 'openai/gpt-fixture', provider: { openai: { options: { apiKey: 'dummy-inline-key' } } }, mcp: { fixture: { environment: { TOKEN: 'dummy-mcp-token' } } } }));
  fs.writeFileSync(path.join(home, '.local/share/opencode/auth.json'), 'dummy-oauth-credential');
  fs.writeFileSync(path.join(root, 'data/settings.json'), JSON.stringify({ wslDistribution: 'Fixture', wslLinuxHome: '/home/fixture', apiKey: 'dummy-settings-key' }));
  for (const name of ['workspace-token.txt', 'server-password.txt', 'prism-api-key.txt']) fs.writeFileSync(path.join(root, 'data', name), 'dummy-local-secret');
  fs.mkdirSync(path.join(root, 'data/private-access')); fs.writeFileSync(path.join(root, 'data/private-access/sessions.json'), 'dummy-pairing-secret');
  fs.writeFileSync(path.join(root, 'data/instructions/build.md'), 'Fixture instructions.');
  const options = { root, snapshot: destination => snapshot(home, destination), checkDatabase };
  return { root, home, source, db, options, manager: createBackupManager(options) };
}
function readDB(filename) { const db = new DatabaseSync(filename, { readOnly: true }); try { return db.prepare('SELECT * FROM message ORDER BY id').all().map(row => ({ ...row })); } finally { db.close(); } }
test('a real WAL snapshot recovers committed history in a separate folder without changing live data', async t => {
  const f = fixture(t), originalSettings = fs.readFileSync(path.join(f.root, 'data/settings.json'));
  f.db.exec("INSERT INTO message VALUES('msg_two','committed in WAL'); BEGIN; INSERT INTO message VALUES('msg_uncommitted','must not recover')");
  const result = await f.manager.start(), backup = path.join(f.root, 'data/backups', result.id);
  assert.equal(f.manager.status().phase, 'complete'); assert.equal(result.verified, true);
  assert.equal(fs.readdirSync(path.join(backup, 'history')).length, 1);
  assert.deepEqual(readDB(path.join(backup, 'history/opencode.db')), [{ id: 'msg_one', text: 'fixture private conversation' }, { id: 'msg_two', text: 'committed in WAL' }]);
  f.db.exec('ROLLBACK');
  const restored = await f.manager.restoreIsolated(result.id), isolated = path.join(f.root, 'data/backup-recovery', restored.folder);
  assert.deepEqual(readDB(path.join(isolated, 'history/opencode.db')), readDB(f.source));
  assert.deepEqual(fs.readFileSync(path.join(f.root, 'data/settings.json')), originalSettings);
  assert.equal(fs.readFileSync(path.join(f.root, 'data/server-password.txt'), 'utf8'), 'dummy-local-secret');
  assert.notEqual(isolated, f.root); assert.equal(restored.verified, true);
});
test('credential stores, inline provider/MCP secrets, pairing state and arbitrary files are excluded', async t => {
  const f = fixture(t), { id } = await f.manager.start(), directory = path.join(f.root, 'data/backups', id);
  const names = files.list(directory); assert.deepEqual(names, ['engine/model-preferences.json', 'history/opencode.db', 'manifest.json', 'seneschal/instructions/build.md', 'seneschal/settings.json']);
  const json = names.filter(name => name.endsWith('.json')).map(name => fs.readFileSync(path.join(directory, name), 'utf8')).join('');
  for (const secret of ['dummy-inline-key', 'dummy-mcp-token', 'dummy-settings-key', 'dummy-oauth-credential', 'dummy-local-secret', 'dummy-pairing-secret']) assert.equal(json.includes(secret), false);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(directory, 'seneschal/settings.json'))), { wslDistribution: 'Fixture', wslLinuxHome: '/home/fixture' });
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(directory, 'engine/model-preferences.json'))), { model: 'openai/gpt-fixture' });
});
test('duplicate clicks share one operation and success is published only after verification', async t => {
  const f = fixture(t); let release, calls = 0; const gate = new Promise(resolve => { release = resolve; });
  const manager = createBackupManager({ ...f.options, snapshot: async directory => { calls++; await gate; await snapshot(f.home, directory); } });
  const first = manager.start(), second = manager.start(); assert.equal(first, second);
  await new Promise(resolve => setTimeout(resolve, 10)); assert.equal(manager.status().phase, 'running');
  assert.equal(fs.readdirSync(path.join(f.root, 'data/backups')).filter(name => files.ID.test(name)).length, 0);
  release(); await first; assert.equal(calls, 1); assert.equal(manager.status().phase, 'complete');
});
test('failed snapshots and failed protection never publish success or overwrite sign-in files', async t => {
  const f = fixture(t), before = fs.readFileSync(path.join(f.root, 'data/server-password.txt'));
  const manager = createBackupManager({ ...f.options, snapshot: () => { throw Error('dummy-secret-in-error'); } });
  await assert.rejects(manager.start(), /Backup failed/); assert.equal(manager.status().phase, 'failed'); assert.equal(JSON.stringify(manager.status()).includes('dummy-secret-in-error'), false);
  assert.equal(fs.readdirSync(path.join(f.root, 'data/backups')).filter(name => files.ID.test(name)).length, 0);
  let called = false; const protectedManager = createBackupManager({ ...f.options, protectFolder: () => { throw Error('ACL failed'); }, snapshot: () => { called = true; } });
  await assert.rejects(protectedManager.start()); assert.equal(called, false); assert.equal(protectedManager.status().phase, 'failed');
  assert.equal(protectedManager.status().stage, 'protection'); assert.match(protectedManager.status().message, /private-folder protection/);
  assert.deepEqual(fs.readFileSync(path.join(f.root, 'data/server-password.txt')), before);
});
test('Windows folder protection does not depend on PowerShell security-module autoload', () => {
  const { windowsProtectionScript } = require('../scripts/backup-manager.cjs');
  const script = windowsProtectionScript("C:\\fixture with spaces\\it's private");
  assert.doesNotMatch(script, /\b(?:Set-Acl|Get-Acl|Import-Module)\b/i);
  assert.match(script, /\[IO\.Directory\]::SetAccessControl/); assert.match(script, /\[IO\.Directory\]::GetAccessControl/);
  assert.match(script, /SetAccessRuleProtection\(\$true,\$false\)/); assert.match(script, /GetAccessRules\(\$true,\$true,\[Security\.Principal\.SecurityIdentifier\]\)/);
  assert.match(script, /it''s private/); assert.match(script, /S-1-5-18/); assert.match(script, /\$rules\.Count -ne 2/);
});
test('persisted failure stages are bounded labels and never render raw errors', async t => {
  const f = fixture(t), manager = createBackupManager({ ...f.options, snapshot: () => { throw Error('dummy-private-exception'); } });
  await assert.rejects(manager.start());
  const next = createBackupManager(f.options).status(); assert.match(next.message, /history snapshot/); assert.equal(next.message.includes('dummy-private-exception'), false);
  const statusFile = path.join(f.root, 'data/backup-status.json'), original = JSON.parse(fs.readFileSync(statusFile));
  fs.writeFileSync(statusFile, JSON.stringify({ ...original, stage: 'dummy-secret-stage' })); assert.throws(() => createBackupManager(f.options).status(), /safely/);
});
test('a zero Windows path volume ID requires independent handle identity; other mismatches remain refused', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'backup-identity-')); t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const file = path.join(root, 'fixture.txt'); fs.writeFileSync(file, 'fixture only');
  const before = fs.lstatSync(file), fd = fs.openSync(file, 'r'), opened = fs.fstatSync(fd);
  try {
    assert.notEqual(opened.dev, 0);
    const unavailable = { ...before, dev: 0 };
    assert.doesNotThrow(() => files.confirmReadIdentity(file, unavailable, opened, 'win32'));
    assert.throws(() => files.confirmReadIdentity(file, unavailable, opened, 'linux'), /device/);
    assert.throws(() => files.confirmReadIdentity(file, { ...before, dev: opened.dev + 1 }, opened, 'win32'), /device/);
    const wrongDevice = Object.create(opened); wrongDevice.dev = opened.dev + 1;
    assert.throws(() => files.confirmReadIdentity(file, unavailable, wrongDevice, 'win32'));
    assert.throws(() => files.confirmReadIdentity(file, { ...unavailable, ino: opened.ino + 1 }, opened, 'win32'));
    assert.throws(() => files.confirmReadIdentity(file, { ...unavailable, size: opened.size + 1 }, opened, 'win32'));
    fs.unlinkSync(file); fs.symlinkSync(path.join(root, 'missing'), file);
    assert.throws(() => files.confirmReadIdentity(file, unavailable, opened, 'win32'));
  } finally { fs.closeSync(fd); }
});
test('corruption, added files, traversal and modified manifests refuse isolated recovery', async t => {
  const f = fixture(t), { id } = await f.manager.start(), directory = path.join(f.root, 'data/backups', id), manifestFile = path.join(directory, 'manifest.json');
  const original = fs.readFileSync(manifestFile), manifest = JSON.parse(original);
  manifest.files[0].name = '../server-password.txt'; fs.writeFileSync(manifestFile, JSON.stringify(manifest)); await assert.rejects(f.manager.restoreIsolated(id));
  fs.writeFileSync(manifestFile, original); fs.writeFileSync(path.join(directory, 'unexpected.txt'), 'dummy'); await assert.rejects(f.manager.verify(id)); fs.unlinkSync(path.join(directory, 'unexpected.txt'));
  fs.appendFileSync(path.join(directory, 'seneschal/instructions/build.md'), 'tamper'); await assert.rejects(f.manager.restoreIsolated(id), /integrity/);
  assert.equal(fs.existsSync(path.join(f.root, 'data/backup-recovery')), false);
  for (const value of ['../data', '', '/tmp', id + '/..']) await assert.rejects(f.manager.verify(value));
});
test('linked source files and linked backup roots are refused', async t => {
  const f = fixture(t); fs.unlinkSync(path.join(f.root, 'data/instructions/build.md')); fs.symlinkSync(path.join(f.root, 'data/server-password.txt'), path.join(f.root, 'data/instructions/build.md'));
  await assert.rejects(f.manager.start());
  fs.unlinkSync(path.join(f.root, 'data/instructions/build.md'));
  const second = fs.mkdtempSync(path.join(os.tmpdir(), 'backup-external-')); t.after(() => fs.rmSync(second, { recursive: true, force: true }));
  fs.mkdirSync(path.join(f.root, 'data/backups'), { recursive: true });
  fs.renameSync(path.join(f.root, 'data/backups'), path.join(f.root, 'data/old-backups')); fs.symlinkSync(second, path.join(f.root, 'data/backups'));
  await assert.rejects(createBackupManager(f.options).start()); assert.equal(fs.readdirSync(second).length, 0);
});
test('Windows BOM-encoded settings and saved data normalize only in backup copies', async t => {
  const f = fixture(t);
  const settingsFile = path.join(f.root, 'data/settings.json'), original = Buffer.concat([Buffer.from([239, 187, 191]), fs.readFileSync(settingsFile)]);
  fs.writeFileSync(settingsFile, original);
  const board = { id: 'fixture', title: 'UTF-16 fixture', privateText: 'fixture only' };
  fs.writeFileSync(path.join(f.root, 'data/agent-board.json'), Buffer.concat([Buffer.from([255, 254]), Buffer.from(JSON.stringify(board), 'utf16le')]));
  fs.mkdirSync(path.join(f.root, 'data/agent-board-history'));
  fs.writeFileSync(path.join(f.root, 'data/agent-board-history/fixture.json'), Buffer.concat([Buffer.from([239, 187, 191]), Buffer.from(JSON.stringify(board))]));
  const engineFile = path.join(f.home, '.config/opencode/opencode.json'); fs.writeFileSync(engineFile, Buffer.concat([Buffer.from([239, 187, 191]), fs.readFileSync(engineFile)]));
  const checked = await f.manager.preflight(); assert.equal(checked.valid, true); assert.equal(fs.existsSync(path.join(f.root, 'data/backups')), false);
  const { id } = await f.manager.start(), directory = path.join(f.root, 'data/backups', id);
  assert.deepEqual(fs.readFileSync(settingsFile), original);
  const copy = fs.readFileSync(path.join(directory, 'seneschal/settings.json')); assert.notEqual(copy[0], 239); assert.equal(JSON.parse(copy).wslDistribution, 'Fixture'); assert.equal(copy.includes('dummy-settings-key'), false);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(directory, 'seneschal/agent-board.json'))), board);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(directory, 'engine/model-preferences.json'))), { model: 'openai/gpt-fixture' });
  assert.equal((await f.manager.restoreIsolated(id)).verified, true);
});
test('JSON decoding accepts declared Windows encodings but rejects malformed or invalid input without leaking it', () => {
  const value = { fixture: 'Unicode ☃', secret: 'dummy-private-value' }, json = JSON.stringify(value);
  for (const bytes of [Buffer.from(json), Buffer.concat([Buffer.from([239, 187, 191]), Buffer.from(json)]), Buffer.concat([Buffer.from([255, 254]), Buffer.from(json, 'utf16le')]), Buffer.concat([Buffer.from([254, 255]), Buffer.from(json, 'utf16le').swap16()])]) assert.deepEqual(files.parseJSON(bytes), value);
  for (const bytes of [Buffer.from('{"dummy-private-value":'), Buffer.from([239, 187, 191]), Buffer.from([255, 254, 0]), Buffer.from([123, 34, 120, 34, 58, 34, 255, 34, 125])]) assert.throws(() => files.parseJSON(bytes), error => error.message.includes('safely') && !error.message.includes('dummy-private-value'));
});
test('invalid metadata fails before history copying or folder protection and identifies the step', async t => {
  const f = fixture(t); fs.writeFileSync(path.join(f.root, 'data/settings.json'), Buffer.concat([Buffer.from([239, 187, 191]), Buffer.from('{broken')]));
  let snapshots = 0, protections = 0;
  const manager = createBackupManager({ ...f.options, snapshot: () => { snapshots++; }, protectFolder: () => { protections++; } });
  await assert.rejects(manager.preflight(), error => error.backupStage === 'metadata');
  await assert.rejects(manager.start(), error => error.backupStage === 'metadata');
  assert.equal(snapshots, 0); assert.equal(protections, 0); assert.equal(fs.existsSync(path.join(f.root, 'data/backups')), false);
  assert.match(manager.status().message, /Seneschal settings, instructions or saved-board data/);
});
test('weekly scheduling uses verified success, not the old attempt marker; no retention deletes', async t => {
  const f = fixture(t); let clock = Date.parse('2026-10-17T12:00:00Z'), calls = 0;
  fs.writeFileSync(path.join(f.root, 'data/last-backup-started.txt'), String(clock));
  const manager = createBackupManager({ ...f.options, now: () => clock, snapshot: async directory => { calls++; await snapshot(f.home, directory); } });
  await manager.weekly(); await manager.weekly(); assert.equal(calls, 1);
  clock += 7 * 86400000; await manager.weekly(); assert.equal(calls, 2);
  assert.equal(fs.readdirSync(path.join(f.root, 'data/backups')).filter(name => files.ID.test(name)).length, 2);
});
test('existing locks are not adopted and interrupted status is not reported as successful', async t => {
  const f = fixture(t); fs.mkdirSync(path.join(f.root, 'data/backups')); fs.writeFileSync(path.join(f.root, 'data/backups/.backup-lock'), 'existing-owner');
  await assert.rejects(f.manager.start()); assert.equal(fs.readFileSync(path.join(f.root, 'data/backups/.backup-lock'), 'utf8'), 'existing-owner');
  fs.writeFileSync(path.join(f.root, 'data/backup-status.json'), JSON.stringify({ phase: 'running', id: 'backup-20261017T120000000Z-0123456789abcdef', lastSuccessAt: null }));
  assert.equal(createBackupManager(f.options).status().phase, 'interrupted');
});
test('backup routes are PC-only, status is persistent, and recovery is never an HTTP mutation', () => {
  const source = fs.readFileSync(path.join(__dirname, '../server.js'), 'utf8'), html = fs.readFileSync(path.join(__dirname, '../app/index.html'), 'utf8'), ui = fs.readFileSync(path.join(__dirname, '../app/app.js'), 'utf8');
  const vm = require('node:vm'); assert.doesNotThrow(() => new vm.Script(source)); assert.doesNotThrow(() => new vm.Script(ui));
  const { allowedRoute } = require('../scripts/private-access-policy.cjs');
  for (const route of ['/workspace/backup', '/workspace/backup/status', '/workspace/backup/restore']) for (const method of ['GET', 'POST']) assert.equal(allowedRoute(method, route), false);
  assert.match(source, /localPreferenceBoundary\(request, publicPort\);\s*if \(pathname === "\/workspace\/backup\/status"/);
  assert.doesNotMatch(source, /restoreIsolated\(/); assert.doesNotMatch(ui, /Sanitized backup started/);
  assert.match(html, /id="backupStatus"[^>]*role="status"[^>]*aria-live="polite"/);
  const { qualifiedFiles } = require('../scripts/private-access.cjs'); assert.ok(qualifiedFiles.includes('scripts/backup-worker.cjs')); assert.ok(qualifiedFiles.includes('tests/backups.test.js'));
});
test('backup UI uses persistent accessible status, single flight, read-only checks and no phone writes', async () => {
  const vm = require('node:vm'), source = fs.readFileSync(path.join(__dirname, '../app/app.js'), 'utf8');
  const code = source.slice(source.indexOf('  let backupRequestPending'), source.indexOf('  function instructionEndpoint'));
  const nodes = new Map(), calls = [], timers = []; let resolvePost, remote = false, readFailure = false;
  const node = selector => { if (!nodes.has(selector)) nodes.set(selector, { disabled: false, attributes: {}, textContent: '', setAttribute(key, value) { this.attributes[key] = value; } }); return nodes.get(selector); };
  const context = vm.createContext({ document: { body: { classList: { contains: () => remote } } }, $: node, els: { settingsDialog: { open: true } }, AbortSignal,
    setTimeout: (fn, ms) => { timers.push({ fn, ms }); return timers.length; }, clearTimeout: () => {},
    workspace: async (route, options = {}) => { calls.push({ route, method: options.method || 'GET' }); if (options.method === 'POST') await new Promise(resolve => { resolvePost = resolve; }); else if (readFailure) throw Error('offline'); return { phase: 'complete', message: 'Fixture verified backup' }; }
  });
  vm.runInContext(code, context);
  const first = context.backupNow(); await context.backupNow();
  assert.equal(calls.filter(c => c.method === 'POST').length, 1); assert.equal(node('#backupNowButton').disabled, true); assert.equal(node('#backupStatus').attributes['aria-busy'], 'true');
  resolvePost(); await first; assert.match(node('#backupStatus').textContent, /verified/); assert.equal(node('#backupNowButton').disabled, false);
  readFailure = true; await context.refreshBackupStatus(); assert.match(node('#backupStatus').textContent, /No success has been confirmed/);
  const posts = calls.filter(c => c.method === 'POST').length; await context.refreshBackupStatus(); assert.equal(calls.filter(c => c.method === 'POST').length, posts);
  remote = true; const before = calls.length; await context.refreshBackupStatus(); await context.backupNow();
  assert.equal(calls.length, before); assert.equal(node('#backupNowButton').disabled, true); assert.match(node('#backupStatus').textContent, /on your PC/);
});
test('database verification rejects corrupt SQLite even with a newly matching file manifest', async t => {
  const f = fixture(t), { id } = await f.manager.start(), directory = path.join(f.root, 'data/backups', id);
  fs.writeFileSync(path.join(directory, 'history/opencode.db'), 'not a database');
  fs.unlinkSync(path.join(directory, 'manifest.json'));
  fs.writeFileSync(path.join(directory, 'manifest.json'), JSON.stringify(files.manifest(directory, id)));
  assert.doesNotThrow(() => files.verify(directory, id)); await assert.rejects(f.manager.restoreIsolated(id));
  assert.equal(fs.existsSync(path.join(f.root, 'data/backup-recovery')), false);
});
test('WSL path arguments are quoted, command errors are bounded, and no installation command is used', async t => {
  const f = fixture(t), calls = [];
  const manager = createBackupManager({ root: f.root, distribution: 'Fixture-Distro', linuxHome: '/home/fixture', checkDatabase,
    runCommand: async (exe, args, input) => {
      calls.push({ exe, args, input });
      if (args.includes('wslpath')) return '/mnt/fixture/with space/it\'s-' + (calls.length === 1 ? 'worker.cjs' : 'destination');
      assert.match(input, /exec node '\/mnt\/fixture\/with space\/it'\\''s-worker\.cjs' 'snapshot' '\/home\/fixture'/);
      throw Error('dummy-runtime-secret');
    }
  });
  await assert.rejects(manager.start(), error => !error.message.includes('dummy-runtime-secret'));
  assert.equal(calls.length, 3); assert.equal(calls.every(call => call.exe === 'wsl.exe' && call.args[2] === '--exec'), true);
  assert.equal(JSON.stringify(calls).includes('npm'), false); assert.equal(JSON.stringify(calls).includes('install'), false);
  const { command } = require('../scripts/backup-manager.cjs');
  await assert.rejects(command(process.execPath, ['-e', "console.error('dummy-secret');process.exit(1)"], '', 2000), error => !error.message.includes('dummy-secret'));
  await assert.rejects(command(process.execPath, ['-e', 'setTimeout(()=>{},5000)'], '', 20));
});
test('WSL path conversion bypasses the shell for backslashes, spaces and apostrophes', async t => {
  const f = fixture(t), calls = [];
  const manager = createBackupManager({ root: f.root, distribution: 'Fixture', linuxHome: '/home/fixture', checkDatabase,
    runCommand: async (exe, args, input) => {
      calls.push({ exe, args, input }); assert.equal(args[2], '--exec');
      if (args[3] === 'wslpath') { assert.equal(args.length, 7); assert.equal(args[6].startsWith(f.root), true); return '/mnt/fixture/a space/it\'s-' + (args[6].endsWith('backup-worker.cjs') ? 'worker.cjs' : 'stage'); }
      assert.equal(args[3], 'bash'); assert.match(input, /it'\\''s-worker/); throw Error('Stop before any real WSL work');
    }
  });
  await assert.rejects(manager.start()); assert.equal(calls.filter(call => call.args[3] === 'wslpath').length, 2);
});
test('backup status clicks visibly check, restore controls after failure, and ignore stale replies', async () => {
  const vm = require('node:vm'), source = fs.readFileSync(path.join(__dirname, '../app/app.js'), 'utf8');
  const code = source.slice(source.indexOf('  let backupRequestPending'), source.indexOf('  function instructionEndpoint'));
  const nodes = new Map(), pending = [];
  const node = selector => { if (!nodes.has(selector)) nodes.set(selector, { disabled: false, attributes: {}, textContent: '', setAttribute(key, value) { this.attributes[key] = value; } }); return nodes.get(selector); };
  const context = vm.createContext({ document: { body: { classList: { contains: () => false } } }, $: node, els: { settingsDialog: { open: true } }, AbortSignal,
    setTimeout: () => 1, clearTimeout: () => {}, workspace: () => new Promise((resolve, reject) => pending.push({ resolve, reject }))
  }); vm.runInContext(code, context);
  const first = context.refreshBackupStatus(); assert.equal(node('#backupStatusButton').textContent, 'Checking…'); assert.equal(node('#backupStatusButton').disabled, true); assert.match(node('#backupStatus').textContent, /Checking/);
  const latest = context.refreshBackupStatus(); pending[1].resolve({ phase: 'failed', message: 'Fixture failure' }); await latest;
  assert.equal(node('#backupStatusButton').disabled, false); assert.match(node('#backupStatus').textContent, /Fixture failure.*Last checked/);
  pending[0].resolve({ phase: 'complete', message: 'Stale success' }); await first; assert.equal(node('#backupStatus').textContent.includes('Stale success'), false);
  const failed = context.refreshBackupStatus(); pending[2].reject(Error('offline')); await failed;
  assert.equal(node('#backupNowButton').disabled, false); assert.equal(node('#backupStatusButton').disabled, false); assert.match(node('#backupStatus').textContent, /No success has been confirmed/);
});
