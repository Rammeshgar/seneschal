'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createChatProgress } = require('../app/activity');
const message = (...parts) => ({ info: { id: 'm', sessionID: 'a', role: 'assistant' }, parts });
const tool = (id, status) => ({ type: 'tool', id, sessionID: 'a', messageID: 'm', tool: 'read', state: { status, input: { path: 'private-path' }, output: 'private-output' } });
function opened() { const model = createChatProgress(); model.select('a'); return model; }

test('Sequential Thinking restores numbered steps without retaining raw thought arguments', () => {
  const model = opened();
  const step = { ...tool('step', 'completed'), tool: 'sequential_thinking_sequentialthinking' };
  step.state.input = { thoughtNumber: 2, totalThoughts: 4, isRevision: true, thought: 'private-planning-text' };
  model.restore('a', [message(step)], model.revision());
  const [row] = model.view().rows;
  assert.equal(row.data.label, 'Sequential Thinking · Step 2 of 4 (estimate) · revision');
  assert.doesNotMatch(JSON.stringify(row), /private-/);
});

test('fresh page restores the successful plan, tool outcomes and explicitly shared summaries only', () => {
  const plan = tool('1', 'completed'); plan.tool = 'todowrite';
  plan.state.input.todos = [{ content: 'Check results', status: 'completed', note: 'private-note' }, { content: 'Deploy', status: 'cancelled' }];
  const failed = { ...plan, id: '2', state: { ...plan.state, status: 'error' } };
  const reasoning = { id: '3', type: 'reasoning', summary: 'Checked the results.', text: 'private-text' };
  const model = opened();
  model.restore('a', [message(plan, failed, reasoning, { ...reasoning, id: '4', redacted: true }, { ...reasoning, id: '5', summary: undefined }, tool('6','error'))], model.revision());
  const { rows } = model.view();
  assert.equal(rows.length, 4); assert.ok(rows.every(row => !row.live));
  assert.deepEqual(rows.filter(row => row.data.plan).map(row => row.data.plan), [[{ content: 'Check results', status: 'completed' }, { content: 'Deploy', status: 'cancelled' }]]);
  assert.equal(rows[0].data.status, 'error'); assert.equal(rows[1].data.summary, reasoning.summary);
  assert.doesNotMatch(JSON.stringify(rows), /private-/);
});

test('newer live events win during a read; reconnect reconciles missed completions without duplication', () => {
  const model = opened(), start = model.revision();
  model.update(tool('p','running')); model.restore('a',[message(tool('p','pending'))],start);
  assert.equal(model.view().rows[0].data.status,'running'); assert.equal(model.view().rows[0].live,true);
  model.disconnect(); assert.equal(model.view().rows[0].live,false);
  model.restore('a',[message(tool('p','completed'))],model.revision());
  assert.equal(model.view().rows.length,1); assert.equal(model.view().rows[0].data.status,'completed'); assert.equal(model.view().rows[0].live,false);
});

test('switching drops previous chat content, foreign parts and non-assistant messages', () => {
  const model = opened(); model.update(tool('p','running')); model.select('b');
  model.restore('a',[message(tool('p','completed'))],model.revision()); model.update(tool('other','pending'));
  assert.deepEqual(model.view(), { rows: [], loaded: false }); model.select('a');
  model.restore('a',[message({ ...tool('x','error'), sessionID: 'b' }), { ...message(tool('y','running')), info: {id:'m',sessionID:'a',role:'user'} }],model.revision());
  assert.deepEqual(model.view(), { rows: [], loaded: true });
});

test('a provider item ID is not consent to display raw text; redaction wins over an older read', () => {
  const model = opened();
  const part = { type: 'reasoning', id: 'r', sessionID: 'a', messageID: 'm', text: 'private text', metadata: { openai: { itemId: 'rs_fixture' } } };
  model.restore('a', [message(part)], model.revision());
  assert.equal(model.view().rows.length, 0);
  const shared = { ...part, summary: 'User-visible summary' };
  model.update(shared); assert.equal(model.view().rows.length, 1);
  const since = model.revision(); model.update({ ...shared, redacted: true });
  model.restore('a', [message(shared)], since);
  assert.deepEqual(model.view().rows, []);
});
