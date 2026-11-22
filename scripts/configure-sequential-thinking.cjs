'use strict';
// Run from the installed isolated Node runtime in WSL, never with a provider key.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawn } = require('node:child_process');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname,'../local-runtime/sequential-thinking');
const node = path.join(root,'node_modules/node/bin/node');
const entry = path.join(root,'node_modules/@modelcontextprotocol/server-sequential-thinking/dist/index.js');
const environment = { DISABLE_THOUGHT_LOGGING:'true', MAX_THOUGHT_HISTORY:'64' };
const server = { type:'local', command:[node,entry], enabled:true, environment, timeout:15000 };

async function smokeTest() {
  fs.accessSync(node,fs.constants.X_OK); fs.accessSync(entry,fs.constants.R_OK);
  const proc = spawn(node,[entry],{stdio:['pipe','pipe','pipe'],env:{...process.env,...environment}});
  const pending = new Map(); let buffer='', stderr='', nextId=0;
  proc.stderr.setEncoding('utf8').on('data',line => { stderr = (stderr+line).slice(-8000); });
  proc.stdout.setEncoding('utf8').on('data',chunk => { buffer+=chunk; for(let pos;(pos=buffer.indexOf('\n'))>=0;) { const line=buffer.slice(0,pos); buffer=buffer.slice(pos+1); let packet; try { packet=JSON.parse(line); } catch { continue; } const handler=pending.get(packet.id); if(handler) { pending.delete(packet.id); clearTimeout(handler.timer); packet.error ? handler.reject(Error('The MCP returned an RPC error.')) : handler.resolve(packet.result); } } });
  const send = (method,params) => new Promise((resolve,reject) => { const id=++nextId; const timer=setTimeout(()=>{pending.delete(id);reject(Error(`MCP timeout: ${method}`));},10000); pending.set(id,{resolve,reject,timer}); proc.stdin.write(JSON.stringify({jsonrpc:'2.0',id,method,params})+'\n'); });
  const fail = error => { for(const handler of pending.values()){clearTimeout(handler.timer);handler.reject(error);} pending.clear(); };
  proc.on('error',fail); proc.on('exit',()=>fail(Error('MCP exited before the check finished.')));
  try {
    await send('initialize',{protocolVersion:'2025-11-25',capabilities:{},clientInfo:{name:'seneschal-smoke-test',version:'1.0.0'}});
    proc.stdin.write(JSON.stringify({jsonrpc:'2.0',method:'notifications/initialized'})+'\n');
    const listed=await send('tools/list',{});
    const tool=listed.tools.find(item=>/^sequential_?thinking$/.test(item.name)); assert.ok(tool,'Expected planning tool');
    for(let number=1;number<=2;number++) { const result=await send('tools/call',{name:tool.name,arguments:{thought:'Public verification sample: check the two-step checklist.',thoughtNumber:number,totalThoughts:2,nextThoughtNeeded:number===1}}); assert.notEqual(result.isError,true); }
    assert.ok(!stderr.includes('Public verification sample'),'Progress arguments must not appear in stderr');
    console.log('PASS: MCP initializes, lists the planning tool, accepts two steps and does not log their text to stderr.');
  } finally { for(const handler of pending.values())clearTimeout(handler.timer); pending.clear(); proc.stdin.end(); proc.kill(); }
}

async function main() {
  if(process.platform!=='linux') throw Error('Run with the isolated WSL Node runtime.');
  await smokeTest();
  if(!process.argv.includes('--enable')) return;
  const configPath=path.join(os.homedir(),'.config/opencode/opencode.json');
  const config=JSON.parse(fs.readFileSync(configPath,'utf8'));
  if(!config.mcp || typeof config.mcp!=='object' || Array.isArray(config.mcp) || config.mcp.servers) throw Error('Unexpected MCP config shape; no settings were changed.');
  if(config.mcp.sequential_thinking) {
    if(JSON.stringify(config.mcp.sequential_thinking)!==JSON.stringify(server)) throw Error('A different Sequential Thinking entry already exists; not overwriting it.');
    console.log('Sequential Thinking is already configured.'); return;
  }
  const suffix=Date.now();
  const backup=configPath+'.before-sequential-thinking-'+suffix; const temp=configPath+'.sequential-thinking-'+suffix+'.tmp';
  fs.copyFileSync(configPath,backup,fs.constants.COPYFILE_EXCL); fs.chmodSync(backup,0o600);
  config.mcp.sequential_thinking=server;
  fs.writeFileSync(temp,JSON.stringify(config,null,2)+'\n',{mode:0o600,flag:'wx'});
  fs.renameSync(temp,configPath);
  console.log('Configured only the new local MCP entry; existing provider, role and permission settings were preserved. A private config backup was made.');
}
main().catch(error=>{console.error(error.message);process.exitCode=1;});
