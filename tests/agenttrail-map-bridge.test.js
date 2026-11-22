'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const os=require('node:os');
const net=require('node:net');
const {sanitizeEvents,activeSessions,createAgenttrailMap}=require('../scripts/agenttrail-map-bridge.cjs');
const wait=ms=>new Promise(r=>setTimeout(r,ms));
const until=async fn=>{for(let i=0;i<60;i++){if(await fn())return;await wait(100);}throw Error('Map did not reach the expected state.');};
test('disabled by default: no listener, key file, or network activity',async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'seneschal-map-disabled-'));const data=path.join(root,'data');fs.mkdirSync(data);
 try{const bridge=createAgenttrailMap({root,dataDirectory:data,fetchImpl:()=>{throw Error('Unexpected fetch');},spawnImpl:()=>{throw Error('Unexpected start');}});await bridge.start();assert.deepEqual(await bridge.status(),{enabled:false,running:false,url:null});bridge.submit({connection:'online',agenttrailActive:['fixture']});assert(!fs.existsSync(path.join(data,'agenttrail-map.secret')));bridge.dispose();}finally{fs.rmdirSync(data);fs.rmdirSync(root);}
});
test('session and tool relay allows only bounded, pseudonymous observed metadata',()=>{
 const at=Date.now(),body={connection:'online',agenttrailEvents:[{kind:'tool-start',sessionID:'ses_private_fixture',callID:'call_private_fixture',tool:'bash',at,command:'PRIVATE COMMAND',prompt:'PRIVATE PROMPT',file:'PRIVATE FILE'},{kind:'working',sessionID:'ses_private_fixture',at},{kind:'tool-end',sessionID:'bad id with spaces',at},{kind:'idle',sessionID:'old',at:at-100000}],agenttrailActive:['ses_private_fixture','ses_private_fixture','invalid id']};
 const clean=sanitizeEvents(body,'fixture-key','C:/private-map-scope',at),active=activeSessions(body,'fixture-key','C:/private-map-scope',at);assert.equal(clean.length,2);assert.equal(active.length,1);assert.equal(clean[0].event.session_id,active[0].event.session_id);assert.equal(clean[0].event.tool_name,'bash');assert.equal(clean[0].event.hook_event_name,'PreToolUse');assert.equal(clean[1].event.hook_event_name,'SessionBusy');
 const text=JSON.stringify(clean);for(const secret of ['ses_private_fixture','call_private_fixture','PRIVATE COMMAND','PRIVATE PROMPT','PRIVATE FILE'])assert(!text.includes(secret));assert.equal(sanitizeEvents({...body,connection:'offline'},'key','scope',at).length,0);
});
test('restricted map starts on Windows and displays only real fixture session lifecycle',async t=>{
 const port=await new Promise((resolve,reject)=>{const s=net.createServer();s.once('error',reject);s.listen(0,'127.0.0.1',()=>{const p=s.address().port;s.close(()=>resolve(p));});});
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'seneschal-map-test-')),data=path.join(root,'data'),vendor=path.join(root,'scripts','vendor','agenttrail-map');fs.mkdirSync(data,{recursive:true});fs.mkdirSync(path.dirname(vendor),{recursive:true});fs.cpSync(path.join(__dirname,'../scripts/vendor/agenttrail-map'),vendor,{recursive:true});fs.writeFileSync(path.join(data,'agenttrail-map.enabled'),'enabled');
 const bridge=createAgenttrailMap({root,dataDirectory:data,port});const get=async p=>await fetch(`http://127.0.0.1:${port}${p}`).then(r=>r.json());
 try{await bridge.start();await until(async()=>{try{return (await bridge.status()).running;}catch{return false;}});const at=Date.now();bridge.submit({connection:'online',agenttrailEvents:[{kind:'start',sessionID:'ses_fixture_1',at},{kind:'working',sessionID:'ses_fixture_1',at:at+1},{kind:'tool-start',sessionID:'ses_fixture_1',tool:'read',callID:'fixture_call',at:at+2,prompt:'PRIVATE_PAYLOAD'}],agenttrailActive:['ses_fixture_1']});
  await until(async()=>{const r=await get('/summary');return Array.isArray(r.runs)&&r.runs.some(x=>x.agent==='seneschal'&&x.ended===false&&String(x.tool).startsWith('read'));});const before=await get('/summary');assert.equal(before.runs.filter(r=>r.agent==='seneschal').length,1);assert(!JSON.stringify(before).includes('ses_fixture_1'));assert(!JSON.stringify(before).includes('PRIVATE_PAYLOAD'));assert.equal((await get('/whoami')).bridgeOnly,true);
  bridge.submit({connection:'online',agenttrailEvents:[{kind:'idle',sessionID:'ses_fixture_1',at:Date.now()}],agenttrailActive:[]});await until(async()=>{const r=await get('/summary');return r.runs.some(x=>x.agent==='seneschal'&&x.ended===true&&x.tool===null);});
 }finally{bridge.dispose();await wait(400);const base=path.resolve(os.tmpdir()),target=path.resolve(root);if(path.dirname(target)===base&&path.basename(target).startsWith('seneschal-map-test-'))fs.rmSync(target,{recursive:true,force:true});}
});
