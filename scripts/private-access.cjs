'use strict';

// Owner-run utility and explicit PC-only controls. Importing never starts access.
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const { validateConfig } = require('./private-access-policy.cjs');
const { createGateway } = require('./private-access-gateway.cjs');
const root = path.resolve(__dirname, '..');
const store = path.join(root, 'data', 'private-access');
const qualificationFile = path.join(root, 'data', 'private-access-qualification.json');
const qualifiedFiles = ['scripts/private-access-policy.cjs', 'scripts/private-access-gateway.cjs', 'scripts/private-access.cjs', 'scripts/phone-access-control.cjs', 'app/phone-access.js', 'app/phone-access.css', 'app/private-access.css', 'app/private-access.js', 'app/activity.js', 'app/app.js', 'app/index.html', 'server.js', 'tests/private-access.test.js', 'scripts/verify-private-access.ps1', 'scripts/moli-mcp.cjs', 'tests/moli.test.js'];
qualifiedFiles.push('scripts/nvidia-speech.cjs', 'app/nvidia-speech.js', 'app/styles.css', 'tests/nvidia-speech.test.js');
qualifiedFiles.push('app/ares.js', 'app/ares-scene.js', 'app/ares.css', 'app/assets/ares/ares.glb', 'app/assets/ares/three.module.js', 'app/assets/ares/GLTFLoader.js', 'app/assets/ares/BufferGeometryUtils.js', 'app/assets/ares/THREE-LICENSE.txt', 'tests/ares.test.js');
qualifiedFiles.push('app/questions.js', 'app/questions.css', 'tests/questions.test.js');
qualifiedFiles.push('scripts/activity-server.js', 'tests/activity-startup.test.js');
qualifiedFiles.push('scripts/backup-files.cjs', 'scripts/backup-worker.cjs', 'scripts/backup-manager.cjs', 'scripts/backup-opencode.ps1', 'tests/backups.test.js');
qualifiedFiles.push('app/wallpapers.js', 'app/wallpapers.css', 'app/wallpapers/legacy-worlds.js', 'app/wallpapers/citylight-world.js', 'app/wallpapers/afterlight-worlds.js', 'app/wallpapers/afterlight-engine.js', 'tests/wallpapers-host.test.js');
qualifiedFiles.push('tests/wallpapers-host-fixture.cjs', 'tests/original-motion-controls.test.js');
const readJson = file => JSON.parse(fs.readFileSync(file, 'utf8'));

function requireQualification() {
  let proof; try { proof = readJson(qualificationFile); } catch { throw Error('Private access is unqualified. Run the isolated verification described in docs/PRIVATE-ACCESS-SETUP.md first.'); }
  if (proof.version !== 1 || proof.result !== 'passed' || proof.environment !== 'docker-network-none-readonly' || !proof.hashes) throw Error('Invalid private-access qualification record.');
  for (const name of qualifiedFiles) {
    const full = path.join(root, name);
    if (!fs.lstatSync(full).isFile() || fs.lstatSync(full).isSymbolicLink()) throw Error('Qualification requires regular source files.');
    const hash = crypto.createHash('sha256').update(fs.readFileSync(full)).digest('hex');
    if (proof.hashes[name] !== hash) throw Error('Private-access files changed after qualification. Re-run isolated verification.');
  }
}

function tailscaleJson(...args) {
  const exe = path.join(process.env.ProgramFiles || 'C:\\Program Files', 'Tailscale', 'tailscale.exe');
  try { return JSON.parse(execFileSync(exe, args, { windowsHide: true, timeout: 10000, maxBuffer: 1024 * 1024, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })); }
  catch { throw Error('Cannot read the local Tailscale service. Open Tailscale and sign in on the PC; do not share login links or keys.'); }
}

function checkServe(snapshot, hostname, port, allowOwned = false) {
  // A successfully read null config represents no device Serve configuration.
  if (snapshot === null) return;
  if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) throw Error('Unexpected Tailscale Serve state.');
  if (Object.keys(snapshot).length === 0) return;
  const tcp = snapshot.TCP || {}, web = snapshot.Web || {}, funnel = snapshot.AllowFunnel || {};
  if (Object.values(funnel).some(value => value !== false)) throw Error('Public Funnel configuration detected. Private setup stopped without changing it.');
  const expectedHost = `${hostname}:443`;
  const handlers = web[expectedHost]?.Handlers;
  const owned = allowOwned && Object.keys(snapshot).every(key => ['TCP', 'Web', 'AllowFunnel'].includes(key)) && Object.keys(tcp).length === 1 && tcp['443']?.HTTPS === true && Object.keys(tcp['443']).length === 1 && Object.keys(web).length === 1 && handlers && Object.keys(web[expectedHost]).length === 1 && Object.keys(handlers).length === 1 && handlers['/']?.Proxy === `http://127.0.0.1:${port}` && Object.keys(handlers['/']).length === 1 && Object.keys(funnel).every(key => key === expectedHost);
  if (!owned) throw Error('Existing Serve configuration detected. Setup will not overwrite or reset another service.');
}

