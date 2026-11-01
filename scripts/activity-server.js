'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const net = require('node:net');
const { spawn } = require('node:child_process');
const VERSION = '0.1.7';
const ID = /^[a-zA-Z0-9:\-_.]{1,256}$/;
function problem(message, status = 503) { return Object.assign(new Error(message), { statusCode: status }); }
function shellQuote(value) { return "'" + String(value).replace(/'/g, "'\\''") + "'"; }
function linuxPath(value) {
  if (!/^[A-Za-z]:[\\/]/.test(value)) throw problem('Activity needs a local Windows installation path.');
  return '/mnt/' + value[0].toLowerCase() + '/' + value.slice(3).replace(/\\/g, '/');
}
const number = value => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
function localPreferenceBoundary(request, port) {
  const host = `127.0.0.1:${port}`, origin = `http://${host}`;
  const counts = new Map();
  for (let i = 0; i < (request.rawHeaders || []).length; i += 2) { const key = request.rawHeaders[i].toLowerCase(); counts.set(key, (counts.get(key) || 0) + 1); }
  if (!['127.0.0.1', '::ffff:127.0.0.1'].includes(request.socket?.remoteAddress) || request.headers.host !== host || request.headers['tailscale-user-login'] !== undefined || request.headers['content-encoding'] !== undefined || ['host', 'origin', 'cookie', 'content-type'].some(key => (counts.get(key) || 0) > 1) || (request.headers.origin !== undefined && request.headers.origin !== origin)) throw problem('Manage Activity startup from Seneschal on this PC.', 403);
  if (request.method === 'GET') return;
  if (request.method !== 'POST' || request.headers.origin !== origin || request.headers['content-type'] !== 'application/json') throw problem('PC-only, same-origin JSON action required.', 403);
}
function createActivityStartup({ root, start }) {
  const directory = path.join(root, 'data'), filename = path.join(directory, 'activity-preferences.json');
  let launched = false, startupError = '';
  function get() {
    try {
      if (fs.existsSync(directory) && (!fs.lstatSync(directory).isDirectory() || fs.lstatSync(directory).isSymbolicLink())) throw Error('Invalid directory');
      if (!fs.existsSync(filename)) return { enabled: false, startupError };
      const stat = fs.lstatSync(filename);
      if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 1024) throw Error('Invalid preference file');
      const value = JSON.parse(fs.readFileSync(filename, 'utf8'));
      if (!value || value.version !== 1 || typeof value.enabled !== 'boolean' || Object.keys(value).some(key => !['version', 'enabled'].includes(key))) throw Error('Invalid preferences');
      return { enabled: value.enabled, startupError };
    } catch { throw problem('Activity startup settings could not be read safely. No automatic start was attempted.', 409); }
  }
  function set(value) {
    if (!value || typeof value.enabled !== 'boolean' || Object.keys(value).some(key => key !== 'enabled')) throw problem('Choose whether Activity should start with Seneschal.', 400);
    get(); // Do not overwrite a corrupt or linked preference store.
    if (!fs.existsSync(directory)) fs.mkdirSync(directory);
    const temporary = path.join(directory, 'activity-preferences.' + crypto.randomBytes(8).toString('hex') + '.tmp');
    try { fs.writeFileSync(temporary, JSON.stringify({ version: 1, enabled: value.enabled }) + '\n', { flag: 'wx', mode: 0o600 }); fs.renameSync(temporary, filename); }
    catch { try { fs.unlinkSync(temporary); } catch {} throw problem('Activity startup setting could not be saved. Your previous preference is unchanged.', 409); }
    return get();
  }
  async function run() {
    if (launched) return;
    launched = true;
    try { if (get().enabled) await start({ allowInstall: false }); }
    catch { startupError = 'Automatic Activity startup failed. Open Activity on this PC to prepare or inspect the service.'; }
  }
  return { get, set, run };
}
function normalizeSession(row) {
  if (!row || row.source !== 'opencode' || !ID.test(row.id || '')) throw problem('History returned an incompatible session.', 502);
  const m = row.metrics || {};
  return {
    id: row.id, sourceSessionId: row.sourceSessionId || null, source: 'opencode',
    title: row.displayTitle || row.name || 'Untitled session', project: row.project || '', cwd: row.cwd || '',
    model: row.model || null, summary: row.summary || '', status: row.status || 'unknown',
    startedAt: row.startedAt || null, updatedAt: row.updatedAt || row.endedAt || row.startedAt || null,
    lastSyncAt: row.lastSyncAt || null, parentSessionId: row.parentSessionId || null,
    relationshipType: row.relationshipType || 'root', truncated: Boolean(m.isTruncated),
    tokens: Object.fromEntries(['inputTokens', 'outputTokens', 'cacheReadTokens', 'cacheWriteTokens', 'reasoningTokens', 'totalTokens'].map(key => [key, number(m[key])])),
    messages: number(m.messageCount), turns: number(row.totalTurns ?? m.userMessageCount),
    toolCalls: number(row.activityCounts?.toolCalls), estimatedCost: number(row.estimatedCost),
    pricingStatus: row.costPricingStatus || 'unknown', costSource: row.costSource || null,
  };
}
function createActivity({ root, distribution, linuxHome, fetcher = fetch, spawnProcess = spawn, now = Date.now, sleeper = ms => new Promise(resolve => setTimeout(resolve, ms)), portCheck }) {
  const owner = crypto.createHash('sha256').update(path.resolve(root).toLowerCase()).digest('hex').slice(0, 16);
  const nonce = crypto.randomBytes(16).toString('hex');
  const base = 'http://127.0.0.1:8078';
  const logFile = path.join(root, 'data', 'agent-trail.log');
  const runtimeScript = linuxPath(path.join(root, 'scripts', 'agent-trail-runtime.cjs'));
  const packageRoot = linuxHome + '/.local/share/seneschal-agent-trail/node_modules/@camtrik/agent-trail';
  const indexRoot = linuxHome + '/.local/share/seneschal-agent-trail/indexes/' + owner;
  const sourceDb = linuxHome + '/.local/share/opencode/opencode.db';
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  let child = null, startPromise = null, syncPromise = null, controlPromise = null;
  let phase = 'stopped', message = 'Start Activity to load local history.', identity = null, lastError = null, lastSyncAt = null;
  let lastSyncAttempt = 0, disposed = false, generation = 0;
  async function call(endpoint, query = {}, method = 'GET', timeout = 10000) {
    const url = new URL(base + endpoint);
    for (const [key, value] of Object.entries(query)) if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, String(value));
    let response;
    try { response = await fetcher(url.href, { method, headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(timeout) }); }
    catch (error) { throw problem(error.name === 'TimeoutError' ? 'History is taking longer to respond. Try again shortly.' : 'The Activity service is not responding. Open Service to restart it.'); }
    if (!response.ok) throw problem(response.status === 404 ? 'This history feature is unavailable in the installed runtime.' : 'History could not complete this request.', response.status === 404 ? 404 : 502);
    let data;
    try { data = await response.json(); } catch { throw problem('History returned an unexpected response.', 502); }
    if (!data || typeof data !== 'object') throw problem('History returned an unexpected response.', 502);
    return data;
  }
  function wsl(script, onOutput) {
    const proc = spawnProcess('wsl.exe', ['-d', distribution, '--', 'bash', '-is'], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    proc.stdin.on('error', () => {});
    proc.stdin.end(script + '\n');
    if (onOutput) { proc.stdout.on('data', onOutput); proc.stderr.on('data', onOutput); }
    return proc;
  }
  async function command(operation) {
    const script = 'exec node ' + [runtimeScript, operation, packageRoot, indexRoot, sourceDb, owner, nonce].map(shellQuote).join(' ');
    const proc = wsl(script);
    let output = '';
    proc.stdout.on('data', data => { output = (output + data).slice(-4000); });
    proc.stderr.on('data', data => { output = (output + data).slice(-4000); });
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { proc.kill(); reject(problem('The Activity service operation timed out.')); }, 15000);
      proc.once('error', () => { clearTimeout(timer); reject(problem('WSL could not start the Activity service.')); });
      proc.once('close', code => { clearTimeout(timer); code === 0 ? resolve(output) : reject(problem('The Activity service operation failed. See its diagnostics log.')); });
    });
  }
  async function status() {
    if (!child || !identity) return { phase, message: lastError || message, owned: Boolean(child), version: null, testedVersion: VERSION, lastError, lastSyncAt, index: indexRoot + '/ingest.db', source: sourceDb };
    try {
      const health = await call('/health', {}, 'GET', 2500);
      const source = await call('/api/v1/sources/opencode', {}, 'GET', 2500);
      if (!Array.isArray(source.sources) || health.database !== 'connected') throw problem('The history database is unavailable.');
      const sourceError = source.sources.find(row => row.error)?.error;
      const sync = health.sync || {};
      const running = sync.scheduler?.active || sync.scheduler?.queued;
      phase = sourceError || lastError ? 'degraded' : health.ready && !syncPromise && !running && !['indexing', 'warming', 'discovering', 'starting'].includes(sync.phase) ? 'ready' : 'indexing';
      message = sourceError ? 'OpenCode history could not be read. Check the source database in Service.' : lastError ? 'History refresh was incomplete. Refresh again or inspect Service.' : phase === 'ready' ? 'Local history is ready.' : 'Indexing local history. Available records can already be opened.';
      return { phase, message, owned: Boolean(child), version: identity?.version || VERSION, testedVersion: VERSION,
        lastError: sourceError ? 'OpenCode history is unavailable.' : lastError,
        lastSyncAt: lastSyncAt || sync.lastSyncAt || source.sources[0]?.lastSyncAt || null,
        index: indexRoot + '/ingest.db', source: sourceDb, sourceSessions: number(source.sources[0]?.sessionCount),
        ready: Boolean(health.ready), complete: phase === 'ready', syncing: Boolean(syncPromise || running), diagnostics: 'data/agent-trail.log' };
    } catch (error) {
      if (!['installing', 'starting'].includes(phase)) { phase = 'failed'; lastError = error.message; }
      return { phase, message: ['installing', 'starting'].includes(phase) ? message : lastError, owned: Boolean(child), version: identity?.version || null, testedVersion: VERSION, lastError, lastSyncAt, index: indexRoot + '/ingest.db', source: sourceDb };
    }
  }
  async function inUse(port) {
    if (portCheck) return portCheck(port);
    return new Promise(resolve => {
      const socket = net.connect({ host: '127.0.0.1', port });
      let done = false;
      const finish = result => { if (!done) { done = true; socket.destroy(); resolve(result); } };
      socket.setTimeout(500); socket.once('connect', () => finish(true)); socket.once('error', () => finish(false)); socket.once('timeout', () => finish(false));
    });
  }
  function start({ allowInstall = true } = {}) {
    if (disposed) return Promise.reject(problem('Seneschal is shutting down.'));
    if (controlPromise) return Promise.reject(problem('An Activity maintenance operation is running.', 409));
    if (startPromise) return startPromise;
    startPromise = (async () => {
      if (child) return status();
      if (await inUse(8078) || await inUse(3030)) throw problem('Another local service uses Activity’s ports (8078 or 3030). Close that service before starting Activity.', 409);
      if (disposed) throw problem('Seneschal is shutting down.');
      phase = 'installing'; message = 'Preparing the local history service…'; lastError = null; identity = null;
      fs.mkdirSync(path.dirname(logFile), { recursive: true });
      const ownGeneration = ++generation;
      const folder = linuxHome + '/.local/share/seneschal-agent-trail';
      const script = 'set -e\nexport TZ=' + shellQuote(timeZone) + '\ncommand -v node >/dev/null || { echo "Node is missing in WSL" >&2; exit 1; }\n' +
        'test "$(node --version | cut -d. -f1 | tr -d v)" -ge 22 || { echo "Activity needs Node 22+ in WSL" >&2; exit 1; }\n' +
        'mkdir -p ' + shellQuote(folder) + '\ncd ' + shellQuote(folder) + '\n' +
        (allowInstall ? 'if ! test -f node_modules/@camtrik/agent-trail/ingest/dist/index.js; then npm install --no-audit --no-fund @camtrik/agent-trail@' + VERSION + '; fi\n' : 'test -f node_modules/@camtrik/agent-trail/ingest/dist/index.js || { echo "Open Activity on the PC once to prepare its runtime." >&2; exit 1; }\n') +
        'exec node ' + [runtimeScript, 'start', packageRoot, indexRoot, sourceDb, owner, nonce].map(shellQuote).join(' ');
      let pending = '';
      child = wsl(script, data => {
        fs.appendFileSync(logFile, data);
        pending = (pending + data.toString('utf8')).slice(-8000);
        const match = pending.match(/SENESCHAL_ACTIVITY_RUNTIME (\{[^\n]+\})/);
        if (match) { try { const announced = JSON.parse(match[1]); if (announced.owner === owner && announced.version === VERSION) { identity = announced; phase = 'starting'; message = 'Starting local history…'; } } catch {} }
      });
      const current = child;
      current.once('error', () => { if (generation === ownGeneration) { child = null; identity = null; phase = 'failed'; lastError = 'WSL could not start Activity. Check the configured distribution.'; } });
      current.once('close', code => { if (generation === ownGeneration) { child = null; identity = null; if (!['stopping', 'stopped'].includes(phase)) { phase = 'failed'; lastError = 'Activity stopped before it was ready (exit ' + code + '). See data/agent-trail.log.'; } } });
      for (let attempt = 0; attempt < 90; attempt++) {
        if (disposed) throw problem('Seneschal is shutting down.');
        if (!child) throw problem(lastError || 'Activity could not start.');
        if (identity) {
          const result = await status();
          if (['ready', 'indexing', 'degraded'].includes(result.phase)) return result;
        }
        await sleeper(1000);
      }
      throw problem('Activity preparation is still running. Check Service for progress.');
    })().catch(error => { if (!child) { phase = 'failed'; lastError = error.message; } throw error; }).finally(() => { startPromise = null; });
    return startPromise;
  }
  async function stopOwned() {
    if (!child) { phase = 'stopped'; message = 'Activity is stopped.'; return status(); }
    if (!identity) throw problem('Activity is still preparing. Wait for preparation before stopping it.', 409);
    const current = child;
    phase = 'stopping'; message = 'Stopping Activity…';
    await command('stop');
    for (let attempt = 0; attempt < 60 && child === current; attempt++) await sleeper(100);
    if (child === current) throw problem('Activity did not stop. The index was not changed.');
    ++generation; identity = null; phase = 'stopped'; message = 'Activity is stopped.';
    return status();
  }
  function maintain(operation) {
    if (startPromise || controlPromise || syncPromise) return Promise.reject(problem('Wait for the current Activity operation to finish.', 409));
    controlPromise = (async () => {
      await stopOwned();
      if (operation === 'rebuild') { await command('rebuild'); lastSyncAt = null; lastError = null; }
    })().finally(() => { controlPromise = null; });
    return controlPromise.then(() => operation === 'stop' ? status() : start());
  }
  async function sync() {
    if (!child || !identity) throw problem('Start Activity before refreshing history.', 409);
    if (syncPromise) return syncPromise;
    if (controlPromise || startPromise) throw problem('Activity is preparing. Try refreshing shortly.', 409);
    lastSyncAttempt = now();
    syncPromise = call('/api/v1/sources/opencode/sync', {}, 'POST', 120000).then(result => {
      const errors = result.syncResult?.errors || [];
      if (errors.length) throw problem('Some history records could not be indexed. See Service diagnostics.');
      lastSyncAt = new Date(now()).toISOString(); lastError = null; return { message: 'History refreshed.', lastSyncAt };
    }).catch(error => { lastError = error.message; throw error; }).finally(() => { syncPromise = null; });
    return syncPromise;
  }
  function page(query) {
    const limit = query.get('limit') || '30', offset = query.get('offset') || '0';
    if (!/^\d+$/.test(limit) || !/^\d+$/.test(offset) || +limit < 1 || +offset > 1000000) throw problem('Invalid history page.', 400);
    return { limit: Math.min(+limit, 100), offset: +offset };
  }
  async function getSession(id) {
    if (!ID.test(id || '')) throw problem('Invalid session identifier.', 400);
    return normalizeSession(await call('/api/v1/sessions/' + encodeURIComponent(id)));
  }
  async function overview(query) {
    const window = query.get('window') || '7d';
    if (!['today', '7d', '30d', 'all'].includes(window)) throw problem('Invalid usage period.', 400);
    const common = { source: 'opencode', window };
    const parts = await Promise.allSettled([
      call('/api/v1/overview/aggregates', common, 'GET', 20000),
      call('/api/v1/overview/daily-tokens', window === 'all' ? common : { source: 'opencode', days: window === 'today' ? 1 : window === '7d' ? 7 : 30 }, 'GET', 20000),
      // Upstream rankings attribute whole sessions to their latest model. Keep that scope explicit.
      call('/api/v1/overview/top-models', { ...common, limit: 8 }, 'GET', 20000),
      call('/api/v1/overview/top-projects', { ...common, limit: 8 }, 'GET', 20000),
    ]);
    const keys = ['totals', 'daily', 'models', 'projects'];
    const result = { window, source: 'opencode', timeZone, generatedAt: new Date(now()).toISOString(), warnings: [], costBasis: 'Agent Trail local pricing estimates; provider billing and subscription limits are separate.', rankingBasis: 'Rankings use sessions started in this period; each session is attributed to its latest recorded model. Token trend uses recorded daily usage. Date windows follow ' + timeZone + '.' };
    parts.forEach((part, i) => { result[keys[i]] = part.status === 'fulfilled' ? part.value : null; if (part.status === 'rejected') result.warnings.push(keys[i] + ': ' + part.reason.message); });
    if (!result.totals) throw problem('Usage totals are unavailable. Refresh history or check Service.');
    return result;
  }
  async function handle(request, pathname, query) {
    const prefix = '/workspace/activity';
    const action = pathname.slice(prefix.length) || '/status';
    if (action === '/status' && request.method === 'GET') return status();
    if (['/start', '/restart', '/stop', '/rebuild', '/sync'].includes(action)) {
      if (request.method !== 'POST') throw problem('Method not allowed.', 405);
      return action === '/start' ? start() : action === '/sync' ? sync() : maintain(action.slice(1));
    }
    if (request.method !== 'GET') throw problem('Method not allowed.', 405);
    if (!child || !identity) throw problem('Start the local Activity service before reading history.', 409);
    if (action === '/overview') return overview(query);
    if (action === '/lookup') {
      const key = query.get('key');
      if (!ID.test(key || '')) throw problem('Invalid session identifier.', 400);
      return normalizeSession(await call('/api/v1/sessions/lookup', { source: 'opencode', key }));
    }
    if (action === '/sessions') {
      const q = (query.get('q') || '').trim().slice(0, 240);
      const params = { ...page(query), source: 'opencode', q, includeChildren: 'true', sort: 'updated_at', order: 'desc' };
      if (query.get('project')) params.project = query.get('project').slice(0, 1000);
      if (query.get('status')) {
        if (!['active', 'idle', 'error', 'aborted', 'unknown'].includes(query.get('status'))) throw problem('Invalid status filter.', 400);
        params.status = query.get('status');
      }
      const data = await call('/api/v1/sessions', params);
      if (!Array.isArray(data.sessions) || !data.pagination) throw problem('History returned an incompatible session list.', 502);
      return { sessions: data.sessions.map(normalizeSession), pagination: data.pagination };
    }
    if (action === '/search') {
      const q = (query.get('q') || '').trim().slice(0, 240);
      if (!q) throw problem('Enter text to search history.', 400);
      const data = await call('/api/v1/sessions/search', { source: 'opencode', q, includeChildren: 'true', limit: 50 });
      if (!Array.isArray(data.results) || data.results.some(row => row.source !== 'opencode')) throw problem('History returned an incompatible search result.', 502);
      return data;
    }
    const match = action.match(/^\/sessions\/([^/]+)(?:\/(turns|messages))?$/);
    if (match) {
      let id; try { id = decodeURIComponent(match[1]); } catch { throw problem('Invalid session identifier.', 400); }
      const session = await getSession(id);
      if (!match[2]) return session;
      const data = await call('/api/v1/sessions/' + encodeURIComponent(id) + '/' + match[2], page(query), 'GET', 20000);
      if (!Array.isArray(data[match[2]]) || !data.pagination) throw problem('History returned an incompatible conversation.', 502);
      return data;
    }
    throw problem('Activity route not found.', 404);
  }
  async function dispose() {
    disposed = true;
    if (child && identity) { try { await stopOwned(); } catch {} }
    else if (child) { child.kill(); }
  }
  return { handle, start, status, sync, dispose, normalizeSession,
    refreshIfDue: () => !disposed && !startPromise && !controlPromise && child && identity && now() - lastSyncAttempt > 30000 ? sync() : Promise.resolve(null) };
}
module.exports = { createActivity, createActivityStartup, localPreferenceBoundary, normalizeSession, linuxPath, shellQuote };
