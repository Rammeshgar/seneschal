'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { configSummary, providerSummary } = require('../scripts/inspect-model-catalog.cjs');
test('config diagnostic projects IDs and flags, never credentials or unrelated settings', () => {
  const source = { provider: { openai: { options: { apiKey: 'dummy-secret', baseURL: 'https://dummy-secret.invalid' },
    models: { 'gpt-6.1-sol': { name: 'dummy-secret', options: { apiKey: 'dummy-secret' } } },
    whitelist: ['gpt-5.6-luna'], blacklist: [] } }, permission: { secret: 'dummy-secret' } };
  const result = configSummary(source);
  assert.deepEqual(result.registeredOpenAIModels, ['gpt-6.1-sol']);
  assert.deepEqual(result.whitelist, ['gpt-5.6-luna']);
  assert.equal(result.hasCustomBaseURL, true);
  assert.equal(JSON.stringify(result).includes('dummy-secret'), false);
  assert.equal(configSummary({ providers: { openai: source.provider.openai } }).registeredOpenAIModels[0], 'gpt-6.1-sol');
});
test('provider diagnostic shows where registered models are filtered without leaking fields', () => {
  const result = providerSummary({ connected: ['openai'], all: [{ id: 'openai', options: { apiKey: 'dummy-secret' }, models: {
    luna: { id: 'gpt-6-luna', name: 'dummy-secret', capabilities: { toolcall: false, input: { text: true } } },
    sol: { id: 'gpt-6.1-sol', capabilities: { toolcall: 'dummy-secret', input: { text: 'dummy-secret' } }, api: { id: 'gpt-6.1-sol' } }
  } }] });
  assert.equal(result.openAIConnected, true);
  assert.equal(result.targetModels.find(model => model.id === 'gpt-6-luna').toolcall, false);
  assert.equal(result.targetModels.find(model => model.id === 'gpt-6.1-sol').toolcall, null);
  assert.equal(result.targetModels.find(model => model.id === 'gpt-6.1-sol').textInput, null);
  assert.equal(result.targetModels.find(model => model.id === 'gpt-6.1-sol').apiIdMatches, true);
  assert.equal(result.targetModels.find(model => model.id === 'gpt-6-astra').reported, false);
  assert.equal(JSON.stringify(result).includes('dummy-secret'), false);
});
