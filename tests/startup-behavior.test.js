const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { EventEmitter } = require('node:events');
const source = fs.readFileSync(require('node:path').join(__dirname, '../server.js'), 'utf8');
function load(name, globals) {
  const start = source.indexOf(`function ${name}(`);
  const end = source.indexOf('\nfunction ', start + 1);
  const c = vm.createContext(globals);
  vm.runInContext(source.slice(start, end), c);
  return c;
}
test('health timeout followed by socket error only completes once', () => {
  const req = new EventEmitter(); req.destroy = () => req.emit('error', new Error('closed'));
  const c = load('checkUpstream', { http: { get: () => req }, host: 'localhost', upstreamPort: 1, upstreamAuthorization: '' });
  const results = []; c.checkUpstream(value => results.push(value));
  req.emit('timeout');
  assert.deepEqual(results, [false]);
});
test('concurrent Bonsai preparation shares one model startup and permits retry', async () => {
  let starts = 0; let finish;
  const c = load('prepareLocalBonsai', { bonsaiPreparation: null, startLocalBonsai: callback => { starts++; finish = callback; } });
  const results = [];
  c.prepareLocalBonsai((error, value) => results.push(value));
  c.prepareLocalBonsai((error, value) => results.push(value));
  assert.equal(starts, 1);
  finish(null, 'ready');
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(results, ['ready', 'ready']);
  c.prepareLocalBonsai(() => {});
  assert.equal(starts, 2);
  finish(null, 'ready');
});
