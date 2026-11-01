'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const crypto=require('node:crypto');
const {createCanvas}=require('@napi-rs/canvas');
const root=path.resolve(__dirname,'..');
const sourceFile=path.join(root,'app/wallpapers/citylight-world.js');
const originalFile=path.join(root,'.test-temp/original-motion-20261025/app/wallpapers/citylight-world.js');
const source=fs.readFileSync(sourceFile,'utf8');
const p={palette:'nocturne',weather:'clear',intensity:65,worldActivity:60,worldGlow:55,worldFeature:true};
const evidence=path.resolve(process.env.CITYLIGHT_MOTION_RENDER_DIR||path.join(root,'.test-temp/original-motion-upgrade'));
function harness(code=source){
  let ownedEffects=0,canvases=0;
  const forbidden=()=>{ownedEffects++;throw Error('Renderer must not own host side effects');};
  const document={createElement(tag){assert.equal(tag,'canvas');canvases++;return createCanvas(480,270);},addEventListener:forbidden};
  const scope={window:null,document,requestAnimationFrame:forbidden,cancelAnimationFrame:forbidden,setTimeout:forbidden,setInterval:forbidden,fetch:forbidden,addEventListener:forbidden,AudioContext:forbidden,Audio:forbidden,localStorage:{getItem:forbidden,setItem:forbidden}};
  scope.window=scope;vm.runInNewContext(code,scope,{filename:sourceFile});
  const canvas=createCanvas(960,540),renderer=scope.SeneschalCitylight.create(canvas);
  return {canvas,renderer,counts:()=>({ownedEffects,canvases})};
}
const pixels=h=>Buffer.from(h.canvas.getContext('2d').getImageData(0,0,960,540).data);
const hash=a=>crypto.createHash('sha256').update(a).digest('hex');
function changed(a,b){let n=0;for(let i=0;i<a.length;i+=4)if(a[i]!==b[i]||a[i+1]!==b[i+1]||a[i+2]!==b[i+2])n++;return n;}
function sample(h,until,prefs=p,start=0){for(let t=start;t<until;t+=1/30)h.renderer.draw(t,prefs);h.renderer.draw(until,prefs);return pixels(h);}
function save(h,name){fs.mkdirSync(evidence,{recursive:true});fs.writeFileSync(path.join(evidence,name),h.canvas.toBuffer('image/png'));}
const metrics={scene:'citylight',resolution:[960,540],logicalResolution:[480,270],activity:60,weather:'clear',actions:{}};

test('Citylight has clearly measurable continuous life within two seconds, not a changed static wallpaper',()=>{
  const h=harness();h.renderer.draw(0,p);const start=pixels(h);save(h,'citylight-after-t0.png');
  const end=sample(h,2);save(h,'citylight-after-t2.png');
  metrics.afterChangedPixels2s=changed(start,end);metrics.afterChangedPercent2s=metrics.afterChangedPixels2s/(960*540)*100;
  assert(metrics.afterChangedPixels2s>5000,'Traffic and inhabited layers should visibly move within two seconds');
  assert.equal(h.renderer.diagnostics().cacheBakes,1);assert.equal(h.counts().canvases,2);assert.equal(h.counts().ownedEffects,0);
  if(fs.existsSync(originalFile)){
    const before=harness(fs.readFileSync(originalFile,'utf8'));before.renderer.draw(0,p);const b0=pixels(before);save(before,'citylight-before-t0.png');
    const b2=sample(before,2);save(before,'citylight-before-t2.png');metrics.beforeChangedPixels2s=changed(b0,b2);
    metrics.beforeChangedPercent2s=metrics.beforeChangedPixels2s/(960*540)*100;
    assert(metrics.afterChangedPixels2s>metrics.beforeChangedPixels2s*2,'The upgrade must materially exceed the earlier sparse ambient motion');before.renderer.dispose();
  }
  h.renderer.dispose();
});

