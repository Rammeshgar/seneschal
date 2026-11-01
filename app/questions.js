(function (root) {
  'use strict';
  const idPattern = /^[a-zA-Z0-9_-]{1,256}$/;
  const text = (value, max) => typeof value === 'string' && value.length <= max;
  function loadError(error) {
    if ([401, 403].includes(error?.status)) return 'Questions need a fresh sign-in or phone pairing. Reconnect, then refresh questions. Approvals are separate.';
    if ([404, 405].includes(error?.status)) return 'This engine does not expose the question service. Tool approvals are separate and still require your decision.';
    if (error?.kind === 'format') return 'The engine returned a question format this app cannot display. Refresh questions or use Classic OpenCode. Tool approvals are separate.';
    if (error?.status >= 500) return 'The question service is temporarily unavailable. Refresh questions to retry. No answer or approval was sent.';
    return 'Questions could not load. Check the PC connection, then refresh questions. No answer or approval was sent.';
  }

  function normalizeRequest(value) {
    if (!value || !idPattern.test(value.id || '') || !/^ses[a-zA-Z0-9_-]{1,253}$/.test(value.sessionID || '') ||
        !Array.isArray(value.questions) || !value.questions.length || value.questions.length > 12) return null;
    const questions = [];
    for (const question of value.questions) {
      if (!question || !text(question.question, 8000) || !question.question.trim() || !text(question.header, 256) ||
          !Array.isArray(question.options) || question.options.length > 32) return null;
      const options = [];
      for (const option of question.options) {
        if (!option || !text(option.label, 512) || !option.label.trim() || !text(option.description ?? '', 4000)) return null;
        options.push({ label: option.label, description: option.description || '' });
      }
      if (new Set(options.map(option => option.label)).size !== options.length) return null;
      questions.push({ question: question.question, header: question.header, options, multiple: question.multiple === true, custom: question.custom !== false });
    }
    return { id: value.id, sessionID: value.sessionID, questions };
  }

  function validateAnswers(request, answers) {
    if (!Array.isArray(answers) || answers.length !== request.questions.length) throw Error('Answer every question before sending.');
    return answers.map((answer, index) => {
      const question = request.questions[index];
      if (!Array.isArray(answer) || !answer.length || (!question.multiple && answer.length !== 1) || answer.length > 33) throw Error('Choose an answer or write your own response for every question.');
      const result = [...new Set(answer)];
      if (result.some(value => !text(value, 2000) || !value.trim() || (!question.custom && !question.options.some(option => option.label === value)))) throw Error('An answer is empty, too long or not one of the permitted choices.');
      return result;
    });
  }

  function createController({ request, changed = () => {} }) {
    let context = { sessionID: '', directory: '' }, epoch = 0, revision = 0, reading = null, disposed = false;
    const completed = new Set(), misses = new Map();
    const state = { context, requests: [], busy: '', uncertain: '', error: '', loaded: false };
    const emit = () => { if (!disposed) changed(state); };
    const forget = id => { completed.add(id); if (completed.size > 256) completed.delete(completed.values().next().value); state.requests = state.requests.filter(item => item.id !== id); revision++; };
    async function refresh(manual = false) {
      if (disposed || !context.sessionID || !context.directory || reading) return;
      const scope = epoch, before = revision, current = { ...context }, marker = {};
      reading = marker;
      try {
        const pending = await request('/question', { directory: current.directory });
        if (scope !== epoch || disposed || before !== revision) return;
        if (!Array.isArray(pending) || pending.length > 256) throw Object.assign(Error('Invalid pending-question response.'), { kind: 'format' });
        const normalized = pending.filter(item => item?.sessionID === current.sessionID).map(normalizeRequest);
        if (normalized.some(item => !item)) throw Object.assign(Error('A question could not be displayed safely.'), { kind: 'format' });
        const latest = normalized.filter(item => item.sessionID === current.sessionID && !completed.has(item.id));
        const ids = new Set(latest.map(item => item.id));
        for (const item of latest) misses.delete(item.id);
        for (const item of state.requests) {
          if (ids.has(item.id) || completed.has(item.id)) continue;
          const count = (misses.get(item.id) || 0) + 1; misses.set(item.id, count);
          if (count < 3) latest.push(item); else misses.delete(item.id);
        }
        state.requests = latest;
        state.loaded = true;
        if (manual && !state.busy) state.uncertain = '';
        state.error = state.uncertain ? 'The last reply was not confirmed. Refresh questions to check its status before trying again.' : '';
        emit();
      } catch (error) {
        if (scope === epoch && !disposed) { state.error = loadError(error); emit(); }
      } finally { if (reading === marker) reading = null; }
    }
    async function act(id, action, answers) {
      const pending = state.requests.find(item => item.id === id && item.sessionID === context.sessionID);
      if (disposed || !pending || state.busy || state.uncertain) return false;
      let body;
      try { body = action === 'reply' ? { answers: validateAnswers(pending, answers) } : {}; }
      catch (error) { state.error = error.message; emit(); return false; }
      const current = { ...context }, scope = epoch;
      state.busy = id; state.error = ''; emit();
      try {
        await request(`/question/${encodeURIComponent(id)}/${action}`, { method: 'POST', directory: current.directory, body });
        if (scope === epoch) { forget(id); state.error = ''; state.uncertain = ''; }
        return true;
      } catch {
        if (scope === epoch && !completed.has(id)) {
          state.uncertain = id;
          state.error = 'Your answer or dismissal was not confirmed. Nothing will be sent again automatically. Refresh questions to check the request.';
        }
        return false;
      } finally { if (state.busy === id) state.busy = ''; emit(); }
    }
    return {
      state, refresh,
      setContext(next) {
        const sessionID = typeof next?.sessionID === 'string' ? next.sessionID : '';
        const directory = typeof next?.directory === 'string' ? next.directory : '';
        if (sessionID === context.sessionID && directory === context.directory) return;
        context = { sessionID, directory }; state.context = context; epoch++; revision++; reading = null;
        state.requests = []; misses.clear(); state.error = ''; state.loaded = false; state.uncertain = ''; emit(); void refresh();
      },
      handleEvent(event) {
        if (disposed || !/^question\.(asked|replied|rejected)$/.test(event?.type || '')) return;
        const properties = event.properties || event.data;
        if (properties?.sessionID !== context.sessionID) return;
        if (event.type === 'question.asked') {
          const pending = normalizeRequest(properties);
          if (!pending) { state.error = 'This question format could not be displayed. Refresh questions or open Classic OpenCode to answer it.'; emit(); return; }
          if (completed.has(pending.id)) return;
          misses.delete(pending.id);
          const index = state.requests.findIndex(item => item.id === pending.id);
          if (index < 0) { if (state.requests.length >= 32) return; state.requests.push(pending); }
          else state.requests[index] = pending;
          revision++; emit();
        } else {
          const id = properties.requestID || properties.id;
          if (!idPattern.test(id || '')) return;
          forget(id); if (state.uncertain === id) { state.uncertain = ''; state.error = ''; } emit();
        }
      },
      reply: (id, answers) => act(id, 'reply', answers), reject: id => act(id, 'reject'),
      dispose() { disposed = true; epoch++; state.requests = []; }
    };
  }

  async function transport(fetcher, pathname, options = {}) {
    const params = new URLSearchParams({ directory: options.directory });
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 10000);
    try {
      const response = await fetcher(`/api${pathname}?${params}`, { method: options.method || 'GET', credentials: 'same-origin', signal: controller.signal,
        headers: options.body ? { 'Content-Type': 'application/json', Accept: 'application/json' } : { Accept: 'application/json' },
        ...(options.body ? { body: JSON.stringify(options.body) } : {}) });
      if (!response.ok) throw Object.assign(Error('Question request failed.'), { status: response.status });
      if (response.status === 204) return null;
      try { return await response.json(); }
      catch { throw Object.assign(Error('Invalid question response.'), { kind: 'format' }); }
    } finally { clearTimeout(timer); }
  }

  function install(document, win, fetcher) {
    const dock = document.getElementById('questionDock');
    if (!dock) return null;
    const node = (tag, className, content) => {
      const element = document.createElement(tag); if (className) element.className = className;
      if (content !== undefined) element.textContent = content; return element;
    };
    const button = (label, handler) => { const element = node('button', '', label); element.type = 'button'; element.addEventListener('click', handler); return element; };
    let active = null, fingerprint = '', fields = [], scope = '', previousFocus = null, validationMessage = '';
    const opened = new Set();
    const dockStatus = node('p'), show = button('Answer question', () => open()), retry = button('Refresh questions', () => { void controller.refresh(true); });
    dockStatus.setAttribute('role', 'status'); dockStatus.setAttribute('aria-live', 'polite'); dock.append(dockStatus, show, retry);
    const dialog = node('dialog', 'question-dialog'); dialog.setAttribute('aria-labelledby', 'questionTitle');
    const header = node('header', 'question-header'), heading = node('h2', '', 'Seneschal needs your answer'); heading.id = 'questionTitle'; heading.tabIndex = -1;
    const hide = button('Close', () => close()); header.append(heading, hide);
    const form = node('form', 'question-form'), body = node('div', 'question-body'), feedback = node('p', 'question-feedback');
    feedback.id = 'questionFeedback'; feedback.setAttribute('role', 'status'); feedback.setAttribute('aria-live', 'polite');
    const actions = node('footer', 'question-actions'), dismiss = button('Dismiss question', () => { if (active) void controller.reject(active.id); });
    const send = node('button', 'question-send', 'Send answers'); send.type = 'submit';
    const recheck = button('Refresh questions', () => { void controller.refresh(true); });
    actions.append(dismiss, recheck, send); form.append(body, feedback, actions); dialog.append(header, form); document.body.append(dialog);
    function close() { if (dialog.open) dialog.close(); }
    function open() {
      if (!active || dialog.open) return;
      previousFocus = document.activeElement; opened.add(`${scope}:${active.id}`);
      dialog.showModal(); heading.focus();
    }
    function build(request) {
      body.replaceChildren(); fields = []; validationMessage = '';
      request.questions.forEach((question, index) => {
        const group = node('fieldset'), legend = node('legend', '', question.question), help = node('p', 'question-help', question.multiple ? 'Select one or more answers.' : 'Choose one answer.');
        legend.id = `questionLegend${index}`; help.id = `questionHelp${index}`;
        group.setAttribute('aria-describedby', `${help.id} questionFeedback`); group.append(legend, help);
        const choices = [], custom = question.custom ? node('textarea') : null;
        question.options.forEach((option, optionIndex) => {
          const label = node('label', 'question-option'), input = node('input'), copy = node('span');
          input.type = question.multiple ? 'checkbox' : 'radio'; input.name = `question-${index}`; input.value = option.label;
          input.id = `questionOption${index}-${optionIndex}`;
          copy.append(node('strong', '', option.label)); if (option.description) copy.append(node('small', '', option.description));
          label.append(input, copy); group.append(label); choices.push(input);
          input.addEventListener('change', () => { if (input.checked && !question.multiple && custom) custom.value = ''; });
        });
        if (custom) {
          const label = node('label', 'question-custom', question.options.length ? 'Or write your own answer' : 'Your answer');
          custom.id = `questionCustom${index}`; custom.maxLength = 2000; custom.rows = 3;
          custom.setAttribute('aria-describedby', 'questionFeedback'); label.htmlFor = custom.id;
          custom.addEventListener('input', () => { if (custom.value.trim() && !question.multiple) choices.forEach(choice => { choice.checked = false; }); });
          group.append(label, custom);
        }
        fields.push({ choices, custom, group }); body.append(group);
      });
    }
    const controller = createController({ request: (url, options) => transport(fetcher, url, options), changed(state) {
      const nextScope = `${state.context.directory}:${state.context.sessionID}`;
      if (scope !== nextScope) { close(); scope = nextScope; fingerprint = ''; }
      const next = state.requests[0] || null, nextFingerprint = next ? JSON.stringify(next) : '';
      active = next;
      if (!active) { close(); body.replaceChildren(); fields = []; }
      else if (nextFingerprint !== fingerprint) { build(active); if (dialog.open) heading.focus(); }
      fingerprint = nextFingerprint;
      dock.hidden = !state.context.sessionID || (!active && !state.error);
      const statusText = state.error || (active ? `Waiting for your answer${state.requests.length > 1 ? ` · ${state.requests.length} requests` : ''}` : '');
      const displayStatus = root.SeneschalI18n?.t(statusText) || statusText;
      if (dockStatus.textContent !== displayStatus) {
        if (root.SeneschalI18n?.setText) root.SeneschalI18n.setText(dockStatus, statusText);
        else dockStatus.textContent = displayStatus;
      }
      show.hidden = !active; show.setAttribute('aria-haspopup', 'dialog');
      const feedbackText = state.error || validationMessage || (state.busy ? 'Sending your response…' : 'Only Send answers or Dismiss question replies to the engine. Closing leaves it pending.');
      const displayFeedback = root.SeneschalI18n?.t(feedbackText) || feedbackText;
      if (feedback.textContent !== displayFeedback) {
        if (root.SeneschalI18n?.setText) root.SeneschalI18n.setText(feedback, feedbackText);
        else feedback.textContent = displayFeedback;
      }
      form.setAttribute('aria-busy', String(Boolean(state.busy)));
      send.disabled = dismiss.disabled = Boolean(state.busy || state.uncertain);
      send.textContent = state.busy ? 'Sending…' : 'Send answers';
      for (const field of fields) { field.group.disabled = Boolean(state.busy || state.uncertain); if (!validationMessage) field.group.removeAttribute('aria-invalid'); }
      if (active && !opened.has(`${scope}:${active.id}`) && !document.querySelector('dialog[open]')) open();
    } });
    form.addEventListener('submit', async event => {
      event.preventDefault(); if (!active) return;
      const answers = fields.map(field => {
        const selected = field.choices.filter(choice => choice.checked).map(choice => choice.value);
        if (field.custom?.value.trim()) selected.push(field.custom.value.trim()); return selected;
      });
      try { validateAnswers(active, answers); }
      catch (error) {
        validationMessage = error.message; feedback.textContent = error.message;
        const index = answers.findIndex(answer => !answer.length);
        const field = fields[index < 0 ? 0 : index]; field?.group.setAttribute('aria-invalid', 'true');
        (field?.choices[0] || field?.custom)?.focus(); return;
      }
      validationMessage = ''; await controller.reply(active.id, answers);
    });
    form.addEventListener('input', () => { validationMessage = ''; });
    form.addEventListener('change', () => { validationMessage = ''; });
    dialog.addEventListener('cancel', event => { event.preventDefault(); close(); });
    dialog.addEventListener('keydown', event => {
      if (event.key === 'Escape') event.stopPropagation();
      if (event.key !== 'Tab') return;
      const controls = [...dialog.querySelectorAll('button:enabled, input:enabled, textarea:enabled')].filter(element => element.getClientRects().length);
      const first = controls[0], last = controls[controls.length - 1];
      if (!first) { event.preventDefault(); heading.focus(); return; }
      if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
      else if (event.shiftKey && [first, heading].includes(document.activeElement)) { event.preventDefault(); last.focus(); }
    });
    dialog.addEventListener('close', () => { if (previousFocus?.isConnected && !previousFocus.hidden) previousFocus.focus(); else if (!dock.hidden) show.focus(); });
    const onContext = event => controller.setContext(event.detail), onActivity = event => controller.handleEvent(event.detail), onRefresh = () => { void controller.refresh(); };
    win.addEventListener('seneschal-question-context', onContext); win.addEventListener('seneschal-activity', onActivity);
    win.addEventListener('seneschal-question-refresh', onRefresh); win.addEventListener('focus', onRefresh);
    const timer = win.setInterval(onRefresh, 1500);
    win.addEventListener('pagehide', event => { if (event.persisted) return; win.clearInterval(timer); controller.dispose(); });
    return { controller, dialog, form, fields: () => fields, close, open };
  }
  const exported = { normalizeRequest, validateAnswers, createController, transport, install };
  if (typeof module !== 'undefined' && module.exports) module.exports = exported;
  else if (root.document) install(root.document, root, root.fetch.bind(root));
})(typeof window !== 'undefined' ? window : globalThis);
