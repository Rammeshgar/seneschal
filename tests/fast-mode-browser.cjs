'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path');
const { chromium } = require(process.argv[2] || '../browser-runtime/node_modules/playwright');
const root = path.join(__dirname, '..'), read = file => fs.readFileSync(path.join(root, file), 'utf8');
const app = read('app/app.js');
const extract = (start, end) => app.slice(app.indexOf(start), app.indexOf(end, app.indexOf(start)));
const render = extract('  function renderModelVariants()', '  function renderModelCapability()');
const bindings = app.split('\n').filter(line => line.includes('els.modelVariant.addEventListener("change"') || line.includes('$("#fastModeButton")?.addEventListener("click"') || line.includes('$("#composerFastModeButton")?.addEventListener("click"')).join('\n');
const html = read('app/index.html').replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '').replace(/<link\b[^>]*>/gi, '');
(async () => {
  const browser = await chromium.launch({ executablePath: 'C:\\Program Files\\BraveSoftware\\Brave-Browser\\Application\\brave.exe', headless:true });
  try {
    for (const [width,height,theme] of [[1365,900,'night'],[390,844,'day'],[320,640,'night']]) {
      const page = await browser.newPage({viewport:{width,height}});
      await page.route('**/*', route=>route.abort());
      await page.setContent(html); await page.addStyleTag({content:read('app/styles.css')});
      await page.evaluate(theme => {
        document.documentElement.dataset.theme=theme;
        window.$=selector=>document.querySelector(selector);
        window.els={modelVariant:$('#modelVariantSelect'),modelVariantWrap:$('#modelVariantWrap')};
        window.fixtureModel={value:'openai/gpt-6.2-sol',variants:{low:{},medium:{},high:{},'fast-low':{},'fast-medium':{},'fast-high':{}}};
        window.selectedModel=()=>fixtureModel; window.state={selectedVariants:{}}; window.storage={set(){}};
        window.escapeHTML=value=>String(value); window.toast=()=>{};
      },theme);
      await page.addScriptTag({content:render+'\n'+bindings+'\nrenderModelVariants();'});
      const button=page.locator('#fastModeButton'), composerButton=page.locator('#composerFastModeButton'), select=page.locator('#modelVariantSelect');
      assert.deepEqual(await select.locator('option').evaluateAll(options=>options.map(o=>o.value)),['low','medium','high']);
      assert.equal(await button.getAttribute('aria-pressed'),'false');
      assert.equal(await button.isVisible(),true);
      await page.evaluate(()=>{document.querySelector('#composerOptions').open=true;});
      assert.equal(await composerButton.isVisible(),true);
      assert.equal(await composerButton.getAttribute('aria-pressed'),'false');
      await button.focus(); await page.keyboard.press('Space');
      assert.equal(await button.getAttribute('aria-pressed'),'true');
      assert.equal(await composerButton.getAttribute('aria-pressed'),'true');
      assert.equal(await composerButton.locator('.fast-mode-state').textContent(),'On');
      assert.equal(await page.evaluate(()=>state.selectedVariants[fixtureModel.value]),'fast-medium');
      await page.evaluate(()=>{els.modelVariant.value='high'; els.modelVariant.dispatchEvent(new Event('change'));});
      assert.equal(await page.evaluate(()=>state.selectedVariants[fixtureModel.value]),'fast-high');
      await composerButton.focus(); await page.keyboard.press('Space');
      assert.equal(await page.evaluate(()=>state.selectedVariants[fixtureModel.value]),'high');
      assert.equal(await button.getAttribute('aria-pressed'),'false');
      assert.equal(await composerButton.getAttribute('aria-pressed'),'false');
      assert.equal(await composerButton.locator('.fast-mode-state').textContent(),'Off');
      assert.equal(await select.inputValue(),'high');
      assert.equal(await page.evaluate(()=>{const b=$('#fastModeButton').getBoundingClientRect(),m=$('#modelPicker').getBoundingClientRect();return b.right<=m.left && b.left>=0 && m.right<=innerWidth}),true);
      await page.addScriptTag({content:app.slice(app.indexOf('/* SENESCHAL FEATURE HELP'))});
      await page.evaluate(()=>SeneschalI18n.change('fa',false));
      await page.waitForFunction(()=>document.querySelector('#composerFastModeButton span').textContent==='حالت سریع');
      assert.equal(await button.getAttribute('aria-label'),'پردازش سریع');
      await composerButton.focus(); await page.keyboard.press('Space');
      await page.waitForFunction(()=>document.querySelector('#composerFastModeButton .fast-mode-state').textContent==='روشن');
      assert.equal(await button.getAttribute('aria-pressed'),'true');
      await page.evaluate(()=>SeneschalI18n.change('en',false));
      await page.waitForFunction(()=>document.querySelector('#composerFastModeButton span').textContent==='Fast mode');
      await page.evaluate(()=>{fixtureModel={value:'other/model',variants:{low:{},high:{}}}; renderModelVariants();});
      assert.equal(await button.isVisible(),false);
      assert.equal(await composerButton.isVisible(),false);
      console.log('PASS '+width+'px '+theme+': accessible lightning toggle, no duplicate levels, speed preserved on level change, correct fit and unsupported-model hiding');
      await page.close();
    }
  } finally {await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
