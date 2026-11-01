'use strict';
// Synthetic DOM and local UI only. No engine, credentials, microphone or provider.
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const { chromium } = require(process.argv[2]);
const root = path.join(__dirname, '..'), read = file => fs.readFileSync(path.join(root, file), 'utf8');
const app = read('app/app.js'), code = app.slice(app.indexOf('/* SENESCHAL FEATURE HELP'));
const html = read('app/index.html').replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '').replace(/<link\b[^>]*>/gi, '');
const out = path.join(root, '.test-temp/feature-help'); fs.mkdirSync(out, { recursive: true });
(async () => {
  const browser = await chromium.launch({ executablePath: 'C:\\Program Files\\BraveSoftware\\Brave-Browser\\Application\\brave.exe', headless: true });
  try {
    for (const [name, width, height, touch, day, reduced] of [
      ['desktop', 1365, 900, false, false, false], ['phone', 390, 844, true, false, false],
      ['small-phone', 320, 640, true, false, false], ['keyboard', 390, 400, true, false, false],
      ['day', 1365, 900, false, true, false], ['reduced', 390, 844, true, false, true]
    ]) {
      if (process.env.FEATURE_HELP_CASE && process.env.FEATURE_HELP_CASE !== name) continue;
      const context = await browser.newContext({ viewport: { width, height }, hasTouch: touch, reducedMotion: reduced ? 'reduce' : 'no-preference' });
      const page = await context.newPage(), errors = []; page.on('pageerror', error => { errors.push(error.message); console.error(name + ': ' + error.stack); }); page.setDefaultTimeout(6000);
      await page.route('**/*', route => route.abort()); await page.setContent(html);
      for (const css of ['styles.css', 'ares.css', 'questions.css', 'wallpapers.css']) await page.addStyleTag({ content: read('app/' + css) });
      await page.evaluate(day => {
        document.documentElement.dataset.theme = day ? 'day' : 'night';
        window.fixtureActions = { send: 0, delete: 0, once: 0, always: 0, reject: 0 };
        document.querySelector('#promptInput').value = 'A private unsent draft';
        document.querySelector('#providerKeyInput').value = 'private-fixture-key-never-in-help';
        document.addEventListener('submit', event => event.preventDefault(), true);
        document.addEventListener('click', event => { const button = event.target.closest('button'); if (!button) return; if (button.id === 'sendButton') fixtureActions.send++; if (button.id === 'confirmDeleteSessionButton') fixtureActions.delete++; if (button.dataset.reply) fixtureActions[button.dataset.reply]++; });
      }, day);
      const testedCode = process.env.FEATURE_HELP_DEBUG ? code.replace('function hide() {', "function hide() { if (current?.id === 'voiceServiceSelect') (root.__helpReasons ||= []).push({stack:new Error().stack,mode,active:doc.activeElement?.id});") : code;
      await page.addScriptTag({ content: testedCode });
      const audit = await page.evaluate(() => {
        const controls = [...document.querySelectorAll('button,summary,input:not([type="hidden"]):not([type="file"]),select,textarea')];
        const rows = controls.map(e => ({ name: e.id || e.textContent.trim().slice(0, 40), copy: SeneschalFeatureHelp.describe(e) }));
        return { total: rows.length, missing: rows.filter(e => !e.copy), generic: rows.filter(e => /^(Use this action in|Change this field)/.test(e.copy)) };
      });
      assert.deepEqual(audit.missing, [], `${name}: every static control has help`);
      assert.deepEqual(audit.generic, [], `${name}: static controls have specific rather than generic help`);
      const visibleHelp = async () => {
        try { await page.waitForFunction(() => { const e = document.querySelector('#seneschalFeatureHelp'); return e && !e.hidden && getComputedStyle(e).visibility === 'visible'; }); }
        catch (error) { console.error(name + ' help state: ' + JSON.stringify(await page.evaluate(() => ({ active: document.activeElement?.id, tooltip: document.querySelector('#seneschalFeatureHelp')?.outerHTML, voiceOpen: document.querySelector('#voiceOptionsPanel').matches(':popover-open'), reasons: window.__helpReasons })))); throw error; }
      };
      const hiddenHelp = () => page.waitForFunction(() => !document.querySelector('#seneschalFeatureHelp') || document.querySelector('#seneschalFeatureHelp').hidden);
      const fits = async () => { const b = await page.locator('#seneschalFeatureHelp').boundingBox(); assert.ok(b && b.x >= 0 && b.y >= 0 && b.x + b.width <= width + 1 && b.y + b.height <= height + 1, `${name}: help fits viewport ${JSON.stringify(b)}`); };
      const inputBeforeHelp = await page.locator('#composerForm').boundingBox();
      await page.locator('#sendButton').hover(); await visibleHelp(); await fits();
      assert.deepEqual(await page.locator('#composerForm').boundingBox(), inputBeforeHelp, 'help does not move the input or message layout');
      assert.match(await page.locator('#seneschalFeatureHelp').textContent(), /Send your draft.*charges/);
      await page.locator('#seneschalFeatureHelp').hover(); await visibleHelp();
      await page.screenshot({ path: path.join(out, name + '-help.png') });
      await page.keyboard.press('Escape'); await hiddenHelp();
      await page.locator('#promptInput').focus(); await visibleHelp();
      assert.match(await page.locator('#promptInput').getAttribute('aria-describedby'), /promptDeliveryStatus/);
      assert.match(await page.locator('#promptInput').getAttribute('aria-describedby'), /seneschalFeatureHelp/);
      assert.equal(await page.locator('#seneschalFeatureHelp').textContent().then(t => t.includes('private unsent')), false);
      await page.keyboard.press('Escape'); await hiddenHelp();
      assert.equal(await page.locator('#promptInput').getAttribute('aria-describedby'), 'promptDeliveryStatus');
      await page.locator('#promptInput').fill('A private unsent draft');
      await page.evaluate(() => { document.querySelector('#sendButton').disabled = true; });
      await page.locator('#sendButton').hover(); await visibleHelp(); assert.match(await page.locator('#seneschalFeatureHelp').textContent(), /Unavailable right now/);
      await page.keyboard.press('Escape'); await page.evaluate(() => { document.querySelector('#sendButton').disabled = false; });
      // Help is in the dialog's own layer; first Escape closes help, not its dialog.
      await page.evaluate(() => document.querySelector('#settingsDialog').showModal());
      await page.locator('#settingsApprovalButton').focus(); await visibleHelp();
      assert.equal(await page.locator('#seneschalFeatureHelp').evaluate(e => e.parentElement.id), 'settingsDialog');
      await fits(); await page.keyboard.press('Escape'); await hiddenHelp(); assert.equal(await page.locator('#settingsDialog').evaluate(e => e.open), true);
      await page.keyboard.press('Escape'); assert.equal(await page.locator('#settingsDialog').evaluate(e => e.open), false);
      // It also remains visible inside an existing native Voice popover.
      await page.evaluate(() => document.querySelector('#voiceOptionsPanel').showPopover());
      await page.locator('#voiceServiceSelect').focus(); await visibleHelp();
      assert.equal(await page.locator('#seneschalFeatureHelp').evaluate(e => e.parentElement.id), 'voiceOptionsPanel');
      await page.keyboard.press('Escape'); assert.equal(await page.locator('#voiceOptionsPanel').evaluate(e => e.matches(':popover-open')), true);
      await page.keyboard.press('Escape');
      // A newly rendered control gets help without a rescan or adding listeners.
      await page.evaluate(() => { const e = document.createElement('button'); e.className = 'message-delete-button'; e.id = 'dynamicHelpAction'; e.textContent = 'Delete'; document.querySelector('#composerForm').before(e); });
      await page.locator('#dynamicHelpAction').focus(); await visibleHelp(); assert.match(await page.locator('#seneschalFeatureHelp').textContent(), /source transcript stays unchanged/);
      await page.evaluate(() => document.querySelector('#dynamicHelpAction').remove()); await hiddenHelp();
      if (!touch) {
        await page.locator('[data-inspector-section="permissions"] .block-title').hover(); await visibleHelp();
        assert.match(await page.locator('#seneschalFeatureHelp').textContent(), /explicit decision/);
        await page.keyboard.press('Escape');
      }
      if (touch) {
        const input = await context.newCDPSession(page);
        async function hold(selector, shouldShow = true, move = 0) {
          await page.keyboard.press('Escape'); const box = await page.locator(selector).boundingBox(); assert.ok(box);
          const x = box.x + box.width / 2, y = box.y + box.height / 2;
          await input.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
          if (move) await input.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x + move, y }] });
          if (shouldShow) await visibleHelp(); else await page.waitForTimeout(620);
          await input.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
          if (shouldShow) { await visibleHelp(); await fits(); } else await hiddenHelp();
        }
        await page.evaluate(() => document.querySelector('#deleteSessionDialog').showModal());
        await hold('#confirmDeleteSessionButton'); assert.equal(await page.evaluate(() => fixtureActions.delete), 0);
        assert.equal(await page.locator('#deleteSessionDialog').evaluate(e => e.open), true);
        await page.keyboard.press('Escape'); await page.keyboard.press('Escape');
        await page.evaluate(() => document.querySelector('#approvalDialog').showModal());
        await hold('input[name="approvalProfile"][value="strict"]');
        assert.equal(await page.locator('input[name="approvalProfile"][value="strict"]').isChecked(), false, 'holding a policy choice explains it without selecting it');
        await page.keyboard.press('Escape'); await page.keyboard.press('Escape');
        await page.evaluate(() => { const panel = document.createElement('dialog'); panel.id = 'fixtureApprovals'; panel.innerHTML = '<button type="button" data-reply="once">Allow once</button><button type="button" data-reply="always">Always</button><button type="button" data-reply="reject">Reject</button>'; document.body.append(panel); panel.showModal(); });
        for (const decision of ['once', 'always', 'reject']) { await hold(`#fixtureApprovals [data-reply="${decision}"]`); assert.equal(await page.evaluate(key => fixtureActions[key], decision), 0); }
        await page.keyboard.press('Escape'); await page.keyboard.press('Escape');
        await hold('#sendButton'); assert.equal(await page.evaluate(() => fixtureActions.send), 0);
        await page.keyboard.press('Escape'); await page.locator('#sendButton').tap(); assert.equal(await page.evaluate(() => fixtureActions.send), 1, 'a fresh normal tap still works after holding');
        await hold('#sendButton', false, 20); assert.equal(await page.evaluate(() => fixtureActions.send), 1, 'a scroll/drag cancels hold help without sending');
        await input.detach();
      }
      assert.equal(await page.locator('#promptInput').inputValue(), 'A private unsent draft'); assert.deepEqual(errors, []);
      console.log(`PASS: ${name}: ${audit.total} controls, hover/focus, preserved ARIA, native layers, dynamic content${touch ? ', safe real-touch holds and scroll cancellation' : ''}`);
      await context.close();
    }
  } finally { await browser.close(); }
})().catch(error => { console.error(error.stack); process.exitCode = 1; });
