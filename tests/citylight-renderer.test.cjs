'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const crypto=require('node:crypto');
const {createCanvas}=require('@napi-rs/canvas');
const appRoot=path.resolve(__dirname,'..');
const file=path.join(appRoot,'app/wallpapers/citylight-world.js');
const source=fs.readFileSync(file,'utf8');
const defaults={palette:'nocturne',weather:'rain',intensity:65,worldActivity:55,worldGlow:55,worldFeature:true};
const hash=canvas=>crypto.createHash('sha256').update(canvas.getContext('2d').getImageData(0,0,canvas.width,canvas.height).data).digest('hex');
function harness(){
  let sideEffects=0,layoutReads=0,canvasCount=0;
  const forbidden=()=>{sideEffects++;throw new Error('Renderer attempted an owned host side effect');};
  const document={createElement(tag){assert.equal(tag,'canvas');canvasCount++;return createCanvas(480,270);},addEventListener:forbidden};
  const scope={window:null,document,requestAnimationFrame:forbidden,cancelAnimationFrame:forbidden,setTimeout:forbidden,setInterval:forbidden,fetch:forbidden,addEventListener:forbidden,AudioContext:forbidden,Audio:forbidden,localStorage:{getItem:forbidden,setItem:forbidden}};
  scope.window=scope;vm.runInNewContext(source,scope,{filename:file});
  const canvas=createCanvas(960,540);
  for(const key of ['clientWidth','clientHeight','offsetWidth','offsetHeight'])Object.defineProperty(canvas,key,{get(){layoutReads++;throw new Error('Layout read');}});
  canvas.getBoundingClientRect=()=>{layoutReads++;throw new Error('Layout read');};
  const renderer=scope.SeneschalCitylight.create(canvas);
  return {canvas,renderer,scope,counts:()=>({sideEffects,layoutReads,canvasCount})};
}
function advance(h,p=defaults,until=19){for(let t=0;t<until;t+=.1)h.renderer.draw(t,p);h.renderer.draw(until,p);return hash(h.canvas);}
function difference(a,b){let count=0;for(let i=0;i<a.length;i+=4)if(a[i]!==b[i]||a[i+1]!==b[i+1]||a[i+2]!==b[i+2])count++;return count;}
function pixels(h){return Buffer.from(h.canvas.getContext('2d').getImageData(0,0,960,540).data);}

test('Citylight is a self-contained 480×270 authored renderer with no owned loop or input side effects',()=>{
  const h=harness();advance(h);const d=h.renderer.diagnostics();
  assert.equal(d.id,'citylight');assert.equal(d.logicalWidth,480);assert.equal(d.logicalHeight,270);assert.equal(d.width,960);assert.equal(d.height,540);
  assert.equal(d.ownsAnimationLoop,false);assert.equal(d.ownsListeners,false);assert.equal(d.ownsAudio,false);
  assert.deepEqual(h.counts(),{sideEffects:0,layoutReads:0,canvasCount:2});
  assert.deepEqual(Object.keys(h.scope.SeneschalCitylight),['create']);
  h.renderer.dispose();
});

test('Art is crisp integer-scaled: every output 2×2 block is identical',()=>{
  const h=harness();advance(h);const a=pixels(h);
  for(let y=0;y<540;y+=2)for(let x=0;x<960;x+=2){const at=(y*960+x)*4;for(const delta of [4,960*4,960*4+4])for(let channel=0;channel<4;channel++)assert.equal(a[at+channel],a[at+delta+channel]);}
  h.renderer.dispose();
});

test('The original copper moon, jade skyline and broad illuminated avenue remain spatially distinct',()=>{
  const h=harness();h.renderer.draw(0,{...defaults,weather:'clear',worldFeature:false});const a=h.canvas.getContext('2d');
  const color=(x,y)=>[...a.getImageData(x*2,y*2,1,1).data].slice(0,3);
  const moon=color(106,74),sky=color(275,40),road=color(252,245),tower=color(356,65);
  assert(moon[0]>moon[1]*1.2,'The large upper-left disc retains copper/orange warmth');
  assert(moon[0]>sky[0]*3,'Moon is legible against the quiet sky');
  assert(road[0]>60&&road[1]>60,'Foreground centreline provides a legible avenue');
  assert(tower[1]>=tower[0],'Broad right-hand glass tower stays in the jade family');
  h.renderer.dispose();
});