test('All six Citylight actions are distinct, visible immediately, bounded and work with ambient life disabled',()=>{
  const expected=['traffic','lanterns','cat','signal','lights','puddles'],hashes=[];
  for(const action of expected){
    const h=harness(),idle={...p,worldFeature:false,worldActivity:0};h.renderer.draw(0,idle);const base=pixels(h);
    assert.equal(h.renderer.effect(action,0),true);h.renderer.draw(0,idle);
    const immediate=changed(base,pixels(h));assert(immediate>20,action+' must give immediate paused-preview feedback');
    sample(h,1.5,idle);const actionPixels=pixels(h);metrics.actions[action]={immediateChangedPixels:immediate,changedPixelsAt1_5s:changed(base,actionPixels)};
    assert(metrics.actions[action].changedPixelsAt1_5s>80,action+' is a real raster change');hashes.push(hash(actionPixels));save(h,'citylight-action-'+action+'.png');
    if(action==='lights'){
      h.renderer.draw(2,{...idle,palette:'ember'});assert.equal(h.renderer.diagnostics().lightsEnabled,false,'Palette changes must retain the light switch');
      h.renderer.draw(2,idle);h.renderer.effect('lights',2);h.renderer.draw(2,idle);assert.equal(changed(base,pixels(h)),0);
    }else{
      h.renderer.draw(20,idle);assert.equal(h.renderer.diagnostics().activeAction,null);assert.equal(changed(base,pixels(h)),0,'Expired action restores exact static architecture');
    }
    for(let n=0;n<1000;n++)h.renderer.effect(action,20);
    assert(h.renderer.diagnostics().activeEffects<=1,'Repeated input must not accumulate actors or effects');
    assert.deepEqual(h.counts(),{ownedEffects:0,canvases:2});h.renderer.dispose();
  }
  assert.equal(new Set(hashes).size,6);
});

test('Six disjoint top-left hotspot rectangles route their own exact centers and do not expose mutable renderer state',()=>{
  const h=harness(),spots=h.renderer.hotspots();assert.equal(spots.length,6);
  assert.deepEqual(Array.from(spots,s=>s.action),['traffic','lanterns','cat','signal','lights','puddles']);
  for(const s of spots){
    assert(s.x>=0&&s.y>=0&&s.w>0&&s.h>0&&s.x+s.w<=960&&s.y+s.h<=540);
    assert.equal(h.renderer.hitTest(s.x+s.w/2,s.y+s.h/2)?.action,s.action);
    for(const other of spots)if(other!==s)assert(!(s.x<other.x+other.w&&s.x+s.w>other.x&&s.y<other.y+other.h&&s.y+s.h>other.y),'Hotspot regions must not ambiguously overlap');
  }
  spots[0].action='changed';assert.equal(h.renderer.hotspots()[0].action,'traffic');
  assert.equal(h.renderer.hitTest(-1,-1),null);assert.equal(h.renderer.hitTest(Infinity,4),null);assert.equal(h.renderer.hitTest(959,539),null);
  h.renderer.dispose();assert.equal(h.renderer.hotspots().length,0);assert.equal(h.renderer.hitTest(500,440),null);
});

test('Zero activity and disabled city life freeze all ambient pixels for every weather choice',()=>{
  for(const weather of ['clear','rain','snow','mist'])for(const mode of ['zero','feature-off']){
    const h=harness(),prefs={...p,weather,worldActivity:mode==='zero'?0:100,worldFeature:mode!=='feature-off'};
    h.renderer.draw(0,prefs);const first=hash(pixels(h));sample(h,5,prefs);
    assert.equal(hash(pixels(h)),first,weather+'/'+mode+' must be genuinely still');assert.equal(h.renderer.diagnostics().motionTime,0);
    assert.equal(h.renderer.diagnostics().cacheBakes,1);h.renderer.dispose();
  }
});

test('Continuous traffic is reproducible, integer-scaled and retains original fixed landmark geometry',()=>{
  const a=harness(),b=harness();sample(a,3);sample(b,3);const pa=pixels(a);assert.equal(hash(pa),hash(pixels(b)));
  for(let y=0;y<540;y+=2)for(let x=0;x<960;x+=2){const at=(y*960+x)*4;for(const delta of [4,960*4,960*4+4])for(let channel=0;channel<4;channel++)assert.equal(pa[at+channel],pa[at+delta+channel]);}
  if(fs.existsSync(originalFile)){
    const before=harness(fs.readFileSync(originalFile,'utf8')),still={...p,worldFeature:false,worldActivity:0};a.renderer.draw(4,still);before.renderer.draw(0,still);
    assert.equal(changed(pixels(a),pixels(before)),0,'The fixed copper moon, skyline, tower and avenue remain byte-for-byte unchanged');before.renderer.dispose();
  }
  a.renderer.dispose();b.renderer.dispose();
});

test.after(()=>{fs.mkdirSync(evidence,{recursive:true});fs.writeFileSync(path.join(evidence,'citylight-motion-metrics.json'),JSON.stringify(metrics,null,2)+'\n');});
