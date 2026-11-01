'use strict';
// Disposable browser fixture, local assets only. No live host, audio, credentials or task engine.
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const { chromium } = require(process.argv[2]);
const root = path.join(__dirname, '..'), output = path.join(root, '.test-temp/ares-browser');
fs.mkdirSync(output, { recursive: true });
// Run the actual section disclosure owner without booting the task engine.
const appCode = fs.readFileSync(path.join(root, 'app/app.js'), 'utf8');
const sectionOwner = appCode.slice(appCode.indexOf('  function syncInspectorSections()'), appCode.indexOf('  function renderProjects()', appCode.indexOf('  function syncInspectorSections()')));
const optionsOwner = appCode.slice(appCode.indexOf('  function bindComposerOptions()'), appCode.indexOf('  function bindModelPicker()', appCode.indexOf('  function bindComposerOptions()')));
const inspectorFixture = `const $=(s,root=document)=>root.querySelector(s), $$=(s,root=document)=>[...root.querySelectorAll(s)]; const els={inspector:$('#inspector'),prompt:$('#promptInput'),fileInput:$('#fileInput')}; const updateConversationClearance=()=>{}; const storage={set:(key,value)=>localStorage.setItem(key,JSON.stringify(value))}; const state={inspectorSections:JSON.parse(localStorage.getItem('seneschal-inspector-sections')||'null')||{permissions:true,tools:true,browser:true,creative:true,code:true,budget:true,providers:true,pulse:true}}; ${sectionOwner}; ${optionsOwner}; syncInspectorSections(); bindComposerOptions(); $('.browser-compose-group').hidden=true; $('#agentSelect').innerHTML='<option>Seneschal · Build</option>'; $('#modelVariantWrap').hidden=false; $('#modelVariantSelect').innerHTML='<option>Medium</option>';`;
const html = fs.readFileSync(path.join(root, 'app/index.html'), 'utf8')
  .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
  .replace(/<link\b[^>]*>/gi, '')
  .replace('</head>', '<link rel="stylesheet" href="/workspace/styles.css"><link rel="stylesheet" href="/workspace/ares.css"><link rel="stylesheet" href="/workspace/private-access.css"><script src="/workspace/ares.js" defer></script><script src="/fixture-inspector.js" defer></script></head>');
