'use strict';
// Isolated in-memory UI fixture; no live service, browser profile or account.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
if (!process.argv[2]) throw Error('Supply an existing Playwright package path.');
const { chromium } = require(process.argv[2]);
const root = path.join(__dirname, '..');
const app = fs.readFileSync(path.join(root, 'app/app.js'), 'utf8');
const html = fs.readFileSync(path.join(root, 'app/index.html'), 'utf8');
const refreshCode = app.slice(app.indexOf('  function setWorkspaceRefreshState('), app.indexOf('  function bindEvents()'));
const menu = html.slice(html.indexOf('<div class="workspace-tools-panel"'), html.indexOf('<div class="usage-card"'));
(async () => {
  const browser = await chromium.launch({ executablePath: 'C:\\Program Files\\BraveSoftware\\Brave-Browser\\Application\\brave.exe', headless: true });
  try {
    for (const [label, width, height] of [['desktop', 1365, 900], ['phone', 390, 844], ['short-phone', 390, 520]]) {
      const context = await browser.newContext({ viewport: { width, height } });
      const page = await context.newPage();
      await page.route('**/*', route => route.abort());
      await page.setContent(`<html><body><button id="refreshButton" aria-label="Refresh workspace">Refresh</button>${menu}</body></html>`);
      await page.addStyleTag({ content: fs.readFileSync(path.join(root, 'app/styles.css'), 'utf8') });
      await page.evaluate(() => {
        window.state = { currentDirectory: '/fixture', currentSessionID: 'fixture-session', customDirectories: [] };
        window.$ = selector => document.querySelector(selector);
        window.els = { version: {} }; window.storage = { set() {} }; window.setConnection = () => {}; window.toast = () => {};
        window.fixtureCalls = 0; window.fixtureFail = false;
        window.fixtureGate = new Promise(resolve => { window.fixtureRelease = resolve; });
        window.api = async route => { fixtureCalls++; await fixtureGate; if (fixtureFail) throw Error('Fixture unavailable'); return route === '/session' ? [{ id: 'fixture-session', directory: '/fixture' }] : {}; };
        window.workspace = async () => { fixtureCalls++; await fixtureGate; return {}; };
        window.normalizeSession = value => value; window.directories = () => ['/fixture']; window.sessionProject = value => value.directory;
        window.refreshDirectoryData = window.refreshInstructionData = window.refreshMessages = async () => {};
        window.connectEvents = window.refreshWorkspaceMeta = () => {};
        document.querySelector('#workspaceToolsPanel').showPopover();
      });
      await page.addScriptTag({ content: `${refreshCode}\n$('#refreshButton').addEventListener('click', () => refreshAll(true));\n$('#workspaceRefreshButton').addEventListener('click', () => refreshAll(true));` });
      const button = page.locator('#workspaceRefreshButton');
      assert.equal(await button.getAttribute('aria-label'), null);
      await button.focus();
      assert.equal(await page.evaluate(() => document.activeElement.id), 'workspaceRefreshButton');
      const bounds = await button.boundingBox();
      assert.ok(bounds.height >= 44 && bounds.x >= 0 && bounds.x + bounds.width <= width);
      await page.keyboard.press('Enter');
      assert.equal(await button.isDisabled(), true);
      assert.equal(await page.locator('#refreshButton').isDisabled(), true);
      await page.evaluate(() => refreshAll(true));
      assert.equal(await page.evaluate(() => fixtureCalls), 5);
      await page.evaluate(() => fixtureRelease());
      await page.waitForFunction(() => !state.refreshingWorkspace);
      assert.match(await page.getByRole('status').textContent(), /Workspace refreshed/);
      assert.equal(await page.locator('#workspaceToolsPanel').evaluate(el => el.matches(':popover-open')), true);
      await page.evaluate(() => { fixtureFail = true; });
      await button.click();
      await page.waitForFunction(() => !state.refreshingWorkspace);
      assert.match(await page.getByRole('status').textContent(), /Fixture unavailable/);
      assert.equal(await button.isEnabled(), true);
      console.log(`PASS: ${label} refresh label, keyboard activation, busy state, single-flight, status and retry`);
      await context.close();
    }
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
