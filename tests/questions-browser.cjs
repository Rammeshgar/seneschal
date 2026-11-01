'use strict';
// Local-only visual fixture. No live Seneschal, existing browser profile, engine or account.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const playwrightPath = process.argv[2];
if (!playwrightPath) throw Error('Supply an existing Playwright package path; this check never installs dependencies.');
const { chromium } = require(playwrightPath);
const root = path.resolve(__dirname, '..'), output = path.join(root, '.test-temp', 'questions-review');
fs.mkdirSync(output, { recursive: true });
const fixture = '<!doctype html><html lang="en" data-theme="night"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head><body><main><h1>Question controls fixture</h1><button id="initial">Session</button><section id="questionDock" class="question-dock" hidden></section><textarea aria-label="Composer"></textarea></main></body></html>';
(async () => {
  let browser;
  const watchdog = setTimeout(() => { console.error('Question browser fixture exceeded its limit.'); process.exit(1); }, 45000);
  try {
    browser = await chromium.launch({ executablePath: 'C:\\Program Files\\BraveSoftware\\Brave-Browser\\Application\\brave.exe', headless: true });
    for (const [label, width, height, theme] of [['desktop', 1365, 900, 'night'], ['phone', 390, 844, 'night'], ['phone-short', 390, 520, 'night'], ['day', 1365, 900, 'day']]) {
      const context = await browser.newContext({ viewport: { width, height } });
      const page = await context.newPage();
      await page.route('**/*', route => route.abort());
      await page.setContent(fixture);
      await page.evaluate(theme => document.documentElement.dataset.theme = theme, theme);
      await page.addStyleTag({ content: fs.readFileSync(path.join(root, 'app', 'styles.css'), 'utf8') });
      await page.addStyleTag({ content: fs.readFileSync(path.join(root, 'app', 'questions.css'), 'utf8') });
      await page.evaluate(() => {
        window.fixturePosts = []; window.fixturePending = [{ id: 'que_fixture', sessionID: 'ses_fixture', questions: [
          { header: 'Research', question: 'How should I research this topic?', options: [{ label: 'Read public pages', description: 'Use Moli for background research.' }, { label: 'Open visible Brave', description: 'Let me watch the browser task.' }], custom: true },
          { header: 'Details', question: 'Which details should the report include?', options: [{ label: 'Sources', description: 'Include references.' }, { label: 'Summary', description: 'Keep the main points clear.' }], multiple: true, custom: false }
        ] }];
        window.fetch = async (_url, options) => {
          if (options.method === 'POST') { window.fixturePosts.push({ url: _url, body: JSON.parse(options.body) }); window.fixturePending = []; return { ok: true, status: 204 }; }
          return { ok: true, status: 200, json: async () => window.fixturePending };
        };
      });
      await page.addScriptTag({ content: fs.readFileSync(path.join(root, 'app', 'questions.js'), 'utf8') });
      await page.evaluate(() => dispatchEvent(new CustomEvent('seneschal-question-context', { detail: { sessionID: 'ses_fixture', directory: '/fixture/project' } })));
      await page.locator('dialog[open]').waitFor();
      assert.equal(await page.locator('dialog input:checked').count(), 0);
      await page.getByRole('button', { name: 'Send answers', exact: true }).click();
      assert.equal(await page.evaluate(() => fixturePosts.length), 0);
      await page.getByLabel('Read public pages', { exact: false }).check();
      await page.getByLabel('Sources', { exact: false }).check();
      await page.getByLabel('Summary', { exact: false }).check();
      await page.getByLabel('Or write your own answer', { exact: true }).fill('A custom instruction');
      assert.equal(await page.locator('dialog input[type=radio]:checked').count(), 0);
      await page.getByLabel('Read public pages', { exact: false }).check();
      assert.equal(await page.getByLabel('Or write your own answer', { exact: true }).inputValue(), '');
      await page.getByRole('button', { name: 'Refresh questions', exact: true }).last().click();
      assert.equal(await page.locator('dialog input:checked').count(), 3);
      const bounds = await page.locator('dialog').boundingBox();
      assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= width + 1); assert.ok(bounds.y >= 0 && bounds.y + bounds.height <= height + 1);
      await page.screenshot({ path: path.join(output, `${label}.png`) });
      await page.getByRole('button', { name: 'Send answers', exact: true }).focus();
      await page.keyboard.press('Tab');
      assert.equal(await page.evaluate(() => document.activeElement.textContent), 'Close');
      await page.keyboard.press('Escape'); assert.equal(await page.locator('dialog[open]').count(), 0);
      assert.equal(await page.evaluate(() => fixturePosts.length), 0);
      await page.getByRole('button', { name: 'Answer question', exact: true }).click();
      assert.equal(await page.locator('dialog input:checked').count(), 3);
      await page.getByRole('button', { name: 'Send answers', exact: true }).click();
      await page.waitForFunction(() => fixturePosts.length === 1);
      assert.deepEqual(await page.evaluate(() => fixturePosts[0].body.answers), [['Read public pages'], ['Sources', 'Summary']]);
      assert.equal(await page.locator('dialog[open]').count(), 0);
      console.log(`PASS: ${label} question controls, draft, Escape, explicit submission and viewport bounds`);
      await context.close();
    }
  } finally { clearTimeout(watchdog); if (browser) await browser.close(); }
})().catch(error => { console.error(error.message); process.exitCode = 1; });