function identity() {
  const status = tailscaleJson('status', '--json');
  if (status.BackendState !== 'Running' || !status.Self?.DNSName || status.Self.Tags?.length) throw Error('An untagged, signed-in personal PC is required.');
  const user = status.User?.[String(status.Self.UserID)];
  if (!user?.LoginName) throw Error('Tailscale did not supply an owner identity.');
  const owner = user.LoginName.toLowerCase();
  for (const peer of Object.values(status.Peer || {})) if (String(peer.UserID) !== String(status.Self.UserID) || peer.Tags?.length) throw Error('The visible tailnet contains another identity or tagged device. Review it before this owner-only setup.');
  return { owner, hostname: status.Self.DNSName.replace(/\.$/, '').toLowerCase() };
}

function assertStore() {
  for (const directory of [path.join(root, 'data'), store]) {
    const stat = fs.lstatSync(directory);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw Error('Remote storage must be an ordinary local directory.');
  }
}
function atomicJson(name, value) {
  assertStore();
  const target = path.join(store, name);
  const temporary = path.join(store, `${name}.${crypto.randomBytes(8).toString('hex')}.tmp`);
  if (fs.existsSync(target) && (!fs.lstatSync(target).isFile() || fs.lstatSync(target).isSymbolicLink())) throw Error('Unexpected remote storage file.');
  fs.writeFileSync(temporary, JSON.stringify(value, null, 2), { flag: 'wx', mode: 0o600 });
  fs.renameSync(temporary, target);
}

function windowsAclArgs(directory, sid) {
  if (!/^S-1-5-(?:\d+-)*\d+$/.test(sid || '')) throw Error('Invalid Windows user SID.');
  // icacls requires '*' to distinguish a numeric SID from an account name.
  return [directory, '/inheritance:r', '/grant:r', `*${sid}:(OI)(CI)F`];
}

function ensureEmptyPreparationDirectory(directory, filesystem = fs) {
  if (!filesystem.existsSync(directory)) { filesystem.mkdirSync(directory); return; }
  const stat = filesystem.lstatSync(directory);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw Error('Private settings must be an ordinary local directory.');
  if (filesystem.readdirSync(directory).length !== 0) throw Error('Private settings already contain files. Preparation will not overwrite them; inspect locally before recovery.');
  // A failed first preparation may leave an empty directory. Reuse it without deletion.
}

function prepare() {
  requireQualification();
  if (process.platform !== 'win32') throw Error('This first host setup is Windows-only.');
  const current = identity();
  const config = validateConfig({ ...current, port: 4200, upstreamPort: 4196 });
  checkServe(tailscaleJson('serve', 'status', '--json'), config.hostname, config.port);
  fs.mkdirSync(path.join(root, 'data'), { recursive: true });
  const dataStat = fs.lstatSync(path.join(root, 'data'));
  if (!dataStat.isDirectory() || dataStat.isSymbolicLink()) throw Error('Data directory is not a regular directory.');
  ensureEmptyPreparationDirectory(store);
  let stage = 'reading Windows user identity';
  try {
    const result = execFileSync('whoami.exe', ['/user', '/fo', 'csv', '/nh'], { windowsHide: true, timeout: 5000, encoding: 'utf8' });
    const sid = result.match(/S-1-5-(?:\d+-)*\d+/)?.[0];
    if (!sid) throw Error('Owner SID unavailable.');
    stage = 'protecting the private settings folder';
    execFileSync('icacls.exe', windowsAclArgs(store, sid), { windowsHide: true, timeout: 5000, stdio: 'ignore' });
    stage = 'writing protected settings';
    atomicJson('config.json', config);
    atomicJson('sessions.json', { version: 1, sessions: [], pairing: null });
    fs.writeFileSync(path.join(store, 'admin-key.txt'), crypto.randomBytes(32).toString('base64url'), { flag: 'wx', mode: 0o600 });
  } catch (error) {
    const detail = Number.isInteger(error.status) ? ` (Windows command exit ${error.status})` : /^E[A-Z0-9_]+$/.test(error.code || '') ? ` (${error.code})` : '';
    throw Error(`Preparation stopped while ${stage}${detail}. No network mapping was created. Existing files are preserved; inspect the private settings folder locally before retrying.`);
  }
  console.log('Private settings prepared. Remote access is still off.');
  console.log('Start the gateway in this PC terminal: node scripts/private-access.cjs start');
  console.log('Then follow docs/PRIVATE-ACCESS-SETUP.md to enable ONLY private Serve and pair the phone.');
}

