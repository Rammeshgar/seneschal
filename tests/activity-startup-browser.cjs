'use strict';
// Real Activity UI with synthetic responses, no server, runtime or personal history.
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
if (!process.argv[2]) throw Error('Supply the existing Playwright path.');
const { chromium } = require(process.argv[2]);
const fixture = require('./activity-ui-fixture');
const root = path.join(__dirname, '..'), read = file => fs.readFileSync(path.join(root, file), 'utf8');
const data = {};
for (const route of ['/overview?window=7d', '/sessions?limit=5']) fixture(new URL('http://fixture.invalid/workspace/activity' + route), { method: 'GET' }, null, (_, result) => { data[route] = result; });
const html = read('app/index.html').replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '').replace(/<link\b[^>]*>/gi, '');
(async () => {
  const browser = await chromium.launch({ executablePath: 'C:\\Program Files\\BraveSoftware\\Brave-Browser\\Application\\brave.exe', headless: true });
  try {
    for (const [name, width, height, remote, theme] of [['desktop', 1365, 900, false, 'night'], ['desktop-day', 1100, 800, false, 'day'], ['phone', 390, 844, true, 'night'], ['small-phone', 320, 640, true, 'night']]) {
      const page = await browser.newPage({ viewport: { width, height } }); page.setDefaultTimeout(7000);
      await page.route('**/*', route => route.abort()); await page.setContent(html);
      await page.addStyleTag({ content: read('app/styles.css') + '\n' + read('app/activity.css') });
      await page.evaluate(({ data, remote, theme }) => {
        document.documentElement.dataset.theme = theme;
        if (remote) { document.body.classList.add('remote-client'); document.body.insertAdjacentHTML('afterbegin', '<header class="remote-host-bar">Private connection · Fixture PC</header>'); }
        window.fixture = { phase: 'stopped', enabled: false, calls: [], failedSave: false };
        window.fetch = async (url, options = {}) => {
          const route = String(url).replace('/workspace/activity', ''), method = options.method || 'GET';
          fixture.calls.push({ route, method, body: options.body });
          if (remote && method !== 'GET') throw Error('Phone attempted a service mutation');
          let value, status = 200;
          if (route === '/preferences') {
            if (method === 'POST') {
              if (fixture.failedSave) { value = { error: 'Fixture preference was not saved.' }; status = 409; }
              else { const body = JSON.parse(options.body); if (typeof body.enabled !== 'boolean' || options.headers['Content-Type'] !== 'application/json') throw Error('Invalid preference submission'); fixture.enabled = body.enabled; }
            }
            value ||= { enabled: fixture.enabled, startupError: '' };
          } else if (route === '/start') { fixture.phase = 'ready'; value = { phase: 'ready', owned: true }; }
          else if (route === '/status') value = { phase: fixture.phase, owned: fixture.phase !== 'stopped', version: '0.1.7', message: fixture.phase === 'stopped' ? 'Activity is stopped.' : 'Local history is available.' };
          else value = data[route] || {};
          return { ok: status === 200, status, json: async () => value };
        };
      }, { data, remote, theme });
      await page.addScriptTag({ content: read('app/activity.js') });
      await page.evaluate(() => window.SeneschalActivity.open());
      const dialog = page.locator('.activity-workspace'); await dialog.waitFor({ state: 'visible' });
      if (remote) {
        await page.getByRole('heading', { name: 'Waiting for PC history' }).waitFor();
        assert.equal(await dialog.getByRole('button', { name: 'Start local history', exact: true }).count(), 0);
        await dialog.getByRole('button', { name: 'Check PC status', exact: true }).click();
        await page.evaluate(() => { fixture.phase = 'indexing'; window.dispatchEvent(new CustomEvent('seneschal-activity', { detail: { type: 'session.idle', properties: { status: { type: 'idle' } } } })); });
        await page.getByRole('heading', { name: 'Your recent work' }).waitFor();
        await dialog.getByRole('tab', { name: 'Service', exact: true }).click();
        await page.getByRole('heading', { name: 'History is available' }).waitFor();
        assert.equal(await page.getByLabel('Start Activity with Seneschal', { exact: true }).count(), 0);
        assert.ok((await page.evaluate(() => fixture.calls)).every(call => call.method === 'GET' && call.route !== '/preferences'));
      } else {
        await dialog.getByRole('tab', { name: 'Service', exact: true }).click();
        const checkbox = page.getByRole('checkbox', { name: 'Start Activity with Seneschal', exact: true });
        await checkbox.waitFor(); await checkbox.scrollIntoViewIfNeeded(); assert.equal(await checkbox.isChecked(), false);
        await checkbox.focus(); await page.keyboard.press('Space');
        await dialog.getByRole('button', { name: 'Save startup preference', exact: true }).click();
        await page.getByText('Saved. Activity will start with future Seneschal host launches.', { exact: false }).waitFor();
        assert.equal(await page.evaluate(() => fixture.enabled), true);
        await checkbox.uncheck(); await dialog.getByRole('button', { name: 'Save startup preference', exact: true }).click();
        await page.getByText('Saved. Automatic Activity startup is off;', { exact: false }).waitFor();
        assert.equal(await page.evaluate(() => fixture.enabled), false);
        await page.evaluate(() => { fixture.failedSave = true; });
        await checkbox.check(); await dialog.getByRole('button', { name: 'Save startup preference', exact: true }).click();
        await page.getByText('Fixture preference was not saved.', { exact: true }).waitFor();
        assert.equal(await page.evaluate(() => fixture.enabled), false);
        const writes = (await page.evaluate(() => fixture.calls)).filter(call => call.method !== 'GET');
        assert.equal(writes.filter(call => call.route === '/start').length, 1, 'only the existing explicit PC Activity open starts a runtime');
        assert.ok(writes.every(call => ['/start', '/preferences'].includes(call.route)), 'saving never stops/restarts a runtime');
      }
      await dialog.getByRole('button', { name: 'Close Activity', exact: true }).click();
      console.log(`PASS: ${name} ${remote ? 'read-only waiting state, automatic indexing catch-up and no remote preference controls' : 'native keyboard checkbox, explicit JSON save, disable-without-stop and persistent save failure'}`);
      await page.close();
    }
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
