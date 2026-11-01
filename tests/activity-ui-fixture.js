'use strict';
// Synthetic records only: never open a user's real history for UI screenshots.
let phase = 'ready';
let lastSyncAt = new Date().toISOString();
const sessions = [
  { id: 'opencode:ses_release', sourceSessionId: 'ses_release', title: 'Prepare the Seneschal release', project: '/home/demo/projects/seneschal', cwd: '/home/demo/projects/seneschal', model: 'Test Model', status: 'idle', turns: 2, toolCalls: 3, estimatedCost: 0.12, tokens: { totalTokens: 18720 }, updatedAt: '2026-10-12T08:10:00Z', lastSyncAt, source: 'opencode' },
  { id: 'opencode:ses_review', sourceSessionId: 'ses_review', title: 'Review the release checklist', project: '/home/demo/projects/seneschal', cwd: '/home/demo/projects/seneschal', model: 'Review Model', status: 'idle', turns: 1, toolCalls: 1, estimatedCost: 0, tokens: { totalTokens: 4800 }, parentSessionId: 'opencode:ses_release', updatedAt: '2026-10-12T08:05:00Z', lastSyncAt, source: 'opencode' },
  { id: 'opencode:ses_workspace', sourceSessionId: 'ses_workspace', title: 'Organize project notes and next steps', project: '/home/demo/projects/workspace', cwd: '/home/demo/projects/workspace', model: null, status: 'active', turns: 1, toolCalls: 0, estimatedCost: null, tokens: { totalTokens: 0 }, updatedAt: '2026-10-11T15:45:00Z', lastSyncAt, source: 'opencode' },
];
function runtime() { return { phase, ready: phase === 'ready', owned: phase !== 'stopped', version: '0.1.7', testedVersion: '0.1.7', lastSyncAt, complete: phase === 'ready', sourceSessions: 3, message: phase === 'ready' ? 'Local history is ready.' : 'Activity is stopped.', index: '/home/demo/.local/share/seneschal-agent-trail/indexes/demo/ingest.db', source: '/home/demo/.local/share/opencode/opencode.db' }; }
module.exports = function activityFixture(url, request, response, json) {
  if (!url.pathname.startsWith('/workspace/activity/')) return false;
  const route = url.pathname.slice('/workspace/activity'.length);
  if (route === '/status') { json(response, runtime()); return true; }
  if (['/start','/restart','/stop','/rebuild','/sync'].includes(route)) { phase = route === '/stop' ? 'stopped' : 'ready'; lastSyncAt = new Date().toISOString(); json(response, runtime()); return true; }
  if (phase === 'stopped') { json(response, { error: 'Start local history before reading records.' }, 409); return true; }
  if (route === '/overview') {
    const days = Array.from({ length: 7 }, (_,i) => { const totalTokens = [0,2200,3500,1900,2400,4800,8720][i]; const inputTokens = Math.round(totalTokens * .6), outputTokens = Math.round(totalTokens * .3); return { date: '2026-10-' + String(6+i).padStart(2,'0'), totalTokens, inputTokens, outputTokens, cacheReadTokens: totalTokens-inputTokens-outputTokens, cacheWriteTokens: 0, reasoningTokens: null, sessionCount: [0,1,1,1,2,2,3][i], cost: totalTokens / 23520 * .12 }; });
    const today = url.searchParams.get('window') === 'today';
    if (today) days.splice(0,6);
    const sum = key => days.reduce((value,day) => value + day[key],0);
    const totals = { sessionCount: today ? 2 : 3, projectCount: today ? 1 : 2, totalTokens: sum('totalTokens'), totalCost: sum('cost'), inputTokens: sum('inputTokens'), outputTokens: sum('outputTokens'), cacheReadTokens: sum('cacheReadTokens'), cacheWriteTokens: sum('cacheWriteTokens'), reasoningTokens: null, pricingStatus: 'partial' };
    json(response, { window: url.searchParams.get('window') || '7d', totals, daily: { days }, models: { models: [{ name: 'Test Model', totalTokens: 18720, sessionCount: 1, cost: 0.12 }, { name: 'Review Model', totalTokens: 4800, sessionCount: 1, cost: 0 }] }, projects: { projects: [{ project: '/home/demo/projects/seneschal', totalTokens: 23520, sessionCount: 2, cost: 0.12 }] }, warnings: [], costBasis: 'Agent Trail local pricing estimates; provider billing and subscription limits are separate.', rankingBasis: 'Rankings use sessions started in this period; each session is attributed to its latest recorded model. Token trend uses recorded daily usage.' }); return true;
  }
  if (route === '/lookup') { const session = sessions.find(item => item.id === url.searchParams.get('key') || item.sourceSessionId === url.searchParams.get('key')); json(response, session || { error: 'Not indexed yet' }, session ? 200 : 404); return true; }
  if (route === '/sessions' || route === '/search') {
    const q = (url.searchParams.get('q') || '').toLowerCase(), status = url.searchParams.get('status'), project = url.searchParams.get('project');
    const filtered = sessions.filter(row => (!q || (row.title + row.project).toLowerCase().includes(q)) && (!status || row.status === status) && (!project || row.project === project));
    const offset = Number(url.searchParams.get('offset') || 0), limit = Number(url.searchParams.get('limit') || 30);
    json(response, route === '/search' ? { results: filtered.map(row => ({ ...row, snippet: 'A recorded conversation match.' })), pagination: { returned: filtered.length, hasMore: false } } : { sessions: filtered.slice(offset,offset+limit), pagination: { total: filtered.length, limit, offset, hasMore: offset + limit < filtered.length } }); return true;
  }
  const match = route.match(/^\/sessions\/([^/]+)(\/turns)?$/);
  if (match) {
    const session = sessions.find(row => row.id === decodeURIComponent(match[1]));
    if (!session) { json(response, { error: 'Session not found' }, 404); return true; }
    if (!match[2]) json(response, session);
    else json(response, { turns: [{ id: 'fixture-turn-1', index: 0, startedAt: '2026-10-12T08:00:00Z', userMessage: { role: 'user', content: 'Please prepare the **release checklist**.' }, assistantMessages: [{ role: 'assistant', model: 'Test Model', content: '## Release review\n\n| Check | Status |\n| --- | --- |\n| Local runtime | Ready |\n| Package checksum | Verified |\n\nThe checklist is ready for review.\n\n```text\nSynthetic fixture — no personal history.\n```' }], activities: [{ type: 'tool_call', id: 'tool-1', name: 'read', displayName: 'Read release notes', inputJson: '{"filePath":"README.md"}', status: 'success', durationMs: 245, resultEvents: [{ content: 'Release notes read. <script>unsafeMarkup()</script>', isPartial: false }] }, { type: 'subagent_link', subagentSessionId: 'opencode:ses_review', subagentSource: 'opencode' }] }], pagination: { total: 1, limit: 20, offset: 0, hasMore: false } });
    return true;
  }
  json(response, { error: 'Activity route not found' }, 404); return true;
};