const assets = ['favicon.svg', 'styles.css', 'private-access.css', 'ares.css', 'ares.js', 'ares-scene.js', 'assets/ares/three.module.js', 'assets/ares/GLTFLoader.js', 'assets/ares/BufferGeometryUtils.js', 'assets/ares/ares.glb'];
(async () => {
  const browser = await chromium.launch({ executablePath: 'C:\\Program Files\\BraveSoftware\\Brave-Browser\\Application\\brave.exe', headless: true, args: ['--enable-unsafe-swiftshader'] });
  try {
    for (const [label, width, height, theme, reduced] of [['phone', 390, 844, 'night', false], ['small-phone', 320, 640, 'night', false], ['desktop', 1365, 900, 'night', false], ['phone-day', 390, 844, 'day', false], ['phone-remote', 390, 844, 'night', false], ['reduced-motion', 390, 844, 'night', true]]) {
      if (process.env.ARES_FIXTURE_CASE && process.env.ARES_FIXTURE_CASE !== label) continue;
      const context = await browser.newContext({ viewport: { width, height }, hasTouch: width <= 680, reducedMotion: reduced ? 'reduce' : 'no-preference' }), page = await context.newPage();
      page.setDefaultTimeout(15000); const errors = [], external = [];
      page.on('pageerror', error => { errors.push(error.message); console.error(`${label}: ${error.stack}`); });
      await page.route('**/*', async route => {
        const url = new URL(route.request().url());
        if (url.origin !== 'https://ares.invalid') { external.push(url.origin); return route.abort(); }
        if (url.pathname === '/') return route.fulfill({ contentType: 'text/html', body: html, headers: { 'Content-Security-Policy': "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data: blob:; connect-src 'self'" } });
        if (url.pathname === '/fixture-inspector.js') return route.fulfill({ contentType: 'application/javascript', body: inspectorFixture });
        const name = url.pathname.replace(/^\/workspace\//, '');
        if (!assets.includes(name)) return route.abort();
        return route.fulfill({ body: fs.readFileSync(path.join(root, 'app', name)), contentType: name.endsWith('.svg') ? 'image/svg+xml' : name.endsWith('.css') ? 'text/css' : name.endsWith('.glb') ? 'model/gltf-binary' : 'application/javascript' });
      });
      await page.goto('https://ares.invalid/');
      await page.evaluate(theme => {
        document.documentElement.dataset.theme = theme;
        document.querySelector('#welcomeView').hidden = true;
        document.querySelector('#sessionHeader').hidden = false;
        document.querySelector('#sessionTitle').textContent = 'Seneschal voice preview';
        document.querySelector('#messageScroll').hidden = false;
        document.querySelector('#messageList').innerHTML = '<article class="message"><div class="message-avatar">DS</div><div class="message-body"><p>Seneschal follows your voice conversation. Your existing voice service stays unchanged.</p></div></article>';
        document.querySelector('#composerForm').style.display = '';
        document.querySelector('#promptInput').value = 'Unsent draft stays here';
        window.fixtureSubmits = 0;
        window.fixtureTalkToggles = 0; window.fixtureTalkActive = true;
        document.querySelector('#talkButton').addEventListener('click', () => { fixtureTalkToggles++; fixtureTalkActive = !fixtureTalkActive; SeneschalAres.setState(fixtureTalkActive ? 'Listening' : 'Idle'); });
        document.querySelector('#composerForm').addEventListener('submit', event => { event.preventDefault(); fixtureSubmits++; });
        document.querySelector('#openInspectorButton').addEventListener('click', () => document.querySelector('#inspector').classList.add('open'));
        document.querySelector('#closeInspectorButton').addEventListener('click', () => document.querySelector('#inspector').classList.remove('open'));
        document.querySelector('#rightPanelToggle').addEventListener('click', () => document.querySelector('#appShell').classList.toggle('right-panel-collapsed'));
      }, theme);
      if (label === 'phone-remote') await page.evaluate(() => { document.body.classList.add('remote-client'); document.body.insertAdjacentHTML('afterbegin', '<header class="remote-host-bar">Private connection · Fixture PC</header>'); });
      await page.waitForFunction(() => document.querySelector('#aresStatus').textContent === 'Idle');
      assert.equal(await page.locator('#aresCanvas canvas').count(), 1);
      assert.match(await page.locator('#aresCanvas').getAttribute('data-animation-clip'), /^Seneschal_/);
      assert.match(await page.locator('#aresDrag').textContent(), /Seneschal/);
      {
        const layout = await page.locator('#aresLayoutButton').boundingBox();
        for (const kind of ['mic', 'speaker']) {
          const mute = await page.locator(`#aresControls [data-voice-mute="${kind}"]`).boundingBox();
          assert.ok(mute && Math.abs(mute.y - layout.y) <= 1, `${label}: ${kind} shares the existing Layout row, not the character canvas`);
          assert.ok(mute.width >= 44 && mute.height >= 44, `${label}: accessible ${kind} touch target`);
        }
        if (width > 1120) assert.ok((await page.locator('#aresCanvas').boundingBox()).height >= 100, 'docked character retains its original canvas space');
      }
      for (const [state, clip] of [['Listening', 'Listening'], ['Thinking', 'Thinking'], ['Preparing voice', 'Thinking'], ['Transcribing', 'Thinking'], ['Speaking', 'Speaking'], ['Idle', 'Idle']]) {
        await page.evaluate(value => SeneschalAres.setState(value), state);
        assert.equal(await page.locator('#aresCanvas').getAttribute('data-animation-clip'), `Seneschal_${clip}`, `${label}: real new-model clip matches ${state}`);
      }
      await page.evaluate(() => { document.querySelector('#permissionDock').hidden = false; });
      await page.waitForFunction(() => document.querySelector('#aresCompanion').hidden);
      await page.evaluate(() => { document.querySelector('#permissionDock').hidden = true; });
      await page.waitForFunction(() => !document.querySelector('#aresCompanion').hidden);
      assert.equal(await page.locator('#aresCompanion').isVisible(), true);
      const bounds = await page.locator('#aresCompanion').boundingBox(), composer = await page.locator('#composerForm').boundingBox();
      assert.ok(bounds.x >= 0 && bounds.y >= 0 && bounds.x + bounds.width <= width && (width > 1120 || bounds.y + bounds.height <= composer.y), `${label}: companion fits without covering the prompt`);
      if (width > 1120) {
        assert.equal(await page.locator('#aresSidebarSlot > #aresCompanion').count(), 1, 'desktop uses the right sidebar');
      }
      assert.equal(await page.locator('.send-group > #aresToggle').count(),1,'Mascot stays beside Voice in the action group');
      await page.evaluate(() => SeneschalAres.setState('Listening'));
      await page.waitForTimeout(220);
      await page.screenshot({ path: path.join(output, `${label}.png`) });
      if (width <= 1120) {
        await page.evaluate(() => document.querySelector('#inspector').classList.add('open'));
        await page.waitForFunction(() => document.querySelector('#aresCompanion').parentNode.id === 'aresSidebarSlot');
        assert.equal(await page.locator('.send-group > #aresToggle').count(),1,'Context cannot relocate the Mascot button');
        assert.equal(await page.locator('#aresCompanion').isVisible(), true, 'Context must not hide Seneschal');
        await page.waitForTimeout(250);
        await page.screenshot({ path: path.join(output, `${label}-sidebar.png`) });
        await page.evaluate(() => document.querySelector('#inspector').classList.remove('open'));
        await page.waitForFunction(() => document.querySelector('#aresCompanion').parentNode === document.body);
        assert.equal(await page.locator('.send-group > #aresToggle').count(),1,'closing Context preserves Mascot access');
      } else {
        await page.evaluate(() => document.querySelector('#appShell').classList.add('right-panel-collapsed'));
        await page.waitForFunction(() => document.querySelector('#aresCompanion').parentNode === document.body);
        assert.equal(await page.locator('.send-group > #aresToggle').count(),1,'collapsed desktop sidebar preserves Mascot access');
        assert.equal(await page.locator('#aresCompanion').isVisible(), true, 'collapsed sidebar keeps a compact companion');
        await page.evaluate(() => document.querySelector('#appShell').classList.remove('right-panel-collapsed'));
        await page.waitForFunction(() => document.querySelector('#aresCompanion').parentNode.id === 'aresSidebarSlot');
      }
      const drag = async (selector, dx, dy, beforeRelease) => {
        const rect = await page.locator(selector).boundingBox(), x = rect.x + rect.width / 2, y = rect.y + rect.height / 2;
        if (width <= 680) {
          const input = await context.newCDPSession(page);
          await input.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
          for (let step = 1; step <= 4; step++) await input.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x + dx * step / 4, y: y + dy * step / 4 }] });
          if (beforeRelease) { await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))); await beforeRelease(); }
          await input.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); await input.detach();
        } else { await page.mouse.move(x, y); await page.mouse.down(); await page.mouse.move(x + dx, y + dy, { steps: 4 }); if (beforeRelease) { await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))); await beforeRelease(); } await page.mouse.up(); }
      };
      if (width > 1120) {
        // An arrow move detaches from the sidebar without relying on a drag.
        await page.locator('#aresDrag').focus(); await page.keyboard.press('ArrowLeft');
      }
      const beforeMove = await page.locator('#aresCompanion').boundingBox();
      let chatPreview;
      await drag('#aresDrag', -40, -35, async () => { chatPreview = await page.locator('#aresCompanion').boundingBox(); });
      const moved = await page.locator('#aresCompanion').boundingBox();
      assert.ok(Math.abs(moved.x - chatPreview.x) < 1 && Math.abs(moved.y - chatPreview.y) < 1, `${label}: release in chat preserves the visible drag position ${JSON.stringify({ beforeMove, chatPreview, moved, composer })}`);
      assert.ok(moved.x < beforeMove.x && moved.y <= beforeMove.y, `${label}: actual ${width <= 680 ? 'touch' : 'mouse'} drag relocates Seneschal (${JSON.stringify({ beforeMove, moved })})`);
      if (width > 680 && await page.locator('#aresResize').isVisible()) await drag('#aresResize', 24, 20);
      else { await page.locator('#aresLayoutButton').click(); await page.locator('[data-ares-size="1"]').click(); await page.keyboard.press('Escape'); }
      const sized = await page.locator('#aresCompanion').boundingBox();
      assert.ok(sized.width > moved.width && sized.height >= moved.height, `${label}: grip or compact Layout size action changes size ${JSON.stringify({ moved, sized })}`);
      assert.ok(sized.y + sized.height <= composer.y, `${label}: resizing never covers the prompt`);
      const chatBounds = await page.locator('.conversation-panel').boundingBox();
      assert.ok(sized.x >= chatBounds.x && sized.x + sized.width <= chatBounds.x + chatBounds.width, 'floating mode cannot cover sidebar options');
      const orbitBefore = await page.locator('#aresCompanion').boundingBox();
      await drag('#aresCanvas', 55, 12);
      await page.waitForFunction(() => Math.abs(Number(document.querySelector('#aresCanvas').dataset.cameraYaw)) > 0.2);
      assert.deepEqual(await page.locator('#aresCompanion').boundingBox(), orbitBefore, 'rotating the camera never moves the panel');
      await page.screenshot({ path: path.join(output, `${label}-orbit.png`) });
      await page.locator('#aresCanvas').focus(); await page.keyboard.press('ArrowUp');
      assert.ok(Number(await page.locator('#aresCanvas').getAttribute('data-camera-pitch')) > 0.15);
      await page.locator('#aresLayoutButton').click(); await page.locator('#aresCameraReset').click();
      assert.equal(await page.locator('#aresCanvas').getAttribute('data-camera-yaw'), '0.000');
      await page.locator('#aresDock').click();
      await page.waitForFunction(() => document.querySelector('#aresCompanion').parentNode.id === 'aresSidebarSlot');
      await page.locator('#aresDrag').click();
      await page.waitForFunction(() => document.querySelector('#aresCompanion').parentNode.id === 'aresSidebarSlot');
      const dockedBox = await page.locator('#aresCompanion').boundingBox(), sidebarOptions = await page.locator('#inspectorContent').boundingBox(), pulseBox = await page.locator('.inspector-pulse').boundingBox(), contextHead = await page.locator('.inspector-head').boundingBox();
      assert.ok(dockedBox.y>=contextHead.y+contextHead.height && dockedBox.y<contextHead.y+contextHead.height+15,'mascot remains at the top of the sidebar');
      assert.ok(dockedBox.y + dockedBox.height <= pulseBox.y && pulseBox.y + pulseBox.height <= sidebarOptions.y + 1, 'compact Pulse follows mascot; settings have a separate scroll area below');
      assert.ok(dockedBox.height <= 260, 'sidebar mascot stays compact');
      const pulseToggle = page.getByRole('button', { name: 'Expand Workspace pulse', exact: true });
      assert.equal(await pulseToggle.getAttribute('aria-controls'), 'workspacePulseDetails');
      assert.equal(await page.locator('.pulse-summary').isVisible(), true); assert.equal(await page.locator('.pulse-bars').isVisible(), false);
      await pulseToggle.focus(); await page.keyboard.press('Enter');
      assert.equal(await page.locator('.pulse-bars').isVisible(), true, 'keyboard expands the full chart');
      assert.equal(await page.locator('[data-inspector-section="permissions"]').evaluate(el => el.classList.contains('collapsed')), true, 'moving Pulse must not change Permissions state');
      await page.getByRole('button', { name: 'Minimize Workspace pulse', exact: true }).click();
      assert.equal(await page.locator('.pulse-bars').isVisible(), false); assert.equal(await page.locator('.pulse-summary').isVisible(), true);
      await page.getByRole('button', { name: 'Expand Agent browser', exact: true }).click();
      await page.locator('#openApprovalButton').scrollIntoViewIfNeeded();
      assert.equal(await page.locator('#openApprovalButton').evaluate(el => { const r = el.getBoundingClientRect(); return el.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)); }), true, 'Permissions remains reachable');
      await page.locator('#protocolButton').scrollIntoViewIfNeeded();
      assert.equal(await page.locator('#protocolButton').evaluate(el => { const r = el.getBoundingClientRect(); return el.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)); }), true, 'last sidebar control remains reachable by scrolling');
      await page.locator('#openApprovalButton').scrollIntoViewIfNeeded();
      await page.screenshot({ path: path.join(output, `${label}-top-dock.png`) });
      if (width <= 680) {
        await page.setViewportSize({ width, height: 390 });
        await page.getByRole('button', { name: 'Expand Workspace pulse', exact: true }).scrollIntoViewIfNeeded();
        await page.getByRole('button', { name: 'Expand Workspace pulse', exact: true }).click();
        await page.locator('#protocolButton').scrollIntoViewIfNeeded();
        assert.equal(await page.locator('#protocolButton').evaluate(el => { const r=el.getBoundingClientRect(); return el.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)); }), true, 'short screens can reach the last control even with Pulse expanded');
        await page.locator('#openApprovalButton').scrollIntoViewIfNeeded();
        assert.equal(await page.locator('#openApprovalButton').isVisible(), true);
        await page.getByRole('button', { name: 'Minimize Workspace pulse', exact: true }).scrollIntoViewIfNeeded();
        await page.getByRole('button', { name: 'Minimize Workspace pulse', exact: true }).click();
        await page.setViewportSize({ width, height });
        await page.evaluate(() => { document.querySelector('#inspector').scrollTop = 0; document.querySelector('#inspectorContent').scrollTop = 0; });
      }
      if (width > 1120) { await page.locator('#aresDrag').focus(); await page.keyboard.press('ArrowLeft'); }
      const handle = await page.locator('#aresDrag').boundingBox(), target = await page.locator('#inspector').boundingBox();
      // Upper-half drops previously failed, and the floating preview was clamped
      // to chat even when the pointer had already crossed into the sidebar.
      await drag('#aresDrag', target.x + target.width / 2 - (handle.x + handle.width / 2), target.y + target.height * 0.35 - (handle.y + handle.height / 2), async () => {
        assert.equal(await page.locator('#aresCompanion').isVisible(), true, 'drag stays visible across the sidebar boundary');
        assert.equal(await page.locator('#inspector').evaluate(el => el.classList.contains('ares-drop-target')), true, 'sidebar highlights the full drop target');
        assert.equal(await page.locator('#aresStatus').textContent(), 'Release to dock in sidebar');
        const preview = await page.locator('#aresCompanion').boundingBox();
        assert.ok(preview.x + preview.width > target.x + 20, 'the panel visibly follows the pointer into the sidebar');
        await page.screenshot({ path: path.join(output, `${label}-sidebar-drag.png`) });
      });
      await page.waitForFunction(() => document.querySelector('#aresCompanion').parentNode.id === 'aresSidebarSlot');
      assert.equal(await page.locator('#inspector').evaluate(el => el.classList.contains('ares-drop-target')), false, 'drop highlight clears after release');
      assert.ok((await page.locator('#aresCompanion').boundingBox()).y < (await page.locator('#inspectorContent').boundingBox()).y, 'drop settles into the separate top slot');
      if (width <= 1120) { await page.locator('#closeInspectorButton').click(); await page.waitForFunction(() => document.querySelector('#aresCompanion').parentNode === document.body); }
      await page.locator('#aresMinimize').click();
      await page.waitForFunction(() => document.querySelector('#aresMinimize').getAttribute('aria-expanded') === 'false');
      await page.waitForFunction(() => document.querySelector('#aresCompanion').getBoundingClientRect().height <= 47);
      assert.ok((await page.locator('#aresCompanion').boundingBox()).height <= 47, `${label}: minimized header fits (${JSON.stringify(await page.locator('#aresCompanion').evaluate(el => ({ rect: el.getBoundingClientRect().toJSON(), classes: el.className, style: el.style.cssText })))})`);
      assert.equal(await page.locator('#aresCanvas').isVisible(), false);
      await page.reload();
      await page.waitForFunction(() => document.querySelector('#aresStatus').textContent === 'Idle');
      assert.equal(await page.locator('#aresMinimize').getAttribute('aria-expanded'), 'false', 'minimized state persists');
      await page.evaluate(() => { document.querySelector('#welcomeView').hidden = true; document.querySelector('#sessionHeader').hidden = false; document.querySelector('#messageScroll').hidden = false; document.querySelector('#promptInput').value = 'Unsent draft stays here'; window.fixtureTalkToggles = 0; window.fixtureTalkActive = false; document.querySelector('#talkButton').addEventListener('click', () => { fixtureTalkToggles++; fixtureTalkActive = !fixtureTalkActive; SeneschalAres.setState(fixtureTalkActive ? 'Listening' : 'Idle'); }); window.fixtureSubmits = 0; document.querySelector('#composerForm').addEventListener('submit', event => { event.preventDefault(); fixtureSubmits++; }); });
      await page.locator('#aresMinimize').click();
      await page.locator('#aresMaximize').click();
      assert.equal(await page.locator('#aresStage').evaluate(el => el.open), true);
      assert.equal(await page.evaluate(() => fixtureTalkToggles), 0, 'maximizing never starts the microphone');
      const full = await page.locator('#aresCompanion').boundingBox();
      assert.ok(full.width >= width - 20 && full.height >= height - 20, `${label}: full-page companion fits viewport`);
      for (let i = 0; i < 8; i++) { await page.keyboard.press('Tab'); assert.equal(await page.locator('#aresStage').evaluate(el => el.contains(document.activeElement)), true, 'full-screen focus stays inside the native dialog'); }
      await page.locator('#aresTalk').click(); assert.equal(await page.evaluate(() => fixtureTalkActive), true);
      await page.locator('#aresTalk').click(); assert.equal(await page.evaluate(() => fixtureTalkActive), false);
      await page.evaluate(() => { document.querySelector('#voiceFeedback').textContent = 'Synthetic voice warning remains visible'; });
      await page.waitForFunction(() => document.querySelector('#aresVoiceFeedback').textContent === 'Synthetic voice warning remains visible');
      assert.equal(await page.locator('#aresVoiceFeedback').isVisible(), true);
      await page.evaluate(() => { document.querySelector('#permissionDock').hidden = false; });
      await page.waitForFunction(() => !document.querySelector('#aresStage').open);
      assert.equal(await page.locator('#permissionDock').isVisible(), true, 'approval remains accessible above full-screen view');
      await page.evaluate(() => { document.querySelector('#permissionDock').hidden = true; });
      await page.waitForFunction(() => document.querySelector('#aresStage').open);
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(resolve)))));
      await page.screenshot({ path: path.join(output, `${label}-maximized.png`) });
      await page.keyboard.press('Escape');
      assert.equal(await page.locator('#aresStage').evaluate(el => el.open), false);
      assert.equal(await page.locator('#aresCanvas canvas').count(), 1, 'restore reuses the same 3D scene');
      assert.equal(await page.evaluate(() => fixtureTalkToggles), 2, 'restoring does not toggle Talk');
      await page.locator('#aresLayoutButton').click();
      await page.getByRole('button', { name: 'Reset layout', exact: true }).click();
      await page.getByRole('button', { name: 'Pause Seneschal motion', exact: true }).click();
      assert.equal(await page.locator('#aresMotion').getAttribute('aria-pressed'), 'true');
      await page.evaluate(() => { SeneschalAres.setAnalyser({ fftSize: 256, getFloatTimeDomainData(values) { values.fill(0.08); } }); SeneschalAres.setState('Speaking'); });
      assert.equal(await page.locator('#aresStatus').textContent(), 'Speaking');
      await page.locator('#aresMotion').focus(); await page.keyboard.press('Escape');
      assert.equal(await page.locator('#aresCanvas canvas').count(), 0);
      assert.equal(await page.locator('#aresToggle').evaluate(el => document.activeElement === el), true);
      await page.locator('#aresToggle').click();
      await page.waitForFunction(() => document.querySelector('#aresStatus').textContent === 'Speaking');
      assert.equal(await page.locator('#aresCanvas canvas').count(), 1);
      if (width <= 680) {
        await page.locator('#aresClose').click();
        await page.evaluate(() => { document.querySelector('#composerOptions').open = true; const checkbox = document.querySelector('#aresEnabled'); checkbox.checked = true; checkbox.dispatchEvent(new Event('change')); });
        await page.waitForFunction(() => document.querySelector('#aresStatus').textContent === 'Speaking');
        assert.equal(await page.locator('#composerOptions').getAttribute('open'), null, 'Show Seneschal closes the menu that used to conceal it');
        assert.equal(await page.locator('#aresCompanion').isVisible(), true);
      }
      await page.locator('#aresClose').click();
      assert.equal(await page.locator('#promptInput').inputValue(), 'Unsent draft stays here');
      assert.equal(await page.evaluate(() => fixtureSubmits), 0);
      await page.reload();
      assert.equal(await page.locator('#aresToggle').getAttribute('aria-pressed'), 'false');
      assert.equal(await page.locator('#aresCanvas canvas').count(), 0);
      assert.deepEqual(errors, []); assert.deepEqual(external, []);
      console.log(`PASS: ${label}: real local GLB/WebGL under strict CSP, layout, state, pause, Escape, disposal and saved visibility`);
      await context.close();
    }
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