test('Only palette, rounded glow and persistent light state invalidate cached architecture',()=>{
  const h=harness();h.renderer.draw(0,defaults);assert.equal(h.renderer.diagnostics().cacheBakes,1);
  for(let n=0;n<50;n++)h.renderer.draw(n*.1,{...defaults,worldActivity:n,weather:n%2?'rain':'mist',intensity:n,worldFeature:!!(n%2)});
  assert.equal(h.renderer.diagnostics().cacheBakes,1);
  h.renderer.draw(6,{...defaults,palette:'ember'});assert.equal(h.renderer.diagnostics().cacheBakes,2);
  h.renderer.draw(6.1,{...defaults,palette:'ember',worldGlow:95});assert.equal(h.renderer.diagnostics().cacheBakes,3);
  h.renderer.effect('lights',6.1);h.renderer.draw(6.1,{...defaults,palette:'ember',worldGlow:95});assert.equal(h.renderer.diagnostics().cacheBakes,4);
  h.renderer.dispose();
});

test('Three earthy palettes and all four weather settings are materially different',()=>{
  const paletteHashes=new Set(),weatherHashes=new Set();
  for(const palette of ['nocturne','ember','sakura']){const h=harness();h.renderer.draw(0,{...defaults,palette});paletteHashes.add(hash(h.canvas));h.renderer.dispose();}
  for(const weather of ['clear','rain','snow','mist']){const h=harness();h.renderer.draw(0,{...defaults,weather});weatherHashes.add(hash(h.canvas));h.renderer.dispose();}
  assert.equal(paletteHashes.size,3);assert.equal(weatherHashes.size,4);
});

test('Intensity zero removes weather completely; high intensity changes many pixels',()=>{
  for(const weather of ['rain','snow','mist']){
    const h=harness();h.renderer.draw(0,{...defaults,weather:'clear',worldFeature:false});const clear=pixels(h);
    h.renderer.draw(0,{...defaults,weather,intensity:0,worldFeature:false});assert.equal(difference(clear,pixels(h)),0);
    h.renderer.draw(0,{...defaults,weather,intensity:100,worldFeature:false});assert(difference(clear,pixels(h))>(weather==='snow'?300:1200),weather+' visibly changes the scene');h.renderer.dispose();
  }
});

test('Activity zero freezes cars, scan, weather and beacons, while a live scene actually advances',()=>{
  const h=harness(),p={...defaults,worldActivity:0};h.renderer.draw(0,p);const still=hash(h.canvas);
  for(let t=1;t<=15;t++)h.renderer.draw(t,p);
  assert.equal(hash(h.canvas),still);assert.equal(h.renderer.diagnostics().motionTime,0);
  for(let t=16;t<=20;t+=.1)h.renderer.draw(t,{...defaults,worldActivity:100});assert.notEqual(hash(h.canvas),still);assert(h.renderer.diagnostics().motionTime>3);
  h.renderer.dispose();
});

test('Feature switch changes the living city without removing its landmark architecture',()=>{
  const h=harness();h.renderer.draw(0,{...defaults,weather:'clear'});const on=pixels(h);
  h.renderer.draw(0,{...defaults,weather:'clear',worldFeature:false});const off=pixels(h),changed=difference(on,off);
  assert(changed>50);assert(changed<25000,'Feature switch affects life, not the entire cached city');
  assert.equal(h.renderer.diagnostics().cacheBakes,1);h.renderer.dispose();
});

test('Glow is a real emissive material control, not an overall image tint',()=>{
  const h=harness(),p={...defaults,weather:'clear',worldFeature:false};h.renderer.draw(0,{...p,worldGlow:0});const dim=pixels(h);
  h.renderer.draw(0,{...p,worldGlow:100});const bright=pixels(h),changed=difference(dim,bright);
  assert(changed>15000);assert(changed<240000,'Sky and unlit ambient architecture should not be globally tinted');
  const a=h.canvas.getContext('2d');const skyHigh=[...a.getImageData(560,50,1,1).data];
  h.renderer.draw(0,{...p,worldGlow:0});assert.deepEqual([...a.getImageData(560,50,1,1).data],skyHigh);
  h.renderer.dispose();
});

