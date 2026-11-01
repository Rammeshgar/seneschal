'use strict';
const test = require('node:test'), assert = require('node:assert/strict'), http = require('node:http'), fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const { API, CONSENT, validWave, transcript, createNvidiaSpeech } = require('../scripts/nvidia-speech.cjs');
const { allowedRoute } = require('../scripts/private-access-policy.cjs');
const clientCode = fs.readFileSync(path.join(__dirname, '../app/nvidia-speech.js'), 'utf8');
function browser(globals = {}) {
  const controls = Object.fromEntries(['voiceServiceSelect', 'nvidiaVoiceConsent', 'nvidiaVoiceNotice', 'nvidiaVoiceStatus', 'checkNvidiaVoice'].map(id => [id, { value: 'browser', checked: false, hidden: false, disabled: false, listeners: {}, addEventListener(type, handler) { this.listeners[type] = handler; } }]));
  const window = {}, c = vm.createContext({ window, document: { getElementById: id => controls[id] }, localStorage: { getItem: () => null, setItem() {} }, AbortController, setTimeout, clearTimeout, navigator: {}, fetch: () => assert.fail('Unexpected external call'), ...globals });
  vm.runInContext(clientCode, c); return { voice: window.SeneschalNvidiaVoice, controls, c, window };
}
function wav() { return Buffer.from(browser().voice.wave(new Float32Array(1600), 16000)); }
async function fixture(t, options = {}) {
  const calls = [], speech = createNvidiaSpeech({ readKey: () => 'nvapi-' + 'synthetic-fixture-not-a-secret', fetcher: async (...args) => { calls.push(args); return new Response(JSON.stringify({ text: 'Synthetic voice test' }), { status: 200 }); }, ...options });
  const server = http.createServer((req, res) => { if (!speech.handle(req, res, req.url, (res, status, body) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); })) { res.writeHead(404); res.end(); } });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => { server.closeAllConnections(); return new Promise(resolve => server.close(resolve)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const send = (action, body = {}, headers = {}) => fetch(`${base}/workspace/nvidia-speech/${action}`, { method: 'POST', headers: { 'Content-Type': action === 'transcribe' ? 'audio/wav' : 'application/json', 'X-Seneschal-Voice-Consent': CONSENT, ...headers }, body: action === 'transcribe' ? body : JSON.stringify(body) });
  return { calls, base, send };
}
test('voice is opt-in, cloud consent is required, and corrupt preferences cannot start a microphone', () => {
  const { voice, controls } = browser({ localStorage: { getItem: () => 'null', setItem() {} } }); voice.init();
  assert.equal(voice.selected(), false); assert.equal(controls.nvidiaVoiceNotice.hidden, true); assert.equal(controls.checkNvidiaVoice.disabled, true);
  controls.voiceServiceSelect.value = 'nvidia'; controls.voiceServiceSelect.listeners.change(); assert.equal(voice.ready(), false);
  controls.nvidiaVoiceConsent.checked = true; controls.nvidiaVoiceConsent.listeners.change(); assert.equal(voice.ready(), true);
});
test('browser conversion generates bounded mono 16-bit 16 kHz WAV and rejects malformed audio', () => {
  const { voice } = browser(); const bytes = Buffer.from(voice.wave(new Float32Array(48000), 48000));
  assert.equal(bytes.length, 32044); assert.equal(validWave(bytes), true);
  bytes.writeUInt16LE(2, 22); assert.equal(validWave(bytes), false); assert.equal(validWave(Buffer.from('not audio')), false);
});
test('status never calls NVIDIA, returns no key or entitlement promise', async t => {
  const f = await fixture(t); const result = await (await fetch(f.base + '/workspace/nvidia-speech/status')).json();
  assert.deepEqual(result, { configured: true, language: 'en-US', mode: 'hosted-developer-trial', freeQuotaVerified: false }); assert.equal(f.calls.length, 0);
});
test('missing consent, cross-origin requests and wrong formats never call a provider', async t => {
  const f = await fixture(t);
  assert.equal((await f.send('speak', { text: 'test' }, { 'X-Seneschal-Voice-Consent': '' })).status, 403);
  assert.equal((await f.send('speak', { text: 'test' }, { Origin: 'https://foreign.example' })).status, 403);
  assert.equal((await f.send('transcribe', Buffer.from('not audio'))).status, 400);
  assert.equal((await f.send('speak', { text: 'test', baseURL: 'http://foreign.example' })).status, 400);
  assert.equal((await f.send('speak', { text: 'x'.repeat(1001) })).status, 400); assert.equal(f.calls.length, 0);
});
test('speech endpoints stay fixed and credentials never reach the client', async t => {
  const f = await fixture(t); const response = await f.send('transcribe', wav()); const value = await response.json();
  assert.equal(response.status, 200); assert.equal(value.text, 'Synthetic voice test'); assert.equal(f.calls[0][0], API.transcribe);
  assert.equal(f.calls[0][1].redirect, 'error'); assert.ok(f.calls[0][1].headers.Authorization.startsWith('Bearer ')); assert.equal(JSON.stringify(value).includes('nvapi'), false);
  assert.equal(f.calls[0][1].body.get('language'), 'en-US'); assert.equal(f.calls.length, 1);
});
test('speech synthesis uses the named stock voice, not voice cloning or arbitrary model URLs', async t => {
  const audio = wav(); const f = await fixture(t, { fetcher: async (url, options) => { assert.equal(url, API.speak); assert.equal(options.body.get('voice'), 'Magpie-Multilingual.EN-US.Aria'); assert.equal(options.body.has('audio_prompt'), false); return new Response(audio); } });
  const res = await f.send('speak', { text: 'Synthetic text' }); assert.equal(res.status, 200); assert.equal(res.headers.get('content-type'), 'audio/wav'); assert.equal((await res.arrayBuffer()).byteLength, audio.length);
});
test('denied access, provider rate limits and errors never retry, echo errors, or use paid fallbacks', async t => {
  for (const code of [401, 403, 429, 500]) {
    let calls = 0; const f = await fixture(t, { fetcher: async () => { calls++; return new Response('sensitive upstream diagnostics', { status: code }); } });
    const res = await f.send('speak', { text: 'Synthetic test' }); const text = await res.text(); assert.ok(res.status >= 400); assert.equal(calls, 1); assert.doesNotMatch(text, /sensitive upstream|nvapi/);
  }
});
test('concurrent requests are single-flight and timeouts do not retry', async t => {
  let started, release; const pending = new Promise(resolve => { started = resolve; });
  const f = await fixture(t, { fetcher: async () => { started(); await new Promise(resolve => { release = resolve; }); return new Response(JSON.stringify({ text: 'test' })); } });
  const first = f.send('transcribe', wav()); await pending;
  assert.equal((await f.send('transcribe', wav())).status, 409); release(); assert.equal((await first).status, 200);
  let calls = 0; const timed = await fixture(t, { timeoutMs: 30, fetcher: (_url, { signal }) => new Promise((_resolve, reject) => { calls++; signal.addEventListener('abort', () => reject(Error('aborted'))); }) });
  assert.equal((await timed.send('transcribe', wav())).status, 504); assert.equal(calls, 1);
});
test('local safety limit bounds automated voice calls without pretending to know free quota', async t => {
  const f = await fixture(t, { now: () => 1000 });
  for (let i = 0; i < 20; i++) assert.equal((await f.send('transcribe', wav())).status, 200);
  assert.equal((await f.send('transcribe', wav())).status, 429); assert.equal(f.calls.length, 20);
});
test('transcript parsing supports NVIDIA response shape without treating errors as speech', () => {
  assert.equal(transcript({ transcripts: [{ transcript: 'Hello' }, { alternatives: [{ transcript: 'world' }] }] }), 'Hello world');
  assert.throws(() => transcript({ error: 'sensitive diagnostics' }), /unexpected transcript/);
});
test('only exact speech routes pass phone policy; provider configuration remains PC-only', () => {
  assert.equal(allowedRoute('GET', '/workspace/nvidia-speech.js'), true);
  assert.equal(allowedRoute('POST', '/workspace/nvidia-speech/transcribe'), true);
  assert.equal(allowedRoute('POST', '/workspace/nvidia-speech/speak'), true);
  for (const route of ['/workspace/nvidia-speech/config', '/workspace/nvidia-speech/token', '/workspace/nvidia-speech/speak/extra', '/api/auth/nvidia']) assert.equal(allowedRoute('POST', route), false);
});
test('existing approvals and model selection remain the only execution path', () => {
  const app = fs.readFileSync(path.join(__dirname, '../app/app.js'), 'utf8');
  assert.match(app, /await sendPrompt\(text, \{ voice: true \}\)/); assert.match(app, /window\.SeneschalNvidiaVoice\?\.stop\(\)/);
  assert.doesNotMatch(clientCode, /apiKey|Authorization|nvapi-/); assert.doesNotMatch(clientCode, /\/api\/session|prompt_async|permission.*reply/);
});
test('Stop during a microphone permission prompt releases a late stream and sends nothing', async () => {
  let grant, stopped = 0, results = 0;
  const b = browser({ navigator: { mediaDevices: { getUserMedia: () => new Promise(resolve => { grant = resolve; }) } } });
  b.controls.voiceServiceSelect.value = 'nvidia'; b.controls.nvidiaVoiceConsent.checked = true;
  b.window.AudioContext = class { constructor() { this.state = 'running'; } close() { this.state = 'closed'; return Promise.resolve(); } };
  b.voice.listen({ onState() {}, onResult() { results++; }, onError() { results++; } }); await new Promise(resolve => setImmediate(resolve));
  b.voice.stop(); grant({ getTracks: () => [{ stop() { stopped++; } }] }); await new Promise(resolve => setImmediate(resolve));
  assert.equal(stopped, 1); assert.equal(results, 0);
});
test('synthetic microphone capture stops its tracks and transcribes exactly once after silence', async () => {
  let processor, stopped = 0, requests = 0, result;
  const received = new Promise(resolve => { result = resolve; });
  const node = () => ({ connect() {}, disconnect() {} });
  const b = browser({ navigator: { mediaDevices: { getUserMedia: async () => ({ getTracks: () => [{ stop() { stopped++; } }] }) } }, fetch: async (url, options) => {
    requests++; assert.equal(url, '/workspace/nvidia-speech/transcribe'); assert.equal(options.headers['X-Seneschal-Voice-Consent'], CONSENT); assert.equal(validWave(Buffer.from(options.body)), true);
    return { ok: true, json: async () => ({ text: 'Synthetic capture' }) };
  } });
  b.controls.voiceServiceSelect.value = 'nvidia'; b.controls.nvidiaVoiceConsent.checked = true;
  b.window.AudioContext = class { constructor() { this.state = 'running'; this.sampleRate = 16000; } createMediaStreamSource() { return node(); } createScriptProcessor() { processor = node(); return processor; } createGain() { return { ...node(), gain: {} }; } close() { this.state = 'closed'; return Promise.resolve(); } };
  b.voice.listen({ onState() {}, onResult: result, onError: error => assert.fail(error.message) }); await new Promise(resolve => setImmediate(resolve));
  for (const volume of [0.2, 0.2, 0, 0, 0, 0, 0]) processor.onaudioprocess?.({ inputBuffer: { getChannelData: () => new Float32Array(4096).fill(volume) } });
  assert.equal(await received, 'Synthetic capture'); assert.equal(stopped, 1); assert.equal(requests, 1); b.voice.stop();
});

function talkFixture(nvidia = false) {
  const instances = [], timers = new Map(), notices = [], stages = [], sent = [], played = [], feedback = { textContent: '' };
  let nextTimer = 0, cloudCallbacks, playbackCallbacks;
  class Recognition {
    constructor() { instances.push(this); }
    start() { this.onstart?.(); }
    abort() { this.onerror?.({ error: 'aborted' }); void this.onend?.(); }
  }
  const state = { conversationMode: true, conversationRecognition: null, voiceSpeaking: false, voiceAwaitingResponse: false, voiceTurn: null, messages: [], statuses: {}, currentSessionID: 'ses_synthetic', attachments: [], currentDirectory: 'synthetic-project', models: [{}] };
  const context = vm.createContext({ state, els: { prompt: { value: '' } }, storage: { set() {} }, navigator: { language: 'en-US' }, document: { querySelectorAll: () => [], getElementById: () => null },
    AbortController, cleanSpeechText: value => String(value), api: () => assert.fail('Unexpected engine request'),
    window: { crypto: require('node:crypto').webcrypto, SpeechRecognition: Recognition, speechSynthesis: { cancel() {} }, SeneschalNvidiaVoice: {
      selected: () => nvidia, ready: () => true, stop() {}, listen(callbacks) { cloudCallbacks = callbacks; return { abort() {} }; },
      speak(text, callbacks) { played.push(text); playbackCallbacks = callbacks; return Promise.resolve(); }
    } }, selectedSession: () => null, autoSizePrompt() {}, setTalkState: stage => stages.push(stage || 'stopped'),
    $: () => feedback, toast: message => notices.push(message), sendPrompt: async text => sent.push(text),
    setTimeout: fn => { const id = ++nextTimer; timers.set(id, fn); return id; }, clearTimeout: id => timers.delete(id)
  });
  const app = fs.readFileSync(path.join(__dirname, '../app/app.js'), 'utf8');
  vm.runInContext(app.slice(app.indexOf('  function scheduleConversationListening('), app.indexOf('  function stopMediaRecording(')), context);
  return { state, instances, timers, notices, stages, sent, played, feedback, context, cloud: () => cloudCallbacks, playback: () => playbackCallbacks };
}

test('mic mute aborts browser capture, preserves draft and blocks late transcripts without stopping the task', async () => {
  const f = talkFixture(); f.context.startConversationListening(); const recognition = f.instances[0];
  recognition.onresult({ results: [[{ transcript: 'Unsent partial draft' }]] });
  f.context.setVoiceMicMuted(true);
  recognition.onresult({ results: [[{ transcript: 'Must not replace draft' }]] }); await recognition.onend();
  assert.equal(f.context.els.prompt.value, 'Unsent partial draft'); assert.equal(f.sent.length, 0);
  assert.equal(f.state.conversationMode, true); assert.equal(f.state.conversationRecognition, null); assert.equal(f.timers.size, 0);
  f.context.setVoiceMicMuted(false); const resume = [...f.timers.values()][0]; f.timers.clear(); resume();
  assert.equal(f.instances.length, 1); assert.match(f.feedback.textContent, /draft is kept/);
});

test('mic mute blocks stale NVIDIA results even after unmuting, and keeps an awaited reply intact', async () => {
  const f = talkFixture(true); f.context.startConversationListening(); const previous = f.cloud();
  f.context.setVoiceMicMuted(true); f.context.setVoiceMicMuted(false); f.context.startConversationListening();
  const current = f.state.conversationRecognition;
  await previous.onResult('Stale muted audio'); previous.onError(Error('Old capture error'));
  assert.equal(f.sent.length, 0); assert.equal(f.state.conversationRecognition, current); assert.equal(f.state.conversationMode, true);
  const turn = beginVoiceTurn(f); f.context.setVoiceMicMuted(true);
  assert.equal(f.state.voiceTurn, turn); assert.equal(f.state.voiceAwaitingResponse, true);
});

test('speaker mute cancels only playback and new muted replies never call speech synthesis', () => {
  const f = talkFixture(true); let cancelled = 0;
  f.context.window.SeneschalNvidiaVoice.cancelSpeech = () => cancelled++;
  const turn = beginVoiceTurn(f); f.context.speakLatestAssistant(turn, [voiceAnswer('msg_answer', turn.messageID, 'Current answer')]);
  const callbacks = f.playback(); f.context.setVoiceSpeakerMuted(true); callbacks.onEnd(); callbacks.onError(Error('Cancelled'));
  assert.equal(cancelled, 1); assert.equal(f.state.conversationMode, true); assert.equal(f.state.voiceSpeaking, false);
  const mutedTurn = beginVoiceTurn(f); f.context.speakLatestAssistant(mutedTurn, [voiceAnswer('msg_muted', mutedTurn.messageID, 'Text only')]);
  assert.deepEqual(f.played, ['Current answer']); assert.equal(f.state.voiceAwaitingResponse, false);
  f.context.setVoiceSpeakerMuted(false); assert.deepEqual(f.played, ['Current answer'], 'unmuting never replays old speech');
});

test('NVIDIA cancellation while speech is being prepared never starts late audio or reports a false error', async () => {
  let release, calls = 0, callbacks = 0;
  const b = browser({ fetch: async () => { calls++; return new Promise(resolve => { release = resolve; }); } });
  b.controls.voiceServiceSelect.value = 'nvidia'; b.controls.nvidiaVoiceConsent.checked = true;
  const pending = b.voice.speak('Synthetic test', { onState() {}, onEnd() { callbacks++; }, onError() { callbacks++; } });
  b.voice.cancelSpeech(); release({ ok: true, arrayBuffer: async () => new ArrayBuffer(0) }); await pending;
  assert.equal(calls, 1); assert.equal(callbacks, 0);
});

test('NVIDIA speaker mute stops a playing source, disconnects the analyser and suppresses late playback callbacks', async () => {
  let source, stopped = 0, disconnected = 0, ended = 0, failed = 0;
  const b = browser({ fetch: async () => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(0) }) });
  b.controls.voiceServiceSelect.value = 'nvidia'; b.controls.nvidiaVoiceConsent.checked = true;
  b.window.SeneschalAres = { setAnalyser() {} };
  b.window.AudioContext = class {
    constructor() { this.state = 'running'; this.destination = {}; }
    async decodeAudioData() { return {}; }
    createBufferSource() { source = { connect() {}, disconnect() {}, start() {}, stop() { stopped++; } }; return source; }
    createAnalyser() { return { connect() {}, disconnect() { disconnected++; } }; }
  };
  await b.voice.speak('Synthetic playback', { onState() {}, onEnd() { ended++; }, onError() { failed++; } });
  const late = source.onended; b.voice.cancelSpeech(); late();
  assert.equal(stopped, 1); assert.ok(disconnected >= 1); assert.equal(ended, 0); assert.equal(failed, 0);
});

