'use strict';
const fs = require('node:fs');
const API = Object.freeze({
  voices: 'https://877104f7-e885-42b9-8de8-f6e4c6303969.invocation.api.nvcf.nvidia.com/v1/audio/list_voices',
  speak: 'https://877104f7-e885-42b9-8de8-f6e4c6303969.invocation.api.nvcf.nvidia.com/v1/audio/synthesize',
  transcribe: 'https://1598d209-5e27-4d3c-8079-4751568b1081.invocation.api.nvcf.nvidia.com/v1/audio/transcriptions'
});
const CONSENT = 'nvidia-trial-v1';
const fail = (statusCode, message) => Object.assign(new Error(message), { statusCode });
function credential(authFile) {
  let key = process.env.NVIDIA_API_KEY;
  if (!key && authFile) {
    const stat = fs.statSync(authFile);
    if (!stat.isFile() || stat.size > 256 * 1024) throw fail(503, 'The local NVIDIA credential store is unavailable.');
    const item = JSON.parse(fs.readFileSync(authFile, 'utf8')).nvidia;
    if (item?.type === 'api') key = item.key;
  }
  if (typeof key !== 'string' || !/^nvapi-[A-Za-z0-9_-]{20,512}$/.test(key)) throw fail(503, 'Connect NVIDIA in OpenCode on the PC first. Never paste the key into chat.');
  return key;
}
async function limited(stream, maximum, signal) {
  const chunks = []; let size = 0;
  for await (const chunk of stream) {
    if (signal?.aborted) throw fail(499, 'Voice request cancelled.');
    const bytes = Buffer.from(chunk); size += bytes.length;
    if (size > maximum) throw fail(413, 'Voice request or response is too large.');
    chunks.push(bytes);
  }
  return Buffer.concat(chunks);
}
function validWave(bytes) {
  return bytes.length >= 44 && bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.readUInt32LE(4) === bytes.length - 8 &&
    bytes.toString('ascii', 8, 16) === 'WAVEfmt ' && bytes.readUInt32LE(16) === 16 && bytes.readUInt16LE(20) === 1 &&
    bytes.readUInt16LE(22) === 1 && bytes.readUInt32LE(24) === 16000 && bytes.readUInt32LE(28) === 32000 &&
    bytes.readUInt16LE(32) === 2 && bytes.readUInt16LE(34) === 16 && bytes.toString('ascii', 36, 40) === 'data' &&
    bytes.readUInt32LE(40) === bytes.length - 44 && (bytes.length - 44) % 2 === 0 && bytes.length <= 640044;
}
function transcript(payload) {
  let value = payload?.text;
  if (typeof value !== 'string' && Array.isArray(payload?.transcripts)) value = payload.transcripts.map(item => typeof item === 'string' ? item : item.transcript || item.alternatives?.[0]?.transcript || '').join(' ');
  if (typeof value !== 'string' || value.length > 12000) throw fail(502, 'NVIDIA returned an unexpected transcript. Nothing was sent to the chat model.');
  return value.trim();
}
function createNvidiaSpeech({ authFile, readKey = () => credential(authFile), fetcher = fetch, now = Date.now, timeoutMs = 35000 } = {}) {
  let busy = false, requests = [];
  const configured = () => { try { return Boolean(readKey()); } catch { return false; } };
  async function perform(action, bytes, type, signal) {
    if (busy) throw fail(409, 'Another voice request is finishing. It was not duplicated.');
    requests = requests.filter(time => now() - time < 60000);
    if (requests.length >= 20) throw fail(429, 'Local voice safety limit reached. Wait a minute; no other provider was used.');
    busy = true;
    try {
      let form, maximum = 1024 * 1024;
      if (action === 'transcribe') {
        if (type !== 'audio/wav' || !validWave(bytes)) throw fail(400, 'Use mono 16-bit, 16 kHz WAV audio, up to 20 seconds.');
        form = new FormData(); form.append('language', 'en-US'); form.append('file', new Blob([bytes], { type: 'audio/wav' }), 'voice-turn.wav');
      } else if (action === 'speak') {
        let body; try { body = JSON.parse(bytes.toString('utf8')); } catch { throw fail(400, 'Invalid speech request.'); }
        if (typeof body.text !== 'string' || !body.text.trim() || body.text.length > 1000 || Object.keys(body).some(key => key !== 'text')) throw fail(400, 'Speech text must contain 1–1,000 characters.');
        form = new FormData();
        for (const [name, value] of Object.entries({ text: body.text.trim(), language: 'en-US', voice: 'Magpie-Multilingual.EN-US.Aria', encoding: 'LINEAR_PCM', sample_rate_hz: '22050' })) form.append(name, value);
        maximum = 8 * 1024 * 1024;
      }
      const key = readKey(); requests.push(now());
      const response = await fetcher(API[action], { method: action === 'voices' ? 'GET' : 'POST', headers: { Authorization: `Bearer ${key}` }, body: form, redirect: 'error', signal });
      if (!response.ok) {
        try { await response.body?.cancel(); } catch {}
        if ([401, 403].includes(response.status)) throw fail(403, 'NVIDIA refused speech access. Check the trial entitlement on your NVIDIA account. No paid fallback was used.');
        if (response.status === 429) throw fail(429, 'NVIDIA trial capacity or rate limit reached. Voice paused; no paid fallback was used.');
        throw fail(502, 'NVIDIA speech is unavailable. Voice paused; no request was retried.');
      }
      const output = await limited(response.body, maximum, signal);
      if (action === 'speak') {
        if (output.length < 44 || output.toString('ascii', 0, 4) !== 'RIFF' || output.toString('ascii', 8, 12) !== 'WAVE') throw fail(502, 'NVIDIA did not return WAV speech.');
        return { audio: output };
      }
      let data; try { data = JSON.parse(output.toString('utf8')); } catch { throw fail(502, 'NVIDIA returned an unreadable speech response.'); }
      if (action === 'transcribe') return { text: transcript(data) };
      const names = Object.values(data).flatMap(group => Array.isArray(group?.voices) ? group.voices : []).filter(name => typeof name === 'string');
      return { available: names.includes('Magpie-Multilingual.EN-US.Aria'), voiceCount: names.length, language: 'en-US', freeQuotaVerified: false };
    } finally { busy = false; }
  }
  function handle(req, res, pathname, json) {
    const prefix = '/workspace/nvidia-speech/';
    if (!pathname.startsWith(prefix)) return false;
    const action = pathname.slice(prefix.length);
    if (action === 'status' && req.method === 'GET') {
      json(res, 200, { configured: configured(), language: 'en-US', mode: 'hosted-developer-trial', freeQuotaVerified: false }); return true;
    }
    if (!['voices', 'transcribe', 'speak'].includes(action) || req.method !== 'POST') { json(res, 405, { error: 'Unsupported speech action.' }); return true; }
    const origin = req.headers.origin;
    if (req.headers['x-seneschal-voice-consent'] !== CONSENT || (origin && origin !== `http://${req.headers.host}`)) {
      json(res, 403, { error: 'Choose NVIDIA voice and accept the cloud-audio notice first.' }); return true;
    }
    const type = String(req.headers['content-type'] || '').split(';')[0].trim();
    if ((action === 'transcribe' && type !== 'audio/wav') || (action !== 'transcribe' && type !== 'application/json')) { json(res, 415, { error: 'Unsupported voice content type.' }); return true; }
    const control = new AbortController();
    const timer = setTimeout(() => control.abort(), timeoutMs); timer.unref?.();
    req.once('aborted', () => control.abort());
    res.once('close', () => { if (!res.writableEnded) control.abort(); });
    (async () => {
      try {
        const bytes = await limited(req, action === 'transcribe' ? 640044 : 8192, control.signal);
        const result = await perform(action, bytes, type, control.signal);
        if (control.signal.aborted || res.destroyed) return;
        if (result.audio) { res.writeHead(200, { 'content-type': 'audio/wav', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', 'content-length': result.audio.length }); res.end(result.audio); }
        else json(res, 200, result);
      } catch (error) {
        if (!res.destroyed && !res.headersSent) json(res, control.signal.aborted ? 504 : error.statusCode || 502, { error: control.signal.aborted ? 'Voice timed out or was stopped. It was not retried.' : error.statusCode ? error.message : 'NVIDIA speech could not complete. Check the connection and local provider sign-in. No paid fallback was used.' });
      } finally { clearTimeout(timer); }
    })();
    return true;
  }
  return { handle };
}
module.exports = { API, CONSENT, validWave, transcript, createNvidiaSpeech };
