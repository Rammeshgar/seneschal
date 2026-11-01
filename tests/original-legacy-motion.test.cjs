'use strict';
// Real pixel evidence: cached original architecture plus inhabited moving work.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const {createCanvas} = require('@napi-rs/canvas');
const base = path.resolve(__dirname, '..');
const currentSource = fs.readFileSync(path.join(base, 'app/wallpapers/legacy-worlds.js'), 'utf8');
const oldPath = path.join(base, '.test-temp/original-motion-20261025/app/wallpapers/legacy-worlds.js');
const oldSource = fs.existsSync(oldPath) ? fs.readFileSync(oldPath, 'utf8') : null;
const proof = path.join(base, '.test-temp/original-motion-upgrade');
fs.mkdirSync(proof, {recursive: true});
let assertions = 0;
function check(value, message) { assert.ok(value, message); assertions++; }
function load(source) {
  const scope = {document: {createElement(tag) { assert.equal(tag,'canvas'); return createCanvas(1,1); }}};
  scope.window=scope;
  vm.runInNewContext(source,scope,{filename:'legacy-worlds.js'});
  return scope.SeneschalLegacyWorlds;
}
const api=load(currentSource),oldApi=oldSource?load(oldSource):null;
if(oldSource) {
  const originalArchitecture = source => source.slice(source.indexOf('  function city('),source.indexOf('  function rover('));
  assert.equal(originalArchitecture(currentSource),originalArchitecture(oldSource),'cached city/lunar/foundry architecture is byte-identical');assertions++;
}
function image(canvas) {return Buffer.from(canvas.getContext('2d').getImageData(0,0,960,540).data);}
function delta(a,b,threshold=10) {
  let count=0,totalDifference=0;
  for(let i=0;i<a.length;i+=4){const d=Math.max(Math.abs(a[i]-b[i]),Math.abs(a[i+1]-b[i+1]),Math.abs(a[i+2]-b[i+2]));if(d>=threshold)count++;totalDifference+=d;}
  return {pixels:count,percent:+(count/518400*100).toFixed(3),meanChannelDifference:+(totalDifference/518400).toFixed(3),threshold};
}
const prefs={palette:'nocturne',weather:'clear',intensity:65,worldActivity:60,worldGlow:60,worldFeature:true};
function sample(kit,id,p) {
  const canvas=createCanvas(960,540),r=kit.create(id,canvas);
  r.draw(0,p);const a=image(canvas),png0=canvas.toBuffer('image/png');
  for(let frame=1;frame<=60;frame++)r.draw(frame/30,p);
  const b=image(canvas),png2=canvas.toBuffer('image/png');
  return {r,canvas,a,b,png0,png2,motion:delta(a,b)};
}
const contact=createCanvas(1280,3*204),qc=contact.getContext('2d');qc.imageSmoothingEnabled=false;
qc.fillStyle='#080f21';qc.fillRect(0,0,1280,612);
const records=[];
for(let index=0;index<api.catalog.length;index++){
  const entry=api.catalog[index],now=sample(api,entry.id,prefs),before=oldApi?sample(oldApi,entry.id,prefs):null;
  const record={id:entry.id,seconds:2,fps:30,activity:60,weather:'clear',before:before?.motion||null,after:now.motion};
  // A material-movement threshold rejects a mere blinking beacon. Lunar uses
  // the smallest physical actors; all must improve severalfold on the old art.
  check(now.motion.percent>=3,entry.id+': >=3% material pixels move within two seconds');
  if(before)check(now.motion.pixels>before.motion.pixels*2,entry.id+': more than2× the original material motion');
  assert.equal(now.r.diagnostics().cacheBakes,1,'ambient animation never rebakes architecture');assertions++;
  const spots=now.r.hotspots();
  assert.deepEqual(Array.from(spots,s=>s.action),Array.from(entry.actions));assertions++;
  check(spots.length===6,entry.id+': six hotspots');
  for(const spot of spots){
    assert.equal(now.r.hitTest(spot.x+spot.w/2,spot.y+spot.h/2)?.action,spot.action,entry.id+': hotspot center dispatches its own action');assertions++;
    check(spot.x>=0&&spot.y>=0&&spot.x+spot.w<=960&&spot.y+spot.h<=540,entry.id+': hotspot inside scene');
  }
  assert.equal(now.r.hitTest(-1,-1),null);assertions++;
  assert.equal(now.r.hitTest(NaN,1),null);assertions++;
  now.r.hotspots()[0].x=-99;check(now.r.hotspots()[0].x!==-99,'hotspot descriptions cannot mutate renderer');
  // A renderer with zero activity stays pixel-identical through host draws,
  // for every weather and palette; this includes weather and tiny beacon clocks.
  let zeroCases=0;
  for(const palette of ['nocturne','ember','sakura'])for(const weather of ['clear','rain','snow','mist']){
    const still={...prefs,palette,weather,worldActivity:0};now.r.draw(4,still);const frozen=image(now.canvas);
    for(const t of [4.05,5,33,500])now.r.draw(t,still);
    assert.deepEqual(image(now.canvas),frozen,entry.id+': zero activity exact still / '+palette+' / '+weather);assertions++;zeroCases++;
  }
  record.zeroActivityCases=zeroCases;
  const unfeatured={...prefs,worldActivity:0,worldFeature:false};now.r.draw(501,unfeatured);const empty=image(now.canvas);
  now.r.draw(501,{...unfeatured,worldFeature:true});check(delta(empty,image(now.canvas),1).pixels>1000,entry.id+': ambient actor switch changes physical content');
  // Bounded manual actions remain available even with ambient actors disabled.
  record.actions=[];
  for(const action of entry.actions){
    const canvas=createCanvas(960,540),r=api.create(entry.id,canvas);r.draw(0,unfeatured);const a=image(canvas);
    check(r.effect(action,0),entry.id+': action accepted '+action);r.draw(1,unfeatured);const change=delta(a,image(canvas),1);
    check(change.pixels>100,entry.id+': action materially visible '+action);
    r.draw(6,unfeatured);
    if(action==='lights'){check(r.diagnostics().lightsEnabled===false,'lights persist');r.draw(7,{...unfeatured,palette:'ember'});check(r.diagnostics().lightsEnabled===false,'palette keeps switched lights');}
    else{assert.deepEqual(image(canvas),a,entry.id+': finite action returns to stable scene '+action);assertions++;}
    // Repeated input replaces a single finite effect rather than leaking a queue.
    for(let i=0;i<100;i++)r.effect(action,7+i/100);
    check(r.diagnostics().activeEffects<=1,'input burst remains bounded');
    record.actions.push({action,...change});r.dispose();assert.deepEqual(Array.from(r.hotspots()),[]);assertions++;
  }
  const panels=[before?.png0,before?.png2,now.png0,now.png2],panelPixels=[before?.a,before?.b,now.a,now.b];
  for(let col=0;col<4;col++){
    const png=panels[col];if(!png)continue;
    fs.writeFileSync(path.join(proof,entry.id+'-'+(col<2?'before':'after')+'-'+(col%2?'2s':'0s')+'.png'),png);
    const panel=createCanvas(960,540),pc=panel.getContext('2d'),data=pc.createImageData(960,540);data.data.set(panelPixels[col]);pc.putImageData(data,0,0);qc.drawImage(panel,col*320,index*204+24,320,180);
    qc.fillStyle='#bdd4d6';qc.font='11px monospace';qc.fillText((col<2?'BEFORE':'AFTER')+' '+(col%2?'2 sec':'0 sec')+' / '+entry.name,col*320+8,index*204+15);
  }
  now.r.dispose();before?.r.dispose();records.push(record);
}
for(const forbidden of [/requestAnimationFrame\s*\(/,/setInterval\s*\(/,/setTimeout\s*\(/,/addEventListener\s*\(/,/fetch\s*\(/,/localStorage/,/AudioContext/])check(!forbidden.test(currentSource),'renderer owns no external side effect '+forbidden);
fs.writeFileSync(path.join(proof,'Original-Worlds-Before-After.png'),contact.toBuffer('image/png'));
fs.writeFileSync(path.join(proof,'legacy-motion-evidence.json'),JSON.stringify({assertions,architecturePreserved:!!oldSource,records},null,2));
console.log(JSON.stringify({assertions,records,proof},null,2));
