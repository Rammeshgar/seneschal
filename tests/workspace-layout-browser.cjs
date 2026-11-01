'use strict';
// Disposable synthetic UI. No live host, engine, credentials, microphone or cloud.
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const { chromium } = require(process.argv[2]);
const root = path.join(__dirname, '..'), read = name => fs.readFileSync(path.join(root, name), 'utf8');
const app = read('app/app.js');
const extract = (start, end) => { const a = app.indexOf(start), b = app.indexOf(end, a); assert.ok(a >= 0 && b > a); return app.slice(a, b); };
const owners = extract('  function syncPanelState()', '  const motionPresets =')
  + extract('  function renderPermissions()', '  function renderAll()')
  + extract('  function updateConversationClearance()', '  function syncMessageMaximizeControl(')
  + extract('  function renderVoiceControl()', '  function stopMediaRecording()')
  + extract('  function bindVoiceControls()', '  function bindEvents()');
const html = read('app/index.html').replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '').replace(/<link\b[^>]*>/gi, '');
const out = path.join(root, '.test-temp/workspace-layout'); fs.mkdirSync(out, { recursive: true });
(async () => {
  const browser = await chromium.launch({ executablePath: 'C:\\Program Files\\BraveSoftware\\Brave-Browser\\Application\\brave.exe', headless: true });
  try {
    for (const [label, width, height, remote, theme, reduced] of [
      ['desktop', 1600, 1000, false, 'night', false], ['laptop', 1365, 768, false, 'night', false],
      ['phone', 390, 844, true, 'night', false], ['small-phone', 320, 640, true, 'night', false],
      ['keyboard', 390, 400, true, 'night', false], ['landscape', 844, 390, true, 'night', false],
      ['day', 1365, 900, false, 'day', false], ['reduced', 1365, 900, false, 'night', true]
    ]) {
      const context = await browser.newContext({ viewport: { width, height }, reducedMotion: reduced ? 'reduce' : 'no-preference' });
      const page = await context.newPage(), errors = [];
      page.on('pageerror', error => errors.push(error.message)); page.setDefaultTimeout(6000);
      await page.route('**/*', route => route.abort()); await page.setContent(html);
      for (const name of ['styles.css', 'ares.css', 'questions.css', ...(remote ? ['private-access.css'] : [])]) await page.addStyleTag({ content: read('app/' + name) });
      await page.evaluate(({ theme, remote }) => {
        document.documentElement.dataset.theme = theme;
        if (remote) { document.body.classList.add('remote-client'); document.body.insertAdjacentHTML('afterbegin', '<header class="remote-host-bar">Private connection · Fixture PC</header>'); }
        window.$ = (s, node = document) => node.querySelector(s); window.$$ = (s, node = document) => [...node.querySelectorAll(s)];
        window.els = { form: $('#composerForm'), prompt: $('#promptInput'), mic: $('#micButton'), talk: $('#talkButton'), permissionDock: $('#permissionDock'), messageScroll: $('#messageScroll') };
        window.state = { permissions: [], permissionReplies: new Map(), currentSessionID: 'ses_fixture', leftPanelCollapsed: false, rightPanelCollapsed: false, conversationMode: false, attachments: [], currentDirectory: '/synthetic', models: [{}] };
        window.storage = { set() {} }; window.escapeHTML = value => String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('"', '&quot;');
        window.fixtureDecisions = []; window.replyPermission = (permission, reply) => fixtureDecisions.push({ id: permission.id, reply }); window.checkPermissionReply = () => {};
        window.toast = () => {}; window.selectedSession = () => null; window.autoSizePrompt = () => {};
        $('#welcomeView').hidden = true; $('#sessionHeader').hidden = false; $('#messageScroll').hidden = false;
        $('#sessionTitle').textContent = 'Workspace layout check'; $('#composerProject').textContent = 'Project: fixture';
        $('#messageList').innerHTML = Array.from({ length: 12 }, (_, i) => `<article class="message"><div class="message-avatar">SE</div><div class="message-body"><p>Message ${i + 1}: output remains inside the scrollable conversation area.</p></div></article>`).join('');
        $('#promptInput').value = 'An unsent draft to preserve';
        window.fixturePosts = 0; $('#composerForm').addEventListener('submit', event => { event.preventDefault(); fixturePosts++; });
        window.fixtureCaptureCount = 0;
        window.SpeechRecognition = class { constructor() { fixtureCaptureCount++; } start() { this.onstart?.(); } abort() { this.onend?.(); } };
        window.sendPrompt = () => { fixturePosts++; }; window.api = () => { throw Error('No real engine allowed'); };
      }, { theme, remote });
      await page.addScriptTag({ content: owners + '\nsyncPanelState(); bindConversationLayout(); bindVoiceControls(); renderVoiceControl();' });
      const checkFlow = async phase => {
        await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
        const result = await page.evaluate(() => {
          const r = id => { const e = document.getElementById(id), b = e.getBoundingClientRect(); return { top: b.top, bottom: b.bottom, left: b.left, right: b.right, height: b.height, visible: !e.hidden }; };
          return { header: r('sessionHeader'), footer: document.querySelector('.composer-footer').getBoundingClientRect().bottom, messages: r('messageScroll'), notices: r('conversationNotices'), input: r('composerForm'), panel: document.querySelector('.conversation-panel').getBoundingClientRect().bottom, overflow: document.documentElement.scrollWidth > innerWidth };
        });
        assert.ok(result.messages.bottom <= result.notices.top + 1, `${label} ${phase}: messages do not cover notices`);
        assert.ok(result.notices.bottom <= result.input.top + 1, `${label} ${phase}: notices do not cover input`);
        assert.ok(result.input.bottom <= result.panel + 1, `${label} ${phase}: input stays on screen: ${JSON.stringify(result)}`);
        assert.ok(result.footer <= result.input.bottom + 1, `${label} ${phase}: footer stays inside input: ${JSON.stringify(result)}`);
        assert.ok(result.messages.top >= result.header.bottom - 1, `${label} ${phase}: header never covers messages`);
        if (height > 500) assert.ok(result.messages.height >= 63, `${label} ${phase}: messages retain a scrollable region`);
        assert.equal(result.overflow, false);
      };
      if (width > 1120) {
        const left = await page.locator('#leftPanelToggle').boundingBox(), right = await page.locator('#rightPanelToggle').boundingBox();
        await page.evaluate(() => { state.leftPanelCollapsed = state.rightPanelCollapsed = true; syncPanelState(); });
        const leftSmall = await page.locator('#leftPanelToggle').boundingBox(), rightSmall = await page.locator('#rightPanelToggle').boundingBox();
        for (const [a, b, name] of [[left, leftSmall, 'left'], [right, rightSmall, 'right']]) {
          assert.ok(Math.abs(a.x - b.x) <= 1 && Math.abs(a.y - b.y) <= 1, `${label}: ${name} toggle remains anchored: ${JSON.stringify({ a, b })}`);
        }
        await page.evaluate(() => { state.leftPanelCollapsed = state.rightPanelCollapsed = false; syncPanelState(); });
      }
      await page.evaluate(() => {
        state.permissions = [{ id: 'per_fixture', sessionID: 'ses_fixture', permission: 'bash', patterns: ['printf "Synthetic permission test" <untrusted>'] }]; renderPermissions();
        $('#questionDock').hidden = false; $('#questionDock').innerHTML = '<p role="status">Questions could not load. No answer or approval was sent.</p><button type="button">Refresh questions</button>';
      });
      await checkFlow('pending approval and question error');
      assert.equal(await page.locator('.permission-content h3').textContent(), 'bash');
      assert.match(await page.locator('.permission-pattern').textContent(), /<untrusted>/);
      assert.equal(await page.locator('.permission-pattern untrusted').count(), 0);
      assert.equal(await page.evaluate(() => fixtureDecisions.length), 0);
      await page.locator('[data-reply="reject"]').focus(); await page.keyboard.press('Enter');
      assert.deepEqual(await page.evaluate(() => fixtureDecisions), [{ id: 'per_fixture', reply: 'reject' }]);
      await page.evaluate(() => { $('#composerForm').classList.add('expanded'); $('#promptInput').style.height = '280px'; }); await checkFlow('expanded input');
      await page.evaluate(() => { $('#composerForm').classList.remove('expanded'); $('#promptInput').style.height = ''; });
      await page.screenshot({ path: path.join(out, label + '-decisions.png') });
      await page.evaluate(() => { state.permissions = []; renderPermissions(); $('#questionDock').hidden = true; state.conversationMode = true; setTalkState('Listening'); });
      const mic = page.locator('.voice-live-controls [data-voice-mute="mic"]'), speaker = page.locator('.voice-live-controls [data-voice-mute="speaker"]');
      await mic.click(); assert.equal(await mic.getAttribute('aria-pressed'), 'true');
      assert.equal(await page.locator('#aresCompanion [data-voice-mute="mic"]').getAttribute('aria-pressed'), 'true');
      await speaker.focus(); await page.keyboard.press('Space'); assert.equal(await speaker.getAttribute('aria-label'), 'Unmute speaker');
      assert.equal(await page.locator('#voiceOptionsPanel [data-voice-mute="speaker"]').getAttribute('aria-pressed'), 'true');
      assert.equal(await page.locator('#promptInput').inputValue(), 'An unsent draft to preserve');
      assert.equal(await page.evaluate(() => fixturePosts), 0); assert.equal(await page.evaluate(() => fixtureCaptureCount), 0);
      for (const control of [mic, speaker]) { const b = await control.boundingBox(); assert.ok(b.width >= 44 && b.height >= 44); assert.ok(b.y >= 0 && b.y + b.height <= height); }
      if (width <= 680) { await page.locator('#voiceMenuButton').click(); assert.equal(await page.locator('#voiceOptionsPanel').evaluate(e => e.matches(':popover-open')), true); await page.keyboard.press('Escape'); }
      await page.screenshot({ path: path.join(out, label + '-audio.png') }); assert.deepEqual(errors, []);
      console.log(`PASS: ${label} stacked decisions/input/messages, anchored rails, explicit approval, shared mute controls and preserved draft`);
      await context.close();
    }
  } finally { await browser.close(); }
})().catch(error => { console.error(error.stack); process.exitCode = 1; });