test('browser speaker mute cancels playback but keeps Talk and the task independent', () => {
  const f = talkFixture(); let cancelled = 0;
  f.context.window.speechSynthesis.cancel = () => cancelled++;
  beginVoiceTurn(f); f.state.voiceSpeaking = true; f.context.setVoiceSpeakerMuted(true);
  assert.equal(cancelled, 1); assert.equal(f.state.conversationMode, true); assert.equal(f.state.voiceSpeaking, false);
  const turn = beginVoiceTurn(f); f.context.speakLatestAssistant(turn, [voiceAnswer('msg_browser_muted', turn.messageID, 'Text stays in chat')]);
  assert.equal(f.state.voiceAwaitingResponse, false); assert.equal(f.sent.length, 0);
});

test('muting before microphone permission resolves immediately releases the late stream without recording', async () => {
  const f = talkFixture(); let grant, stopped = 0, recorders = 0;
  f.context.navigator.mediaDevices = { getUserMedia: () => new Promise(resolve => { grant = resolve; }) };
  f.context.window.MediaRecorder = f.context.MediaRecorder = class { constructor() { recorders++; } };
  const source = fs.readFileSync(path.join(__dirname, '../app/app.js'), 'utf8');
  f.context.setListening = () => {};
  vm.runInContext(source.slice(source.indexOf('  function stopMediaRecording()'), source.indexOf('  async function toggleVoiceDictation()')), f.context);
  const pending = f.context.startMediaRecording(); f.context.setVoiceMicMuted(true);
  grant({ getTracks: () => [{ stop() { stopped++; } }] }); await pending;
  assert.equal(stopped, 1); assert.equal(recorders, 0); assert.equal(f.state.mediaRecorder, null);
});

