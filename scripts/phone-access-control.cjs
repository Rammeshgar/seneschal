'use strict';

// The workspace server authenticates its launcher cookie before invoking this module.
// A second, exact local-origin boundary keeps these controls off the remote surface.
const PREFIX = '/workspace/phone-access';
const ACTIONS = new Set(['start', 'pair', 'stop', 'revoke']);
function localBoundary(req, port) {
  const expectedHost = `127.0.0.1:${port}`, expectedOrigin = `http://${expectedHost}`;
  const counts = new Map();
  for (let i = 0; i < (req.rawHeaders || []).length; i += 2) {
    const name = req.rawHeaders[i].toLowerCase(); counts.set(name, (counts.get(name) || 0) + 1);
  }
  if (['host', 'origin', 'cookie', 'content-type', 'authorization'].some(name => (counts.get(name) || 0) > 1)
      || !['127.0.0.1', '::ffff:127.0.0.1'].includes(req.socket?.remoteAddress)
      || req.headers.host !== expectedHost || req.headers['tailscale-user-login'] !== undefined
      || req.headers['content-encoding'] !== undefined
      || (req.headers.origin !== undefined && req.headers.origin !== expectedOrigin)) throw Error('Open these controls from Seneschal on this PC.');
  if (req.method === 'GET' && req.url === `${PREFIX}/status`) return 'status';
  const action = req.url?.startsWith(`${PREFIX}/`) ? req.url.slice(PREFIX.length + 1) : '';
  if (req.method !== 'POST' || !ACTIONS.has(action) || req.headers.origin !== expectedOrigin
      || req.headers['content-type'] !== 'application/json') throw Error('PC-only, same-origin JSON action required.');
  return action;
}

async function readInput(req) {
  const parts = []; let size = 0;
  for await (const chunk of req) {
    size += chunk.length; if (size > 1024) throw Error('Phone access request is too large.'); parts.push(chunk);
  }
  const value = JSON.parse(Buffer.concat(parts).toString('utf8'));
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error('Invalid phone access request.');
  return value;
}

function createPhoneAccessControl({ port = 4196, control = require('./private-access.cjs') } = {}) {
  let owned = null, busy = false, disposed = false;
  const admin = (action, id) => control.administer(action, id, { quiet: true });
  async function probe() {
    try { return { running: true, devices: (await admin('devices')).devices }; }
    catch (error) { if (error.code === 'ECONNREFUSED') return { running: false, devices: [] }; throw error; }
  }
  async function status() {
    let config;
    try { config = control.preparedConfig(); }
    catch { return { state: 'needs-setup', qualified: false, devices: [], message: 'Private settings are missing or unreadable. Complete the existing PC setup guide; do not overwrite them.' }; }
    let qualified = true;
    try { control.requireQualification(); } catch { qualified = false; }
    const base = { qualified, url: config.origin + '/', pairingMinutes: 10, browserHours: 12, busy };
    if (config.upstreamPort !== port) return { ...base, state: 'blocked', devices: [], message: 'The configured private host uses a different workspace port. Review the PC settings before starting.' };
    try {
      const result = await probe();
      // Explicit projection: no tokens, hashes, settings, owner email or admin key.
      const devices = result.devices.map(({ id, label, expiresAt }) => ({ id, label, expiresAt }));
      return { ...base, state: result.running ? 'running' : 'stopped', devices,
        message: !qualified ? 'Files changed since verification. Starting or pairing is blocked until the isolated PC verifier passes; stopping a running gateway is still available.' : result.running ? 'Closing this browser window leaves the PC host running. The PC must stay awake and connected.' : 'Gateway stopped. Previously paired browsers may remain valid until expiry. Start access, then use Stop phone access to revoke them.' };
    } catch { return { ...base, state: 'unknown', devices: [], message: 'Could not authenticate the gateway. No process was stopped. Use its original PC terminal to inspect or stop it.' }; }
  }
  async function act(action, input = {}) {
    if (disposed || busy) throw Error('Phone access is busy. Refresh its status before trying again.');
    if (!ACTIONS.has(action) || Object.keys(input).some(key => action !== 'revoke' || key !== 'id')
        || (action === 'revoke' && !/^[a-f0-9]{24}$/.test(input.id || ''))) throw Error('Invalid phone access action.');
    busy = true;
    try {
      const config = control.preparedConfig();
      if (config.upstreamPort !== port) throw Error('The configured workspace port does not match this PC host.');
      if (action === 'start' || action === 'pair') control.requireQualification();
      if (action === 'start') {
        const current = await probe();
        if (!current.running) {
          const gateway = await control.start({ quiet: true });
          if (disposed) { gateway.server.close(); gateway.server.closeAllConnections(); throw Error('Phone access is busy. The PC host is stopping.'); }
          owned = gateway;
          gateway.server.once('close', () => { if (owned === gateway) owned = null; });
        }
        return { started: true, message: 'Gateway running. The existing private Serve mapping is unchanged. No Windows startup service was installed.' };
      }
      if (action === 'pair') return await admin('pair');
      if (action === 'revoke') return await admin('revoke', input.id);
      // Disable authenticates the gateway before revoking or stopping it.
      // A refused/unknown service is not treated as a successful durable revocation.
      await admin('disable');
      return { stopped: true, message: 'Phone access stopped. All paired browsers and unused codes revoked. PC tasks and history are unchanged; the private Serve mapping remains.' };
    } finally { busy = false; }
  }
  async function handle(req, send) {
    let action;
    try { action = localBoundary(req, port); } catch (error) { send(403, { error: error.message }); return; }
    try {
      if (action === 'status') return send(200, await status());
      send(200, await act(action, await readInput(req)));
    } catch (error) {
      // Never return filesystem/Tailscale output or secret-bearing unexpected errors.
      const known = /^(Phone access is busy|Invalid phone access|The configured workspace|Private-access files changed|Private access is unqualified|Invalid private-access qualification|Cannot read the local Tailscale|The Tailscale host\/account changed|Existing Serve configuration|Public Funnel configuration|Private gateway is not reachable|Device limit reached)/;
      send(409, { error: error.code === 'EADDRINUSE' ? 'Gateway port is occupied. No existing process was stopped.' : known.test(error.message) ? error.message : 'Phone access action failed. Check the PC gateway and verification status; no unrelated process was stopped.' });
    }
  }
  function dispose() {
    disposed = true;
    // Only the gateway created by this host is owned here. Shutdown preserves cookies.
    // A close listener can clear ownership or re-enter disposal. Detach first and
    // keep a stable local reference for both cleanup steps.
    const gateway = owned;
    owned = null;
    if (gateway) {
      try { gateway.server.close(); }
      finally { gateway.server.closeAllConnections(); }
    }
  }
  return { status, act, handle, dispose };
}
module.exports = { createPhoneAccessControl, localBoundary };
