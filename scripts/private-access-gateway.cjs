'use strict';

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { COOKIE, SESSION_MS, equal, validateConfig, requestBoundary, allowedRoute, readCookie, createSessions } = require('./private-access-policy.cjs');
const escape = value => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const MAX_BODY = 8 * 1024 * 1024;
const MAX_TRANSFORM = 2 * 1024 * 1024;
// Provider catalogs contain large unused option/schema fields before redaction.
// Keep other transforms small and bound both raw catalog input and sanitized output.
const MAX_PROVIDER_INPUT = 16 * 1024 * 1024;
// A full public model catalog can still exceed 2 MiB after redaction.
// This exception is catalog-only; config, agents and HTML keep the smaller limit.
const MAX_PROVIDER_OUTPUT = 8 * 1024 * 1024;
const SECURITY_HEADERS = {
  // Native form POSTs use Origin: null under no-referrer (Fetch Standard).
  // Preserve the exact origin for pairing/logout while suppressing cross-origin referrers.
  'cache-control': 'no-store', 'referrer-policy': 'same-origin', 'x-content-type-options': 'nosniff',
  'x-frame-options': 'DENY', 'strict-transport-security': 'max-age=31536000',
  'permissions-policy': 'microphone=(self), camera=(), geolocation=()',
  'content-security-policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self' data: blob:; font-src 'self'; connect-src 'self'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'"
};

function send(res, status, value, type = 'application/json; charset=utf-8', extra = {}) {
  if (res.destroyed || res.headersSent) return;
  const body = type.startsWith('application/json') ? JSON.stringify(value) : value;
  res.writeHead(status, { ...SECURITY_HEADERS, 'content-type': type, ...extra }); res.end(body);
}

async function body(req, limit) {
  const chunks = []; let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw Error('Request body too large.');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString('utf8');
}