test('muting an attachment recording discards late chunks and never attaches or sends audio', async () => {
  const f = talkFixture(); let recorder, stopped = 0, attached = 0;
  f.context.navigator.mediaDevices = { getUserMedia: async () => ({ getTracks: () => [{ stop() { stopped++; } }] }) };
  f.context.window.MediaRecorder = f.context.MediaRecorder = class {
    static isTypeSupported() { return true; }
    constructor() { recorder = this; this.state = 'inactive'; }
    start() { this.state = 'recording'; }
    stop() { this.state = 'inactive'; this.ondataavailable?.({ data: { size: 5 } }); void this.onstop?.(); }
  };
  f.context.setListening = () => {}; f.context.addFiles = () => attached++;
  const source = fs.readFileSync(path.join(__dirname, '../app/app.js'), 'utf8');
  vm.runInContext(source.slice(source.indexOf('  function stopMediaRecording()'), source.indexOf('  async function toggleVoiceDictation()')), f.context);
  await f.context.startMediaRecording(); f.context.setVoiceMicMuted(true);
  recorder.ondataavailable({ data: { size: 5 } });
  assert.ok(stopped >= 1); assert.equal(f.state.mediaChunks.length, 0); assert.equal(attached, 0); assert.equal(f.sent.length, 0);
});

