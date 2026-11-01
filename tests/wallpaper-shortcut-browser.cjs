'use strict';
// Actual local gallery and UI, isolated from personal data, engine and audio.
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const { chromium } = require(process.argv[2]);
const root = path.join(__dirname, '..'), read = file => fs.readFileSync(path.join(root, file), 'utf8');
const html = read('app/index.html').replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '').replace(/<link\b[^>]*>/gi, '');
const app = read('app/app.js'), start = app.indexOf('  function openAtmospheres('), end = app.indexOf('  function cycleMotion(', start);
const output = path.join(root, '.test-temp/wallpaper-shortcut'); fs.mkdirSync(output, { recursive: true });
(async () => {
  const browser = await chromium.launch({ executablePath: 'C:\\Program Files\\BraveSoftware\\Brave-Browser\\Application\\brave.exe', headless: true });
  try {
    for (const [name, width, height, collapsed, remote] of [
      ['desktop', 1365, 900, false, false], ['collapsed', 1365, 900, true, false],
      ['phone', 390, 844, false, true], ['small-phone', 320, 640, false, true], ['keyboard', 390, 400, false, true]
    ]) {
      const context = await browser.newContext({ viewport: { width, height } }), page = await context.newPage(), errors = [];
      page.on('pageerror', error => errors.push(error.message)); page.setDefaultTimeout(6000);
      await page.route('**/*', route => route.abort()); await page.setContent(html);
      for (const css of ['styles.css', 'ares.css', 'wallpapers.css', ...(remote ? ['private-access.css'] : [])]) await page.addStyleTag({ content: read('app/' + css) });
      await page.evaluate(({ collapsed, remote }) => {
        if (collapsed) document.querySelector('#appShell').classList.add('left-panel-collapsed');
        if (remote) { document.body.classList.add('remote-client'); document.body.insertAdjacentHTML('afterbegin', '<header class="remote-host-bar">Private connection · Fixture PC</header>'); }
        if (innerWidth <= 680) document.querySelector('.sidebar').classList.add('open');
        window.$ = s => document.querySelector(s); window.fixtureSubmits = 0;
        document.querySelector('#promptInput').value = 'Keep my unsent draft';
        document.querySelector('#composerForm').addEventListener('submit', event => { event.preventDefault(); fixtureSubmits++; });
      }, { collapsed, remote });
      await page.addScriptTag({ content: read('app/wallpapers.js') });
      await page.addScriptTag({ content: app.slice(start, end) + '\ndocument.getElementById("motionSwitch").addEventListener("click", openAtmospheres);' });
      const trigger = page.getByRole('button', { name: 'Open wallpaper themes', exact: true });
      assert.equal(await trigger.isVisible(), true);
      const box = await trigger.boundingBox(); assert.ok(box.width >= 44 && box.height >= 44);
      assert.ok(box.y >= 0 && box.y + box.height <= height, `${name}: launcher is on screen`);
      assert.equal(await trigger.evaluate(e => { const b = e.getBoundingClientRect(); return e.contains(document.elementFromPoint(b.x + b.width / 2, b.y + b.height / 2)); }), true, 'no overlay hides the launcher');
      assert.equal(await page.locator('#workspaceToolsPanel').evaluate(e => e.matches(':popover-open')), false);
      if (!collapsed) assert.equal(await page.locator('.wallpaper-shortcut-label').isVisible(), true);
      await page.screenshot({ path: path.join(output, name + '-shortcut.png') });
      await trigger.focus(); await page.keyboard.press('Enter');
      await page.locator('#atmosphereDialog[open]').waitFor();
      assert.equal(await page.locator('#workspaceToolsPanel').evaluate(e => e.matches(':popover-open')), false);
      assert.equal(await page.locator('.atmosphere-card').count(), 11);
      await page.getByRole('button', { name: /Still composition/ }).click();
      assert.equal(await page.locator('html').getAttribute('data-motion'), 'still');
      assert.equal(await page.locator('#atmosphereName').textContent(), 'Still composition');
      await page.keyboard.press('Escape'); await page.waitForFunction(() => !document.querySelector('#atmosphereDialog').open);
      assert.equal(await trigger.evaluate(e => document.activeElement === e), true, 'Escape restores focus to the visible shortcut');
      assert.equal(await page.locator('#promptInput').inputValue(), 'Keep my unsent draft');
      assert.equal(await page.evaluate(() => fixtureSubmits), 0); assert.deepEqual(errors, []);
      console.log(`PASS: ${name} visible wallpaper shortcut, direct gallery, keyboard/Escape, selection and preserved draft`);
      await context.close();
    }
  } finally { await browser.close(); }
})().catch(error => { console.error(error.stack); process.exitCode = 1; });
