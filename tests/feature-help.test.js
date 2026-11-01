'use strict';
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../app/app.js'), 'utf8');
const helpSource = source.slice(source.indexOf('/* SENESCHAL FEATURE HELP'), source.indexOf('/* SENESCHAL LOCAL LANGUAGES'));
const context = vm.createContext({}); vm.runInContext(helpSource, context);
const help = context.SeneschalFeatureHelp;
function control(id = '', selectors = [], attrs = {}) {
  return { id, dataset: {}, textContent: '', getAttribute: key => attrs[key] || null, hasAttribute: key => Object.hasOwn(attrs, key),
    matches: selector => selector.split(',').some(key => selectors.includes(key.trim())), closest: () => null };
}
test('help copy is brief, local, and uses stable IDs suitable for future language packs', () => {
  assert.ok(Object.keys(help.catalog).length > 170);
  for (const [id, copy] of Object.entries(help.catalog)) { assert.ok(id && copy.length >= 30 && copy.length <= 300, id); assert.ok(!/[<>]/.test(copy), id); }
  assert.equal(typeof help.install, 'function');
  assert.doesNotMatch(helpSource, /\bfetch\s*\(|XMLHttpRequest|WebSocket|getUserMedia|speechSynthesis|AudioContext|localStorage|\.click\s*\(|\.submit\s*\(/);
});
test('permission explanations distinguish one action, remembered approval, rejection and status checks', () => {
  assert.match(help.describe(control('', ['[data-reply="once"]'])), /only this waiting/);
  assert.match(help.describe(control('', ['[data-reply="always"]'])), /matching actions.*conversation/);
  assert.match(help.describe(control('', ['[data-reply="reject"]'])), /not approved/);
  assert.match(help.describe(control('', ['[data-check-permission]'])), /does not send.*again/);
});
test('destructive help distinguishes source deletion from local display removal', () => {
  assert.match(help.describe(control('confirmDeleteSessionButton')), /Permanently.*Project files are not deleted/);
  assert.match(help.describe(control('confirmDeleteProjectButton')), /folder, files.*kept/);
  assert.match(help.describe(control('confirmDeleteMessageButton')), /source transcript remains unchanged/);
});
test('voice help follows the mute state and does not promise to take back transmitted audio', () => {
  assert.match(help.describe(control('', ['[data-voice-mute="mic"]'], { 'aria-pressed': 'false' })), /already sent cannot be taken back/);
  assert.match(help.describe(control('', ['[data-voice-mute="mic"]'], { 'aria-pressed': 'true' })), /automatically send/);
  assert.match(help.describe(control('', ['[data-voice-mute="speaker"]'], { 'aria-pressed': 'true' })), /not be replayed/);
  assert.match(help.describe(control('voiceMenuButton')), /does not start recording/);
});
test('help never inspects a typed password or draft value', () => {
  const key = control('providerKeyInput'); Object.defineProperty(key, 'value', { get() { assert.fail('Private field value must not be read'); } });
  assert.match(help.describe(key), /Keep it secret/);
  const draft = control('promptInput'); Object.defineProperty(draft, 'value', { get() { assert.fail('Draft must not be read'); } });
  assert.match(help.describe(draft), /Typing alone sends nothing/);
});
test('disabled actions keep their explanation and add an availability note', () => {
  assert.match(help.describe(control('sendButton', [':disabled'])), /Unavailable right now/);
});

test('section headings explain the feature, not just repeat the heading label', () => {
  for (const [key, expected] of [['permissions', /explicit decision/], ['tools', /automatically approved/], ['budget', /provider too/], ['pulse', /not your remaining/]]) {
    const node = control('', ['.block-title']); node.closest = () => ({ dataset: { inspectorSection: key } });
    assert.match(help.describe(node), expected);
  }
});
