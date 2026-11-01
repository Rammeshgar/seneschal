'use strict';

const crypto = require('node:crypto');
const COOKIE = '__Host-seneschal_remote';
const SESSION_MS = 12 * 60 * 60 * 1000;
const PAIR_MS = 10 * 60 * 1000;
const digest = value => crypto.createHash('sha256').update(value).digest('hex');
const equal = (a, b) => {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const left = Buffer.from(a), right = Buffer.from(b);
  return left.length === right.length && crypto.timingSafeEqual(left, right);
};

function validateConfig(input) {
  if (!input || !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.[a-z0-9-]+\.ts\.net$/.test(input.hostname || '')) throw Error('An exact Tailscale DNS hostname is required.');
  if (!/^[a-z0-9._%+-]+@(gmail|googlemail)\.com$/.test(input.owner || '')) throw Error('An exact owner Gmail identity is required.');
  for (const name of ['port', 'upstreamPort']) if (!Number.isInteger(input[name]) || input[name] < 1024 || input[name] > 65535) throw Error('Invalid loopback port.');
  if (input.port === input.upstreamPort) throw Error('Gateway and workspace ports must differ.');
  return { hostname: input.hostname, owner: input.owner, port: input.port, upstreamPort: input.upstreamPort, origin: `https://${input.hostname}` };
}

function requestPath(raw) {
  if (typeof raw !== 'string' || raw.length > 8192 || !raw.startsWith('/') || raw.startsWith('//') || raw.includes('#')) throw Error('Invalid request target.');
  const path = raw.split('?')[0];
  const decoded = decodeURIComponent(path);
  // Do not let URL normalization hide traversal or encoded separators from the route policy.
  if (/[\\\x00-\x20\x7f%]/.test(decoded) || /%2f/i.test(path) || decoded.split('/').some(part => part === '.' || part === '..') || decoded.includes('//')) throw Error('Ambiguous request path.');
  const url = new URL(raw, 'https://invalid.example');
  for (const key of url.searchParams.keys()) if (key.toLowerCase() === 'access') throw Error('Launcher tokens are not accepted remotely.');
  return { pathname: decoded, search: url.search };
}

function requestBoundary(req, config) {
  const counts = new Map();
  for (let i = 0; i < (req.rawHeaders || []).length; i += 2) {
    const name = req.rawHeaders[i].toLowerCase();
    counts.set(name, (counts.get(name) || 0) + 1);
  }
  for (const name of ['host', 'origin', 'tailscale-user-login', 'cookie', 'content-type', 'authorization']) if ((counts.get(name) || 0) > 1) throw Error('Duplicate security header.');
  if (!['127.0.0.1', '::ffff:127.0.0.1'].includes(req.socket?.remoteAddress)) throw Error('Loopback transport required.');
  if (req.headers.host !== config.hostname && req.headers.host !== `${config.hostname}:443`) throw Error('Unexpected host.');
  if (typeof req.headers['tailscale-user-login'] !== 'string' || req.headers['tailscale-user-login'].toLowerCase() !== config.owner) throw Error('This account is not allowed.');
  if (!['GET', 'POST', 'PATCH', 'DELETE'].includes(req.method)) throw Error('Unsupported method.');
  if (req.headers.origin && req.headers.origin !== config.origin) throw Error('Unexpected origin.');
  if (req.method !== 'GET' && req.headers.origin !== config.origin) throw Error('Same-origin request required.');
  if (req.headers['content-encoding']) throw Error('Encoded request bodies are not supported.');
  return requestPath(req.url);
}

function allowedRoute(method, pathname) {
  if (method === 'GET' && /^\/workspace\/(?:wallpapers\.(?:js|css)|wallpapers\/(?:legacy-worlds|citylight-world|afterlight-worlds|afterlight-engine)\.js)$/.test(pathname)) return true;
  if (method === 'GET' && /^\/workspace\/(?:ares(?:-scene)?\.js|ares\.css|assets\/ares\/(?:ares\.glb|three\.module\.js|GLTFLoader\.js|BufferGeometryUtils\.js))$/.test(pathname)) return true;
  if (method === 'GET' && pathname === '/workspace/nvidia-speech.js') return true;
  if (method === 'GET' && pathname === '/workspace/nvidia-speech/status') return true;
  if (method === 'POST' && /^\/workspace\/nvidia-speech\/(?:voices|transcribe|speak)$/.test(pathname)) return true;
  if (method === 'GET' && (['/', '/index.html'].includes(pathname) || /^\/workspace\/(?:styles\.css|app\.js|markdown\.js|maintenance\.js|activity\.js|activity\.css|questions\.js|questions\.css|favicon(?:\.svg|\.ico|-32\.png)|icon-192\.png)$/.test(pathname) || /^\/workspace\/assets\/[a-zA-Z0-9/_ .-]+\.(?:png|jpe?g|webp|gif|svg|mp4|webm|ico)$/.test(pathname))) return true;
  const workspace = {
    '/workspace/session-projects': ['GET', 'POST'], '/workspace/approval-policy': ['GET'],
    '/workspace/instructions': ['GET'], '/workspace/blender-health': ['GET'], '/workspace/vscode': ['GET'],
    '/workspace/browser-mode': ['GET'], '/workspace/usage': ['GET'], '/workspace/agent-board': ['GET', 'POST'],
    '/workspace/agent-board/history': ['GET'], '/workspace/activity': ['GET'], '/workspace/activity/status': ['GET'],
    '/workspace/activity/overview': ['GET'], '/workspace/activity/lookup': ['GET'], '/workspace/activity/sessions': ['GET'],
    '/workspace/activity/search': ['GET']
  };
  if (workspace[pathname]?.includes(method)) return true;
  if (method === 'GET' && /^\/workspace\/activity\/sessions\/[a-zA-Z0-9:_-][a-zA-Z0-9:_.-]{0,255}(?:\/(?:turns|messages))?$/.test(pathname)) return true;
  if (method === 'GET' && ['/api/global/health', '/api/path', '/api/session', '/api/session/status', '/api/provider', '/api/config', '/api/agent', '/api/experimental/tool/ids', '/api/permission', '/api/mcp', '/api/command', '/api/event'].includes(pathname)) return true;
  if (method === 'POST' && pathname === '/api/session') return true;
  if (method === 'GET' && pathname === '/api/question') return true;
  if (/^\/api\/question\/[a-zA-Z0-9_-]{1,256}\/(?:reply|reject)$/.test(pathname)) return method === 'POST';
  if (/^\/api\/session\/ses[a-zA-Z0-9_-]{1,253}$/.test(pathname)) return ['GET', 'PATCH', 'DELETE'].includes(method);
  if (/^\/api\/session\/ses[a-zA-Z0-9_-]{1,253}\/message$/.test(pathname)) return method === 'GET';
  if (/^\/api\/session\/ses[a-zA-Z0-9_-]{1,253}\/(?:prompt_async|command|abort|revert)$/.test(pathname)) return method === 'POST';
  if (/^\/api\/permission\/[a-zA-Z0-9_-]{1,256}\/reply$/.test(pathname) || /^\/api\/session\/ses[a-zA-Z0-9_-]{1,253}\/permissions\/[a-zA-Z0-9_-]{1,256}$/.test(pathname)) return method === 'POST';
  return false;
}

