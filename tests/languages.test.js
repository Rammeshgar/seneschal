'use strict';
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../app/app.js'), 'utf8');
const context = vm.createContext({}); vm.runInContext(source.slice(source.indexOf('/* SENESCHAL FEATURE HELP')), context);
const i18n = context.SeneschalI18n, help = context.SeneschalFeatureHelp;
test('only explicit supported languages can change the interface', () => {
  assert.equal(i18n.language, 'en'); assert.equal(i18n.change('xx'), false); assert.equal(i18n.change('<script>'), false);
  assert.equal(i18n.change('fa'), true); assert.equal(i18n.language, 'fa'); assert.equal(i18n.languages.fa.dir, 'rtl');
  assert.equal(i18n.change('en'), true); assert.equal(i18n.t('Send message'), 'Send message');
});
test('all curated help and section purposes have authored Persian translations', () => {
  i18n.change('fa');
  for (const [id, copy] of Object.entries(help.catalog)) assert.match(i18n.t(copy), /[\u0600-\u06ff]/, id);
  for (const [section, copy] of Object.entries(help.sections)) assert.match(i18n.t(copy), /[\u0600-\u06ff]/, section);
  for (const [selector, copy] of help.rules) if (typeof copy === 'string') assert.match(i18n.t(copy), /[\u0600-\u06ff]/, selector);
});
test('permissions remain distinct and unknown diagnostics or content are not guessed', () => {
  assert.equal(i18n.t('Allow once'), 'فقط این بار'); assert.equal(i18n.t('Always'), 'همیشه'); assert.equal(i18n.t('Reject'), 'رد درخواست');
  for (const raw of ['printf "Allow once"', 'C:\\Projects\\Settings', 'https://example.com/Options', 'Unknown diagnostic 42', '<script>alert(1)</script>']) assert.equal(i18n.t(raw), raw);
});
test('English round trips without modifying copy or numeric source values', () => {
  const sourceNumber = 1234.5; assert.match(i18n.number(sourceNumber), /[۰-۹]/); assert.equal(sourceNumber, 1234.5);
  assert.match(i18n.date('2026-10-25T12:00:00Z', {year:'numeric',month:'2-digit',day:'2-digit',timeZone:'UTC'}), /۲۰۲۶/);
  assert.match(i18n.t('12 characters'), /۱۲/);
  i18n.change('en'); for (const key of Object.keys(i18n.translations)) assert.equal(i18n.t(key), key);
});
test('language module cannot request audio, send messages, call a provider or mutate policy', () => {
  const code = source.slice(source.indexOf('/* SENESCHAL LOCAL LANGUAGES'));
  assert.doesNotMatch(code, /\bfetch\s*\(|XMLHttpRequest|WebSocket|getUserMedia|speechSynthesis|\.click\s*\(|\.submit\s*\(/);
  assert.doesNotMatch(code, /localStorage\.(?:getItem|setItem)\(['"]/);
  assert.match(code, /const storageKey = 'seneschal-interface-language-v1'/);
});
