'use strict';
// Optional PC-only bridge. It consumes the same authorized UI event summary
// as Project Desk; raw session/call identifiers are never persisted or relayed.
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const {spawn}=require('node:child_process');
const PORT=5550;
const kinds={start:'SessionStart',working:'SessionBusy',idle:'Stop',end:'SessionEnd','tool-start':'PreToolUse','tool-end':'PostToolUse','tool-error':'PostToolUseFailure'};
const toolNames=new Set(['read','write','edit','glob','grep','list','bash','task','webfetch','websearch','todowrite','todoread','question','tool']);
const validID=value=>typeof value==='string'&&/^[A-Za-z0-9_.:-]{1,160}$/.test(value);
const id=(key,value)=>crypto.createHmac('sha256',key).update(value).digest('hex').slice(0,24);
function sanitizeEvents(body,key,cwd,now=Date.now()){
  if(!body||body.connection!=='online')return [];
  const records=(Array.isArray(body.agenttrailEvents)?body.agenttrailEvents:[]).slice(-64).flatMap(e=>{
    if(!e||!Object.hasOwn(kinds,e.kind)||!validID(e.sessionID)||!Number.isSafeInteger(e.at)||e.at<now-60_000||e.at>now+5000)return [];
    const session_id='seneschal-'+id(key,e.sessionID),event={hook_event_name:kinds[e.kind],agent:'seneschal',cwd,session_id};
    if(e.kind==='start')event.source='startup';
    if(e.kind.startsWith('tool-')){
      event.tool_name=toolNames.has(e.tool)?e.tool:'tool';
      if(validID(e.callID))event.tool_use_id=id(key,'call:'+e.callID);
    }
    return [{event,key:id(key,`${e.kind}:${e.sessionID}:${validID(e.callID)?e.callID:''}:${e.at}`),at:e.at}];
  }).sort((a,b)=>a.at-b.at);
  return records;
}
function activeSessions(body,key,cwd,now=Date.now()){
  if(!body||body.connection!=='online')return [];
  return [...new Set((Array.isArray(body.agenttrailActive)?body.agenttrailActive:[]).filter(validID).slice(0,48))].map(value=>({event:{hook_event_name:'SessionBusy',agent:'seneschal',cwd,session_id:'seneschal-'+id(key,value)},at:now}));
}
function readKey(data){
  const file=path.join(data,'agenttrail-map.secret');
  if(!fs.existsSync(file)){try{fs.writeFileSync(file,crypto.randomBytes(32).toString('hex'),{flag:'wx',mode:0o600});}catch(error){if(error.code!=='EEXIST')throw error;}}
  const info=fs.lstatSync(file);if(!info.isFile()||info.isSymbolicLink()||info.size!==64)throw Error('Invalid local map key');
  const value=fs.readFileSync(file,'utf8');if(!/^[a-f0-9]{64}$/.test(value))throw Error('Invalid local map key');return value;
}
function createAgenttrailMap({root,dataDirectory,fetchImpl=global.fetch,spawnImpl=spawn,port=PORT}){
  const origin=`http://127.0.0.1:${port}`,vendor=path.join(root,'scripts','vendor','agenttrail-map');
  const marker=path.join(dataDirectory,'agenttrail-map.enabled'),scope=path.join(root,'local-runtime','agenttrail-map-scope'),entry=path.join(vendor,'bin','agenttrail.mjs');
  let key,child,disposed=false,busy=false,pending=null,started=false;
  const seen=new Map(),lastBusy=new Map();
  const enabled=()=>{try{const st=fs.lstatSync(marker);return st.isFile()&&!st.isSymbolicLink()&&st.size<=32&&fs.readFileSync(marker,'utf8').trim()==='enabled';}catch{return false;}};
  const verified=async()=>{try{const r=await fetchImpl(origin+'/whoami',{signal:AbortSignal.timeout(750),redirect:'error'});if(!r.ok)return false;const d=await r.json();return d.bridgeOnly===true&&d.port===port&&path.resolve(d.repoPath)===path.resolve(scope);}catch{return false;}};
  async function start(){
    if(disposed||started||!enabled()||!fs.existsSync(entry))return;
    try{fs.mkdirSync(scope,{recursive:true});if(fs.lstatSync(scope).isSymbolicLink())throw Error('Invalid map scope');const plan=path.join(scope,'PLAN.md');if(!fs.existsSync(plan))fs.copyFileSync(path.join(vendor,'PLAN-template.md'),plan,fs.constants.COPYFILE_EXCL);
      key=readKey(dataDirectory);started=true;if(await verified()||disposed)return;
      child=spawnImpl(process.execPath,[entry,scope,'--port',String(port),'--no-open'],{windowsHide:true,stdio:'ignore',env:{...process.env,AGENTTRAIL_BRIDGE_ONLY:'1',AGENTTRAIL_BRIDGE_KEY:key,AGENTTRAIL_PORT_BASE:String(port),AGENTTRAIL_PORT:String(port)}});
      child.on('error',()=>{child=null;});child.once('exit',()=>{child=null;});
    }catch{started=false;}
  }
  async function status(){const active=enabled();return {enabled:active,running:active&&await verified(),url:active?origin+'/':null};}
  async function send(event){try{const response=await fetchImpl(origin+'/hook',{method:'POST',redirect:'error',signal:AbortSignal.timeout(750),headers:{'Content-Type':'application/json','x-seneschal-map-key':key},body:JSON.stringify(event)});return response.ok;}catch{return false;}}
  async function flush(){
    if(busy||disposed||!key||!enabled())return;busy=true;
    try{while(pending&&!disposed){const body=pending;pending=null;if(!await verified())continue;
        const now=Date.now();for(const row of sanitizeEvents(body,key,scope,now)){
          if(disposed||seen.has(row.key))continue;if(!await send(row.event))break;seen.set(row.key,now);if(seen.size>512)seen.delete(seen.keys().next().value);
          if(row.event.hook_event_name==='SessionBusy'){lastBusy.set(row.event.session_id,now);if(lastBusy.size>128)lastBusy.delete(lastBusy.keys().next().value);}
          if(['Stop','SessionEnd'].includes(row.event.hook_event_name))lastBusy.delete(row.event.session_id);
        }
        for(const row of activeSessions(body,key,scope,now)){if(disposed)break;const sid=row.event.session_id;if(now-(lastBusy.get(sid)||0)<25_000)continue;if(await send(row.event)){lastBusy.set(sid,now);if(lastBusy.size>128)lastBusy.delete(lastBusy.keys().next().value);}}
      }}finally{busy=false;}
  }
  function submit(body){if(disposed||!key||!enabled()||body?.connection!=='online')return;pending={connection:body.connection,agenttrailEvents:Array.isArray(body.agenttrailEvents)?body.agenttrailEvents.slice(-64):[],agenttrailActive:Array.isArray(body.agenttrailActive)?body.agenttrailActive.slice(0,48):[]};void flush();}
  function dispose(){disposed=true;pending=null;if(child&&!child.killed)child.kill();}
  return {start,status,submit,dispose};
}
module.exports={createAgenttrailMap,sanitizeEvents,activeSessions};
