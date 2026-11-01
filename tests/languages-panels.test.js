'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const root=path.join(__dirname,'..'),read=n=>fs.readFileSync(path.join(root,'app',n),'utf8');
const app=read('app.js'),ctx=vm.createContext({});vm.runInContext(app.slice(app.indexOf('/* SENESCHAL FEATURE HELP')),ctx);const i18n=ctx.SeneschalI18n;
const {catalog}=require(path.join(root,'app/wallpapers.js'));
test('all wallpaper catalog copy has authored Persian',()=>{
 i18n.change('fa');for(const world of catalog)for(const copy of [world.name,world.short,world.group,world.badge,world.description,...(world.actions||[]).map(a=>a[1])].filter(Boolean))assert.match(i18n.t(copy),/[\u0600-\u06ff]/,copy);
});
test('scene-specific Afterlight setting labels are translated',()=>{
 const metadata=vm.createContext({window:{}});vm.runInContext(read('wallpapers/afterlight-worlds.js'),metadata);i18n.change('fa');
 for(const world of metadata.window.SeneschalAfterlightWorlds.catalog)for(const key of ['feature','activity','glow'])assert.match(i18n.t(world[key]),/[\u0600-\u06ff]/,world[key]);
});
test('live wallpaper status, percentages and interaction hints translate as complete messages',()=>{
 i18n.change('fa');for(const copy of ['Last indexed Nov 1, 2026 · Coverage may be incomplete','Live animation · up to 30 fps · rendered locally','Live animation · 60 fps limit · click a detail or press 1–6 · Esc to return','Gallery thumbnails are still images. Explore full scene to see the animation. · rotation paused','Live animation · up to 15 fps · rendered locally · rotation in 2 min','Dispatch a lunar rover · triggered','Launch the service drone · still-frame result; motion remains paused','Send a relay pulse · click or use the matching number','1. Dispatch a lunar rover','100%']){
  const result=i18n.t(copy);assert.match(result,/[\u0600-\u06ff]/,copy);assert.doesNotMatch(result,/rotation|triggered|fps|click|paused|Last indexed|Coverage/,copy);
 }
 for(const raw of ['Unknown diagnostic · rotation paused','Unknown payload · triggered','1. User content',String.raw`C:\Settings\Build`,'/home/test/OpenCode.db'])assert.equal(i18n.t(raw),raw);
});
test('Activity technical values are escaped, isolated and protected from translation',()=>{
 const source=read('activity.js'),start=source.indexOf('  function serviceRuntimeView()'),end=source.indexOf('  function render(',start);
 const escape=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const sandbox=vm.createContext({state:{runtime:{phase:'ready',owned:true,source:'/home/test/Settings.db',index:'C:\\History\\index.db',version:'0.1.7',lastError:'<img src=x onerror=bad()>'}},escape,date:()=>'',count:()=>''});vm.runInContext(source.slice(start,end),sandbox);const html=sandbox.serviceRuntimeView();
 assert.match(html,/<bdi dir="ltr" data-no-i18n class="activity-technical">\/home\/test\/Settings.db<\/bdi>/);assert.match(html,/<bdi dir="ltr" data-no-i18n class="activity-technical">Agent Trail 0\.1\.7<\/bdi>/);assert.doesNotMatch(html,/<img/);assert.match(html,/dir="auto" data-no-i18n>&lt;img/);
 sandbox.state.runtime={phase:'stopped'};assert.match(sandbox.serviceRuntimeView(),/<dd>Created on first start<\/dd>/);
});
test('English round trips all new copy and numeric preference values remain numbers',()=>{
 const numeric=60;i18n.change('fa');assert.equal(i18n.t('60%'),'۶۰٪');assert.equal(numeric,60);i18n.change('en');
 for(const world of catalog)for(const copy of [world.name,world.description,...(world.actions||[]).map(a=>a[1])])assert.equal(i18n.t(copy),copy);
});
