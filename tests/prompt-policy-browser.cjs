'use strict';
// Offline fixture only: no live engine, credentials, model calls or personal profile.
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
if (!process.argv[2]) throw Error('Supply the existing Playwright path.');
const { chromium } = require(process.argv[2]);
const source = fs.readFileSync(path.join(__dirname, '../app/app.js'), 'utf8');
const code = source.slice(source.indexOf('  function promptToolRestrictions('), source.indexOf('  async function sendPrompt('));
const html = fs.readFileSync(path.join(__dirname, '../app/index.html'), 'utf8');
const statusMarkup = html.match(/<p class="prompt-delivery-status"[^>]*><\/p>/)?.[0];
assert.ok(statusMarkup);
(async () => {
  const browser = await chromium.launch({ executablePath: 'C:\\Program Files\\BraveSoftware\\Brave-Browser\\Application\\brave.exe', headless: true });
  try {
    for (const width of [390, 1365]) {
      const page = await browser.newPage({ viewport: { width, height: 844 } });
      await page.route('**/*', route => route.abort());
      await page.setContent('<label for="draft">Message</label><textarea id="draft">Keep my draft</textarea><button id="send">Send</button><p id="result" role="status"></p>' + statusMarkup);
      await page.addStyleTag({ content: fs.readFileSync(path.join(__dirname, '../app/styles.css'), 'utf8') });
      await page.evaluate(() => {
        window.state = { tools: [], promptSubmissions: new Set() };
        window.fixture = { rules: [], calls: [], brokenReset: false, busy: false };
        window.legacy = () => ['read', 'write', 'edit', 'bash', 'task', 'webfetch', 'websearch', 'glob', 'grep'].map(permission => ({ permission, pattern: '*', action: 'allow' }));
        fixture.rules = legacy();
        window.$ = selector => document.querySelector(selector);
        window.updateConversationClearance = () => {};
        const nativeTimeout = window.setTimeout.bind(window), nativeClear = window.clearTimeout.bind(window), nativeConfirm = window.confirm.bind(window);
        const networkTimers = new Set();
        window.setTimeout = (callback, ms) => { const id = nativeTimeout(callback, ms); if (ms === 15000) networkTimers.add(id); return id; };
        window.clearTimeout = id => { networkTimers.delete(id); nativeClear(id); };
        window.confirm = message => { fixture.timerCountAtConfirmation = networkTimers.size; return nativeConfirm(message); };
        window.api = async (route, options) => {
          fixture.calls.push({ route, method: options.method || 'GET' });
          if (route === '/session/status') return fixture.busy ? { ses_fixture: { type: 'busy' } } : {};
          if (route === '/global/health') return { healthy: true, version: fixture.brokenReset ? 'unsupported' : '1.19.0' };
          if (options.method === 'PATCH') { if (!fixture.brokenReset) fixture.rules = []; return {}; }
          if (options.method === 'POST') return {};
          return { permission: fixture.rules };
        };
      });
      await page.addScriptTag({ content: code + `
        document.querySelector('#send').onclick = async () => {
          setPromptDeliveryStatus();
          try { await submitSessionInput('ses_fixture', '/fixture', { agent: 'build', parts: [] }, () => { document.querySelector('#draft').value = ''; }); document.querySelector('#result').textContent = 'Sent'; }
          catch (error) { setPromptDeliveryStatus(error.message); document.querySelector('#result').textContent = error.message; }
        };` });
      for (const [decision, broken, busy, expectedPosts, expectedPatches] of [['dismiss', false, false, 0, 0], ['accept', false, true, 0, 0], ['accept', true, false, 0, 0], ['accept', false, false, 1, 0]]) {
        await page.evaluate(({ broken, busy }) => { fixture.rules = legacy(); fixture.calls = []; fixture.brokenReset = broken; fixture.busy = busy; document.querySelector('#draft').value = 'Keep my draft'; document.querySelector('#result').textContent = ''; }, { broken, busy });
        page.once('dialog', async dialog => { assert.equal(dialog.type(), 'confirm'); assert.match(dialog.message(), /keeps its messages and files/); await dialog[decision](); });
        await page.getByRole('button', { name: 'Send', exact: true }).click();
        await page.waitForFunction(() => document.querySelector('#result').textContent.length > 0);
        assert.equal(await page.evaluate(() => fixture.calls.filter(call => call.method === 'POST').length), expectedPosts);
        assert.equal(await page.evaluate(() => fixture.calls.filter(call => call.method === 'PATCH').length), expectedPatches);
        assert.equal(await page.locator('#draft').inputValue(), expectedPosts ? '' : 'Keep my draft');
        assert.equal(await page.evaluate(() => state.promptSubmissions.size), 0);
        assert.equal(await page.evaluate(() => fixture.timerCountAtConfirmation), 0, 'reading the native confirmation has no active network timer');
        assert.equal(await page.locator('#promptDeliveryStatus').isVisible(), expectedPosts === 0, 'failed delivery remains visible instead of only a toast');
      }
      console.log(`PASS: ${width}px explicit permission reset, cancellation, active-task protection, failed read-back and preserved draft`);
      await page.close();
    }
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
