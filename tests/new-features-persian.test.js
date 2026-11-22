'use strict';
const test=require('node:test'), assert=require('node:assert/strict'), fs=require('node:fs'), path=require('node:path'), vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'../app/app.js'),'utf8');
const context=vm.createContext({}); vm.runInContext(source.slice(source.indexOf('/* SENESCHAL FEATURE HELP')),context);
const i18n=context.SeneschalI18n;
test('Fast mode, planning and restored activity labels are authored in Persian and reversible',()=>{
  const copy=['Fast mode','Fast processing','Fast processing · on (click to disable)','Fast processing · off (higher usage or cost may apply)','Fast processing requested. Provider availability, usage limits and premium charges may apply.','Agent-reported plan','Live Agenttrail Map ↗','Sequential Thinking · Step 2 of 4 (estimate) · revision','Sequential Thinking · Step 3 · running','Planning step 3 of 5 (estimated) · Reconsidering an earlier step · Further review requested','Working · 1/5 steps complete','1 / 5 complete','Plan · Restored','Last seen','last recorded:','Waiting for session records.','Only reported updates and observed actions; private model reasoning is not available.'];
  i18n.change('fa');
  for(const item of copy){assert.match(i18n.t(item),/[\u0600-\u06ff]/,item);assert.notEqual(i18n.t(item),item);}
  assert.equal(i18n.t('GPT-6.2 Astra'),'GPT-6.2 Astra');
  assert.equal(i18n.t('Unrecognized task content'),'Unrecognized task content');
  i18n.change('en');for(const item of copy)assert.equal(i18n.t(item),item);
});
