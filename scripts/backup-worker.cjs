'use strict';
// Runs beside the original database inside WSL: never copy a live SQLite file.
const fs = require('node:fs'), path = require('node:path');
const files = require('./backup-files.cjs');
function sqlite() {
  let api; try { api = require('node:sqlite'); } catch { throw Error('Backup needs a WSL Node runtime with SQLite backup support (Node 22.16+). No runtime was installed.'); }
  if (typeof api.backup !== 'function') throw Error('WSL Node does not support SQLite backups. Node 22.16+ is required.');
  return api;
}
function checkDatabase(filename) {
  files.ordinary(filename); const { DatabaseSync } = sqlite(), db = new DatabaseSync(filename, { readOnly: true });
  try { db.exec('PRAGMA trusted_schema=OFF'); const rows = db.prepare('PRAGMA quick_check').all(); if (rows.length !== 1 || Object.values(rows[0])[0] !== 'ok') throw Error('Database integrity check failed.'); }
  finally { db.close(); }
}
async function snapshot(home, destination) {
  files.ancestors(home); files.ancestors(destination);
  const source = path.join(home, '.local/share/opencode/opencode.db');
  files.ancestors(path.dirname(source));
  if (files.ordinary(source).size > files.MAX_FILE) throw Error('History exceeds the 1 GiB backup limit.');
  for (const suffix of ['-wal', '-shm']) if (fs.existsSync(source + suffix)) files.ordinary(source + suffix);
  const { DatabaseSync, backup } = sqlite(), db = new DatabaseSync(source, { readOnly: true });
  const targetDirectory = path.join(destination, 'history'); fs.mkdirSync(targetDirectory, { mode: 0o700 });
  const target = path.join(targetDirectory, 'opencode.db');
  try { db.exec('PRAGMA trusted_schema=OFF'); const pageSize = db.prepare('PRAGMA page_size').get().page_size; await backup(db, target, { rate: 100, progress: ({ totalPages }) => { if (totalPages * pageSize > files.MAX_FILE) throw Error('History exceeds backup limit.'); } }); }
  finally { db.close(); }
  // The completed standalone copy must not depend on WAL sidecar files.
  const completed = new DatabaseSync(target);
  try { completed.exec('PRAGMA trusted_schema=OFF; PRAGMA journal_mode=DELETE'); } finally { completed.close(); }
  checkDatabase(target); files.ordinary(target);
  const config = path.join(home, '.config/opencode');
  if (fs.existsSync(config)) {
    files.ancestors(config);
    for (const name of ['AGENTS.md', 'GENERAL.md']) { const sourceFile = path.join(config, name); if (fs.existsSync(sourceFile)) files.write(destination, 'engine/' + name, files.read(sourceFile, 1024 * 1024)); }
    // Raw provider/MCP config can contain inline credentials. Never include it.
    const configFile = path.join(config, 'opencode.json');
    if (fs.existsSync(configFile)) {
      const bytes = files.read(configFile); let value;
      try { value = files.parseJSON(bytes); } catch { value = {}; } // JSONC/custom configuration is intentionally omitted.
      const models = {};
      for (const key of ['model', 'small_model', 'default_agent']) if (typeof value?.[key] === 'string' && /^[a-zA-Z0-9_.:/-]{1,200}$/.test(value[key])) models[key] = value[key];
      files.write(destination, 'engine/model-preferences.json', JSON.stringify(models, null, 2));
    }
  }
}
async function main(args) {
  const timer = setTimeout(() => process.exit(1), 120000);
  try {
    if (args[0] === 'snapshot' && args.length === 3) await snapshot(args[1], args[2]);
    else if (args[0] === 'check' && args.length === 2) checkDatabase(args[1]);
    else throw Error('Invalid backup worker operation.');
  } finally { clearTimeout(timer); }
}
if (require.main === module) main(process.argv.slice(2)).catch(() => { console.error('History snapshot or database verification failed. Check the installed WSL Node runtime and history database.'); process.exitCode = 1; });
module.exports = { snapshot, checkDatabase };