test('browser network failure stops Talk once, keeps partial draft, and never restarts or submits', async () => {
  const f = talkFixture(); vm.runInContext('startConversationListening()', f.context);
  const recognition = f.instances[0];
  recognition.onresult({ results: [[{ transcript: 'unfinished draft' }]] });
  recognition.onerror({ error: 'network' });
  recognition.onerror({ error: 'network' }); recognition.onstart(); await recognition.onend();
  assert.equal(f.state.conversationMode, false); assert.equal(f.state.conversationRecognition, null);
  assert.equal(f.timers.size, 0); assert.equal(f.notices.length, 1); assert.equal(f.sent.length, 0);
  assert.match(f.feedback.textContent, /Browser speech.*Talk stopped/);
  assert.equal(f.context.els.prompt.value, 'unfinished draft'); assert.equal(f.stages.at(-1), 'stopped');
});

test('silence may restart browser listening; terminal errors and stale callbacks cannot', async () => {
  const f = talkFixture(); vm.runInContext('startConversationListening()', f.context);
  const first = f.instances[0]; first.onerror({ error: 'no-speech' }); await first.onend();
  assert.equal(f.notices.length, 0); assert.equal(f.timers.size, 1);
  const resume = [...f.timers.values()][0]; f.timers.clear(); resume();
  const second = f.instances[1]; first.onerror({ error: 'network' }); await first.onend();
  assert.equal(f.state.conversationRecognition, second); assert.equal(f.state.conversationMode, true);
  second.onerror({ error: 'service-not-allowed' }); await second.onend();
  assert.equal(f.state.conversationMode, false); assert.equal(f.timers.size, 0); assert.equal(f.notices.length, 1);
});

