(function (root) {
  'use strict';
  const CONSENT = 'nvidia-trial-v1';
  const preferences = { get() { try { return JSON.parse(localStorage.getItem('seneschal-nvidia-voice') || '{}') || {}; } catch { return {}; } }, set(value) { try { localStorage.setItem('seneschal-nvidia-voice', JSON.stringify(value)); } catch {} } };
  let context, currentCapture, playback, playbackAnalyser, request, speechRequest, epoch = 0, speechEpoch = 0;
  const selected = () => document.getElementById('voiceServiceSelect')?.value === 'nvidia';
  const ready = () => selected() && document.getElementById('nvidiaVoiceConsent')?.checked;
  function wave(samples, inputRate) {
    const length = Math.floor(samples.length * 16000 / inputRate), buffer = new ArrayBuffer(44 + length * 2), view = new DataView(buffer);
    const text = (offset, value) => { for (let i = 0; i < value.length; i++) view.setUint8(offset + i, value.charCodeAt(i)); };
    text(0, 'RIFF'); view.setUint32(4, buffer.byteLength - 8, true); text(8, 'WAVEfmt '); view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true); view.setUint32(24, 16000, true); view.setUint32(28, 32000, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true); text(36, 'data'); view.setUint32(40, length * 2, true);
    for (let i = 0; i < length; i++) {
      const start = Math.floor(i * inputRate / 16000), end = Math.max(start + 1, Math.floor((i + 1) * inputRate / 16000)); let value = 0;
      for (let j = start; j < end && j < samples.length; j++) value += samples[j];
      value = Math.max(-1, Math.min(1, value / (end - start))); view.setInt16(44 + i * 2, value < 0 ? value * 32768 : value * 32767, true);
    }
    return buffer;
  }
  async function call(action, body) {
    if (!ready()) throw Error('Accept the NVIDIA cloud-audio notice in Voice first.');
    const control = new AbortController(); request = control;
    if (action === 'speak') speechRequest = control;
    const timer = setTimeout(() => control.abort(), 40000);
    try {
      const response = await fetch(`/workspace/nvidia-speech/${action}`, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': action === 'transcribe' ? 'audio/wav' : 'application/json', 'X-Seneschal-Voice-Consent': CONSENT }, body: action === 'transcribe' ? body : JSON.stringify(body || {}), signal: control.signal });
      if (response.status === 404) throw Error('The running Seneschal host has not loaded NVIDIA voice. Finish active tasks, restart Seneschal on the PC, then reload this page. Nothing was switched to another service.');
      if (!response.ok) { const data = await response.json().catch(() => ({})); throw Error(data.error || 'NVIDIA voice could not complete. No fallback was used.'); }
      return action === 'speak' ? response.arrayBuffer() : response.json();
    } finally { clearTimeout(timer); if (request === control) request = null; if (speechRequest === control) speechRequest = null; }
  }
  async function audioContext() {
    const AudioContext = root.AudioContext || root.webkitAudioContext;
    if (!AudioContext) throw Error('This browser does not support NVIDIA microphone capture.');
    if (!context || context.state === 'closed') context = new AudioContext();
    if (context.state === 'suspended') await context.resume();
    return context;
  }
  function stopCapture() { currentCapture?.cancel(); currentCapture = null; }
  function cancelSpeech() {
    speechEpoch++; speechRequest?.abort(); speechRequest = null;
    root.SeneschalAres?.setAnalyser(null);
    const node = playback; playback = null;
    if (node) { node.onended = null; try { node.stop(); node.disconnect(); } catch {} }
    playbackAnalyser?.disconnect(); playbackAnalyser = null;
  }
  function stop() {
    epoch++; stopCapture(); request?.abort(); request = null;
    cancelSpeech();
    const previous = context; context = null; if (previous && previous.state !== 'closed') previous.close().catch(() => {});
  }
  function listen({ onState, onResult, onError }) {
    const turn = epoch; let cancelled = false, stream, source, processor, gain, timer;
    const cleanup = () => {
      clearTimeout(timer); if (processor) processor.onaudioprocess = null;
      for (const node of [source, processor, gain]) { try { node?.disconnect(); } catch {} }
      stream?.getTracks().forEach(track => track.stop());
      if (currentCapture === handle) currentCapture = null;
    };
    const handle = { abort() { cancelled = true; cleanup(); }, cancel() { this.abort(); } }; currentCapture = handle;
    (async () => {
      if (!ready()) throw Error('Accept the NVIDIA cloud-audio notice in Voice first.');
      if (!navigator.mediaDevices?.getUserMedia) throw Error('Microphone recording needs a secure browser connection.');
      const audio = await audioContext();
      stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
      if (cancelled || turn !== epoch) { cleanup(); return; }
      source = audio.createMediaStreamSource(stream); processor = audio.createScriptProcessor(4096, 1, 1); gain = audio.createGain(); gain.gain.value = 0;
      source.connect(processor); processor.connect(gain); gain.connect(audio.destination);
      const chunks = []; let count = 0, duration = 0, quiet = 0, voiced = 0, finished = false;
      const finish = async () => {
        if (finished || cancelled || turn !== epoch) return; finished = true; cleanup();
        if (voiced < 0.18) { onResult(''); return; }
        const samples = new Float32Array(count); let offset = 0; for (const chunk of chunks) { samples.set(chunk, offset); offset += chunk.length; }
        onState('Transcribing');
        try { const result = await call('transcribe', wave(samples, audio.sampleRate)); if (!cancelled && turn === epoch) onResult(result.text || ''); }
        catch (error) { if (!cancelled && turn === epoch) onError(error); }
      };
      processor.onaudioprocess = event => {
        if (cancelled || finished || turn !== epoch) return;
        const data = new Float32Array(event.inputBuffer.getChannelData(0)), seconds = data.length / audio.sampleRate;
        if (duration + seconds > 19.5) { void finish(); return; }
        chunks.push(data); count += data.length; duration += seconds;
        let energy = 0; for (const value of data) energy += value * value;
        if (Math.sqrt(energy / data.length) > 0.018) { voiced += seconds; quiet = 0; } else quiet += seconds;
        if ((voiced > 0.18 && quiet > 1.05) || (voiced === 0 && duration > 7)) void finish();
      };
      timer = setTimeout(() => { void finish(); }, 20000); onState('Listening');
    })().catch(error => { cleanup(); if (!cancelled && turn === epoch) onError(error); });
    return handle;
  }
  async function speak(text, { onState, onEnd, onError }) {
    const turn = epoch, speechTurn = ++speechEpoch;
    try {
      onState('Preparing voice');
      const data = await call('speak', { text: text.slice(0, 1000) });
      if (turn !== epoch || speechTurn !== speechEpoch) return;
      const audio = await audioContext(), decoded = await audio.decodeAudioData(data);
      if (turn !== epoch || speechTurn !== speechEpoch) return;
      playback = audio.createBufferSource(); playback.buffer = decoded;
      const analyser = root.SeneschalAres && audio.createAnalyser ? audio.createAnalyser() : null;
      playbackAnalyser = analyser;
      if (analyser) { analyser.fftSize = 256; playback.connect(analyser); analyser.connect(audio.destination); root.SeneschalAres.setAnalyser(analyser); }
      else playback.connect(audio.destination);
      const node = playback; node.onended = () => { if (playback === node) { playback = null; playbackAnalyser = null; root.SeneschalAres?.setAnalyser(null); } node.disconnect(); analyser?.disconnect(); if (turn === epoch && speechTurn === speechEpoch) onEnd(); };
      onState('Speaking'); node.start();
    } catch (error) { if (turn === epoch && speechTurn === speechEpoch) onError(error); }
  }
  function init({ stopVoice = () => {} } = {}) {
    const select = document.getElementById('voiceServiceSelect'), consent = document.getElementById('nvidiaVoiceConsent'), notice = document.getElementById('nvidiaVoiceNotice'), status = document.getElementById('nvidiaVoiceStatus'), check = document.getElementById('checkNvidiaVoice');
    if (!select || !consent) return;
    const saved = preferences.get(); select.value = saved.service === 'nvidia' ? 'nvidia' : 'browser'; consent.checked = saved.consent === CONSENT;
    const render = () => { notice.hidden = !selected(); check.disabled = !ready(); };
    const change = () => { stopVoice(); stop(); preferences.set({ service: select.value, consent: consent.checked ? CONSENT : '' }); render(); };
    select.addEventListener('change', change); consent.addEventListener('change', change); render();
    check.addEventListener('click', async () => {
      if (!ready() || check.disabled) return; check.disabled = true; status.textContent = 'Checking voice access…';
      try { const result = await call('voices', {}); status.textContent = result.available ? 'NVIDIA voice is available. English speech trial; remaining free quota is not reported. Use Talk to begin.' : 'The selected NVIDIA voice is unavailable. Nothing was recorded.'; }
      catch (error) { status.textContent = error.message; }
      finally { render(); }
    });
  }
  root.SeneschalNvidiaVoice = { init, selected, ready, listen, speak, stop, cancelSpeech, wave };
})(window);
