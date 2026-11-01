'use strict';
// Runs inside WSL. Own only these children and this installation's derived index.
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const [operation, packageRoot, indexRoot, sourceDb, owner, nonce] = process.argv.slice(2);
if (!['start', 'stop', 'rebuild'].includes(operation) || !/^[a-f0-9]{16}$/.test(owner || '') || !/^[a-f0-9]{32}$/.test(nonce || '')) throw Error('Invalid Activity runtime arguments.');
const metadataFile = path.join(indexRoot, 'runtime.json');
const exists = pid => { try { process.kill(pid, 0); return true; } catch { return false; } };
function metadata() { try { return JSON.parse(fs.readFileSync(metadataFile, 'utf8')); } catch { return null; } }
const previous = metadata();
if (operation === 'stop') {
  if (!previous || previous.owner !== owner || previous.nonce !== nonce) throw Error('This Activity runtime is not owned by this Seneschal process.');
  if (exists(previous.pid)) process.kill(previous.pid, 'SIGTERM');
  process.exit(0);
}
if (previous && exists(previous.pid)) throw Error('An Activity runtime already owns this index. Restart its Seneschal window first.');
fs.mkdirSync(indexRoot, { recursive: true });
if (operation === 'rebuild') {
  const backup = path.join(indexRoot, 'backup-' + new Date().toISOString().replace(/[:.]/g, '-'));
  fs.mkdirSync(backup);
  // Move only this service's stopped, derived SQLite files. Never touch sourceDb.
  for (const name of ['ingest.db', 'ingest.db-wal', 'ingest.db-shm']) {
    const from = path.join(indexRoot, name);
    if (fs.existsSync(from)) fs.renameSync(from, path.join(backup, name));
  }
  process.stdout.write(JSON.stringify({ backup }) + '\n');
  process.exit(0);
}
if (Number(process.versions.node.split('.')[0]) < 22) throw Error('Activity history needs Node 22 or newer in WSL.');
const packageInfo = JSON.parse(fs.readFileSync(path.join(packageRoot, 'package.json'), 'utf8'));
if (packageInfo.name !== '@camtrik/agent-trail' || packageInfo.version !== '0.1.7') throw Error('Activity requires the tested Agent Trail 0.1.7 package.');
const disabled = path.join(indexRoot, 'unused-sources');
fs.mkdirSync(disabled, { recursive: true });
const environment = {
  ...process.env, NODE_ENV: 'production', NEXT_TELEMETRY_DISABLED: '1',
  INGEST_PORT: '8078', INGEST_DB_PATH: path.join(indexRoot, 'ingest.db'), OPENCODE_DB_PATH: sourceDb,
  OPENCLAW_DIR: disabled, CLAUDE_PROJECTS_DIR: disabled, CODEX_SESSIONS_DIR: disabled,
  QODER_DB_PATH: path.join(disabled, 'absent.db'), QODER_HISTORY_ROOT: disabled, OPENCLAW_HOME: disabled,
  AGENT_TRAIL_CONFIG: path.join(disabled, 'absent.json'),
  INGEST_STARTUP_SYNC_LIMIT: '50', INGEST_BACKGROUND_SYNC_ENABLED: 'true', AGENT_TRAIL_LOG_LEVEL: 'info',
  NODE_OPTIONS: `--require ${JSON.stringify(path.join(__dirname, 'agent-trail-loopback.cjs'))}`,
};
const children = [];
let stopping = false;
function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  for (const child of children) if (child.exitCode === null && !child.killed) child.kill('SIGTERM');
  const deadline = setTimeout(() => {
    for (const child of children) if (child.exitCode === null) child.kill('SIGKILL');
    finish(code);
  }, 4500);
  function finish(result) {
    clearTimeout(deadline);
    if (metadata()?.nonce === nonce) fs.unlinkSync(metadataFile);
    process.exit(result);
  }
  Promise.all(children.map(child => child.exitCode !== null ? Promise.resolve() : new Promise(resolve => child.once('exit', resolve)))).then(() => finish(code));
}
function launch(entry, env, cwd) {
  const child = spawn(process.execPath, [entry], { env, cwd, stdio: ['ignore', 'inherit', 'inherit'] });
  children.push(child);
  child.on('error', error => { console.error(error.message); stop(1); });
  child.on('exit', code => { if (!stopping) { console.error('Activity child exited: ' + code); stop(code || 1); } });
}
fs.writeFileSync(metadataFile, JSON.stringify({ owner, nonce, pid: process.pid, version: packageInfo.version, index: environment.INGEST_DB_PATH }), { mode: 0o600 });
launch(path.join(packageRoot, 'ingest', 'dist', 'index.js'), environment, packageRoot);
// Keep the original dashboard available as a diagnostic fallback.
const standalone = path.join(packageRoot, '.next', 'standalone');
launch(path.join(standalone, 'server.js'), { ...environment, PORT: '3030', HOSTNAME: '127.0.0.1', INGEST_URL: 'http://127.0.0.1:8078' }, standalone);
process.on('SIGTERM', () => stop());
process.on('SIGINT', () => stop());
process.stdout.write('SENESCHAL_ACTIVITY_RUNTIME ' + JSON.stringify({ version: packageInfo.version, owner, index: environment.INGEST_DB_PATH, source: sourceDb }) + '\n');