test('NVIDIA Talk uses cloud capture, not browser recognition, and errors stop without fallback', () => {
  const f = talkFixture(true); f.state.conversationMode = false; vm.runInContext('toggleConversationMode()', f.context);
  assert.equal(f.instances.length, 0); assert.match(f.feedback.textContent, /NVIDIA cloud voice selected/);
  f.cloud().onError(Error('Synthetic NVIDIA failure'));
  assert.equal(f.state.conversationMode, false); assert.equal(f.timers.size, 0);
  assert.equal(f.feedback.textContent, 'Synthetic NVIDIA failure'); assert.equal(f.instances.length, 0);
});

test('an older host without voice routes gives restart guidance instead of a generic network message', async () => {
  let calls = 0;
  const b = browser({ fetch: async () => { calls++; return { status: 404, ok: false }; } });
  b.voice.init(); b.controls.voiceServiceSelect.value = 'nvidia'; b.controls.nvidiaVoiceConsent.checked = true; b.controls.nvidiaVoiceConsent.listeners.change();
  await b.controls.checkNvidiaVoice.listeners.click();
  assert.equal(calls, 1); assert.match(b.controls.nvidiaVoiceStatus.textContent, /restart Seneschal.*reload/);
  assert.equal(b.controls.checkNvidiaVoice.disabled, false);
});

