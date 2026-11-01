'use strict';
// Real installed renderer, synthetic levels, strict production-equivalent CSP.
// No microphone, network service, conversation or voice API is used.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium}=require(process.argv[2]);
const root=path.join(__dirname,'..'),output=path.join(root,'.test-temp/ares-visual');fs.mkdirSync(output,{recursive:true});
const moduleCode=`
import * as THREE from '/workspace/assets/ares/three.module.js';
import {GLTFLoader} from '/workspace/assets/ares/GLTFLoader.js';
import {createAresView} from '/workspace/ares-scene.js';
const parse=GLTFLoader.prototype.parseAsync;
GLTFLoader.prototype.parseAsync=async function(...args){const value=await parse.apply(this,args);window.asset=value;return value;};
window.level=0;window.violations=[];document.addEventListener('securitypolicyviolation',event=>violations.push(event.violatedDirective));
window.view=createAresView(document.getElementById('host'),{level:()=>window.level,ready(){window.ready=true;},error(){window.failed=true;}});
window.metrics=()=>{
 view.setCamera(0,0);
 const {renderer,camera}=window.__visualView,model=asset.scene;model.updateMatrixWorld(true);
 let mouth,badge;model.traverse(o=>{if(o.morphTargetDictionary)mouth=o;if(o.isMesh&&o.material?.name?.includes('authentic Seneschal badge'))badge=o;});
 const positions=mouth.geometry.attributes.position,points=[];
 for(let i=0;i<positions.count;i++)if(Math.abs(positions.getX(i))<.04)points.push(mouth.getVertexPosition(i,new THREE.Vector3()));
 const localOpening=Math.max(...points.map(p=>p.y))-Math.min(...points.map(p=>p.y));
 const projected=points.map(p=>mouth.localToWorld(p.clone()).project(camera));
 const openingPixels=(Math.max(...projected.map(p=>p.y))-Math.min(...projected.map(p=>p.y)))*renderer.domElement.height/2;
 const triangles=[];const indices=mouth.geometry.index;
 for(let i=0;i<indices.count;i+=3){const p=new THREE.Vector3();for(let j=0;j<3;j++)p.add(mouth.getVertexPosition(indices.getX(i+j),new THREE.Vector3()));p.divideScalar(3);if(Math.abs(p.x)<.045)triangles.push(p);}
 triangles.sort((a,b)=>a.y-b.y);
 const visible=[triangles[0],triangles.at(-1)].map(p=>{const target=mouth.localToWorld(p.clone()),ray=new THREE.Raycaster(camera.position,target.sub(camera.position).normalize());return ray.intersectObject(model,true)[0]?.object===mouth;});
 const image=badge.material.map?.image;
 const textureCanvas=document.createElement('canvas');textureCanvas.width=image?.width||1;textureCanvas.height=image?.height||1;
 const tc=textureCanvas.getContext('2d');if(image)tc.drawImage(image,0,0);
 const pixelData=tc.getImageData(0,0,textureCanvas.width,textureCanvas.height).data,colors=new Set();
 for(let i=0;i<pixelData.length;i+=4)colors.add([pixelData[i]>>4,pixelData[i+1]>>4,pixelData[i+2]>>4].join(','));
 const canvas=renderer.domElement,copy=document.createElement('canvas');copy.width=canvas.width;copy.height=canvas.height;const ctx=copy.getContext('2d');ctx.drawImage(canvas,0,0);
 const corners=[];const bp=badge.geometry.attributes.position;for(let i=0;i<bp.count;i++)corners.push(badge.localToWorld(new THREE.Vector3().fromBufferAttribute(bp,i)).project(camera));
 const x0=Math.max(0,Math.ceil((Math.min(...corners.map(p=>p.x))+1)*canvas.width/2)),x1=Math.min(canvas.width,Math.floor((Math.max(...corners.map(p=>p.x))+1)*canvas.width/2));
 const y0=Math.max(0,Math.ceil((1-Math.max(...corners.map(p=>p.y)))*canvas.height/2)),y1=Math.min(canvas.height,Math.floor((1-Math.min(...corners.map(p=>p.y)))*canvas.height/2));
 const badgePixels=ctx.getImageData(x0,y0,Math.max(1,x1-x0),Math.max(1,y1-y0)).data,lumas=[];
 for(let i=0;i<badgePixels.length;i+=4)lumas.push((badgePixels[i]+badgePixels[i+1]+badgePixels[i+2])/3);
 return {localOpening,openingPixels,visible,weights:mouth.morphTargetInfluences.slice(),textureWidth:image?.width||0,textureColors:colors.size,badgePixelRange:Math.max(...lumas)-Math.min(...lumas),badgePixelWidth:x1-x0,violations:violations.slice()};
};
`;
(async()=>{
 const browser=await chromium.launch({executablePath:'C:/Program Files/BraveSoftware/Brave-Browser/Application/brave.exe',headless:true,args:['--enable-unsafe-swiftshader']});
 const results=[];
 try{
  for(const [label,width,height]of[['phone-card',210,170],['desktop-full',850,760],['broken-badge',210,170]]){
   const page=await browser.newPage({viewport:{width:Math.max(390,width),height:Math.max(420,height)}}),errors=[];
   page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
   await page.route('**/*',route=>{
    const u=new URL(route.request().url());if(u.origin!=='https://visual.invalid')return route.abort();
    if(u.pathname==='/')return route.fulfill({contentType:'text/html',headers:{'Content-Security-Policy':"default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data: blob:; connect-src 'self'"},body:'<html><head><link rel="stylesheet" href="/test.css"></head><body><div id="host"></div><script type="module" src="/visual-test.js"></script></body></html>'});
    if(u.pathname==='/test.css')return route.fulfill({contentType:'text/css',body:'body{margin:0;background:#0e1720}#host{width:'+width+'px;height:'+height+'px}canvas{display:block;width:100%;height:100%}'});
    if(u.pathname==='/visual-test.js')return route.fulfill({contentType:'application/javascript',body:moduleCode});
    const name=u.pathname.replace(/^\/workspace\//,'');
    if(!['ares-scene.js','assets/ares/ares.glb','assets/ares/three.module.js','assets/ares/GLTFLoader.js','assets/ares/BufferGeometryUtils.js'].includes(name))return route.abort();
    let body=fs.readFileSync(path.join(root,'app',name));
    if(label==='broken-badge'&&name.endsWith('.glb')){
      body=Buffer.from(body);const jsonLength=body.readUInt32LE(12),gltf=JSON.parse(body.toString('utf8',20,20+jsonLength));
      const image=gltf.bufferViews[gltf.images[0].bufferView];body[20+jsonLength+8+(image.byteOffset||0)]=0;
    }
    if(name==='ares-scene.js')body=body.toString().replace('let yaw = 0, pitch = 0, distance = 4;', 'window.__visualView = {renderer, scene, camera}; let yaw = 0, pitch = 0, distance = 4;');
    return route.fulfill({contentType:name.endsWith('.glb')?'model/gltf-binary':'application/javascript',body});
   });
   await page.goto('https://visual.invalid/');await page.waitForFunction(()=>window.ready||window.failed,{timeout:30000});
   if(label==='broken-badge'){
    assert.equal(await page.evaluate(()=>window.failed),true,'a broken badge must fail visibly rather than claiming readiness');assert.equal(await page.evaluate(()=>window.ready),undefined);
    assert.deepEqual(await page.evaluate(()=>violations),[]);assert.ok(errors.some(error=>error.includes("Couldn't load texture")));
    results.push({label,visibleFailure:true,falseReady:false,securityViolations:0});await page.evaluate(()=>view.dispose());await page.close();continue;
   }
   assert.equal(await page.evaluate(()=>window.failed),undefined,'asset must fully load');
   const cases=[];
   for(const [mode,level]of[['silence',0],['quiet',.048],['normal',.30],['browser',-1]]){
    await page.evaluate(value=>{window.level=value;view.setState('Speaking');},level);
    const samples=[];for(let i=0;i<8;i++){await page.waitForTimeout(65);samples.push(await page.evaluate(()=>metrics()));}
    for(const s of samples){assert.ok(s.visible.every(Boolean),label+' '+mode+': mouth must be in front of the glass');assert.equal(s.textureWidth,128);assert.ok(s.textureColors>12);assert.deepEqual(s.violations,[]);}
    const largest=Math.max(...samples.map(s=>s.openingPixels));
    if(mode==='quiet')assert.ok(largest>(width<300?4:18),label+': quiet speech opening is too small '+largest);
    if(mode==='normal'||mode==='browser')assert.ok(largest>(width<300?8:35),label+': strong speech opening is too small '+largest);
    if(mode==='silence')assert.ok(Math.max(...samples.map(s=>s.localOpening))<.045,'silence closes the mouth');
    if(width>300)assert.ok(samples.every(s=>s.badgePixelRange>40),'the rendered badge cannot be a flat white square');
    await page.screenshot({path:path.join(output,label+'-'+mode+'.png')});
    cases.push({mode,largestOpeningPixels:largest,minimumOpeningPixels:Math.min(...samples.map(s=>s.openingPixels)),badgeTextureColors:samples[0].textureColors,badgePixelRange:samples[0].badgePixelRange});
   }
   await page.evaluate(()=>{view.setPaused(true);});const paused=await page.evaluate(()=>metrics());await page.waitForTimeout(250);assert.ok((await page.evaluate(()=>metrics())).weights.every((value,i)=>Math.abs(value-paused.weights[i])<1e-9),'Pause keeps a stable mouth');
   await page.evaluate(()=>view.setVisible(false));const hidden=await page.evaluate(()=>metrics());await page.waitForTimeout(250);assert.deepEqual((await page.evaluate(()=>metrics())).weights,hidden.weights,'hidden scenes do not animate');
   await page.evaluate(()=>view.dispose());assert.equal(await page.locator('#host canvas').count(),0);assert.deepEqual(errors,[]);
   results.push({label,cases,textureVisible:true,mouthVisible:true,securityViolations:0,pausedAndHiddenStop:true});await page.close();
  }
  fs.writeFileSync(path.join(output,'results.json'),JSON.stringify(results,null,2));console.log(JSON.stringify(results,null,2));
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
