'use strict';
// Real raster comparisons and lifecycle checks. No browser/desktop manipulation.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const crypto=require('node:crypto');
const {createCanvas}=require('@napi-rs/canvas');
const appRoot=path.resolve(__dirname,'..');
const requestedSource=process.argv[2]||process.env.SENESCHAL_AFTERLIGHT_SOURCE;
if(!requestedSource)throw new Error('Supply the original Afterlight web folder as the first argument, or set SENESCHAL_AFTERLIGHT_SOURCE. This optional raster comparison also requires @napi-rs/canvas.');
const sourceRoot=path.resolve(requestedSource);
const ids=['city','observatory','sleeper','pelagic','sanctuary'];
const palettes=['nocturne','ember','sakura'];
const hash=canvas=>crypto.createHash('sha256').update(canvas.getContext('2d').getImageData(0,0,960,540).data).digest('hex');
function harness(adapted){
  let now=0,requestId=0,globalEvents=0,storageReads=0,storageWrites=0,inputBindings=0;
  const pending=new Map(),listeners=new Map();
  function target(name){return{addEventListener(type,fn){const key=name+':'+type;if(!listeners.has(key))listeners.set(key,new Set());listeners.get(key).add(fn);},removeEventListener(type,fn){listeners.get(name+':'+type)?.delete(fn);}};}
  function canvas(){const c=createCanvas(960,540);c.dataset={};c.addEventListener=()=>{inputBindings++;};c.getBoundingClientRect=()=>({left:0,top:0,width:960,height:540});return c;}
  const output=canvas(),media={...target('media'),matches:false};
  const document={...target('document'),hidden:false,createElement:canvas,getElementById:()=>output,body:{classList:{toggle(){},remove(){}}}};
  const scope={...target('window'),document,console,innerWidth:960,innerHeight:540,performance:{now:()=>now},
    localStorage:{getItem(){storageReads++;return null;},setItem(){storageWrites++;}},
    requestAnimationFrame(fn){pending.set(++requestId,fn);return requestId;},cancelAnimationFrame:id=>pending.delete(id),
    matchMedia:()=>media,dispatchEvent(){globalEvents++;},Event:class{},CustomEvent:class{constructor(type,options){this.type=type;this.detail=options?.detail;}}};
  scope.window=scope;
  if(adapted){for(const file of ['afterlight-worlds.js','afterlight-engine.js'])vm.runInNewContext(fs.readFileSync(path.join(appRoot,'app/wallpapers',file),'utf8'),scope,{filename:file});}
  else{for(const file of ['worlds.js','scene.js'])vm.runInNewContext(fs.readFileSync(path.join(sourceRoot,file),'utf8'),scope,{filename:file});}
  const A=adapted?scope.SeneschalAfterlight.create(output):scope.Afterlight;
  return{A,scope,document,output,pending,listeners,canvas,advance(ms=40){now+=ms;const jobs=[...pending.values()];pending.clear();jobs.forEach(fn=>fn(now));},emit(name,type){for(const fn of listeners.get(name+':'+type)||[])fn({matches:media.matches});},counts:()=>({globalEvents,storageReads,storageWrites,inputBindings,listeners:[...listeners.values()].reduce((sum,s)=>sum+s.size,0)})};
}

const rasterChecks=[];
for(const id of ids){
  const original=harness(false),isolated=harness(true);
  original.A.pause(true);
  original.A.set({caption:false,volume:0,musicStrength:0,musicSpectrum:false,rotate:false,daycycle:false,parallax:false});
  original.A.selectScene(id);isolated.A.select(id);isolated.A.set({parallax:false});
  for(const palette of palettes){
    original.A.set({palette});isolated.A.set({palette});
    original.A.previewAt(19);isolated.A.renderAt(19);
    const expected=hash(original.output),actual=hash(isolated.output);
    assert.equal(actual,expected,`${id}/${palette} must be pixel-identical to Afterlight 1.7`);
    rasterChecks.push({id,palette,sha256:actual});
  }
  for(const action of ['train','cat']){
    isolated.A.effect(action);
    const effectPixels=hash(isolated.output),state=isolated.A.diagnostics();
    isolated.A.renderCurrent();
    const redraw=isolated.A.diagnostics();
    assert.equal(hash(isolated.output),effectPixels,`${id}/${action} redraw must preserve the rendered effect`);
    assert.deepEqual(redraw.eventTimes,state.eventTimes,`${id}/${action} redraw must preserve event timestamps`);
    assert.equal(redraw.clock,state.clock);assert.equal(redraw.paused,state.paused);assert.equal(redraw.hostPaused,state.hostPaused);assert.equal(redraw.scheduledFrames,state.scheduledFrames);
  }
  isolated.A.pause(false);isolated.advance();isolated.advance();isolated.advance();
  const advanced=isolated.A.diagnostics();assert(advanced.clock>19,'The engine must really advance before the control redraw test');
  isolated.A.set({palette:'ember'});isolated.A.renderCurrent();
  const control=isolated.A.diagnostics();
  assert.equal(control.clock,advanced.clock,'Control/theme redraw must not rewind scene time');
  assert.deepEqual(control.eventTimes,advanced.eventTimes,'Control/theme redraw must not reset action timestamps');
  assert.equal(control.paused,false);assert.equal(control.scheduledFrames,1,'Control redraw must retain exactly the original animation chain');
  isolated.A.dispose();
  assert.equal(isolated.pending.size,0);
  assert.equal(isolated.counts().listeners,0);
}

