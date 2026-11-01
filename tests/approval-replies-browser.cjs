'use strict';
// In-memory browser fixture: no live engine, account or existing browser profile.
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
if (!process.argv[2]) throw Error('Supply an existing Playwright path. No dependencies are installed.');
const { chromium } = require(process.argv[2]);
const root = path.join(__dirname, '..'), read = name => fs.readFileSync(path.join(root, name), 'utf8');
const app = read('app/app.js');
const extract = (start, end) => { const first = app.indexOf(start), last = app.indexOf(end, first); assert.ok(first >= 0 && last > first); return app.slice(first, last); };
const code = extract('  async function api(', '  async function workspace(') + extract('  function renderPermissions(', '  function renderAll(') + extract('  async function permissionRequest(', '  function renderAttachments(');
const markup = read('app/index.html').replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '').replace(/<link\b[^>]*>/gi, '');
const output = path.join(root, '.test-temp/approval-replies'); fs.mkdirSync(output, { recursive: true });
(async () => {
  const browser = await chromium.launch({ executablePath: 'C:\\Program Files\\BraveSoftware\\Brave-Browser\\Application\\brave.exe', headless: true });
  try {
    for (const [label, width, height, theme] of [['desktop', 1365, 900, 'night'], ['phone', 390, 844, 'night'], ['short-phone', 390, 520, 'night'], ['phone-day', 390, 844, 'day']]) {
      const context = await browser.newContext({ viewport: { width, height } }), page = await context.newPage();
      page.setDefaultTimeout(5000); await page.route('**/*', route => route.abort());
      await page.setContent(markup); await page.addStyleTag({ content: read('app/styles.css') });
      await page.evaluate(theme => {
        document.documentElement.dataset.theme = theme;
        window.$ = (selector, root = document) => root.querySelector(selector);
        window.$$ = (selector, root = document) => [...root.querySelectorAll(selector)];
        window.escapeHTML = text => String(text).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
        window.els = { permissionDock: $('#permissionDock'), prompt: $('#promptInput') || document.querySelector('textarea') };
        window.state = { currentSessionID: 'ses_fixture', currentDirectory: '/fixture/project', sessions: [{ id: 'ses_fixture', directory: '/fixture/project' }],
          permissions: [{ id: 'per_fixture', sessionID: 'ses_fixture', title: 'Read a test document', pattern: '/fixture/example.txt' }], permissionReplies: new Map(), permissionMisses: {} };
        window.withDirectory = (route, directory) => route + '?directory=' + encodeURIComponent(directory);
        window.toast = () => {}; window.log = () => {};
        window.fixtureCalls = []; window.fixtureMode = 'wait';
        window.fixtureGate = new Promise(resolve => { window.fixtureRelease = resolve; });
        window.fetch = async (url, options) => {
          fixtureCalls.push({ url, method: options.method, body: options.body });
          if (options.method === 'POST') { if (fixtureMode === 'wait') await fixtureGate; else if (fixtureMode === 'offline') throw TypeError('Fixture offline'); }
          return { ok: true, status: 200, headers: { get: () => 'application/json' }, json: async () => options.method === 'GET' ? [...state.permissions] : {} };
        };
      }, theme);
      await page.addScriptTag({ content: code + '\nrenderPermissions();' });
      const allow = page.getByRole('button', { name: 'Allow once', exact: true });
      await allow.focus(); await page.keyboard.press('Enter');
      assert.equal(await page.locator('[data-reply]:disabled').count(), 3);
      assert.equal(await page.locator('[role=status]').filter({ hasText: 'Sending your decision' }).count(), 1);
      await page.evaluate(() => replyPermission(state.permissions[0], 'reject'));
      assert.equal(await page.evaluate(() => fixtureCalls.length), 1);
      await page.evaluate(() => fixtureRelease()); await page.waitForFunction(() => document.querySelector('#permissionDock').hidden);
      assert.equal(await page.evaluate(() => document.activeElement === els.prompt), true);
      await page.evaluate(() => { fixtureMode = 'offline'; state.permissions = [{ id: 'per_second', sessionID: 'ses_fixture', title: 'Read a second test document', pattern: '/fixture/second.txt' }]; renderPermissions(); });
      await allow.click(); await page.getByRole('button', { name: 'Check status', exact: true }).waitFor();
      assert.equal(await page.locator('[data-reply]:disabled').count(), 3);
      assert.equal(await page.evaluate(() => fixtureCalls.filter(call => call.method === 'POST').length), 2);
      assert.match(await page.locator('#permissionReplyStatus').textContent(), /Nothing was resent/);
      const bounds = await page.locator('#permissionDock').boundingBox();
      assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= width && bounds.y >= 0 && bounds.y + bounds.height <= height, `${label}: recovery controls fit`);
      for (const button of await page.locator('.permission-actions button').all()) assert.ok((await button.boundingBox()).height >= 44);
      await page.screenshot({ path: path.join(output, `${label}.png`) });
      await page.evaluate(() => { fixtureMode = 'ready'; });
      await page.getByRole('button', { name: 'Check status', exact: true }).click();
      assert.equal(await page.evaluate(() => fixtureCalls.filter(call => call.method === 'POST').length), 2, 'status recovery never sends a decision');
      assert.equal(await allow.isEnabled(), true);
      assert.equal(await page.evaluate(() => document.activeElement.textContent), 'Allow once');
      await page.getByRole('button', { name: 'Reject', exact: true }).click();
      await page.waitForFunction(() => document.querySelector('#permissionDock').hidden);
      assert.equal(await page.evaluate(() => fixtureCalls.filter(call => call.method === 'POST').length), 3);
      console.log(`PASS: ${label} approval lock, uncertain recovery, read-only check, keyboard focus and 44px controls`);
      await context.close();
    }
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