function preparedConfig() {
  assertStore();
  return validateConfig(readJson(path.join(store, 'config.json')));
}

async function start({ quiet = false } = {}) {
  requireQualification();
  const config = preparedConfig();
  const current = identity();
  if (config.owner !== current.owner || config.hostname !== current.hostname) throw Error('The Tailscale host/account changed. Remote access remains off.');
  checkServe(tailscaleJson('serve', 'status', '--json'), config.hostname, config.port, true);
  const token = fs.readFileSync(path.join(root, 'data', 'workspace-token.txt'), 'utf8').trim();
  const gateway = createGateway({ config, upstreamToken: token, adminKey: fs.readFileSync(path.join(store, 'admin-key.txt'), 'utf8').trim(), state: readJson(path.join(store, 'sessions.json')), save: value => atomicJson('sessions.json', value) });
  await gateway.listen();
  if (quiet) return gateway;
  console.log('Private gateway running on loopback. Keep this terminal and the Seneschal host running. Closing its browser window does not stop the host.');
  console.log(`Phone address, after private Serve is enabled: https://${config.hostname}/`);
  console.log('In a second PC terminal: node scripts/private-access.cjs pair');
  console.log('Stop gateway and revoke all browsers: node scripts/private-access.cjs disable');
  return gateway;
}

async function administer(action, id, { quiet = false } = {}) {
  assertStore();
  const config = validateConfig(readJson(path.join(store, 'config.json')));
  const key = fs.readFileSync(path.join(store, 'admin-key.txt'), 'utf8').trim();
  const payload = JSON.stringify({ action, id });
  const value = await new Promise((resolve, reject) => {
    const request = http.request({ hostname: '127.0.0.1', port: config.port, path: '/remote/admin', method: 'POST', timeout: 5000, headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json', 'content-length': Buffer.byteLength(payload) } }, response => {
      const chunks = []; let size = 0;
      response.on('data', chunk => { size += chunk.length; if (size > 16384) { response.destroy(); reject(Error('Unexpected administration response.')); } else chunks.push(chunk); });
      response.on('error', () => reject(Error('Administration response interrupted.')));
      response.on('end', () => { try { const data = JSON.parse(Buffer.concat(chunks)); if (response.statusCode !== 200) throw Error(data.error || 'Administration denied.'); resolve(data); } catch (error) { reject(error); } });
    });
    request.on('timeout', () => request.destroy());
    request.on('error', cause => {
      const error = Error('Private gateway is not reachable. Start it on this PC, or close its owned terminal to stop it.');
      // Only a refused connection establishes that no listener accepted this request.
      error.code = cause.code;
      reject(error);
    });
    request.end(payload);
  });
  if (quiet) return value;
  if (action === 'pair') console.log(`One-time pairing code: ${value.code}\nExpires in 10 minutes. Enter it only on your own phone's private Seneschal page; do not paste it into chat.`);
  else if (action === 'devices') { for (const device of value.devices) console.log(`${device.id}  ${device.label}  expires ${new Date(device.expiresAt).toLocaleString()}`); if (!value.devices.length) console.log('No paired browsers.'); }
  else console.log(action === 'disable' ? 'Gateway stopped and browsers revoked. Your local Seneschal and history are unchanged. The private Serve mapping is not removed; see the setup guide.' : 'Browser access revoked. Running agent tasks were not restarted or stopped.');
  return value;
}

async function main() {
  const command = process.argv[2];
  if (command === 'prepare') return prepare();
  if (command === 'start') return start();
  if (['pair', 'devices', 'revoke-all', 'disable'].includes(command)) return administer(command);
  if (command === 'revoke' && /^[a-f0-9]{24}$/.test(process.argv[3] || '')) return administer(command, process.argv[3]);
  console.log('Private access (opt-in): prepare | start | pair | devices | revoke <browser-id> | revoke-all | disable');
}
if (require.main === module) main().catch(error => { console.error(error.code === 'EADDRINUSE' ? 'Gateway port already occupied. No existing process was stopped.' : error.message); process.exitCode = 1; });
module.exports = { checkServe, qualifiedFiles, windowsAclArgs, ensureEmptyPreparationDirectory, requireQualification, preparedConfig, start, administer };
