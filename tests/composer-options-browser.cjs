'use strict';
// Isolated in-memory fixture: no model, microphone, live service or personal profile.
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
if (!process.argv[2]) throw Error('Supply an existing Playwright path; no dependencies are installed.');
const { chromium } = require(process.argv[2]);
const { sanitize } = require('../scripts/private-access-gateway.cjs');
const root = path.join(__dirname, '..'), read = file => fs.readFileSync(path.join(root, file), 'utf8');
const app = read('app/app.js');
const extract = (start, end) => { const first = app.indexOf(start), last = app.indexOf(end, first); assert.ok(first >= 0 && last > first); return app.slice(first, last); };
const code = extract('  function bindComposerOptions(', '  function bindModelPicker(') + extract('  function renderVoiceControl(', '  function setListening(') + extract('  function renderModelVariants(', '  function renderModelCapability(') + extract('  function bindVoiceControls(', '  function bindEvents(');
const provider = sanitize('/api/provider', { all: [{ id: 'openai', models: { fixture: { id: 'fixture', variants: { low: { privateOption: 'never-export' }, medium: {}, high: {} } } } }] });
const model = { ...provider.all[0].models.fixture, value: 'openai/fixture' };
const html = read('app/index.html').replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '').replace(/<link\b[^>]*>/gi, '');
const output = path.join(root, '.test-temp/composer-options'); fs.mkdirSync(output, { recursive: true });
(async () => {
  const browser = await chromium.launch({ executablePath: 'C:\\Program Files\\BraveSoftware\\Brave-Browser\\Application\\brave.exe', headless: true });
  try {
    for (const [label, width, height, remote, theme] of [['small-phone', 320, 640, false, 'night'], ['phone', 390, 844, true, 'night'], ['keyboard-height', 390, 400, true, 'night'], ['phone-day', 390, 844, true, 'day'], ['tablet', 844, 800, false, 'night'], ['desktop', 1365, 900, false, 'night']]) {
      const context = await browser.newContext({ viewport: { width, height } }), page = await context.newPage();
      page.setDefaultTimeout(5000); await page.route('**/*', route => route.abort());
      await page.setContent(html); await page.addStyleTag({ content: read('app/styles.css') }); await page.addStyleTag({ content: read('app/ares.css') });
      if (remote) { await page.addStyleTag({ content: read('app/private-access.css') }); await page.evaluate(() => { document.body.classList.add('remote-client'); document.body.insertAdjacentHTML('afterbegin', '<header class="remote-host-bar">Private connection · Fixture PC</header>'); }); }
      await page.evaluate(theme => {
        document.documentElement.dataset.theme = theme;
        window.$ = (selector, root = document) => root.querySelector(selector);
        window.els = { prompt: $('#promptInput'), fileInput: $('#fileInput'), mic: $('#micButton'), talk: $('#talkButton') };
        window.state = { conversationMode: false };
        window.updateConversationClearance = () => {};
        window.fixtureSends = 0; window.fixtureStops = 0;
        window.fixtureTalkClicks = 0; window.fixtureMicClicks = 0;
        $('#talkButton').addEventListener('click', () => { fixtureTalkClicks++; state.conversationMode = !state.conversationMode; els.talk.dataset.stage = state.conversationMode ? 'Listening' : ''; renderVoiceControl(); });
        $('#micButton').addEventListener('click', () => { fixtureMicClicks++; els.mic.setAttribute('aria-pressed', 'false'); renderVoiceControl(); });
        $('#composerForm').addEventListener('submit', event => { event.preventDefault(); fixtureSends++; });
        $('#composerStopButton').addEventListener('click', () => { fixtureStops++; });
        $('#skillsButton').addEventListener('click', () => $('#instructionDialog').showModal());
        $('#agentSelect').innerHTML = '<option value="build">Build</option><option value="plan">Plan</option>';
        $('#modelVariantSelect').innerHTML = '<option value="medium">Medium</option><option value="high">High</option>';
        $('#modelVariantWrap').hidden = false;
        // Current production maintenance layer hides these duplicate browser controls.
        $('.browser-compose-group').hidden = true;
        $('#promptInput').value = 'Keep this unsent draft intact';
      }, theme);
      await page.evaluate(model => {
        window.selectedModel = () => model;
        state.selectedVariants = {};
        window.storage = { set() {} };
        window.escapeHTML = value => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('"', '&quot;');
        els.modelVariantWrap = $('#modelVariantWrap'); els.modelVariant = $('#modelVariantSelect');
        $('#modelVariantSelect').addEventListener('change', event => { state.selectedVariants[model.value] = event.target.value; });
      }, model);
      await page.addScriptTag({ content: code + '\nbindComposerOptions(); bindVoiceControls(); renderVoiceControl(); renderModelVariants();' });
      assert.deepEqual(await page.locator('#modelVariantSelect option').evaluateAll(options => options.map(option => option.value)), ['low', 'medium', 'high']);
      const options = page.locator('#composerOptions'), trigger = page.locator('#composerOptionsSummary'), send = page.getByRole('button', { name: 'Send message', exact: true });
      const compactHeight = await page.locator('#composerForm').evaluate(el => el.getBoundingClientRect().height);
      {
        assert.equal(await page.locator('#skillsButton').isVisible(), false);
        assert.equal(await send.isVisible(), true); assert.equal(await trigger.isVisible(), true);
        assert.ok(compactHeight < (width<=360?240:190), `${label}: composer fits without shrinking touch targets`);
        await trigger.focus(); await page.keyboard.press('Enter');
        assert.equal(await page.locator('#skillsButton').isVisible(), true);
        const bounds = await page.locator('#composerOptionsPanel').boundingBox();
        assert.ok(bounds.x >= 0 && bounds.y >= 0 && bounds.x + bounds.width <= width && bounds.y + bounds.height <= height, `${label}: options fit viewport`);
        assert.equal(await page.locator('#composerForm').evaluate(el => el.getBoundingClientRect().height), compactHeight, 'opening options does not expand the composer');
        await page.getByRole('combobox', { name: 'Model thinking level' }).selectOption('high');
        await page.evaluate(() => renderModelVariants());
        assert.equal(await page.locator('#modelVariantSelect').inputValue(), 'high', 'sanitized thinking choice survives render');
        await page.getByRole('combobox', { name: 'Agent mode' }).selectOption('plan');
        assert.equal(await page.evaluate(() => fixtureSends), 0);
        await page.locator('#skillsButton').click(); await page.locator('#instructionDialog[open]').waitFor();
        assert.equal(await options.getAttribute('open'), '');
        await page.evaluate(() => document.querySelector('#instructionDialog').close());
        await page.getByRole('button', { name: 'Attach files', exact: true }).scrollIntoViewIfNeeded();
        const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.getByRole('button', { name: 'Attach files', exact: true }).click()]);
        await chooser.setFiles([]);
        await page.locator('#voiceMenuButton').scrollIntoViewIfNeeded(); await page.locator('#voiceMenuButton').click();
        assert.equal(await page.locator('#voiceOptionsPanel').evaluate(el => el.matches(':popover-open')), true);
        await page.keyboard.press('Escape');
        assert.equal(await options.getAttribute('open'), null, 'Voice options are independent of setup');
        await trigger.click(); await trigger.focus(); await page.keyboard.press('Escape');
        assert.equal(await options.getAttribute('open'), null);
        assert.equal(await trigger.evaluate(el => document.activeElement === el), true);
        await page.evaluate(() => { state.conversationMode = true; renderVoiceControl(); });
        assert.equal(await page.locator('#voiceButton').isVisible(), true, 'active Voice stays directly available');
        assert.equal(await page.locator('#voiceButton').getAttribute('aria-pressed'), 'true');
        assert.equal(await page.evaluate(() => state.conversationMode), true);
        await trigger.click(); await page.locator('#refreshButton').click();
        assert.equal(await options.getAttribute('open'), null, 'outside tap closes the options');
        assert.equal(await page.locator('#promptInput').inputValue(), 'Keep this unsent draft intact');
        await page.evaluate(() => { state.conversationMode = false; renderVoiceControl(); $('#composerStopButton').hidden = false; });
        await page.getByRole('button', { name: 'Stop', exact: true }).click();
        assert.equal(await page.evaluate(() => fixtureStops), 1); assert.equal(await send.isVisible(), true);
        if (height > 500 && remote) { await trigger.click(); await page.screenshot({ path: path.join(output, `${label}-open.png`) }); await trigger.click(); await page.screenshot({ path: path.join(output, `${label}-closed.png`) }); }
        await page.setViewportSize({ width: 1365, height: 900 }); await page.waitForFunction(() => !document.querySelector('#composerOptions').open);
        assert.equal(await page.locator('#skillsButton').isVisible(), false);
        await page.setViewportSize({ width, height }); await page.waitForFunction(() => !document.querySelector('#composerOptions').open);
      }
      const primary = page.locator('#voiceButton'), arrow = page.locator('#voiceMenuButton');
      await primary.scrollIntoViewIfNeeded(); await primary.click();
      assert.equal(await page.evaluate(() => fixtureTalkClicks), 1, 'main Voice starts Talk directly');
      assert.equal(await page.locator('#voiceOptionsPanel').evaluate(el => el.matches(':popover-open')), false, 'main Voice cannot open the options');
      assert.equal(await primary.getAttribute('aria-pressed'), 'true');
      await primary.click(); assert.equal(await page.evaluate(() => fixtureTalkClicks), 2); assert.equal(await primary.getAttribute('aria-pressed'), 'false');
      await page.evaluate(() => { els.mic.setAttribute('aria-pressed', 'true'); renderVoiceControl(); });
      await primary.click(); assert.equal(await page.evaluate(() => fixtureMicClicks), 1, 'main Voice stops active dictation instead of starting a second mode');
      assert.equal(await page.evaluate(() => fixtureTalkClicks), 2);
      await arrow.click(); await page.waitForFunction(() => document.querySelector('#voiceMenuButton').getAttribute('aria-expanded') === 'true');
      assert.equal(await page.evaluate(() => fixtureTalkClicks), 2, 'arrow never starts or stops voice');
      const popup = await page.locator('#voiceOptionsPanel').boundingBox(); assert.ok(popup.x >= 0 && popup.y >= 0 && popup.x + popup.width <= width && popup.y + popup.height <= height, 'voice popup stays in the viewport');
      await page.keyboard.press('Escape');
      await primary.focus(); await page.keyboard.press('ArrowDown'); assert.equal(await page.locator('#voiceServiceSelect').evaluate(el => el === document.activeElement), true);
      await page.keyboard.press('Escape');
      assert.equal(await primary.evaluate(el => el === document.activeElement), true, 'keyboard-opened voice options return focus to Voice');
      await page.evaluate(() => $('#composerStopButton').hidden = true);
      const upload=await page.locator('#attachFilesButton').boundingBox(),setup=await trigger.boundingBox(),voice=await page.locator('.composer-voice-group').boundingBox(),submit=await send.boundingBox();
      assert.ok(upload.x < setup.x, 'Upload is the first action');
      assert.ok(voice.x+voice.width <= submit.x+1 && submit.x-voice.x-voice.width < 14, 'Voice is adjacent to Send');
      assert.ok(Math.abs(voice.y-submit.y) < 2, 'Voice and Send align on one row');
      const mascot=await page.locator('#aresToggle').boundingBox();
      assert.ok(mascot.x+mascot.width<=voice.x+1 && voice.x-mascot.x-mascot.width<14,'Mascot sits directly beside Voice');
      assert.ok(Math.abs(mascot.y-voice.y)<2,'Mascot and Voice align');
      await trigger.click(); await page.screenshot({path:path.join(output, `${label}-open.png`)}); await trigger.click();
      await page.screenshot({path:path.join(output, `${label}-closed.png`)});
      assert.equal(await page.evaluate(() => fixtureSends), 0, 'opening controls never sends a message');
      await send.click(); assert.equal(await page.evaluate(() => fixtureSends), 1);
      console.log(`PASS: ${label} default state, compact layout, skills/upload/voice/thinking/agent, explicit Send/Stop and preserved draft`);
      await context.close();
    }
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
