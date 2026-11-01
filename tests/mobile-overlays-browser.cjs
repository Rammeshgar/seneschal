'use strict';
// In-memory fixture: real markup, styles and UI handlers; no live services or accounts.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
if (!process.argv[2]) throw Error('Supply an existing Playwright path; no dependencies are installed.');
const { chromium } = require(process.argv[2]);
const root = path.join(__dirname, '..');
const read = name => fs.readFileSync(path.join(root, name), 'utf8');
const app = read('app/app.js'), remote = read('app/private-access.js');
const handlers = app.slice(app.indexOf('  function closeModelPicker('), app.indexOf('  function selectModel('));
const remoteNavigation = remote.slice(remote.indexOf('  function setupMobileNavigation('), remote.indexOf('  // Export only pure UI setup'));
const markup = read('app/index.html').replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '').replace(/<link\b[^>]*>/gi, '');
const output = path.join(root, '.test-temp/mobile-overlays');
fs.mkdirSync(output, { recursive: true });
(async () => {
  const browser = await chromium.launch({ executablePath: 'C:\\Program Files\\BraveSoftware\\Brave-Browser\\Application\\brave.exe', headless: true });
  try {
    for (const [width, height] of [[320, 640], [390, 844], [480, 900], [680, 720], [681, 720], [844, 390], [1120, 800], [1121, 800], [1440, 900]]) {
      for (const isRemote of [false, true]) {
        const label = `${isRemote ? 'remote' : 'local'}-${width}x${height}`;
        const context = await browser.newContext({ viewport: { width, height } });
        const page = await context.newPage();
        page.setDefaultTimeout(5000);
        await page.route('**/*', route => route.abort());
        await page.setContent(markup);
        await page.addStyleTag({ content: read('app/styles.css') });
        await page.evaluate(() => {
          window.$ = selector => document.querySelector(selector);
          window.els = Object.fromEntries(['modelPicker', 'modelPickerButton', 'modelPickerMenu', 'modelPickerGroups', 'inspector'].map(id => [id, document.getElementById(id)]));
          els.modelSearch = document.getElementById('modelSearchInput');
          document.getElementById('modelPickerLabel').textContent = 'GPT-6.1 Sol';
          window.fixtureSelections = [];
          window.renderModelPicker = (filter = '') => {
            const models = ['GPT-6 Astra', 'GPT-6.1 Sol', 'GPT-6 Sol', 'GPT-6 Luna', ...Array.from({ length: 30 }, (_, index) => `Fixture model ${index}`)];
            els.modelPickerGroups.innerHTML = `<details open class="model-provider-group"><summary>OPENAI</summary><div class="model-provider-options">${models.filter(name => name.toLowerCase().includes(filter.toLowerCase())).map(name => `<button class="model-picker-option" data-model-value="${name}" role="option"><span>${name}</span><small>fixture-model</small></button>`).join('')}</div></details>`;
          };
          window.selectModel = value => { fixtureSelections.push(value); closeModelPicker(); };
          document.getElementById('appShell').classList.add('right-panel-collapsed');
        });
        // Match deferred-script ordering: local handlers bind before the private client.
        await page.addScriptTag({ content: `${handlers}\nbindModelPicker(); bindContextDrawer();` });
        if (isRemote) {
          await page.addStyleTag({ content: read('app/private-access.css') });
          await page.evaluate(() => {
            document.body.classList.add('remote-client');
            document.body.insertAdjacentHTML('afterbegin', '<header class="remote-host-bar">Private connection · Fixture PC</header>');
          });
          await page.addScriptTag({ content: `${remoteNavigation}\nsetupMobileNavigation(document, window); setupInspectorNavigation(document, window);` });
        }
        const refresh = page.locator('#refreshButton');
        assert.equal(await refresh.isVisible(), true, `${label}: refresh is directly available without opening a sidebar`);
        if (width <= 680) {
          const target = await refresh.boundingBox();
          assert.ok(target.width >= 44 && target.height >= 44 && target.x >= 0 && target.x + target.width <= width, `${label}: visible thumb-sized refresh target`);
          assert.equal(await refresh.getAttribute('aria-label'), 'Refresh workspace');
          assert.equal(await refresh.evaluate(el => { const r = el.getBoundingClientRect(); return el.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)); }), true);
          const modelTarget = await page.locator('#modelPickerButton').boundingBox();
          assert.ok(modelTarget.width > 44 && modelTarget.x + modelTarget.width <= target.x, `${label}: model selector and refresh do not overlap`);
        }
        const picker = page.locator('#modelPickerMenu'), search = page.getByRole('searchbox', { name: 'Search models' });
        await page.getByRole('button', { name: 'Select AI model' }).click();
        await search.waitFor();
        const bounds = await picker.boundingBox();
        assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= width + 1, `${label}: model picker is on-screen`);
        assert.ok(bounds.y >= 0 && bounds.y + bounds.height <= height + 1, `${label}: picker fits height`);
        if (width <= 1120) assert.equal(await page.locator('#openInspectorButton').isVisible(), false, `${label}: Context cannot cover search`);
        assert.equal(await search.evaluate(el => document.elementFromPoint(el.getBoundingClientRect().x + 10, el.getBoundingClientRect().y + 10) === el), true);
        await search.fill('astra');
        assert.equal(await page.getByRole('option').count(), 1);
        await page.getByRole('option', { name: /GPT-6 Astra/ }).click();
        assert.deepEqual(await page.evaluate(() => fixtureSelections), ['GPT-6 Astra']);
        assert.equal(await picker.isVisible(), false);
        assert.equal(await page.evaluate(() => document.activeElement.id), 'modelPickerButton');
        await page.getByRole('button', { name: 'Select AI model' }).click();
        await page.getByRole('button', { name: 'Close model picker' }).click();
        assert.equal(await picker.isVisible(), false);
        await page.getByRole('button', { name: 'Select AI model' }).click();
        await page.keyboard.press('Escape');
        assert.equal(await picker.isVisible(), false);
        if (width <= 1120) {
          await page.locator('#openInspectorButton').click();
          const close = page.locator('#closeInspectorButton');
          await close.waitFor();
          await page.waitForFunction(() => Math.abs(new DOMMatrix(getComputedStyle(document.getElementById('inspector')).transform).e) < 0.1);
          assert.equal(await page.locator('.workspace').evaluate(el => el.scrollLeft), 0, `${label}: focusing the drawer must not scroll the workspace`);
          assert.equal(await page.evaluate(() => Math.abs(document.getElementById('inspector').getBoundingClientRect().right - document.querySelector('.workspace').getBoundingClientRect().right) < 2), true, `${label}: drawer stays at the right edge`);
          assert.equal(await page.locator('#openInspectorButton').isVisible(), false);
          assert.equal(await page.evaluate(() => document.activeElement.id), 'closeInspectorButton');
          assert.equal(await close.evaluate(el => { const rect = el.getBoundingClientRect(); return rect.width >= 44 && rect.height >= 44 && document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2) === el; }), true, `${label}: close is reachable`);
          assert.equal(await page.locator('#inspector').evaluate(el => getComputedStyle(el).backgroundColor), 'rgb(14, 20, 29)');
          if (width === 480) await page.screenshot({ path: path.join(output, `${label}-context.png`) });
          await page.locator('#inspector').evaluate(el => { el.scrollTop = el.scrollHeight; });
          assert.equal(await close.isVisible(), true);
          await close.click();
          assert.equal(await page.locator('#openInspectorButton').isVisible(), true);
          assert.equal(await page.evaluate(() => document.activeElement.id), 'openInspectorButton');
          await page.locator('#openInspectorButton').click(); await page.keyboard.press('Escape');
          assert.equal(await page.locator('#inspector').evaluate(el => el.classList.contains('open')), false);
          await page.locator('#openInspectorButton').click();
          await page.locator('#modelPickerButton').click();
          assert.equal(await page.locator('#inspector').evaluate(el => el.classList.contains('open')), false);
        }
        await page.getByRole('button', { name: 'Select AI model' }).click();
        if (await picker.isHidden()) await page.getByRole('button', { name: 'Select AI model' }).click();
        await page.getByRole('option').last().scrollIntoViewIfNeeded();
        const last = await page.getByRole('option').last().boundingBox();
        assert.ok(last.y + last.height <= height + 1, `${label}: final model remains reachable`);
        if (width === 480) await page.screenshot({ path: path.join(output, `${label}-models.png`) });
        console.log(`PASS: ${label} bounds, search, model selection, close, Escape and focus`);
        await context.close();
      }
    }
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
