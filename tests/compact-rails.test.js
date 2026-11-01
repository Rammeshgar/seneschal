'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const root=path.join(__dirname,'..'),app=fs.readFileSync(path.join(root,'app/app.js'),'utf8'),html=fs.readFileSync(path.join(root,'app/index.html'),'utf8'),css=fs.readFileSync(path.join(root,'app/styles.css'),'utf8');
const slice=(a,b)=>{const start=app.indexOf(a),end=app.indexOf(b,start);assert.ok(start>=0&&end>start);return app.slice(start,end);};
const context=vm.createContext({});vm.runInContext(app.slice(app.indexOf('/* SENESCHAL FEATURE HELP')),context);
test('compact shortcuts have stable names, real buttons and explained behavior',()=>{
 for(const id of ['compactNewSession','compactProjects','compactSessions','compactPermissions','compactTools','compactProviders','compactPulse']){
  assert.match(html,new RegExp('<button[^>]*id="'+id+'"[^>]*aria-label="[^"]+"'));
  assert.ok(context.SeneschalFeatureHelp.catalog[id]?.length>30,id);
 }
 for(const id of ['compactProjects','compactSessions','compactPermissions','compactTools','compactProviders','compactPulse']){
  context.SeneschalI18n.change('fa');assert.match(context.SeneschalI18n.t(context.SeneschalFeatureHelp.catalog[id]),/[\u0600-\u06ff]/,id);
 }
});
test('context navigation reveals only allowed sections and cannot execute or approve a task',()=>{
 const code=slice('  function revealInspectorSection(','  function syncCompactPermissionBadge(');
 assert.doesNotMatch(code,/\bapi\s*\(|fetch\s*\(|replyPermission\s*\(|sendPrompt\s*\(|\.click\s*\(/);
 assert.match(code,/\["permissions", "tools", "providers", "pulse"\]\.includes\(key\)/);
 const sandbox=vm.createContext({});vm.runInContext(code,sandbox);
 for(const invalid of ['once','always','reject','__proto__','<script>'])assert.doesNotThrow(()=>sandbox.revealInspectorSection(invalid));
});
test('left navigation preserves the native action owners and explicit panel state',()=>{
 const reveal=slice('  function revealRailSection(','  function revealInspectorSection(');
 assert.match(reveal,/state\.leftPanelCollapsed = false/);assert.match(reveal,/state\.railSections\[key\] = false/);
 assert.doesNotMatch(reveal,/\bapi\s*\(|fetch\s*\(|sendPrompt\s*\(/);
 const bind=slice('  function bindCompactNavigation(','  const motionPresets =');assert.match(bind,/#compactNewSession[\s\S]*newSession\(\)/);
 for(const id of ['activityRailButton','workspaceToolsButton','settingsRailButton','motionSwitch'])assert.equal((html.match(new RegExp('id="'+id+'"','g'))||[]).length,1,id+' is not cloned');
});
test('badge reflects unresolved approvals and never sends a decision',()=>{
 const badge={hidden:true,textContent:''},classes=new Set(),button={classList:{toggle:(key,on)=>on?classes.add(key):classes.delete(key)}},status={textContent:''};
 const sandbox=vm.createContext({$:id=>({'#compactPermissionBadge':badge,'#compactPermissions':button,'#compactPermissionStatus':status}[id]),window:{},state:{permissions:[{id:'one'},{id:'two'}],permissionReplies:new Map([['one',{status:'resolved'}]])}});
 vm.runInContext(slice('  function syncCompactPermissionBadge(','  function bindCompactNavigation('),sandbox);
 sandbox.syncCompactPermissionBadge();assert.equal(badge.hidden,false);assert.equal(badge.textContent,'1');assert.ok(classes.has('has-pending'));assert.equal(status.textContent,'Permission required');
 sandbox.state.permissionReplies.set('two',{status:'resolved'});sandbox.syncCompactPermissionBadge();assert.equal(badge.hidden,true);assert.ok(!classes.has('has-pending'));assert.equal(status.textContent,'No waiting approvals');
 sandbox.syncCompactPermissionBadge(Array.from({length:12},()=>({})));assert.equal(badge.textContent,'9+');
});
test('desktop rails retain native popovers and mobile drawers remain separate',()=>{
 assert.match(css,/sidebar-footer > #workspaceToolsPanel:popover-open \{ display: grid/);
 assert.match(css,/@media \(max-width: 1120px\) \{ \.app-shell \.inspector > \.compact-context-nav \{ display: none !important/);
 assert.match(css,/@media \(max-width: 680px\) \{ \.app-shell > \.sidebar > \.compact-left-nav \{ display: none !important/);
 assert.match(css,/width: 44px; min-width: 44px; height: 44px; min-height: 44px/);
});
test('compact help is placed beside rails rather than over adjacent icons',()=>{
 const helper=slice('/* SENESCHAL FEATURE HELP','/* SENESCHAL LOCAL LANGUAGES');
 assert.match(helper,/rightRail \? anchor\.left - rect\.width - 10 : anchor\.right \+ 10/);
 assert.match(helper,/current\.matches\('\.panel-toggle'\)/);
 assert.doesNotMatch(helper,/\bfetch\s*\(|\.click\s*\(|replyPermission\s*\(/);
});