function readCookie(value) {
  const entries = String(value || '').split(';').map(item => item.trim()).filter(item => item.startsWith(`${COOKIE}=`));
  if (entries.length !== 1) return '';
  const token = entries[0].slice(COOKIE.length + 1);
  return /^[a-zA-Z0-9_-]{43}$/.test(token) ? token : '';
}

function createSessions({ state = { version: 1, sessions: [], pairing: null }, save = () => {}, now = Date.now, onRevoke = () => {} } = {}) {
  const validHash = value => /^[a-f0-9]{64}$/.test(value || '');
  const validSession = item => item && /^[a-f0-9]{24}$/.test(item.id || '') && validHash(item.hash) && typeof item.label === 'string' && item.label.length <= 48 && Number.isSafeInteger(item.createdAt) && Number.isSafeInteger(item.expiresAt) && item.expiresAt > item.createdAt && item.expiresAt - item.createdAt <= SESSION_MS;
  if (state.version !== 1 || !Array.isArray(state.sessions) || state.sessions.length > 4 || !state.sessions.every(validSession) || new Set(state.sessions.map(s => s.id)).size !== state.sessions.length) throw Error('Invalid remote session store.');
  if (state.pairing !== null && (!state.pairing || !validHash(state.pairing.hash) || !Number.isSafeInteger(state.pairing.expiresAt) || !Number.isInteger(state.pairing.attempts) || state.pairing.attempts < 0 || state.pairing.attempts > 5)) throw Error('Invalid pairing store.');
  state = structuredClone(state);
  let healthy = true;
  function commit(next) {
    if (!healthy) throw Error('Remote session storage unavailable.');
    try { save(next); state = next; } catch { healthy = false; onRevoke(null); throw Error('Remote session storage unavailable.'); }
  }
  function authenticate(token) {
    if (!healthy || !token) return null;
    return state.sessions.find(item => equal(item.hash, digest(token)) && item.expiresAt > now()) || null;
  }
  function pairCode() {
    const code = crypto.randomBytes(10).toString('hex').toUpperCase();
    commit({ ...state, pairing: { hash: digest(code), expiresAt: now() + PAIR_MS, attempts: 0 } });
    return code.match(/.{4}/g).join('-');
  }
  function pair(code, label) {
    const pending = state.pairing;
    const normalized = String(code || '').replace(/-/g, '').toUpperCase();
    if (!healthy || !pending || pending.expiresAt <= now() || pending.attempts >= 5) throw Error('Pairing code invalid or expired. Request a new code on the PC.');
    if (!/^[A-F0-9]{20}$/.test(normalized) || !equal(pending.hash, digest(normalized))) {
      commit({ ...state, pairing: { ...pending, attempts: pending.attempts + 1 } });
      throw Error('Pairing code invalid or expired. Request a new code on the PC.');
    }
    const sessions = state.sessions.filter(item => item.expiresAt > now());
    if (sessions.length >= 4) throw Error('Device limit reached. Revoke an old browser on the PC.');
    const token = crypto.randomBytes(32).toString('base64url');
    const cleanLabel = String(label || 'Phone browser').replace(/[\x00-\x1f\x7f]/g, '').trim().slice(0, 48) || 'Phone browser';
    const issuedAt = now();
    const session = { id: crypto.randomBytes(12).toString('hex'), hash: digest(token), label: cleanLabel, createdAt: issuedAt, expiresAt: issuedAt + SESSION_MS };
    commit({ version: 1, sessions: [...sessions, session], pairing: null });
    return { token, session };
  }
  function revoke(id) {
    commit({ ...state, sessions: id ? state.sessions.filter(item => item.id !== id) : [], pairing: id ? state.pairing : null });
    onRevoke(id || null);
  }
  return { authenticate, pairCode, pair, revoke, list: () => state.sessions.filter(s => s.expiresAt > now()).map(({ hash, ...item }) => item) };
}

module.exports = { COOKIE, SESSION_MS, PAIR_MS, digest, equal, validateConfig, requestPath, requestBoundary, allowedRoute, readCookie, createSessions };
