'use strict';
// Run with the bundled Node runtime and @napi-rs/canvas on NODE_PATH.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createCanvas } = require('@napi-rs/canvas');
const source = fs.readFileSync(path.join(__dirname, '../app/wallpapers/legacy-worlds.js'), 'utf8');
const proofDir = process.argv[2] || path.join(__dirname, '../.test-temp/wallpapers-legacy');
fs.mkdirSync(proofDir, { recursive: true });
const sandbox = { console, document: { createElement(tag) { assert.equal(tag, 'canvas'); return createCanvas(1, 1); } } };
sandbox.window = sandbox;
vm.runInNewContext(source, sandbox, { filename: 'legacy-worlds.js' });
const api = sandbox.SeneschalLegacyWorlds;
assert.equal(api.catalog.length, 3);
assert.deepEqual(Array.from(api.catalog, s => s.id), ['pixel-city', 'lunar-relay', 'orbital-foundry']);
assert.throws(() => api.create('missing', createCanvas(1, 1)), /Unknown/);
for (const forbidden of [/requestAnimationFrame\s*\(/, /setInterval\s*\(/, /setTimeout\s*\(/, /addEventListener\s*\(/, /fetch\s*\(/, /localStorage/, /AudioContext/]) assert.ok(!forbidden.test(source), String(forbidden));
const tiles = createCanvas(960, 540 * 3);
const tilesCtx = tiles.getContext('2d');
const records = [];
function raster(canvas) { return Buffer.from(canvas.getContext('2d').getImageData(0,0,960,540).data); }
function changedPixels(a,b) { let count=0;for(let i=0;i<a.length;i+=4)if(a[i]!==b[i]||a[i+1]!==b[i+1]||a[i+2]!==b[i+2])count++;return count; }
function luminance(a) { let sum=0;for(let i=0;i<a.length;i+=4)sum+=a[i]*.2126+a[i+1]*.7152+a[i+2]*.0722;return sum/(a.length/4); }
function verifyVisibleControls(entry) {
  const staticP={palette:'nocturne',weather:'clear',intensity:65,worldActivity:0,worldGlow:65,worldFeature:false};
  const canvas=createCanvas(960,540),r=api.create(entry.id,canvas);
  r.draw(0,{...staticP,worldGlow:0});const dim=raster(canvas);
  r.draw(0,{...staticP,worldGlow:100});const bright=raster(canvas),glowPixels=changedPixels(dim,bright);
  assert.ok(glowPixels>400,entry.id+': glow changes visible emissive materials, not just metadata');
  assert.ok(luminance(bright)>luminance(dim),entry.id+': glow 100 is brighter than 0');
  r.dispose();
  const results=[],actionRasters=[];
  for(const action of entry.actions){
    const view=createCanvas(960,540),engine=api.create(entry.id,view);engine.draw(0,staticP);const before=raster(view);
    assert.equal(engine.effect(action,0),true);engine.draw(1,staticP);const after=raster(view),changes=changedPixels(before,after);
    assert.ok(changes>20,entry.id+' / '+action+': produces a real visible action');actionRasters.push({action,raster:after});
    engine.draw(6,staticP);const afterDeadline=raster(view);
    if(action==='lights'){
      assert.equal(engine.diagnostics().lightsEnabled,false,entry.id+': lights toggle off');
      assert.deepEqual(afterDeadline,after,entry.id+': switched lights persist beyond an effect deadline');
      engine.draw(7,{...staticP,palette:'ember'});assert.equal(engine.diagnostics().lightsEnabled,false,'palette does not reset light state');
      engine.effect('lights',8);engine.draw(8,staticP);assert.equal(engine.diagnostics().lightsEnabled,true,'lights toggle back on');assert.deepEqual(raster(view),before,'switching lights on restores authored lighting exactly');
    }else assert.deepEqual(afterDeadline,before,entry.id+' / '+action+': bounded action returns to static baseline');
    results.push({action,changedPixels:changes,persistent:action==='lights'});engine.dispose();
  }
  for(let a=0;a<actionRasters.length;a++)for(let b=a+1;b<actionRasters.length;b++)assert.ok(changedPixels(actionRasters[a].raster,actionRasters[b].raster)>20,entry.id+': '+actionRasters[a].action+' and '+actionRasters[b].action+' are visually distinct');
  return {glowChangedPixels:glowPixels,glowLuminanceIncrease:+(luminance(bright)-luminance(dim)).toFixed(3),actions:results};
}
for (let index = 0; index < api.catalog.length; index++) {
  const entry = api.catalog[index], canvas = createCanvas(960, 540), renderer = api.create(entry.id, canvas);
  assert.equal(entry.actions.length,6,entry.id+': six physically distinct scene actions');
  const hotspots=renderer.hotspots();assert.equal(hotspots.length,6);
  for(const spot of hotspots)assert.equal(renderer.hitTest(spot.x+spot.w/2,spot.y+spot.h/2)?.action,spot.action,entry.id+': top-left hotspot bounds route their own center');
  const p = { palette: 'nocturne', weather: entry.id === 'pixel-city' ? 'rain' : 'clear', worldActivity: 55, worldGlow: 65, intensity: 65, worldFeature: true };
  renderer.draw(0, p);
  for (let frame = 1; frame <= 100; frame++) renderer.draw(frame / 20, p);
  let diag = renderer.diagnostics();
  assert.equal(diag.cacheBakes, 1); assert.equal(diag.width, 960); assert.equal(diag.cacheBytes, 480 * 270 * 4);
  const pixels = canvas.getContext('2d').getImageData(0, 0, 960, 540).data, colors = new Set();
  for (let i = 0; i < pixels.length; i += 4 * 11) colors.add(pixels[i] + ',' + pixels[i + 1] + ',' + pixels[i + 2]);
  assert.ok(colors.size > 85, entry.id + ': rich but bounded tonal detail');
  fs.writeFileSync(path.join(proofDir, entry.id + '.png'), canvas.toBuffer('image/png'));
  tilesCtx.drawImage(canvas, 0, index * 540);
  // All presets render, and changing only weather or activity never rebakes geometry.
  renderer.draw(6, { ...p, weather: 'snow', worldActivity: 0 }); assert.equal(renderer.diagnostics().cacheBakes, 1);
  const before = canvas.toBuffer('image/png'); renderer.draw(40, { ...p, weather: 'snow', worldActivity: 0 }); assert.deepEqual(canvas.toBuffer('image/png'), before, 'zero activity is static');
  renderer.draw(41, { ...p, palette: 'ember', worldActivity: 0 }); assert.equal(renderer.diagnostics().cacheBakes, 2);
  fs.writeFileSync(path.join(proofDir, entry.id + '-ember.png'), canvas.toBuffer('image/png'));
  renderer.draw(42, { ...p, palette: 'sakura', worldActivity: 0 }); assert.equal(renderer.diagnostics().cacheBakes, 3);
  fs.writeFileSync(path.join(proofDir, entry.id + '-sakura.png'), canvas.toBuffer('image/png'));
  assert.equal(renderer.effect('not-an-action', 42), false); assert.equal(renderer.effect(entry.actions[0], 42), true);renderer.draw(43, p);
  renderer.draw(44, { palette: 'invalid', intensity: NaN, worldActivity: -50, worldGlow: 900, weather: 'invalid' });
  diag = renderer.diagnostics(); assert.equal(diag.settings.palette, 'nocturne'); assert.equal(diag.settings.worldActivity, 0); assert.equal(diag.settings.worldGlow, 100); assert.equal(diag.settings.weather, 'clear');
  const samples = []; for (let i = 0; i < 200; i++) { const start = performance.now(); renderer.draw(45 + i / 20, p); samples.push(performance.now() - start); } samples.sort((a, b) => a - b);
  records.push({ id: entry.id, colors: colors.size, medianDrawMs: +samples[100].toFixed(3), p95DrawMs: +samples[190].toFixed(3), cacheBakes: renderer.diagnostics().cacheBakes,visibleControls:verifyVisibleControls(entry) });
  renderer.dispose(); renderer.dispose(); renderer.draw(99, p); renderer.bake(p); assert.equal(renderer.diagnostics().disposed, true); assert.equal(renderer.diagnostics().cacheBytes, 0);assert.deepEqual(Array.from(renderer.hotspots()),[]);assert.equal(renderer.hitTest(480,270),null);
}
fs.writeFileSync(path.join(proofDir, 'Legacy-Worlds-Collection.png'), tiles.toBuffer('image/png'));
fs.writeFileSync(path.join(proofDir, 'legacy-worlds-render-check.json'), JSON.stringify({ canvas: '960×540', logicalPixels: '480×270', assertions: 'passed', records }, null, 2));
console.log(JSON.stringify({ assertions: 'passed', records, proofDir }, null, 2));
