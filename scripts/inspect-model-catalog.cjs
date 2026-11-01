'use strict';
// Read-only loopback diagnostics. No prompts, config writes, auth changes or restarts.
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const TARGETS = ['gpt-6-astra', 'gpt-6.1-sol', 'gpt-6-sol', 'gpt-6-luna',
  'gpt-5.6-sol', 'gpt-5.6-terra', 'gpt-5.6-luna'];
const boolean = value => typeof value === 'boolean' ? value : null;
function ids(value) {
  const list = Array.isArray(value) ? value : Object.keys(value || {});
  return list.filter(id => typeof id === 'string' && /^gpt-[a-z0-9.-]{1,60}$/.test(id)).slice(0, 100);
}
function configSummary(config) {
  const provider = config?.provider?.openai || config?.providers?.openai || {};
  return {
    registeredOpenAIModels: ids(provider.models),
    whitelist: ids(provider.whitelist), blacklist: ids(provider.blacklist),
    hasCustomBaseURL: Boolean(provider.options?.baseURL || provider.settings?.baseURL),
    openAIDisabled: (config?.disabled_providers || []).includes('openai'),
    enabledProviderRestriction: Boolean(config?.enabled_providers?.length)
  };
}
function providerSummary(data) {
  const provider = (data?.all || []).find(item => item.id === 'openai');
  const models = Object.values(provider?.models || {});
  return {
    openAIConnected: (data?.connected || []).includes('openai'),
    reportedOpenAIModels: ids(models.map(model => model.id)),
    targetModels: TARGETS.map(id => {
      const model = models.find(item => item.id === id);
      if (!model) return { id, reported: false };
      return { id, reported: true,
        thinkingLevels: Object.keys(model.variants || {}).filter(name => /^[a-z][a-z0-9_-]{0,39}$/.test(name)).slice(0, 32),
        toolcall: boolean(model.capabilities?.toolcall ?? model.capabilities?.tools ?? model.tool_call),
        textInput: boolean(model.capabilities?.input?.text ?? model.modalities?.input?.includes('text')),
        apiIdMatches: model.api?.id ? model.api.id === id : null };
    })
  };
}
function get(endpoint, authorization, directory) {
  return new Promise(resolve => {
    const url = new URL(endpoint, 'http://127.0.0.1:4097');
    if (directory && !endpoint.startsWith('/global/')) url.searchParams.set('directory', directory);
    const request = http.get(url, { headers: { authorization }, timeout: 5000 }, response => {
      const parts = []; let size = 0;
      response.on('data', chunk => {
        size += chunk.length;
        if (size > 16 * 1024 * 1024) { response.destroy(); resolve({ error: 'response-too-large' }); }
        else parts.push(chunk);
      });
      response.on('error', () => resolve({ error: 'response-incomplete' }));
      response.on('end', () => {
        if (response.statusCode !== 200) return resolve({ status: response.statusCode });
        try { resolve({ status: 200, data: JSON.parse(Buffer.concat(parts).toString('utf8')) }); }
        catch { resolve({ status: 200, error: 'invalid-json' }); }
      });
    });
    request.on('timeout', () => { request.destroy(); resolve({ error: 'timeout' }); });
    request.on('error', error => resolve({ error: ['ECONNREFUSED', 'EACCES', 'EPERM'].includes(error.code) ? error.code : 'connection-failed' }));
  });
}
async function main(root = path.resolve(__dirname, '..')) {
  const credentialPath = path.join(root, 'data', 'server-password.txt');
  const item = fs.lstatSync(credentialPath);
  if (!item.isFile() || item.isSymbolicLink() || item.size > 1024) throw Error('invalid-local-credential');
  const password = fs.readFileSync(credentialPath, 'utf8').trim();
  if (password.length < 20) throw Error('invalid-local-credential');
  const authorization = 'Basic ' + Buffer.from('opencode:' + password).toString('base64');
  let directory;
  try {
    const settings = JSON.parse(fs.readFileSync(path.join(root, 'data', 'settings.json'), 'utf8'));
    directory = settings.launchDirectory;
  } catch {}
  const inspectPermissions = process.argv.includes('--permissions');
  const requests = ['/global/health', '/config', '/provider', '/global/config', ...(inspectPermissions ? ['/agent', '/session?limit=20', '/doc'] : [])];
  const result = {};
  for (const endpoint of requests) {
    const response = await get(endpoint, authorization, directory);
    if (!response.data) { result[endpoint] = response; continue; }
    if (endpoint === '/provider') result[endpoint] = providerSummary(response.data);
    else if (endpoint === '/global/health') result[endpoint] = {
      healthy: response.data.healthy === true,
      version: /^\d+\.\d+\.\d+(?:[-.a-z0-9]+)?$/i.test(response.data.version || '') ? response.data.version : 'unknown'
    };
    else if (endpoint === '/agent') result[endpoint] = response.data.filter(agent => ['build', 'plan'].includes(agent.name)).map(agent => ({
      name: agent.name, permissionRuleCount: Array.isArray(agent.permission) ? agent.permission.length : null,
      bashActions: Array.isArray(agent.permission) ? agent.permission.filter(rule => rule.permission === 'bash' && rule.pattern === '*').map(rule => rule.action).filter(action => ['ask', 'deny', 'allow'].includes(action)) : []
    }));
    else if (endpoint.startsWith('/session?')) result.sessions = {
      inspected: Array.isArray(response.data) ? response.data.length : 0,
      broadBashAllowSessions: Array.isArray(response.data) ? response.data.filter(session => session.permission?.some(rule => rule.permission === 'bash' && rule.pattern === '*' && rule.action === 'allow')).length : 0
    };
    else if (endpoint === '/doc') result.sessionUpdateFields = Object.keys(response.data.paths?.['/session/{sessionID}']?.patch?.requestBody?.content?.['application/json']?.schema?.properties || {}).filter(key => ['title', 'permission', 'time'].includes(key));
    else result[endpoint] = configSummary(response.data);
  }
  process.stdout.write(JSON.stringify(result, null, 2) + '\n');
}
module.exports = { configSummary, providerSummary, main };
if (require.main === module) main().catch(() => {
  process.stderr.write('Cannot inspect the local engine. Keep Seneschal running and use your normal PC terminal. No settings were changed.\n');
  process.exitCode = 1;
});