test('choosing NVIDIA with an unloaded client never silently uses browser speech', () => {
  const f = talkFixture(); f.state.conversationMode = false;
  f.context.window.SeneschalNvidiaVoice = undefined;
  f.context.$ = selector => selector === '#voiceServiceSelect' ? { value: 'nvidia' } : f.feedback;
  vm.runInContext('toggleConversationMode()', f.context);
  assert.equal(f.instances.length, 0); assert.equal(f.state.conversationMode, false);
  assert.match(f.feedback.textContent, /restart Seneschal.*Browser speech was not used/);
  const app = fs.readFileSync(path.join(__dirname, '../app/app.js'), 'utf8');
  assert.match(app, /async function toggleVoiceDictation\(\) \{[\s\S]*?if \(!voiceServiceAvailable\(\)\) return;/);
});

const voiceAnswer = (id, parentID, text, extra = {}) => ({ info: { id, role: 'assistant', sessionID: 'ses_synthetic', parentID, time: { created: 1, completed: 2 }, finish: 'stop', ...extra }, parts: [{ type: 'text', text }] });
function beginVoiceTurn(f, messageID = 'msg_current') {
  f.context.beginConversationTurn({ id: 'ses_synthetic', directory: 'synthetic-project' }, messageID);
  return f.state.voiceTurn;
}

test('voice playback ignores a previous answer, incomplete streaming text, tool preambles and other sessions', () => {
  const f = talkFixture(true), turn = beginVoiceTurn(f);
  const snapshots = [
    [voiceAnswer('msg_old_answer', 'msg_previous', 'Previous answer')],
    [voiceAnswer('msg_partial', turn.messageID, 'Partial answer', { time: { created: 1 } })],
    [voiceAnswer('msg_tool', turn.messageID, 'Let me check', { finish: 'tool-calls' })],
    [voiceAnswer('msg_other', turn.messageID, 'Other chat', { sessionID: 'ses_other' })],
    [voiceAnswer('msg_summary', turn.messageID, 'Summary', { summary: true })]
  ];
  for (const messages of snapshots) f.context.speakLatestAssistant(turn, messages);
  assert.equal(f.played.length, 0); assert.equal(f.state.voiceAwaitingResponse, true);
  f.context.speakLatestAssistant(turn, [voiceAnswer('msg_old_answer', 'msg_previous', 'Previous answer'), voiceAnswer('msg_final', turn.messageID, 'Current answer')]);
  assert.deepEqual(f.played, ['Current answer']); assert.equal(f.state.voiceAwaitingResponse, false);
  f.context.speakLatestAssistant(turn, [voiceAnswer('msg_final', turn.messageID, 'Current answer')]);
  assert.equal(f.played.length, 1);
});

test('reply recovery reads only, waits through lag and busy snapshots, then speaks the matched final answer once', async () => {
  const f = talkFixture(true), turn = beginVoiceTurn(f); let messages = [voiceAnswer('msg_old', 'msg_previous', 'Old')], status = 'idle';
  const calls = [];
  f.context.api = async (route, options) => { calls.push({ route, options }); return route === '/session/status' ? { ses_synthetic: { type: status } } : messages; };
  await f.context.checkConversationReply(turn); assert.equal(f.played.length, 0); assert.equal(f.state.voiceAwaitingResponse, true);
  messages = [voiceAnswer('msg_final', turn.messageID, 'New answer')]; status = 'busy';
  await f.context.checkConversationReply(turn); assert.equal(f.played.length, 0);
  status = 'idle'; await f.context.checkConversationReply(turn); await f.context.checkConversationReply(turn);
  assert.deepEqual(f.played, ['New answer']); assert.equal(calls.length, 6);
  assert.equal(f.state.statuses.ses_synthetic.type, 'idle');
  assert.ok(calls.every(call => !call.options.method && call.options.directory === 'synthetic-project'));
  f.playback().onEnd(); assert.equal(f.state.voiceTurn, null); assert.equal(f.state.voiceSpeaking, false);
});

test('late snapshots and playback callbacks cannot cross Stop, a new voice turn or a session switch', async () => {
  const f = talkFixture(true), first = beginVoiceTurn(f, 'msg_first'); let release;
  f.context.api = route => route === '/session/status' ? Promise.resolve({}) : new Promise(resolve => { release = resolve; });
  const pending = f.context.checkConversationReply(first);
  f.context.stopConversationMode(false); f.state.conversationMode = true;
  const second = beginVoiceTurn(f, 'msg_second');
  release([voiceAnswer('msg_first_answer', first.messageID, 'Stale answer')]); await pending;
  assert.equal(f.played.length, 0); assert.equal(f.state.voiceTurn, second);
  f.context.speakLatestAssistant(second, [voiceAnswer('msg_second_answer', second.messageID, 'Second answer')]);
  const latePlayback = f.playback(); f.context.stopConversationMode(false); f.state.conversationMode = true;
  const third = beginVoiceTurn(f, 'msg_third'); latePlayback.onEnd(); latePlayback.onError(Error('stale'));
  assert.equal(f.state.voiceTurn, third); assert.equal(f.state.voiceAwaitingResponse, true);
  f.state.currentSessionID = 'ses_other'; await f.context.checkConversationReply(third);
  assert.equal(f.state.conversationMode, false); assert.equal(f.state.voiceTurn, null);
});

test('lost reply reads never resend a prompt; failure and bounded waiting never speak old text', async () => {
  const f = talkFixture(true), turn = beginVoiceTurn(f); let reads = 0;
  f.context.api = async () => { reads++; throw Error('synthetic disconnect'); };
  await f.context.checkConversationReply(turn); assert.equal(reads, 2); assert.equal(f.played.length, 0); assert.equal(f.state.voiceAwaitingResponse, true);
  f.context.api = async route => route === '/session/status' ? {} : [voiceAnswer('msg_failed', turn.messageID, 'Do not speak', { error: { name: 'APIError' } })];
  await f.context.checkConversationReply(turn); assert.equal(f.state.conversationMode, false); assert.equal(f.played.length, 0);
  f.state.conversationMode = true; const timed = beginVoiceTurn(f); timed.started = Date.now() - 300001;
  await f.context.checkConversationReply(timed); assert.equal(f.state.conversationMode, false); assert.match(f.feedback.textContent, /task was not cancelled/);
  assert.equal(f.sent.length, 0);
});

test('voice request IDs preserve the engine layout and ordering; waiting begins before the POST can finish', () => {
  const f = talkFixture(true), first = f.context.nextVoiceMessageID(), second = f.context.nextVoiceMessageID();
  assert.match(first, /^msg_[0-9a-f]{12}[0-9A-Za-z]{14}$/); assert.ok(second > first);
  const app = fs.readFileSync(path.join(__dirname, '../app/app.js'), 'utf8');
  assert.match(app, /messageID: voiceMessageID, model:/);
  assert.match(app, /if \(options.voice\) beginConversationTurn\(session, voiceMessageID\)/);
  assert.doesNotMatch(app, /refreshMessages\(true\)\.then\(speakLatestAssistant\)/);
  assert.doesNotMatch(app, /if \(options.voice\) state.voiceAwaitingResponse = true/);
});

test('a fast answer before the send acknowledgement is spoken once and never puts Talk back into waiting', async () => {
  const f = talkFixture(true), session = { id: 'ses_synthetic', directory: 'synthetic-project' };
  Object.assign(f.state, { openCodeCommands: [], selectedAgent: 'build', selectedVariants: {}, statuses: {} });
  const noop = () => {};
  Object.assign(f.context, {
    selectedSession: () => session, selectedModel: () => ({ providerID: 'synthetic', id: 'fixture', value: 'synthetic/fixture' }),
    expandSessionReferences: async text => text, setPromptDeliveryStatus: noop, promptToolRestrictions: () => ({}), runtimeInstructionSystem: () => '',
    renderAttachments: noop, renderHeader: noop, renderMessages: noop, updateConversationClearance: noop, log: noop, refreshMessages: noop,
    submitSessionInput: async (sessionID, directory, body, onReady) => {
      assert.equal(sessionID, session.id); assert.equal(directory, session.directory);
      onReady(); const turn = f.state.voiceTurn;
      assert.equal(turn.messageID, body.messageID); assert.equal(f.state.voiceAwaitingResponse, true);
      f.context.speakLatestAssistant(turn, [voiceAnswer('msg_fast_answer', body.messageID, 'Fast current answer')]);
      f.playback().onEnd();
      assert.equal(f.state.voiceAwaitingResponse, false);
      return undefined;
    }
  });
  const app = fs.readFileSync(path.join(__dirname, '../app/app.js'), 'utf8');
  vm.runInContext(app.slice(app.indexOf('  async function sendPrompt('), app.indexOf('  async function expandSessionReferences(')), f.context);
  assert.equal(await f.context.sendPrompt('Current spoken question', { voice: true }), true);
  assert.deepEqual(f.played, ['Fast current answer']); assert.equal(f.state.voiceAwaitingResponse, false); assert.equal(f.state.voiceTurn, null);
});

test('concurrent idle events share one read-only reply check', async () => {
  const f = talkFixture(true), turn = beginVoiceTurn(f); let release, calls = 0;
  f.context.api = route => { calls++; return route === '/session/status' ? Promise.resolve({}) : new Promise(resolve => { release = resolve; }); };
  const first = f.context.checkConversationReply(turn); await f.context.checkConversationReply(turn);
  assert.equal(calls, 2); release([voiceAnswer('msg_answer', turn.messageID, 'One answer')]); await first;
  assert.deepEqual(f.played, ['One answer']);
});