test('Traffic convoy and scanning-tower transmission are distinct, bounded and visible with idle life off',()=>{
  for(const [action,at] of [['traffic',2.3],['signal',1.5]]){
    const h=harness(),p={...defaults,weather:'clear',worldFeature:false,worldActivity:0};h.renderer.draw(0,p);const base=pixels(h);
    assert.equal(h.renderer.effect(action,0),true);h.renderer.draw(0,p);assert(difference(base,pixels(h))>20,action+' is visible immediately, including in paused preview');
    h.renderer.draw(at,p);const changed=difference(base,pixels(h));assert(changed>100,action+' interaction is visible');
    assert.equal(h.renderer.diagnostics().activeAction,action);h.renderer.draw(20,p);assert.equal(h.renderer.diagnostics().activeAction,null);assert.equal(difference(base,pixels(h)),0);
    for(let n=0;n<500;n++)h.renderer.effect(action,20);assert.equal(h.renderer.diagnostics().activeAction,action);h.renderer.draw(50,p);assert.equal(h.renderer.diagnostics().activeAction,null);h.renderer.dispose();
  }
});

test('Persistent light switch toggles the whole inhabited city and restores exact original pixels',()=>{
  const h=harness(),p={...defaults,weather:'clear',worldFeature:false,worldActivity:0};h.renderer.draw(0,p);const lit=pixels(h);
  assert.equal(h.renderer.effect('lights',0),true);h.renderer.draw(0,p);assert(difference(lit,pixels(h))>15000);assert.equal(h.renderer.diagnostics().lightsEnabled,false);
  h.renderer.draw(100,p);assert.equal(h.renderer.diagnostics().lightsEnabled,false);
  h.renderer.effect('lights',100);h.renderer.draw(100,p);assert.equal(difference(lit,pixels(h)),0);assert.equal(h.renderer.effect('bad-action',0),false);h.renderer.dispose();
});

test('Invalid preferences, non-finite clocks and disposed calls are safe',()=>{
  assert.throws(()=>{const h=harness();h.scope.SeneschalCitylight.create(null);},/canvas/);
  const h=harness();h.renderer.draw(Infinity,{palette:'__proto__',weather:'tornado',intensity:Infinity,worldActivity:-200,worldGlow:900});
  const d=h.renderer.diagnostics();assert.equal(d.settings.palette,'nocturne');assert.equal(d.settings.weather,'clear');assert.equal(d.settings.intensity,65);assert.equal(d.settings.worldActivity,0);assert.equal(d.settings.worldGlow,100);
  h.renderer.draw(-Infinity,null);assert.equal(h.renderer.diagnostics().settings.palette,'nocturne');
  h.renderer.dispose();h.renderer.dispose();const frames=h.renderer.diagnostics().frames;
  h.renderer.draw(100,defaults);h.renderer.bake(defaults);assert.equal(h.renderer.effect('lights',0),false);assert.equal(h.renderer.diagnostics().frames,frames);assert.equal(h.renderer.diagnostics().disposed,true);assert.equal(h.renderer.diagnostics().cacheBytes,0);
  assert.deepEqual(h.counts(),{sideEffects:0,layoutReads:0,canvasCount:2});
});

if(process.env.CITYLIGHT_RENDER_DIR){
  const folder=path.resolve(process.env.CITYLIGHT_RENDER_DIR);fs.mkdirSync(folder,{recursive:true});
  for(const palette of ['nocturne','ember','sakura']){
    const h=harness();advance(h,{...defaults,palette},19);fs.writeFileSync(path.join(folder,'citylight-'+palette+'.png'),h.canvas.toBuffer('image/png'));
    if(palette==='nocturne')fs.writeFileSync(path.join(appRoot,'app/assets/wallpapers/citylight.png'),h.canvas.toBuffer('image/png'));
    for(const action of palette==='nocturne'?['traffic','signal','lights']:[]){h.renderer.effect(action,19);h.renderer.draw(action==='traffic'?21.4:action==='signal'?20.5:19,{...defaults,palette});fs.writeFileSync(path.join(folder,'citylight-'+action+'.png'),h.canvas.toBuffer('image/png'));}
    h.renderer.dispose();
  }
}