const h=harness(true),A=h.A;
assert.equal(A.diagnostics().paused,true,'New renderer starts paused');
assert.equal(h.pending.size,0);
assert.deepEqual(h.counts(),{globalEvents:0,storageReads:0,storageWrites:0,inputBindings:0,listeners:3},'No application event, persistent storage or input side effects');
assert.equal(h.scope.Afterlight,undefined);assert.equal(h.scope.AfterlightWorlds,undefined);assert.equal(h.scope.livelyPropertyListener,undefined);assert.equal(h.scope.wallpaperPropertyListener,undefined);
assert.equal(A.musicFrame,undefined);assert.equal(A.musicDemo,undefined);
A.set({rotate:true,musicStrength:100,volume:100,daycycle:true});
assert.equal(A.prefs().rotate,false);assert.equal(A.prefs().musicStrength,0);assert.equal(A.prefs().volume,0);assert.equal(A.prefs().daycycle,false);
A.pause(false);assert.equal(h.pending.size,1);
for(const id of ids){
  A.select('afterlight-'+id);
  for(const weather of ['clear','rain','snow','mist']){A.set({weather,intensity:81});h.advance();h.advance();assert.equal(h.pending.size,1);}
  for(const key of ['train','lantern','cat','meteor','light','water']){A.effect(key);h.advance();assert.equal(h.pending.size,1);}
  const spot=A.hotspots()[0];A.pointer(spot.x+spot.w/2,spot.y+spot.h/2,true);h.advance();
  A.hostPause(true);assert.equal(h.pending.size,0);A.hostPause(false);assert.equal(h.pending.size,1);
}
A.select('city');A.set({palette:'ember',intensity:29});A.select('observatory');A.set({palette:'sakura',worldGlow:87});A.select('city');assert.equal(A.prefs().palette,'ember');assert.equal(A.prefs().intensity,29);
A.set({reduced:true});assert.equal(h.pending.size,0);A.select('sleeper');assert.equal(h.pending.size,0);A.set({reduced:false});assert.equal(h.pending.size,1);
h.document.hidden=true;h.emit('document','visibilitychange');assert.equal(h.pending.size,0);h.document.hidden=false;h.emit('document','visibilitychange');assert.equal(h.pending.size,1);
const frames=A.diagnostics().frame;A.dispose();A.dispose();h.advance();assert.equal(h.pending.size,0);assert.equal(h.counts().listeners,0);assert.equal(A.diagnostics().frame,frames);assert.equal(A.diagnostics().disposed,true);assert.equal(A.select('city'),undefined);
const replacement=h.scope.SeneschalAfterlight.create(h.output);assert.equal(replacement.diagnostics().paused,true);assert.equal(h.counts().listeners,3);const third=h.scope.SeneschalAfterlight.create(h.output);assert.equal(replacement.diagnostics().disposed,true);assert.equal(h.counts().listeners,3);third.dispose();assert.equal(h.counts().listeners,0);

console.log(JSON.stringify({status:'PASS',pixelComparisons:rasterChecks.length,worlds:ids.length,palettes:palettes.length,checks:['pixel-identical Afterlight 1.7','current-clock redraw preserves pixels/action timestamps/pause/RAF','control redraw never rewinds advanced scene time','starts paused','one RAF','hidden/reduced/host pause','no input bindings','no global app events','no persistent storage','silent and no audio APIs','same-canvas replacement disposal','listener cleanup','bounded released core layers'],rasterChecks},null,2));
