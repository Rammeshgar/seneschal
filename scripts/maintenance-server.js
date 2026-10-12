"use strict";
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');
function version(value) { return String(value).replace(/^v/, '').match(/^(\d+)\.(\d+)\.(\d+)(?:-beta\.(\d+))?$/)?.slice(1).map((n, i) => n === undefined ? (i === 3 ? Infinity : 0) : Number(n)); }
function newer(a, b) { a = version(a); b = version(b); if (!a || !b) return false; for (let i = 0; i < a.length; i++) { if (a[i] !== b[i]) return a[i] > b[i]; } return false; }
function createMaintenance({ root, distribution, linuxHome, shutdown, fetcher = fetch, wslRunner }) {
  const current = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version;
  let selected = null, updating = false, trail = null;
  let engineUpdating = false;
  function runWsl(script) {
    if (wslRunner) return wslRunner(script);
    return new Promise((resolve, reject) => {
      // Match the engine launcher's interactive shell so ~/.bashrc adds OpenCode to PATH.
      const child = spawn('wsl.exe', ['-d', distribution, '--', 'bash', '-is'], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
      let output = ''; let errors = '';
      const timer = setTimeout(() => { child.kill(); reject(new Error('OpenCode operation timed out. Check WSL connectivity before retrying.')); }, 180000);
      child.stdout.on('data', data => { output = (output + data).slice(-16000); });
      child.stderr.on('data', data => { errors = (errors + data).slice(-16000); });
      child.on('error', error => { clearTimeout(timer); reject(error); });
      child.on('close', code => { clearTimeout(timer); code === 0 ? resolve(output.trim()) : reject(new Error((errors || output || `WSL exited with ${code}`).replace(/\u0000/g, '').slice(-1500))); });
      child.stdin.on('error', () => {}); child.stdin.end(script + '\n');
    });
  }
  async function engineCheck() {
    const installed = (await runWsl('opencode --version')).match(/\b\d+\.\d+\.\d+\b/)?.[0];
    if (!installed) throw new Error('Could not determine installed OpenCode version.');
    const response = await fetcher('https://api.github.com/repos/anomalyco/opencode/releases?per_page=100', { headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'Seneschal-updater' }, signal: AbortSignal.timeout(15000) });
    if (!response.ok) throw new Error(`OpenCode release check failed (${response.status}).`);
    const releases = (await response.json()).filter(r => !r.draft && !r.prerelease && /^v\d+\.\d+\.\d+$/.test(r.tag_name)).sort((a,b) => newer(a.tag_name,b.tag_name) ? -1 : 1);
    const major = installed.split('.')[0];
    const compatible = releases.find(r => r.tag_name.slice(1).split('.')[0] === major);
    if (!compatible) throw new Error('No stable release found for your OpenCode major version. No update was selected.');
    return { current: installed, version: compatible.tag_name, latest: releases[0]?.tag_name, available: newer(compatible.tag_name, installed), notes: compatible.body || '' };
  }
  async function engineUpdate() {
    if (engineUpdating) throw new Error('An OpenCode update is already running.');
    engineUpdating = true;
    try {
      const info = await engineCheck();
      if (!info.available) return { message: 'No newer stable OpenCode release is available on your current major version.' };
      // The target comes only from validated official release metadata, never client input.
      await runWsl(`set -e\nopencode upgrade ${info.version}`);
      const installed = await runWsl('opencode --version');
      if (!installed.includes(info.version.slice(1))) throw new Error('Upgrade returned but the installed version did not change. Check your OpenCode installation method.');
      return { message: `OpenCode ${info.version} installed. Restart Seneschal’s engine to activate it; Windows does not need restarting. Existing running processes may still report the previous version.`, current: info.version };
    } finally { engineUpdating = false; }
  }
  async function check() {
    const response = await fetcher('https://api.github.com/repos/Rammeshgar/seneschal/releases?per_page=30', { headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'Seneschal-updater' }, signal: AbortSignal.timeout(15000) });
    if (!response.ok) throw new Error(`GitHub update check failed (${response.status}). Try again later.`);
    const releases = await response.json();
    selected = releases.filter(r => !r.draft && newer(r.tag_name, current)).sort((a, b) => newer(a.tag_name, b.tag_name) ? -1 : 1)[0] || null;
    const asset = selected?.assets?.find(a => /^seneschal.*\.zip$/i.test(a.name) && /^sha256:[a-f0-9]{64}$/i.test(a.digest || ''));
    return { current, available: !!selected, version: selected?.tag_name || current, notes: selected?.body || '', installable: !!asset && !fs.existsSync(path.join(root, '.git')), message: selected && !asset ? 'This release needs a ZIP asset with a GitHub SHA-256 digest before automatic installation is available.' : fs.existsSync(path.join(root, '.git')) ? 'Source checkout: use Git to update; automatic installation is reserved for installed copies.' : '' };
  }
  async function update() {
    if (updating) throw new Error('An update is already in progress.');
    const info = await check();
    if (!info.available || !info.installable) throw new Error(info.message || 'No newer installable release.');
    updating = true;
    try {
      const asset = selected.assets.find(a => /^seneschal.*\.zip$/i.test(a.name) && /^sha256:[a-f0-9]{64}$/i.test(a.digest || ''));
      const url = new URL(asset.browser_download_url);
      if (url.protocol !== 'https:' || url.hostname !== 'github.com' || !url.pathname.startsWith('/Rammeshgar/seneschal/releases/download/')) throw new Error('Untrusted release download.');
      if (asset.size > 200 * 1024 * 1024) throw new Error('Release exceeds the 200 MB update limit.');
      const response = await fetcher(url, { signal: AbortSignal.timeout(120000) });
      if (!response.ok) throw new Error(`Download failed (${response.status}).`);
      const chunks = []; let size = 0;
      for await (const chunk of response.body) { size += chunk.length; if (size > 200 * 1024 * 1024) throw new Error('Release is too large.'); chunks.push(Buffer.from(chunk)); }
      const bytes = Buffer.concat(chunks);
      if (crypto.createHash('sha256').update(bytes).digest('hex') !== asset.digest.slice(7).toLowerCase()) throw new Error('Release checksum does not match. No files were changed.');
      const folder = fs.mkdtempSync(path.join(root, 'data', 'update-'));
      const zip = path.join(folder, 'release.zip'); fs.writeFileSync(zip, bytes);
      const child = spawn('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(root, 'scripts', 'apply-update.ps1'), '-Root', root, '-Archive', zip, '-ServerPID', String(process.pid)], { detached: true, stdio: 'ignore', windowsHide: true });
      await new Promise((resolve, reject) => { child.once('spawn', resolve); child.once('error', reject); }); child.unref();
      setTimeout(() => shutdown(0), 1500);
      return { message: 'Verified download. Seneschal will restart after installation. A backup and update log are kept in data.' };
    } catch (error) { updating = false; throw error; }
  }
  async function startTrail() {
    if (trail && trail.exitCode === null && !trail.killed) return { url: 'http://localhost:3030', message: 'Agent Trail is already running. It may still be indexing.' };
    // Fixed script; no shell text or project paths are accepted from the browser.
    const preload = fs.readFileSync(path.join(root, 'scripts', 'agent-trail-loopback.cjs')).toString('base64');
const command = 'set -e; test "$(node --version | cut -d. -f1 | tr -d v)" -ge 22 || { echo "Agent Trail needs Node 22+ in WSL" >&2; exit 1; }; mkdir -p "$HOME/.local/share/seneschal-agent-trail"; cd "$HOME/.local/share/seneschal-agent-trail"; if ! test -f node_modules/.bin/agent-trail; then npm install --no-audit --no-fund @camtrik/agent-trail@0.1.7; fi; ' + `node -e "require('fs').writeFileSync('loopback.cjs', Buffer.from('${preload}', 'base64'))"; ` + 'export NODE_OPTIONS="--require $(pwd)/loopback.cjs" HOSTNAME=127.0.0.1 PORT=3030 INGEST_PORT=8078 NEXT_TELEMETRY_DISABLED=1; export OPENCODE_DB_PATH="$HOME/.local/share/opencode/opencode.db"; exec ./node_modules/.bin/agent-trail';
    const logPath = path.join(root, 'data', 'agent-trail.log');
    const logOffset = fs.existsSync(logPath) ? fs.statSync(logPath).size : 0;
    const output = fs.openSync(logPath, 'a');
    // Stream the script verbatim: Windows/WSL argument quoting must not rewrite it.
    try { trail = spawn('wsl.exe', ['-d', distribution, '--', 'bash', '-ls'], { stdio: ['pipe', output, output], windowsHide: true }); }
    finally { fs.closeSync(output); }
    const child = trail;
    child.stdin.on('error', () => {});
    child.stdin.end(command + '\n');
    try { await new Promise((resolve, reject) => { child.once('spawn', resolve); child.once('error', reject); }); }
    catch (error) { trail = null; throw error; }
    for (let attempt = 0; attempt < 60; attempt++) {
      if (child.exitCode !== null) {
        const recent = fs.readFileSync(logPath).subarray(logOffset).toString('utf8').replace(/\u0000/g, '');
        const detail = recent.split(/\r?\n/).find(line => line.trim() && !line.includes('base64'))?.slice(0, 240);
        throw new Error(`Agent Trail could not start: ${detail || 'No startup details were returned.'} Full log: ${logPath}`);
      }
      try { const r = await fetch('http://127.0.0.1:3030', { signal: AbortSignal.timeout(500) }); if (r.ok) return { url: 'http://localhost:3030', message: 'Dashboard ready. Select OpenCode to inspect Seneschal sessions.' }; } catch {}
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
    return { url: 'http://localhost:3030', message: `Installation/indexing continues. Retry shortly; progress is in ${logPath}.` };
  }
  return { check, update, startTrail, engineCheck, engineUpdate };
}
module.exports = { createMaintenance, newer };
