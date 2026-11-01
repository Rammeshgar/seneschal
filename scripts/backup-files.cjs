'use strict';
// No archive extraction or executable recovery. Every payload path is allowlisted.
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const MAX_FILE = 1024 * 1024 * 1024, MAX_TOTAL = MAX_FILE + 64 * 1024 * 1024, MAX_FILES = 512;
const ID = /^backup-\d{8}T\d{9}Z-[a-f0-9]{16}$/;
function ordinary(filename, directory = false) {
  const stat = fs.lstatSync(filename);
  if (stat.isSymbolicLink() || (directory ? !stat.isDirectory() : !stat.isFile() || stat.nlink !== 1)) throw Error('Backup requires ordinary, unlinked files and folders.');
  return stat;
}
function ancestors(filename) {
  let current = path.resolve(filename);
  for (;;) { ordinary(current, true); const next = path.dirname(current); if (next === current) break; current = next; }
}
function confirmReadIdentity(filename, before, opened, platform = process.platform) {
  if (!opened.isFile() || opened.nlink !== 1 || opened.size !== before.size || opened.ino !== before.ino) throw Error('Backup input changed while opening.');
  if (opened.dev === before.dev) return;
  // Windows path-based metadata can report zero for unavailable volume info.
  // Do not simply ignore the mismatch: compare two independent open handles.
  if (platform !== 'win32' || before.dev !== 0 || opened.dev === 0) throw Error('Backup input changed while opening (device).');
  ancestors(path.dirname(filename));
  const current = ordinary(filename);
  if (current.ino !== before.ino || current.size !== before.size || (current.dev !== 0 && current.dev !== opened.dev)) throw Error('Backup input changed while confirming identity.');
  const second = fs.openSync(filename, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
  try {
    const anchor = fs.fstatSync(second), after = ordinary(filename);
    if (!anchor.isFile() || anchor.nlink !== 1 || anchor.size !== opened.size || anchor.ino !== opened.ino || anchor.dev !== opened.dev || after.ino !== before.ino || after.size !== before.size || (after.dev !== 0 && after.dev !== opened.dev)) throw Error('Backup input identity could not be confirmed.');
  } finally { fs.closeSync(second); }
}
function read(filename, limit = 2 * 1024 * 1024) {
  const stat = ordinary(filename);
  if (stat.size > limit) throw Error('Backup input exceeds its safe size limit.');
  const fd = fs.openSync(filename, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
  try {
    const opened = fs.fstatSync(fd);
    confirmReadIdentity(filename, stat, opened);
    const bytes = Buffer.alloc(stat.size + 1), count = fs.readSync(fd, bytes, 0, bytes.length, 0), after = fs.fstatSync(fd);
    if (count !== stat.size || after.size !== stat.size || after.mtimeMs !== opened.mtimeMs) throw Error('Backup input changed while reading.');
    return bytes.subarray(0, count);
  } finally { fs.closeSync(fd); }
}
function parseJSON(bytes) {
  try {
    // Windows tools commonly emit UTF-8 BOM or explicitly marked UTF-16 JSON.
    // Decode strictly, strip only the encoding marker, and never repair invalid JSON.
    const encoding = bytes[0] === 255 && bytes[1] === 254 ? 'utf-16le' : bytes[0] === 254 && bytes[1] === 255 ? 'utf-16be' : 'utf-8';
    return JSON.parse(new TextDecoder(encoding, { fatal: true }).decode(bytes));
  } catch { throw Error('Backup JSON could not be decoded or parsed safely.'); }
}
function readJSON(filename, limit) { return parseJSON(read(filename, limit)); }
function hash(filename) {
  ordinary(filename); const fd = fs.openSync(filename, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
  try {
    const before = fs.fstatSync(fd); if (!before.isFile() || before.nlink !== 1 || before.size > MAX_FILE) throw Error('Invalid backup payload.');
    const digest = crypto.createHash('sha256'), buffer = Buffer.alloc(65536); let total = 0, count;
    while ((count = fs.readSync(fd, buffer, 0, buffer.length, null))) { total += count; if (total > before.size) throw Error('Backup payload changed.'); digest.update(buffer.subarray(0, count)); }
    const after = fs.fstatSync(fd);
    if (total !== before.size || after.size !== before.size || after.mtimeMs !== before.mtimeMs) throw Error('Backup payload changed.');
    return { bytes: total, sha256: digest.digest('hex') };
  } finally { fs.closeSync(fd); }
}
function allowed(name) {
  return typeof name === 'string' && !name.split('/').some(part => /^(con|prn|aux|nul|com[1-9]|lpt[1-9])\./i.test(part)) && /^(history\/opencode\.db|engine\/(model-preferences\.json|AGENTS\.md|GENERAL\.md)|seneschal\/(settings\.json|activity-preferences\.json|session-projects\.json|agent-board\.json)|seneschal\/(instructions|agent-board-history)\/[a-zA-Z0-9_-]{1,100}\.(md|json))$/.test(name);
}
function payloadPath(root, name) {
  if (!allowed(name)) throw Error('Unexpected backup payload path.');
  const filename = path.join(root, ...name.split('/'));
  ancestors(path.dirname(filename)); return filename;
}
function write(root, name, bytes) {
  if (!allowed(name)) throw Error('Unexpected backup payload path.');
  ancestors(root);
  let directory = root;
  for (const component of name.split('/').slice(0, -1)) { directory = path.join(directory, component); if (!fs.existsSync(directory)) fs.mkdirSync(directory, { mode: 0o700 }); ordinary(directory, true); }
  fs.writeFileSync(path.join(root, ...name.split('/')), bytes, { flag: 'wx', mode: 0o600 });
}
function list(root, prefix = '') {
  ordinary(root, true); const files = [];
  const entries = fs.readdirSync(root); if (entries.length > MAX_FILES) throw Error('Too many backup entries.');
  for (const entry of entries) {
    const full = path.join(root, entry), relative = prefix + entry;
    const stat = fs.lstatSync(full);
    if (stat.isDirectory() && !stat.isSymbolicLink()) {
      if (!['history', 'engine', 'seneschal', 'seneschal/instructions', 'seneschal/agent-board-history'].includes(relative)) throw Error('Unexpected backup directory.');
      files.push(...list(full, relative + '/'));
    }
    else { ordinary(full); files.push(relative); }
    if (files.length > MAX_FILES) throw Error('Too many backup files.');
  }
  return files.sort();
}
function manifest(root, id) {
  if (!ID.test(id)) throw Error('Invalid backup ID.');
  let total = 0;
  const files = list(root).map(name => { if (!allowed(name)) throw Error('Unexpected backup payload.'); const detail = hash(payloadPath(root, name)); total += detail.bytes; return { name, ...detail }; });
  if (total > MAX_TOTAL || !files.some(f => f.name === 'history/opencode.db')) throw Error('Backup is incomplete or too large.');
  return { version: 1, id, createdAt: new Date().toISOString(), private: true, credentialStoresIncluded: false, warning: 'History and instructions are private, unredacted content and may contain pasted secrets. Not a shareable export.', files };
}
function verify(root, expectedID) {
  ancestors(root);
  const value = readJSON(path.join(root, 'manifest.json'), 256 * 1024);
  if (value.version !== 1 || !ID.test(value.id) || (expectedID && value.id !== expectedID) || value.private !== true || value.credentialStoresIncluded !== false || !Array.isArray(value.files) || value.files.length > MAX_FILES) throw Error('Invalid backup manifest.');
  const actual = list(root).filter(name => name !== 'manifest.json'), names = value.files.map(file => file.name);
  if (names.some(name => !allowed(name)) || new Set(names.map(name => name.toLowerCase())).size !== names.length || JSON.stringify([...names].sort()) !== JSON.stringify(actual) || !names.includes('history/opencode.db')) throw Error('Backup contents do not match its manifest.');
  let total = 0;
  for (const file of value.files) {
    if (!Number.isSafeInteger(file.bytes) || file.bytes < 0 || file.bytes > MAX_FILE || !/^[a-f0-9]{64}$/.test(file.sha256)) throw Error('Invalid backup file metadata.');
    const detail = hash(payloadPath(root, file.name)); total += detail.bytes;
    if (detail.bytes !== file.bytes || detail.sha256 !== file.sha256 || total > MAX_TOTAL) throw Error('Backup integrity check failed.');
  }
  return value;
}
function settings(value) {
  const result = {};
  for (const key of ['wslDistribution', 'wslLinuxHome', 'launchDirectory', 'blenderExecutable']) if (typeof value?.[key] === 'string' && value[key].length <= 4096) result[key] = value[key];
  return result;
}
module.exports = { ID, MAX_FILE, ordinary, ancestors, confirmReadIdentity, read, parseJSON, readJSON, hash, allowed, payloadPath, write, list, manifest, verify, settings };
