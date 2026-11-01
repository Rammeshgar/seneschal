'use strict';
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const { spawn } = require('node:child_process');
const files = require('./backup-files.cjs');
const quote = value => "'" + String(value).replace(/'/g, "'\\''") + "'";
const STAGES = Object.freeze({ unknown: 'an unconfirmed step', metadata: 'Seneschal settings, instructions or saved-board data', protection: 'private-folder protection', path: 'Windows-to-WSL path conversion', snapshot: 'the history snapshot', verification: 'backup verification', publication: 'saving the completed backup' });
const failure = (stage = 'unknown', cause) => {
  stage = Object.hasOwn(STAGES, stage) ? stage : 'unknown';
  return Object.assign(Error(`Backup failed at ${STAGES[stage]}. No success is confirmed; remaining folders are retained for inspection. Check WSL, Node 22.16+ SQLite support, free space and file permissions.`, cause ? { cause } : undefined), { backupStage: stage });
};
async function atStage(stage, action) { try { return await action(); } catch (error) { throw failure(stage, error); } }
function command(exe, args, input, timeout = 150000) {
  return new Promise((resolve, reject) => {
    const child = spawn(exe, args, { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    let output = '', length = 0, settled = false;
    const finish = (error, result) => { if (settled) return; settled = true; clearTimeout(timer); error ? reject(error) : resolve(result); };
    const timer = setTimeout(() => { child.kill(); finish(failure()); }, timeout);
    child.on('error', () => finish(failure())); child.stdin.on('error', () => {});
    child.stdout.on('data', chunk => { length += chunk.length; if (length > 8192) { child.kill(); finish(failure()); } else output += chunk; });
    child.stderr.on('data', () => {});
    child.on('close', code => finish(code === 0 ? null : failure(), output.trim()));
    child.stdin.end(input || '');
  });
}
function windowsProtectionScript(directory) {
  // Owner and SYSTEM only, before any private bytes are written.
  return "$ErrorActionPreference='Stop'; $p=" + "'" + directory.replace(/'/g, "''") + "'; " +
    "$sid=[Security.Principal.WindowsIdentity]::GetCurrent().User; $acl=New-Object Security.AccessControl.DirectorySecurity; $acl.SetOwner($sid); $acl.SetAccessRuleProtection($true,$false); " +
    "$inherit=[Security.AccessControl.InheritanceFlags]'ContainerInherit,ObjectInherit'; " +
    "foreach($who in @($sid,(New-Object Security.Principal.SecurityIdentifier 'S-1-5-18'))) { $rule=New-Object Security.AccessControl.FileSystemAccessRule($who,'FullControl',$inherit,'None','Allow'); $acl.AddAccessRule($rule) }; [IO.Directory]::SetAccessControl($p,$acl); " +
    "$check=[IO.Directory]::GetAccessControl($p); $rules=@($check.GetAccessRules($true,$true,[Security.Principal.SecurityIdentifier])); " +
    "if(-not $check.AreAccessRulesProtected -or $check.GetOwner([Security.Principal.SecurityIdentifier]).Value -ne $sid.Value -or $rules.Count -ne 2 -or @($rules | Where-Object { $_.AccessControlType -ne 'Allow' -or $_.IsInherited -or $_.FileSystemRights -ne [Security.AccessControl.FileSystemRights]::FullControl -or $_.IdentityReference.Value -notin @($sid.Value,'S-1-5-18') }).Count) { throw 'Private folder protection failed' }";
}
async function protect(directory) {
  if (process.platform !== 'win32') { fs.chmodSync(directory, 0o700); return; }
  // No Set-Acl/Get-Acl module autoload: Windows PowerShell uses framework ACL APIs.
  const script = windowsProtectionScript(directory);
  await atStage('protection', () => command('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')], '', 15000));
}
function createBackupManager({ root, distribution, linuxHome, runCommand = command, protectFolder = protect, snapshot, checkDatabase, now = Date.now }) {
  root = path.resolve(root);
  const data = path.join(root, 'data'), base = path.join(data, 'backups'), recovery = path.join(data, 'backup-recovery');
  const statusFile = path.join(data, 'backup-status.json'); let job = null, lastError = false;
  function status() {
    files.ancestors(data);
    if (lastError) return { phase: 'failed', stage: lastError, id: null, lastSuccessAt: null, message: failure(lastError).message };
    if (!fs.existsSync(statusFile)) return { phase: job ? 'running' : 'none', lastSuccessAt: null, id: null, message: job ? 'Starting a private backup…' : 'No verified backup recorded. Backups stay on this PC; keep an additional protected copy elsewhere.' };
    const value = files.readJSON(statusFile, 4096);
    if (!['running', 'complete', 'failed'].includes(value.phase) || (value.id !== null && !files.ID.test(value.id)) || (value.lastSuccessAt !== null && !Number.isFinite(Date.parse(value.lastSuccessAt))) || (value.stage !== undefined && !Object.hasOwn(STAGES, value.stage))) throw Error('Backup status could not be read safely.');
    return { phase: job ? 'running' : value.phase === 'running' ? 'interrupted' : value.phase, id: value.id, lastSuccessAt: value.lastSuccessAt,
      message: job ? 'Creating and verifying a private history backup…' : value.phase === 'running' ? 'The previous backup may be running elsewhere or was interrupted. Check the owning operation and incomplete folders before retrying.' : value.phase === 'complete' ? `Verified backup saved in data/backups/${value.id}. Private conversation content is included; do not share it.` : failure(value.stage).message };
  }
  function save(value) {
    files.ancestors(data); if (fs.existsSync(statusFile)) files.ordinary(statusFile);
    const temporary = path.join(data, 'backup-status-' + crypto.randomBytes(8).toString('hex') + '.tmp');
    fs.writeFileSync(temporary, JSON.stringify(value), { flag: 'wx', mode: 0o600 }); fs.renameSync(temporary, statusFile);
  }
  async function privateDirectory(directory) {
    await atStage('protection', async () => {
      files.ancestors(path.dirname(directory));
      if (!fs.existsSync(directory)) fs.mkdirSync(directory, { mode: 0o700 });
      files.ordinary(directory, true); await protectFolder(directory); files.ordinary(directory, true);
    });
  }
  async function wsl(operation, ...args) {
    if (!/^[a-zA-Z0-9_.-]{1,100}$/.test(distribution || '') || !/^\/(home\/[^/\0\r\n]+|root)$/.test(linuxHome || '') || linuxHome.includes('..')) throw failure();
    const convert = async value => {
      // --exec bypasses WSL's default shell, which consumes Windows backslashes.
      const result = await atStage('path', () => runCommand('wsl.exe', ['-d', distribution, '--exec', 'wslpath', '-a', '-u', value], '', 15000));
      if (!result.startsWith('/') || /[\0\r\n]/.test(result)) throw failure('path'); return result;
    };
    const worker = await convert(path.join(root, 'scripts', 'backup-worker.cjs'));
    const mapped = [];
    for (const arg of args) mapped.push(arg === linuxHome ? linuxHome : await convert(arg));
    await atStage(operation === 'snapshot' ? 'snapshot' : 'verification', () => runCommand('wsl.exe', ['-d', distribution, '--exec', 'bash', '-is'], 'exec node ' + [worker, operation, ...mapped].map(quote).join(' ') + '\n'));
  }
  async function check(directory) {
    if (checkDatabase) await checkDatabase(path.join(directory, 'history/opencode.db'));
    else await wsl('check', path.join(directory, 'history/opencode.db'));
  }
  function backupDirectory(id) {
    if (!files.ID.test(id || '')) throw Error('Choose a valid backup ID from the saved status.');
    files.ancestors(base); const directory = path.join(base, id); files.ancestors(directory); return directory;
  }
  async function verify(id) { const directory = backupDirectory(id), manifest = files.verify(directory, id); await check(directory); return { id, files: manifest.files.length, verified: true }; }
  function collectMetadata() {
    files.ancestors(data); const result = []; let size = 0;
    const add = (name, bytes) => { size += Buffer.byteLength(bytes); if (size > 64 * 1024 * 1024 || result.length >= 500) throw Error('Backup metadata exceeds its limit.'); result.push({ name, bytes }); };
    const settingsFile = path.join(data, 'settings.json');
    if (fs.existsSync(settingsFile)) add('seneschal/settings.json', JSON.stringify(files.settings(files.readJSON(settingsFile)), null, 2));
    for (const name of ['session-projects.json', 'agent-board.json', 'activity-preferences.json']) {
      const source = path.join(data, name);
      if (fs.existsSync(source)) add('seneschal/' + name, JSON.stringify(files.readJSON(source, 8 * 1024 * 1024), null, 2));
    }
    for (const [folder, extension] of [['instructions', 'md'], ['agent-board-history', 'json']]) {
      const source = path.join(data, folder); if (!fs.existsSync(source)) continue;
      files.ancestors(source); const entries = fs.readdirSync(source); if (entries.length > 200) throw Error('Too many metadata files.');
      for (const name of entries) {
        if (!new RegExp('^[a-zA-Z0-9_-]{1,100}\\.' + extension + '$').test(name)) throw Error('Unexpected metadata filename.');
        const bytes = files.read(path.join(source, name), 1024 * 1024);
        add(`seneschal/${folder}/${name}`, extension === 'json' ? JSON.stringify(files.parseJSON(bytes), null, 2) : bytes);
      }
    }
    return result;
  }
  async function preflight() {
    const metadata = await atStage('metadata', collectMetadata);
    return { valid: true, files: metadata.length, bytes: metadata.reduce((sum, item) => sum + Buffer.byteLength(item.bytes), 0) };
  }
  async function perform() {
    const previous = status();
    // Validate and capture bounded metadata before spending time/disk on history.
    const metadata = await atStage('metadata', collectMetadata);
    await privateDirectory(base);
    // Existing locks are never assumed stale or adopted automatically.
    const lock = path.join(base, '.backup-lock'); const fd = fs.openSync(lock, 'wx', 0o600);
    const id = 'backup-' + new Date(now()).toISOString().replace(/[-:.]/g, '') + '-' + crypto.randomBytes(8).toString('hex');
    const stage = path.join(base, '.' + id + '.incomplete'), destination = path.join(base, id);
    try {
      fs.closeSync(fd); save({ phase: 'running', id, lastSuccessAt: previous.lastSuccessAt });
      fs.mkdirSync(stage, { mode: 0o700 }); await atStage('protection', () => protectFolder(stage));
      if (snapshot) await atStage('snapshot', () => snapshot(stage)); else await wsl('snapshot', linuxHome, stage);
      await atStage('metadata', () => { for (const item of metadata) files.write(stage, item.name, item.bytes); });
      await atStage('verification', async () => {
        const manifest = files.manifest(stage, id);
        fs.writeFileSync(path.join(stage, 'manifest.json'), JSON.stringify(manifest, null, 2), { flag: 'wx', mode: 0o600 });
        files.verify(stage, id); await check(stage);
      });
      await atStage('publication', () => { fs.renameSync(stage, destination); save({ phase: 'complete', id, lastSuccessAt: new Date(now()).toISOString() }); });
      return { id, verified: true };
    } catch (error) { const failedStage = Object.hasOwn(STAGES, error.backupStage) ? error.backupStage : 'unknown'; save({ phase: 'failed', stage: failedStage, id, lastSuccessAt: previous.lastSuccessAt }); throw failure(failedStage, error); }
    finally { fs.unlinkSync(lock); }
  }
  function start() {
    if (!job) { lastError = false; job = Promise.resolve().then(perform).catch(error => { lastError = Object.hasOwn(STAGES, error.backupStage) ? error.backupStage : 'unknown'; throw failure(lastError, error); }).finally(() => { job = null; }); job.catch(() => {}); }
    return job;
  }
  async function weekly() {
    const last = status().lastSuccessAt; if (!last || now() - Date.parse(last) >= 7 * 86400000) await start();
  }
  async function restoreIsolated(id) {
    const source = backupDirectory(id); await verify(id); await privateDirectory(recovery);
    const target = path.join(recovery, id + '-' + crypto.randomBytes(8).toString('hex'));
    fs.mkdirSync(target, { mode: 0o700 }); await protectFolder(target);
    const manifest = files.verify(source, id);
    for (const entry of manifest.files) {
      const input = files.payloadPath(source, entry.name), directory = path.dirname(path.join(target, ...entry.name.split('/')));
      fs.mkdirSync(directory, { recursive: true, mode: 0o700 }); files.ancestors(directory);
      fs.copyFileSync(input, path.join(directory, path.basename(input)), fs.constants.COPYFILE_EXCL);
    }
    fs.writeFileSync(path.join(target, 'manifest.json'), JSON.stringify(manifest, null, 2), { flag: 'wx', mode: 0o600 });
    files.verify(target, id); await check(target);
    return { id, verified: true, folder: path.basename(target), message: 'Recovered into data/backup-recovery only. Nothing was imported, executed or changed in the live app.' };
  }
  return { status, start, weekly, verify, restoreIsolated, preflight };
}
async function main(args) {
  const root = path.resolve(__dirname, '..'), settingsFile = path.join(root, 'data/settings.json');
  const settings = fs.existsSync(settingsFile) ? files.readJSON(settingsFile) : {};
  const manager = createBackupManager({ root, distribution: process.env.SENESCHAL_WSL_DISTRO || process.env.DIGITAL_SERVANT_WSL_DISTRO || settings.wslDistribution || 'Ubuntu', linuxHome: process.env.SENESCHAL_WSL_HOME || process.env.DIGITAL_SERVANT_WSL_HOME || settings.wslLinuxHome || '/home/' + String(process.env.USERNAME || 'user').toLowerCase() });
  let result;
  if (args[0] === 'backup' && args.length === 1) result = await manager.start();
  else if (args[0] === 'status' && args.length === 1) result = manager.status();
  else if (args[0] === 'verify' && args.length === 2) result = await manager.verify(args[1]);
  else if (args[0] === 'restore-isolated' && args.length === 2) result = await manager.restoreIsolated(args[1]);
  else throw Error('Use backup, status, verify BACKUP-ID, or restore-isolated BACKUP-ID.');
  console.log(JSON.stringify(result));
}
if (require.main === module) main(process.argv.slice(2)).catch(error => { console.error(failure(error.backupStage).message); process.exitCode = 1; });
module.exports = { createBackupManager, command, protect, windowsProtectionScript };
