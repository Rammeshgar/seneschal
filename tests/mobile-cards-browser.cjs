'use strict';
// Real rendering functions in an in-memory fixture; no live engine or user profile.
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
if (!process.argv[2]) throw Error('Supply an existing Playwright path. No installation is performed.');
const { chromium } = require(process.argv[2]);
const root = path.join(__dirname, '..'), read = file => fs.readFileSync(path.join(root, file), 'utf8');
const app = read('app/app.js');
const slice = (start, end) => { const first = app.indexOf(start), last = app.indexOf(end, first); assert.ok(first >= 0 && last > first); return app.slice(first, last); };
const code = slice('  function renderTool(', '  function liveActivityText(') + slice('  function bindToolDisclosures(', '  function messagePreview(') + slice('  function syncMessageMaximizeControl(', '  function exitMaximizedMessage(');
const html = read('app/index.html').replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '').replace(/<link\b[^>]*>/gi, '');
const output = path.join(root, '.test-temp/mobile-cards'); fs.mkdirSync(output, { recursive: true });
(async () => {
  const browser = await chromium.launch({ executablePath: 'C:\\Program Files\\BraveSoftware\\Brave-Browser\\Application\\brave.exe', headless: true });
  try {
    for (const [label, width, height, remote, theme] of [['small-phone', 320, 640, false, 'night'], ['phone', 390, 844, true, 'night'], ['reference-phone', 480, 900, false, 'night'], ['phone-day', 390, 844, true, 'day'], ['landscape', 844, 390, true, 'night'], ['desktop', 1365, 900, false, 'night']]) {
      const context = await browser.newContext({ viewport: { width, height } }), page = await context.newPage();
      page.setDefaultTimeout(5000); await page.route('**/*', route => route.abort());
      await page.setContent(html); await page.addStyleTag({ content: read('app/styles.css') });
      if (remote) { await page.addStyleTag({ content: read('app/private-access.css') }); await page.evaluate(() => { document.body.classList.add('remote-client'); document.body.insertAdjacentHTML('afterbegin', '<header class="remote-host-bar">Private connection · Fixture PC</header>'); }); }
      await page.evaluate(theme => {
        document.documentElement.dataset.theme = theme;
        window.$ = (selector, root = document) => root.querySelector(selector); window.$$ = (selector, root = document) => [...root.querySelectorAll(selector)];
        window.escapeHTML = value => String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
        window.formatText = value => `<p>${escapeHTML(value)}</p>`;
        window.state = { currentSessionID: 'ses_fixture', currentDirectory: '/fixture', selectedAgent: 'build', pinnedMessages: {}, archivedMessages: {}, deletedMessages: {}, showArchivedMessages: false, maximizedMessageID: '', collapsedMessageIDs: new Set(), userScrolledAway: true, messages: [
          { info: { id: 'msg_tool', role: 'assistant', modelID: 'gpt-6.1-sol' }, parts: [{ type: 'reasoning', text: 'Preparing a harmless output test.' }, { type: 'text', text: 'The tool result is shown below.' }, { type: 'tool', tool: 'bash', state: { status: 'completed', title: 'Print a harmless approval test message', output: 'Seneschal approval test' } }] },
          { info: { id: 'msg_final', role: 'assistant', modelID: 'gpt-6.1-sol' }, parts: [{ type: 'text', text: 'Seneschal approval test' }] },
          { info: { id: 'msg_user', role: 'user' }, parts: [{ type: 'text', text: 'A message whose edit, retry and copy controls must remain available.' }] },
          { info: { id: 'msg_long', role: 'assistant', modelID: 'gpt-6.1-sol' }, parts: [{ type: 'tool', tool: 'seneschal_public_page_reader', state: { status: 'completed', title: 'A long tool title ' + 'https://example.invalid/'.repeat(10), output: Array.from({ length: 40 }, (_, i) => `Output line ${i}: ${'word '.repeat(20)}`).join('\n') } }] }
        ] };
        window.els = { welcome: $('#welcomeView'), messageScroll: $('#messageScroll'), messageList: $('#messageList'), pinnedShelf: $('#pinnedMessageShelf'), pinnedList: $('#pinnedMessageList'), archivedMessagesButton: $('#archivedMessagesButton'), archivedMessagesCount: $('#archivedMessagesCount') };
        window.selectedSession = () => ({ id: 'ses_fixture' }); window.storedMessageIDs = () => new Set(); window.agentDisplayName = () => 'Build'; window.sessionStatus = () => 'idle'; window.messagePlainText = () => 'Fixture response';
        window.renderPinnedMessages = window.renderMessageMap = window.syncMessageMaximizeControl = () => {};
        window.fixtureActions = [];
        for (const name of ['copyRenderedMessage', 'retryUserMessage', 'openMessageEditor', 'createBoardFromMessage', 'toggleMessagePin', 'toggleMessageArchive', 'openDeleteMessage', 'copyCodeBlock']) window[name] = () => fixtureActions.push(name);
        $('#sessionHeader').hidden = false; $('#sessionTitle').textContent = 'Mobile layout test'; $('.composer').classList.add('minimized');
      }, theme);
      await page.addScriptTag({ content: code + '\nbindMessageActionMenus(); bindToolDisclosures(); renderMessages();' });
      const first = page.locator('[data-message="msg_tool"]'), final = page.locator('[data-message="msg_final"]');
      if (width <= 680) {
        assert.equal(await first.locator('.message-actions-menu').getAttribute('open'), null);
        assert.equal(await first.locator('.message-copy-button').isVisible(), false);
        assert.ok((await first.locator('.message-body').boundingBox()).width >= width - 42, `${label}: no wasted avatar column`);
        const plainCard = await final.boundingBox(); assert.ok(plainCard.height < 150, `${label}: short response remains compact`);
        await first.locator('summary[aria-label^="Actions"]').focus(); await page.keyboard.press('Enter');
        assert.equal(await first.locator('.message-copy-button').isVisible(), true);
        for (const button of await first.locator('.message-view-controls button').all()) { const rect = await button.boundingBox(); assert.ok(rect.height >= 44 && rect.x >= 0 && rect.x + rect.width <= width + 1); }
        await first.locator('.message-copy-button').click(); assert.deepEqual(await page.evaluate(() => fixtureActions), ['copyRenderedMessage']);
        await first.locator('.message-copy-button').focus(); await page.keyboard.press('Escape');
        assert.equal(await first.locator('.message-copy-button').isVisible(), false);
        assert.equal(await first.locator('summary[aria-label^="Actions"]').evaluate(el => el === document.activeElement), true);
        await first.locator('summary[aria-label^="Actions"]').click();
        await first.locator('.message-maximize-button').click();
        assert.equal(await first.evaluate(el => el.classList.contains('maximized')), true);
        await first.locator('summary[aria-label^="Actions"]').click();
        const expanded = await first.locator('.message-body').boundingBox();
        assert.ok(expanded.x >= 0 && expanded.x + expanded.width <= width && expanded.y >= (remote ? 100 : 54), `${label}: expanded card remains below the top bar`);
        await first.locator('summary[aria-label^="Actions"]').click();
        await first.getByRole('button', { name: 'Restore normal message view' }).click();
        assert.equal(await first.evaluate(el => el.classList.contains('maximized')), false);
        await first.locator('summary[aria-label^="Actions"]').focus(); await page.keyboard.press('Escape');
      } else assert.equal(await first.locator('.message-copy-button').isVisible(), true, 'desktop controls stay exposed');
      const toolDetails = first.locator('.tool-part');
      {
        assert.equal(await toolDetails.getAttribute('open'), null, 'completed Bash starts collapsed on desktop and phone');
        await toolDetails.locator('summary').focus(); await page.keyboard.press('Enter');
        assert.equal(await toolDetails.locator('pre').isVisible(), true);
        await page.evaluate(() => renderMessages());
        assert.equal(await first.locator('.tool-part pre').isVisible(), true, 'manual expansion survives message refresh');
      }
      const status = first.locator('.tool-status'), tool = first.locator('.tool-summary strong');
      const statusRect = await status.boundingBox(), toolRect = await tool.boundingBox();
      if (width <= 680) { assert.equal(await status.evaluate(el => getComputedStyle(el).whiteSpace), 'nowrap'); assert.ok(Math.abs(statusRect.y - toolRect.y) < 3); }
      assert.equal(await first.locator('pre').getAttribute('tabindex'), '0');
      if (width <= 680) {
        const long = page.locator('[data-message="msg_long"] .tool-part'); await long.locator('summary').click();
        assert.equal(await long.locator('pre').evaluate(el => el.clientHeight <= 180 && el.scrollHeight > el.clientHeight), true, `${label}: long output scrolls inside its card`);
        await long.locator('summary').click(); await first.locator('.tool-summary').click();
      }
      for (const card of await page.locator('.message-body').all()) { const rect = await card.boundingBox(); assert.ok(rect.x >= 0 && rect.x + rect.width <= width + 1, `${label}: all cards within viewport`); }
      await page.locator('#messageScroll').evaluate(el => { el.scrollTop = 0; });
      if (width === 480 || label === 'phone-day') await page.screenshot({ path: path.join(output, `${label}.png`) });
      if (width <= 680) {
        await page.setViewportSize({ width: 1365, height: 900 }); await page.waitForFunction(() => [...document.querySelectorAll('.message-actions-menu')].every(el => el.open));
        assert.equal(await toolDetails.getAttribute('open'),null,'manually collapsed Bash stays collapsed when switching to desktop');
        await page.setViewportSize({ width, height }); await page.waitForFunction(() => [...document.querySelectorAll('.message-actions-menu')].every(el => !el.open));
      }
      await page.evaluate(() => {
        state.messages.push({info:{id:'msg_bash_resize',role:'assistant'},parts:[{id:'prt_bash_resize',type:'tool',tool:'bash',state:{status:'completed',title:'Unopened Bash resize fixture',output:'Harmless fixture'}}]});renderMessages();
      });
      const untouched=page.locator('[data-tool-key="prt_bash_resize"]');assert.equal(await untouched.getAttribute('open'),null);
      await page.setViewportSize({width:width<=680?1365:390,height:900});
      await page.waitForTimeout(50);assert.equal(await untouched.getAttribute('open'),null,'viewport changes cannot auto-expand an untouched completed Bash');
      await page.setViewportSize({width,height});
      await untouched.locator('summary').focus();await page.keyboard.press('Enter');
      await page.evaluate(()=>renderMessages());assert.equal(await untouched.locator('pre').isVisible(),true,'keyboard expansion remains available and survives refresh');
      console.log(`PASS: ${label} compact cards, accessible actions, full tool labels, contained output and responsive resize`);
      await context.close();
    }
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
