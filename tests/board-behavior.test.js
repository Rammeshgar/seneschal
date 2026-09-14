const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(require('node:path').join(__dirname, '../app/app.js'), 'utf8');
function harness(names, extras = {}) {
  const context = vm.createContext({ crypto: require('node:crypto'), Date, state: {}, ...extras });
  for (const name of names) {
    const match = new RegExp('^  (?:async )?function ' + name + '\\(', 'm').exec(source);
    assert.ok(match, name);
    const tail = source.slice(match.index + 1);
    const next = /\n  (?:async )?function /.exec(tail);
    vm.runInContext(tail.slice(0, next ? next.index : undefined), context);
  }
  return context;
}
test('project assignment survives raw engine refresh without changing tool folder', () => {
  const c = harness(['normalizeSession'], { state: { sessionProjects: { ses_test: '/other' } } });
  const result = c.normalizeSession({ id: 'ses_test', directory: '/original', metadata: {} });
  assert.equal(result.projectDirectory, '/other');
  assert.equal(result.directory, '/original');
});
test('architecture retains exact selected plan and gives supervisor all worker handoffs', async () => {
  const c = harness(['boardFromArchitecture', 'boardAgentResult'], {
    state: { models: [{ value: 'test', name: 'Test' }], currentDirectory: '/project' },
    selectedModel: () => ({ value: 'test' }), normalizeAgentBoard: value => value, boardRoleLabel: value => value
  });
  const plan = 'Original plan\n' + 'x'.repeat(40000);
  const board = c.boardFromArchitecture({ agents: [{ key: 'a', name: 'Build' }, { key: 'a', name: 'Check' }] }, plan, 'msg1', 'ses1', '', '/project');
  assert.equal(board.planText, plan);
  assert.equal(await c.boardAgentResult(board.agents[0]), plan);
  assert.equal(new Set(board.agents.map(a => a.id)).size, board.agents.length);
  const supervisor = board.agents.find(a => a.role === 'supervisor');
  assert.equal(supervisor.dependencies.length, board.agents.length - 1);
  for (const worker of board.agents.slice(1)) assert.ok(worker.dependencies.includes(board.agents[0].id));
});
test('old replies and partial text cannot complete a new board run', async () => {
  let reply;
  const agent = { id: 'a', sessionID: 's', status: 'running', startedAt: Date.now() - 5000 };
  const c = harness(['reconcileAgentBoardStatuses'], {
    state: { agentBoard: { agents: [agent] }, sessions: [{ id: 's' }] }, api: async () => [reply],
    scheduleAgentBoardSave() {}, renderAgentBoard() {}, scheduleReadyBoardAgents() {},
    boardAgentResult: async () => '', processBoardRequests: async () => {}, releaseWaitingBoardAgents() {}
  });
  reply = { info: { role: 'assistant', time: { created: agent.startedAt - 10, completed: Date.now() } } };
  await c.reconcileAgentBoardStatuses({ s: { type: 'idle' } });
  assert.equal(agent.status, 'running');
  reply = { info: { role: 'assistant', time: { created: agent.startedAt + 10 } }, parts: [{ type: 'text', text: 'working' }] };
  await c.reconcileAgentBoardStatuses({});
  assert.equal(agent.status, 'running');
  reply.info.time.completed = Date.now();
  await c.reconcileAgentBoardStatuses({});
  assert.equal(agent.status, 'complete');
});
test('overlapping scheduling calls respect parallel capacity', async () => {
  const agents = [1, 2, 3].map(id => ({ id, status: 'ready', dependencies: [] }));
  const c = harness(['scheduleReadyBoardAgents'], {
    state: { agentBoard: { active: true, concurrency: 2, agents } }, boardAgent: id => agents.find(a => a.id === id),
    runBoardAgent: async id => { agents.find(a => a.id === id).status = 'running'; await new Promise(resolve => setTimeout(resolve, 5)); },
    scheduleAgentBoardSave() {}, renderAgentBoard() {}, stopAgentBoardMonitor() {}
  });
  await Promise.all([c.scheduleReadyBoardAgents(), c.scheduleReadyBoardAgents()]);
  assert.equal(agents.filter(a => a.status === 'running').length, 2);
});
test('project assignment endpoint writes and reloads durable data', () => {
  const path = require('node:path');
  const dataDirectory = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'seneschal-test-'));
  const server = fs.readFileSync(path.join(__dirname, '../server.js'), 'utf8');
  const begin = server.indexOf('function handleWorkspaceEndpoint(');
  const tail = server.slice(begin);
  const end = /\nfunction /.exec(tail);
  let output;
  const c = vm.createContext({ fs, path, URL, dataDirectory, host: '127.0.0.1', publicPort: 4196,
    readJsonBody: (request, callback) => callback(null, request.body),
    json: (response, status, value) => { output = { status, value }; return true; },
    endpointError: (response, error) => { throw error; }
  });
  vm.runInContext(tail.slice(0, end.index), c);
  try {
    c.handleWorkspaceEndpoint({ url: '/workspace/session-projects', headers: {}, method: 'POST', body: { sessionID: 'ses_test', directory: '/target' } }, {}, '/workspace/session-projects');
    assert.equal(output.status, 200);
    c.handleWorkspaceEndpoint({ url: '/workspace/session-projects', headers: {}, method: 'GET' }, {}, '/workspace/session-projects');
    assert.equal(output.value.ses_test, '/target');
    assert.equal(JSON.parse(fs.readFileSync(path.join(dataDirectory, 'session-projects.json'))).ses_test, '/target');
    for (const directory of ['Mie_Twee', 'My Project', 'C:\\Projects\\Mie_Twee', '/home/sadeq/projects']) {
      c.handleWorkspaceEndpoint({ url: '/workspace/session-projects', headers: {}, method: 'POST', body: { sessionID: 'ses_test', directory } }, {}, '/workspace/session-projects');
      c.handleWorkspaceEndpoint({ url: '/workspace/session-projects', headers: {}, method: 'GET' }, {}, '/workspace/session-projects');
      assert.equal(output.value.ses_test, directory);
    }
    for (const directory of ['', '  ', 'bad\nname', 'bad\0name']) {
      assert.throws(() => c.handleWorkspaceEndpoint({ url: '/workspace/session-projects', headers: {}, method: 'POST', body: { sessionID: 'ses_test', directory } }, {}, '/workspace/session-projects'), /Invalid destination project/);
    }
  } finally { fs.rmSync(dataDirectory, { recursive: true }); }
});
