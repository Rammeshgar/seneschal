'use strict';
// Manual Windows/WSL integration smoke. A new fixture only; never opens real history.
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const { createBackupManager, command, protect } = require('../scripts/backup-manager.cjs');
const quote = value => "'" + value.replace(/'/g, "'\\''") + "'";
(async () => {
  if (process.platform !== 'win32') throw Error('This fixture requires Windows and existing WSL Node.');
  const parent = path.resolve(__dirname, '../.test-temp'); fs.mkdirSync(parent, { recursive: true });
  const root = fs.mkdtempSync(path.join(parent, "backup Windows it's-"));
  const data = path.join(root, 'data'), home = path.join(root, 'fixture-home');
  fs.mkdirSync(data); fs.mkdirSync(path.join(root, 'scripts')); fs.mkdirSync(home);
  for (const name of ['backup-files.cjs', 'backup-worker.cjs']) fs.copyFileSync(path.join(__dirname, '../scripts', name), path.join(root, 'scripts', name));
  const previousModules = process.env.PSModulePath;
  process.env.PSModulePath = path.join(root, 'no-security-module');
  try {
    await protect(root); await protect(root); // Native Windows check, including reapplication.
    console.log('Fixture: native folder protection passed twice.');
    const converted = await command('wsl.exe', ['-d', 'Ubuntu', '--exec', 'wslpath', '-a', '-u', root]);
    assert.ok(converted.startsWith('/')); const mappedHome = converted + '/fixture-home';
    console.log('Fixture: direct WSL path conversion passed.');
    const seed = `const fs=require('node:fs'),path=require('node:path'),{DatabaseSync}=require('node:sqlite');const home=${JSON.stringify(mappedHome)};const directory=path.join(home,'.local/share/opencode');fs.mkdirSync(directory,{recursive:true});fs.mkdirSync(path.join(home,'.config/opencode'),{recursive:true});const db=new DatabaseSync(path.join(directory,'opencode.db'));db.exec("PRAGMA journal_mode=WAL;CREATE TABLE message(text TEXT);INSERT INTO message VALUES('fixture only')");db.close();fs.writeFileSync(path.join(home,'.config/opencode/opencode.json'),JSON.stringify({model:'fixture/model',provider:{fixture:{options:{apiKey:'dummy-key'}}}}));`;
    await command('wsl.exe', ['-d', 'Ubuntu', '--exec', 'node', '-'], seed);
    console.log('Fixture: dummy database created.');
    const originalSettings = Buffer.concat([Buffer.from([239, 187, 191]), Buffer.from(JSON.stringify({ wslDistribution: 'Ubuntu', wslLinuxHome: '/home/fixture', apiKey: 'dummy-key' }))]);
    fs.writeFileSync(path.join(data, 'settings.json'), originalSettings);
    const manager = createBackupManager({ root, distribution: 'Ubuntu', linuxHome: '/home/fixture', runCommand: (exe, args, input, timeout) => {
      // The one virtual home is redirected to the fixture; production bridge unchanged.
      if (input?.includes(" 'snapshot' '/home/fixture' ")) input = input.replace(" 'snapshot' '/home/fixture' ", " 'snapshot' " + quote(mappedHome) + ' ');
      return command(exe, args, input, timeout);
    } });
    assert.equal((await manager.preflight()).valid, true);
    const result = await manager.start(); assert.equal(manager.status().phase, 'complete');
    assert.deepEqual(fs.readFileSync(path.join(data, 'settings.json')), originalSettings);
    console.log('Fixture: dummy backup completed.');
    await manager.verify(result.id); const restored = await manager.restoreIsolated(result.id); assert.equal(restored.verified, true);
    const settings = fs.readFileSync(path.join(root, 'data/backups', result.id, 'seneschal/settings.json'), 'utf8'); assert.equal(settings.includes('dummy-key'), false);
    console.log('PASS: native Windows ACLs without Security module, quoted WSL paths, BOM settings, dummy SQLite snapshot, verification and isolated recovery.');
    console.log('Only new fixture files under .test-temp were used; no live history or credentials were opened.');
  } finally { if (previousModules === undefined) delete process.env.PSModulePath; else process.env.PSModulePath = previousModules; }
})().catch(error => { console.error('Windows fixture failed at ' + (error.backupStage || 'fixture validation') + '. No live data was used.'); let deepest = error; while (deepest.cause) deepest = deepest.cause; console.error('Dummy fixture only: ' + deepest.message.replace(/C:\\Users\\[^\r\n]*/g, '[fixture path]')); if (deepest.identityCheck) console.error(JSON.stringify(deepest.identityCheck)); process.exitCode = 1; });
