'use strict';
// Fresh, offline-routed browser fixtures only. No live engine, profile or model calls.
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
if (!process.argv[2]) throw Error('Supply an existing Playwright path.');
const { chromium } = require(process.argv[2]);
const root = path.join(__dirname, '..'), read = file => fs.readFileSync(path.join(root, file), 'utf8');
const source = read('app/app.js');
const extract = (start, end) => source.slice(source.indexOf(start), source.indexOf(end, source.indexOf(start)));
const code = extract('  function setRecoveryStatus(', '  function setTheme(') + extract('  function createConnectionRecovery(', '  async function pollPermissions(');
const html = read('app/index.html').replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '').replace(/<link\b[^>]*>/gi, '');
(async () => {
  const browser = await chromium.launch({ executablePath: 'C:\\Program Files\\BraveSoftware\\Brave-Browser\\Application\\brave.exe', headless: true });
  try {
    for (const [name, width, height, remote, theme] of [['small-phone', 320, 640, true, 'night'], ['phone', 390, 844, true, 'night'], ['keyboard-phone', 390, 400, true, 'night'], ['day-phone', 390, 844, true, 'day'], ['desktop', 1365, 900, false, 'night']]) {
      const context = await browser.newContext({ viewport: { width, height } }), page = await context.newPage();
      page.setDefaultTimeout(5000); await page.route('**/*', route => route.abort());
      await page.setContent(html); await page.addStyleTag({ content: read('app/styles.css') });
      if (remote) { await page.addStyleTag({ content: read('app/private-access.css') }); await page.evaluate(() => { document.body.classList.add('remote-client'); document.body.insertAdjacentHTML('afterbegin', '<header class="remote-host-bar">Private connection · Fixture PC</header>'); }); }
      await page.evaluate(theme => {
        document.documentElement.dataset.theme = theme;
        window.$ = selector => document.querySelector(selector);
        window.els = { pulseLabel: { textContent: '' } };
        window.state = { currentSessionID: 'ses_fixture', currentDirectory: '/fixture', sessions: [{ id: 'ses_fixture', directory: '/fixture' }], messages: [], permissions: [], statuses: {}, permissionReplies: new Map([['per_old', { status: 'uncertain' }]]), attachments: ['keep attachment'], userScrolledAway: true };
        window.fixture = { reads: 0, writes: 0, auth: 200, version: 'initial', streams: [], renders: [] };
        window.api = async (route, options = {}) => {
          if (options.method && options.method !== 'GET') { fixture.writes++; throw Error('Unexpected mutation'); }
          fixture.reads++;
          if (!navigator.onLine) throw Error('Fixture offline');
          if (fixture.auth !== 200) { const error = Error('Fixture expired'); error.status = fixture.auth; throw error; }
          if (route === '/global/health') return { healthy: true };
          if (route === '/session') return [{ id: 'ses_fixture', directory: '/fixture' }];
          if (route === '/session/status') return { ses_fixture: { type: 'idle' } };
          if (route === '/permission') return [];
          return [{ text: fixture.version }];
        };
        window.selectedSession = () => state.sessions.find(session => session.id === state.currentSessionID);
        window.normalizeSession = value => value; window.mergePermissionSnapshot = value => value;
        window.renderProjects = window.renderSessions = window.renderHeader = window.renderUsage = window.renderPermissions = window.updateConversationClearance = window.setConnection = window.log = () => {};
        window.renderMessages = scroll => { fixture.renders.push(scroll); $('#messageList').textContent = state.messages.map(message => message.text).join('\n'); };
        window.withDirectory = value => value;
        window.EventSource = class {
          constructor(url) { this.url = url; this.closed = false; fixture.streams.push(this); setTimeout(() => { if (!this.closed) navigator.onLine ? this.onopen?.() : this.onerror?.(); }, 0); }
          close() { this.closed = true; }
        };
        $('#promptInput').value = 'Keep my unsent draft';
        $('#composerForm').addEventListener('submit', event => { event.preventDefault(); fixture.writes++; });
      }, theme);
      await page.addScriptTag({ content: code + '\nbindConnectionRecovery(); connectEvents();' });
      await page.waitForFunction(() => fixture.reads >= 5 && document.querySelector('#connectionRecoveryStatus').hidden);
      await page.locator('#promptInput').focus();
      await page.evaluate(() => { window.oldFixtureStream = state.eventSource; fixture.version = 'Completed while phone was disconnected'; });
      await context.setOffline(true);
      await page.getByRole('status').filter({ hasText: /^Offline\. PC tasks/ }).waitFor();
      assert.equal(await page.evaluate(() => oldFixtureStream.closed), true);
      await context.setOffline(false);
      await page.waitForFunction(() => document.querySelector('#connectionRecoveryStatus').hidden && document.querySelector('#messageList').textContent.includes('Completed while phone was disconnected'));
      assert.equal(await page.locator('#promptInput').inputValue(), 'Keep my unsent draft');
      assert.equal(await page.locator('#promptInput').evaluate(el => document.activeElement === el), true);
      assert.equal(await page.evaluate(() => state.currentSessionID), 'ses_fixture');
      assert.deepEqual(await page.evaluate(() => state.attachments), ['keep attachment']);
      assert.equal(await page.evaluate(() => state.userScrolledAway), true);
      assert.equal(await page.evaluate(() => state.permissionReplies.get('per_old').status), 'uncertain');
      await page.evaluate(() => {
        oldFixtureStream.onmessage({ data: JSON.stringify({ type: 'session.status', properties: { sessionID: 'ses_fixture', status: { type: 'busy' } } }) });
        window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true }));
        window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }));
      });
      await page.waitForFunction(() => fixture.streams.length >= 3 && document.querySelector('#connectionRecoveryStatus').hidden);
      assert.equal(await page.evaluate(() => state.statuses.ses_fixture.type), 'idle');
      await page.evaluate(() => {
        fixture.auth = 401;
        Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' }); document.dispatchEvent(new Event('visibilitychange'));
        Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' }); document.dispatchEvent(new Event('visibilitychange'));
      });
      await page.waitForFunction(() => /expired/.test(document.querySelector('#connectionRecoveryStatus').textContent));
      if (remote) {
        const pair = page.getByRole('link', { name: 'Pair this browser', exact: true });
        assert.equal(await pair.getAttribute('href'), '/remote/pair');
        const bounds = await pair.boundingBox(); assert.ok(bounds.width >= 44 && bounds.height >= 44 && bounds.x >= 0 && bounds.x + bounds.width <= width && bounds.y >= 0 && bounds.y + bounds.height <= height, `${name}: pairing link remains inside the viewport`);
        await pair.focus(); assert.equal(await pair.evaluate(el => document.activeElement === el), true);
      }
      const streams = await page.evaluate(() => fixture.streams.length);
      await page.evaluate(() => { window.dispatchEvent(new Event('online')); window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true })); });
      assert.equal(await page.evaluate(() => fixture.streams.length), streams);
      assert.equal(await page.evaluate(() => fixture.writes), 0);
      assert.ok((await page.evaluate(() => fixture.renders)).every(scroll => scroll === false));
      await page.evaluate(() => state.disposeConnectionRecovery());
      console.log(`PASS: ${name} automatic offline/online catch-up, history/wake recovery, unchanged draft/focus/decisions, zero mutations and expired-pairing stop`);
      await context.close();
    }
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
