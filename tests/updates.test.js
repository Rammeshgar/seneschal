const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createMaintenance } = require('../scripts/maintenance-server');
function fixture(fetcher) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'seneschal-updater-'));
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ version: '0.2.1-beta.17' }));
  return { root, manager: createMaintenance({ root, distribution: 'Ubuntu', shutdown: () => assert.fail('must not restart'), fetcher }) };
}
const asset = { name: 'seneschal-v0.2.1-beta.18.zip', digest: `sha256:${'a'.repeat(64)}`, size: 10, browser_download_url: 'https://github.com/Rammeshgar/seneschal/releases/download/v0.2.1-beta.18/release.zip' };
const release = { tag_name: 'v0.2.1-beta.18', assets: [asset] };
test('Engine check selects latest stable release on installed major only', async () => {
  const { root } = fixture(async () => {});
  const manager = createMaintenance({ root, distribution: 'Ubuntu', wslRunner: async () => '1.18.21', fetcher: async () => ({ ok: true, json: async () => [{ tag_name: 'v2.0.24' }, { tag_name: 'v1.19.0' }, { tag_name: 'v1.19.1', prerelease: true }] }) });
  const result = await manager.engineCheck();
  assert.equal(result.version, 'v1.19.0'); assert.equal(result.latest, 'v2.0.24'); assert.equal(result.available, true);
});
test('Engine update pins validated official target and verifies installed version', async () => {
  const { root } = fixture(async () => {}); let updated = false; const commands = [];
  const manager = createMaintenance({ root, distribution: 'Ubuntu', wslRunner: async script => { commands.push(script); if (script.includes('upgrade')) { updated = true; return ''; } return updated ? '1.19.0' : '1.18.21'; }, fetcher: async () => ({ ok: true, json: async () => [{ tag_name: 'v1.19.0' }] }) });
  const result = await manager.engineUpdate();
  assert.ok(commands.includes('set -e\nopencode upgrade v1.19.0')); assert.equal(result.current, 'v1.19.0');
});
test('Published release check ignores drafts and chooses numeric newest release', async () => {
  const { manager } = fixture(async () => ({ ok: true, json: async () => [{ ...release, tag_name: 'v0.2.1-beta.99', draft: true }, release, { ...release, tag_name: 'v0.2.1-beta.9' }] }));
  const result = await manager.check(); assert.equal(result.version, release.tag_name); assert.ok(result.installable);
});
test('Source checkout is never overwritten', async () => {
  const { manager, root } = fixture(async () => ({ ok: true, json: async () => [release] }));
  fs.mkdirSync(path.join(root, '.git'));
  assert.equal((await manager.check()).installable, false);
  await assert.rejects(manager.update(), /Source checkout/);
});
test('Release without checksum cannot be installed', async () => {
  const { manager } = fixture(async () => ({ ok: true, json: async () => [{ ...release, assets: [{ ...asset, digest: null }] }] }));
  assert.equal((await manager.check()).installable, false);
});
test('Checksum failure never changes files or launches updater', async () => {
  const { manager, root } = fixture(async url => String(url).includes('api.github.com') ? { ok: true, json: async () => [release] } : { ok: true, body: (async function* () { yield Buffer.from('wrong'); })() });
  await assert.rejects(manager.update(), /checksum/);
  assert.deepEqual(fs.readdirSync(root), ['package.json']);
});
test('Untrusted release URL is rejected before download', async () => {
  const { manager } = fixture(async () => ({ ok: true, json: async () => [{ ...release, assets: [{ ...asset, browser_download_url: 'https://evil.example/release.zip' }] }] }));
  await assert.rejects(manager.update(), /Untrusted/);
});