function pairPage(error = '') {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Pair your phone · Seneschal</title><link rel="stylesheet" href="/remote/style.css"></head><body class="remote-pair-page"><main class="remote-pair-card"><p class="remote-kicker">SENESCHAL · PRIVATE ACCESS</p><h1>Connect to your PC</h1><p>Your conversations and tools stay on the PC. Enter the one-time code shown there to connect this browser.</p><form method="post" action="/remote/pair"><label for="device">Browser name</label><input id="device" name="label" maxlength="48" value="My phone" required autocomplete="off"><label for="code">Pairing code</label><input id="code" name="code" required maxlength="24" spellcheck="false" autocomplete="off" autocapitalize="characters" aria-describedby="code-help${error ? ' pair-error' : ''}" ${error ? 'aria-invalid="true" autofocus' : ''}><p id="code-help">Codes expire after 10 minutes and can be used once.</p>${error ? `<p id="pair-error" role="alert">${escape(error)}</p>` : ''}<button type="submit">Pair this browser</button></form><p>Private connection only. Your PC must be awake and running Seneschal. Paired browsers expire after 12 hours.</p></main></body></html>`;
}

const select = (object, keys) => Object.fromEntries(keys.filter(key => object?.[key] !== undefined).map(key => [key, object[key]]));
function permission(value) {
  if (['allow', 'ask', 'deny'].includes(value)) return value;
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, permission(entry)]));
}
function variantNames(value) {
  // The phone selects a name; only the engine needs the private provider options.
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.fromEntries(Object.keys(value).filter(name => /^[a-zA-Z][a-zA-Z0-9_-]{0,39}$/.test(name) && !['constructor', 'prototype'].includes(name)).slice(0, 32).map(name => [name, {}]));
}
function sanitize(pathname, value) {
  if (pathname === '/api/config') return { permission: permission(value.permission), agent: Object.fromEntries(Object.entries(value.agent || {}).map(([name, agent]) => [name, { permission: permission(agent?.permission) }])) };
  if (pathname === '/api/agent') return value.map(agent => ({ ...select(agent, ['name', 'description', 'mode', 'hidden', 'color']), model: select(agent.model, ['providerID', 'modelID']), permission: permission(agent.permission) }));
  if (pathname === '/api/provider') return {
    connected: value.connected || [], default: value.default || {},
    all: (value.all || []).map(provider => ({ ...select(provider, ['id', 'name', 'source']), models: Object.fromEntries(Object.entries(provider.models || {}).map(([id, model]) => [id, { ...select(model, ['id', 'providerID', 'name', 'family', 'release_date', 'status', 'capabilities', 'cost', 'limit']), variants: variantNames(model.variants) }])) }))
  };
  return value;
}

function createGateway({ config: input, upstreamToken, adminKey, state, save, assetDirectory = path.join(__dirname, '..', 'app'), now = Date.now }) {
  const config = validateConfig(input);
  if (!/^[a-zA-Z0-9_-]{32,128}$/.test(upstreamToken || '') || !/^[a-zA-Z0-9_-]{43}$/.test(adminKey || '')) throw Error('Local secrets missing or malformed.');
  const active = new Set();
  function closeSessions(id) { for (const entry of active) if (!id || entry.id === id) { entry.upstream.destroy(); entry.response.destroy(); active.delete(entry); } }
  const sessions = createSessions({ state, save, now, onRevoke: closeSessions });
  const clearCookie = `${COOKIE}=; Secure; HttpOnly; SameSite=Strict; Path=/; Max-Age=0`;
  const server = http.createServer({ maxHeaderSize: 16384, requestTimeout: 30000, headersTimeout: 10000 }, async (req, res) => {
    try {
      // This administration channel is not reachable through the configured HTTPS Host.
      if (req.headers.host === `127.0.0.1:${config.port}` && req.url === '/remote/admin') {
        if (req.method !== 'POST' || !['127.0.0.1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress) || req.headers.origin !== undefined || req.headers['tailscale-user-login'] !== undefined || !equal(req.headers.authorization, `Bearer ${adminKey}`) || req.headers['content-type'] !== 'application/json') return send(res, 403, { error: 'Local administration denied.' });
        const input = JSON.parse(await body(req, 2048));
        if (input.action === 'pair') return send(res, 200, { code: sessions.pairCode(), expiresInMinutes: 10 });
        if (input.action === 'devices') return send(res, 200, { devices: sessions.list() });
        if (input.action === 'revoke' && /^[a-f0-9]{24}$/.test(input.id || '')) { sessions.revoke(input.id); return send(res, 200, { revoked: true }); }
        if (input.action === 'revoke-all') { sessions.revoke(null); return send(res, 200, { revoked: true }); }
        if (input.action === 'disable') {
          sessions.revoke(null); send(res, 200, { disabled: true });
          setImmediate(() => { closeSessions(null); server.close(); server.closeAllConnections(); }); return;
        }
        return send(res, 400, { error: 'Unknown local action.' });
      }
      const route = requestBoundary(req, config);
      if (route.pathname === '/remote/style.css' && req.method === 'GET') return send(res, 200, fs.readFileSync(path.join(assetDirectory, 'private-access.css')), 'text/css; charset=utf-8');
      if (route.pathname === '/remote/pair') {
        if (req.method === 'GET') return send(res, 200, pairPage(), 'text/html; charset=utf-8');
        if (req.method !== 'POST' || req.headers['content-type']?.split(';')[0] !== 'application/x-www-form-urlencoded') return send(res, 415, { error: 'Use the pairing form.' });
        try {
          const fields = new URLSearchParams(await body(req, 2048));
          if (fields.getAll('code').length !== 1 || fields.getAll('label').length > 1) throw Error('Invalid pairing form.');
          const paired = sessions.pair(fields.get('code'), fields.get('label'));
          return send(res, 303, '', 'text/plain', { location: '/', 'set-cookie': `${COOKIE}=${paired.token}; Secure; HttpOnly; SameSite=Strict; Path=/; Max-Age=${SESSION_MS / 1000}` });
        } catch (error) { return send(res, 400, pairPage(error.message), 'text/html; charset=utf-8'); }
      }
      const token = readCookie(req.headers.cookie);
      const session = sessions.authenticate(token);
      if (!session) {
        if (req.method === 'GET' && ['/', '/index.html'].includes(route.pathname)) return send(res, 303, '', 'text/plain', { location: '/remote/pair', 'set-cookie': clearCookie });
        return send(res, 401, { error: 'Phone session expired or revoked. Pair again on the PC.' }, undefined, { 'set-cookie': clearCookie });
      }
      if (route.pathname === '/remote/logout' && req.method === 'POST') {
        sessions.revoke(session.id); return send(res, 303, '', 'text/plain', { location: '/remote/pair', 'set-cookie': clearCookie });
      }
      if (route.pathname === '/remote/status' && req.method === 'GET') return send(res, 200, { host: config.hostname.split('.')[0], expiresAt: session.expiresAt, label: session.label });
      if (route.pathname === '/remote/client.js' && req.method === 'GET') return send(res, 200, fs.readFileSync(path.join(assetDirectory, 'private-access.js')), 'text/javascript; charset=utf-8');
      if (!allowedRoute(req.method, route.pathname)) return send(res, 403, { error: 'This action is PC-only or not enabled for private access.' });
      if (req.headers['content-length'] && (!/^\d+$/.test(req.headers['content-length']) || Number(req.headers['content-length']) > MAX_BODY)) return send(res, 413, { error: 'Maximum remote request size is 8 MiB.' });
      const headers = { host: `127.0.0.1:${config.upstreamPort}`, cookie: `atelier_session=${upstreamToken}`, 'accept-encoding': 'identity' };
      for (const name of ['accept', 'content-type', 'last-event-id']) if (req.headers[name]) headers[name] = req.headers[name];
      if (route.pathname.startsWith('/workspace/nvidia-speech/') && req.headers['x-seneschal-voice-consent'] === 'nvidia-trial-v1') headers['x-seneschal-voice-consent'] = 'nvidia-trial-v1';
      const upstream = http.request({ hostname: '127.0.0.1', port: config.upstreamPort, method: req.method, path: req.url, headers }, response => {
        const responseHeaders = { ...SECURITY_HEADERS };
        for (const name of ['content-type', 'content-disposition']) if (response.headers[name]) responseHeaders[name] = response.headers[name];
        if (response.statusCode >= 300 && response.statusCode < 400) { response.resume(); return send(res, 502, { error: 'An unexpected host redirect was blocked.' }); }
        const html = ['/', '/index.html'].includes(route.pathname);
        const cleanJson = ['/api/config', '/api/agent', '/api/provider'].includes(route.pathname);
        if (html || cleanJson) {
          if (response.headers['content-encoding'] && response.headers['content-encoding'] !== 'identity') { response.destroy(); return send(res, 502, { error: 'Unexpected encoded host response.' }); }
          const inputLimit = route.pathname === '/api/provider' ? MAX_PROVIDER_INPUT : MAX_TRANSFORM;
          const chunks = []; let size = 0;
          response.on('data', chunk => { size += chunk.length; if (size > inputLimit) { response.destroy(); send(res, 502, { error: 'Host response exceeded the safe limit.' }); } else chunks.push(chunk); });
          response.on('end', () => {
            if (!sessions.authenticate(token)) return send(res, 401, { error: 'Session expired.' });
            try {
              let text = Buffer.concat(chunks).toString('utf8');
              if (response.statusCode !== 200) return send(res, 502, { error: 'Host workspace unavailable. Open Seneschal on the PC first.' });
              if (html) {
                // Host-only controls are not a remote asset or an extra allowed route.
                text = text.replace('<link rel="stylesheet" href="/workspace/phone-access.css" />', '').replace('<script src="/workspace/phone-access.js" defer></script>', '');
                if (!/<\/head>/i.test(text) || !/<body[^>]*>/i.test(text) || !/<\/body>/i.test(text)) throw Error('Unexpected workspace document.');
                text = text.replace(/<\/head>/i, '<link rel="stylesheet" href="/remote/style.css"></head>').replace(/<body([^>]*)>/i, `<body$1><header class="remote-host-bar"><span>Private connection · Runs on <strong>${escape(config.hostname.split('.')[0])}</strong></span><form method="post" action="/remote/logout"><button type="submit">Disconnect</button></form></header>`).replace(/<\/body>/i, '<script src="/remote/client.js" defer></script></body>');
                return send(res, 200, text, 'text/html; charset=utf-8');
              }
              const sanitized = sanitize(route.pathname, JSON.parse(text));
              const outputLimit = route.pathname === '/api/provider' ? MAX_PROVIDER_OUTPUT : MAX_TRANSFORM;
              if (Buffer.byteLength(JSON.stringify(sanitized)) > outputLimit) return send(res, 502, { error: 'Filtered host response exceeded the safe limit.' });
              return send(res, 200, sanitized);
            } catch { send(res, 502, { error: 'Unexpected host response.' }); }
          });
          response.on('error', () => send(res, 502, { error: 'Host response interrupted.' }));
        } else {
          res.writeHead(response.statusCode, responseHeaders); response.pipe(res);
          response.on('error', () => res.destroy());
        }
      });
      const entry = { id: session.id, token, upstream, response: res }; active.add(entry);
      res.on('close', () => { active.delete(entry); upstream.destroy(); });
      upstream.on('error', () => { if (res.headersSent) res.destroy(); else send(res, 502, { error: 'PC workspace unavailable. Open Seneschal on the PC first.' }); });
      let received = 0;
      req.on('data', chunk => { received += chunk.length; if (received > MAX_BODY) { upstream.destroy(); send(res, 413, { error: 'Maximum remote request size is 8 MiB.' }); } });
      req.on('aborted', () => upstream.destroy());
      req.pipe(upstream);
    } catch { send(res, 403, { error: 'Private access denied. Check the account, address and request origin.' }); }
  });
  // The first milestone supports HTTP + SSE, not arbitrary raw engine upgrades.
  server.on('upgrade', (_req, socket) => socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n'));
  server.on('clientError', (_error, socket) => socket.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n'));
  const expiry = setInterval(() => { for (const entry of active) if (!sessions.authenticate(entry.token)) { entry.upstream.destroy(); entry.response.destroy(); active.delete(entry); } }, 1000);
  expiry.unref(); server.on('close', () => { clearInterval(expiry); closeSessions(null); });
  return { server, sessions, listen: () => new Promise((resolve, reject) => { server.once('error', reject); server.listen(config.port, '127.0.0.1', resolve); }) };
}

module.exports = { createGateway, pairPage, sanitize };
