(function (root) {
  'use strict';
  let view, enabled = true, paused = false, stage = 'Idle', analyser = null, generation = 0, initialized = false, nodes, sampler, loading = false, failed = false, floatingHome, loadAttempt = 0, loadDeadline;
  const failure = 'Seneschal could not load. Voice still works. Check browser 3D support; after an update, restart Seneschal when tasks finish and reload.';
  const preference = { get() { try { return localStorage.getItem('seneschal-ares-visible') !== 'false'; } catch { return true; } }, set(value) { try { localStorage.setItem('seneschal-ares-visible', String(value)); } catch {} } };
  const reduced = root.matchMedia?.('(prefers-reduced-motion: reduce)');
  const defaults = () => ({ floating: false, width: 210, height: 260, x: 1, y: 1, minimized: false, yaw: 0, pitch: 0 });
  const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
  let settings = defaults(), maximized = false, gesture = null, orbitGesture = null, rendered, onScreen = true;
  function readLayout() {
    try {
      const value = JSON.parse(localStorage.getItem('seneschal-ares-layout') || 'null');
      if (!value || typeof value !== 'object') return defaults();
      return { floating: value.floating === true, minimized: value.minimized === true,
        width: Number.isFinite(value.width) ? clamp(value.width, 200, 420) : 210,
        height: Number.isFinite(value.height) ? clamp(value.height, 190, 500) : 260,
        x: Number.isFinite(value.x) ? clamp(value.x, 0, 1) : 1, y: Number.isFinite(value.y) ? clamp(value.y, 0, 1) : 1,
        yaw: Number.isFinite(value.yaw) ? clamp(value.yaw, -Math.PI, Math.PI) : 0, pitch: Number.isFinite(value.pitch) ? clamp(value.pitch, -1.15, 1.15) : 0 };
    } catch { return defaults(); }
  }
  function saveLayout() { try { localStorage.setItem('seneschal-ares-layout', JSON.stringify(settings)); } catch {} }
  function closeLayoutMenu() { if (nodes.layoutPanel.matches?.(':popover-open')) nodes.layoutPanel.hidePopover(); }
  function level() {
    if (!analyser) return -1;
    if (!sampler || sampler.length !== analyser.fftSize) sampler = new Float32Array(analyser.fftSize);
    try { analyser.getFloatTimeDomainData(sampler); } catch { return 0; }
    let energy = 0; for (const value of sampler) energy += value * value;
    return Math.min(1, Math.sqrt(energy / sampler.length) * 6);
  }
  function bounds() {
    const viewport = root.visualViewport, form = nodes.form.getBoundingClientRect(), header = document.getElementById('sessionHeader')?.getBoundingClientRect();
    const conversation = document.querySelector?.('.conversation-panel')?.getBoundingClientRect();
    const left = Math.max(viewport?.offsetLeft || 0, conversation?.left || 0) + 8, top = Math.max((viewport?.offsetTop || 0) + 8, header?.bottom || 60) + 8;
    // A drag must visibly cross the chat/sidebar boundary. Only settled floating
    // cards are confined to chat; dropping in the sidebar switches to its dock.
    const moving = gesture?.kind === 'move' && gesture.moved;
    const right = Math.min(root.innerWidth, (viewport?.offsetLeft || 0) + (viewport?.width || root.innerWidth), moving ? root.innerWidth : conversation?.right || root.innerWidth) - 8;
    const bottom = Math.min((viewport?.offsetTop || 0) + (viewport?.height || root.innerHeight) - 8, moving ? root.innerHeight : form.top - 8);
    return { left, top, width: Math.max(0, right - left), height: Math.max(0, bottom - top) };
  }
  function sidebarDrop(point) {
    const inspector = document.getElementById('inspector'), shell = document.getElementById('appShell'), rect = inspector?.getBoundingClientRect();
    const visible = inspector?.classList?.contains('open') || (root.innerWidth > 1120 && !shell?.classList?.contains('right-panel-collapsed'));
    return Boolean(point && visible && rect && point.x >= rect.left && point.x <= rect.right && point.y >= rect.top && point.y <= rect.bottom);
  }
  function layout() {
    if (!nodes) return;
    const shell = document.getElementById('appShell'), inspector = document.getElementById('inspector'), slot = document.getElementById('aresSidebarSlot');
    const docked = !maximized && !settings.floating && Boolean(slot && ((root.innerWidth > 1120 && !shell?.classList?.contains('right-panel-collapsed') && !shell?.classList?.contains('message-maximized')) || inspector?.classList?.contains('open')));
    const destination = maximized ? nodes.stage : docked ? slot : floatingHome;
    if (destination && nodes.panel.parentNode !== destination) destination.appendChild(nodes.panel);
    nodes.panel.classList?.toggle('ares-docked', docked);
    nodes.panel.classList?.toggle('ares-minimized', settings.minimized && !maximized);
    nodes.panel.classList?.toggle('ares-maximized', maximized);
    const dropReady = gesture?.kind === 'move' && gesture.moved && sidebarDrop(gesture.last);
    inspector?.classList?.toggle('ares-drop-target', Boolean(dropReady));
    const rawLabel = dropReady ? 'Release to dock in sidebar' : failed ? failure : loading ? 'Loading Seneschal…' : stage;
    const label = root.SeneschalI18n?.t(rawLabel) || rawLabel;
    if (nodes.status.textContent !== label) {
      if (root.SeneschalI18n?.setText) root.SeneschalI18n.setText(nodes.status, rawLabel);
      else nodes.status.textContent = label;
    }
    const area = bounds(), width = Math.min(clamp(settings.width, 200, 420), area.width);
    const height = settings.minimized && !maximized ? 46 : Math.min(settings.height, area.height);
    const left = area.left + Math.max(0, area.width - width) * settings.x, top = area.top + Math.max(0, area.height - height) * settings.y;
    const obstructed = document.querySelector?.('dialog[open]:not(#aresStage), #permissionDock:not([hidden]), #questionDock:not([hidden]), #modelPickerMenu:not([hidden]), .sidebar.open') || (!docked && !maximized && ((root.innerWidth <= 680 && document.getElementById('composerOptions')?.open) || (root.innerWidth <= 1120 && inspector?.classList?.contains('open') && !gesture?.moved)));
    const visible = enabled && (docked || maximized || (area.width >= 200 && area.height >= (settings.minimized ? 46 : 190))) && !document.hidden && !obstructed;
    nodes.panel.hidden = !visible;
    Object.assign(nodes.panel.style, { width: `${width}px`, height: `${height}px`, left: `${left}px`, top: `${top}px`, right: 'auto', bottom: 'auto' });
    if (maximized && visible && !nodes.stage.open) nodes.stage.showModal?.();
    if ((!maximized || !visible) && nodes.stage.open) nodes.stage.close?.();
    const rect = docked ? nodes.panel.getBoundingClientRect() : { left, top, width, height };
    rendered = { left: rect.left, top: rect.top, width: rect.width, height: rect.height };
    nodes.drag.disabled = maximized; nodes.resize.hidden = docked || maximized || settings.minimized;
    nodes.layoutButton.hidden = maximized; nodes.talk.hidden = !maximized;
    nodes.cameraHome.hidden = !maximized;
    nodes.feedback.hidden = !maximized;
    view?.setVisible(visible && onScreen && (!settings.minimized || maximized));
    view?.resize();
  }
  function refresh() {
    if (!nodes) return;
    nodes.toggle.setAttribute('aria-pressed', String(enabled)); nodes.toggle.title = enabled ? 'Hide Seneschal companion' : 'Show Seneschal companion';
    const toggleState = document.getElementById('aresToggleState'); if (toggleState) toggleState.textContent = enabled ? 'On' : 'Off';
    nodes.enabled.checked = enabled;
    if (nodes.retry) nodes.retry.hidden = !failed;
    nodes.motion.setAttribute('aria-pressed', String(paused)); nodes.motion.textContent = paused ? '▶' : 'Ⅱ'; nodes.motion.setAttribute('aria-label', paused ? 'Resume Seneschal motion' : 'Pause Seneschal motion');
    nodes.minimize.setAttribute('aria-expanded', String(!settings.minimized || maximized)); nodes.minimize.setAttribute('aria-label', settings.minimized && !maximized ? 'Restore Seneschal' : 'Minimize Seneschal'); nodes.minimize.textContent = settings.minimized && !maximized ? '□' : '−';
    nodes.maximize.setAttribute('aria-pressed', String(maximized)); nodes.maximize.setAttribute('aria-label', maximized ? 'Restore Seneschal from full screen' : 'Maximize Seneschal');
    nodes.talk.textContent = stage === 'Idle' ? 'Start Talk' : 'Stop Talk';
    nodes.feedback.textContent = document.getElementById('voiceFeedback')?.textContent || 'Uses your current conversation and voice service.';
    view?.setPaused(paused || Boolean(reduced?.matches));
    nodes.status.textContent = failed ? failure : loading ? 'Loading Seneschal…' : stage;
    view?.setState(stage);
    view?.setCamera?.(settings.yaw, settings.pitch);
    layout();
  }
  async function show(value, loadScene = () => import(`/workspace/ares-scene.js?attempt=${++loadAttempt}`)) {
    enabled = Boolean(value); preference.set(enabled); generation++; const turn = generation;
    root.clearTimeout?.(loadDeadline);
    loading = enabled; failed = false;
    if (!enabled) { gesture = null; orbitGesture = null; maximized = false; closeLayoutMenu(); view?.dispose(); view = null; nodes.host.replaceChildren(); refresh(); return; }
    refresh(); nodes.status.textContent = 'Loading Seneschal…';
    loadDeadline = root.setTimeout?.(() => {
      if (enabled && turn === generation && loading) { generation++; loading = false; failed = true; view?.dispose(); view = null; refresh(); }
    }, 20000);
    try {
      const module = await loadScene(); if (!enabled || turn !== generation) return;
      view?.dispose();
      view = module.createAresView(nodes.host, { level, ready() { if (enabled && turn === generation) { root.clearTimeout?.(loadDeadline); loading = false; refresh(); } }, error() { if (enabled && turn === generation) { root.clearTimeout?.(loadDeadline); loading = false; failed = true; refresh(); } } });
      refresh();
    } catch { if (enabled && turn === generation) { root.clearTimeout?.(loadDeadline); loading = false; failed = true; refresh(); } }
  }
  function setState(value) {
    stage = ['Listening', 'Thinking', 'Speaking', 'Preparing voice', 'Transcribing', 'Ready', 'Mic muted'].includes(value) ? value : 'Idle';
    refresh();
  }
  function setAnalyser(value) { analyser = value || null; sampler = null; }
  function place(rect) {
    const area = bounds(); settings.floating = true;
    settings.width = Math.min(clamp(rect.width, 200, 420), area.width);
    if (!settings.minimized) settings.height = Math.min(clamp(rect.height, 190, 500), Math.max(190, area.height));
    const height = settings.minimized ? 46 : Math.min(settings.height, area.height);
    settings.x = area.width > settings.width ? clamp((rect.left - area.left) / (area.width - settings.width), 0, 1) : 0;
    settings.y = area.height > height ? clamp((rect.top - area.top) / (area.height - height), 0, 1) : 0;
    layout();
  }
  function finishGesture(cancelled) {
    if (!gesture) return;
    const previous = gesture, finalRect = { ...rendered }; gesture = null;
    if (cancelled || !previous.moved) settings = previous.saved;
    else if (previous.kind === 'move' && sidebarDrop(previous.last)) settings.floating = false;
    else place(finalRect);
    try { previous.node.releasePointerCapture?.(previous.id); } catch {}
    layout(); if (!cancelled) saveLayout();
  }
  function adjust(kind, direction, step = 24) {
    const rect = { ...rendered }, x = direction === 'left' ? -step : direction === 'right' ? step : 0, y = direction === 'up' ? -step : direction === 'down' ? step : 0;
    place(kind === 'move' ? { ...rect, left: rect.left + x, top: rect.top + y } : { ...rect, width: rect.width + x, height: rect.height + y }); saveLayout();
  }
  function bindGeometry(node, kind) {
    node.addEventListener('pointerdown', event => {
      if (maximized || event.isPrimary === false || (event.button !== undefined && event.button !== 0)) return;
      event.preventDefault(); closeLayoutMenu();
      const rect = { ...rendered }, saved = { ...settings };
      gesture = { kind, id: event.pointerId, node, x: event.clientX, y: event.clientY, rect, saved };
      try { node.setPointerCapture?.(event.pointerId); } catch { finishGesture(true); }
    });
    node.addEventListener('pointermove', event => {
      if (!gesture || gesture.node !== node || gesture.id !== event.pointerId) return;
      const dx = event.clientX - gesture.x, dy = event.clientY - gesture.y;
      if (!gesture.moved && Math.hypot(dx, dy) < 3) return;
      if (!gesture.moved) {
        gesture.moved = true; place(gesture.rect); gesture.rect = { ...rendered };
        try { node.setPointerCapture?.(event.pointerId); } catch { finishGesture(true); return; }
      }
      const rect = gesture.rect;
      gesture.last = { x: event.clientX, y: event.clientY };
      place(kind === 'move' ? { ...rect, left: rect.left + dx, top: rect.top + dy } : { ...rect, width: rect.width + dx, height: rect.height + dy });
    });
    node.addEventListener('pointerup', event => { if (!event || gesture?.id === event.pointerId) finishGesture(false); });
    node.addEventListener('pointercancel', event => { if (!event || gesture?.id === event.pointerId) finishGesture(true); });
    node.addEventListener('lostpointercapture', event => { if ((!event || gesture?.id === event.pointerId) && !node.hasPointerCapture?.(event?.pointerId)) finishGesture(true); });
    node.addEventListener('keydown', event => {
      if (maximized || !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
      event.preventDefault(); event.stopPropagation(); adjust(kind, event.key.replace('Arrow', '').toLowerCase(), event.shiftKey ? 32 : 12);
    });
  }
  function setCamera(yaw, pitch, persist = false) {
    settings.yaw = ((yaw + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI;
    settings.pitch = clamp(pitch, -1.15, 1.15);
    view?.setCamera?.(settings.yaw, settings.pitch); if (persist) saveLayout();
  }
  function finishOrbit(cancelled) {
    if (!orbitGesture) return;
    const previous = orbitGesture; orbitGesture = null;
    if (cancelled) setCamera(previous.yaw, previous.pitch);
    try { nodes.host.releasePointerCapture?.(previous.id); } catch {}
    if (!cancelled) saveLayout();
  }
  function orbitStep(direction) {
    setCamera(settings.yaw + (direction === 'left' ? -0.26 : direction === 'right' ? 0.26 : 0), settings.pitch + (direction === 'up' ? 0.18 : direction === 'down' ? -0.18 : 0), true);
  }
  function init({ loadScene } = {}) {
    if (initialized) return;
    const ids = { toggle: 'aresToggle', enabled: 'aresEnabled', panel: 'aresCompanion', host: 'aresCanvas', status: 'aresStatus', close: 'aresClose', motion: 'aresMotion', form: 'composerForm', retry: 'aresRetry', drag: 'aresDrag', resize: 'aresResize', minimize: 'aresMinimize', maximize: 'aresMaximize', reset: 'aresReset', stage: 'aresStage', layoutButton: 'aresLayoutButton', layoutPanel: 'aresLayoutPanel', talk: 'aresTalk', feedback: 'aresVoiceFeedback', dock: 'aresDock', cameraReset: 'aresCameraReset', cameraHome: 'aresCameraHome' };
    nodes = Object.fromEntries(Object.entries(ids).map(([key, id]) => [key, document.getElementById(id)]));
    if (Object.values(nodes).some(node => !node)) { nodes = null; return; }
    initialized = true; enabled = preference.get(); settings = readLayout(); floatingHome = nodes.panel.parentNode;
    // Move existing layouts to the new sidebar home once. Explicit visibility,
    // minimization and camera preferences survive; subsequent dragging persists.
    try {
      if (localStorage.getItem('seneschal-ares-dock-layout') !== 'top-v1') {
        settings.floating = false; saveLayout(); localStorage.setItem('seneschal-ares-dock-layout', 'top-v1');
      }
    } catch {}
    function reveal() {
      if (root.innerWidth <= 680) {
        const options = document.getElementById('composerOptions'); if (options) options.open = false;
        const voice = document.getElementById('voiceOptionsPanel'); if (voice?.matches?.(':popover-open')) voice.hidePopover();
      }
      layout(); document.getElementById('aresSidebarSlot')?.scrollIntoView?.({ block: 'nearest' });
    }
    nodes.toggle.addEventListener('click', () => { const next = !enabled; void show(next, loadScene); if (next) reveal(); });
    nodes.enabled.addEventListener('change', () => { void show(nodes.enabled.checked, loadScene); if (nodes.enabled.checked) reveal(); });
    nodes.retry.addEventListener('click', () => { void show(true, loadScene); reveal(); });
    nodes.close.addEventListener('click', () => { void show(false, loadScene); nodes.toggle.focus({ preventScroll: true }); });
    nodes.panel.addEventListener('keydown', event => {
      if (event.key !== 'Escape') return;
      event.stopPropagation(); if (nodes.layoutPanel.matches?.(':popover-open')) return;
      event.preventDefault();
      if (gesture) finishGesture(true);
      else if (orbitGesture) finishOrbit(true);
      else if (maximized) { maximized = false; refresh(); nodes.maximize.focus({ preventScroll: true }); }
      else { void show(false, loadScene); nodes.toggle.focus({ preventScroll: true }); }
    });
    nodes.stage.addEventListener('cancel', event => { event.preventDefault(); maximized = false; refresh(); nodes.maximize.focus({ preventScroll: true }); });
    nodes.stage.addEventListener('keydown', event => {
      if (event.key !== 'Tab') return;
      const controls = [...nodes.stage.querySelectorAll('button:not([disabled]):not([hidden])')].filter(button => button.getClientRects().length);
      const target = event.shiftKey && document.activeElement === controls[0] ? controls.at(-1) : !event.shiftKey && document.activeElement === controls.at(-1) ? controls[0] : null;
      if (target) { event.preventDefault(); target.focus({ preventScroll: true }); }
    });
    nodes.motion.addEventListener('click', () => { paused = !paused; refresh(); });
    nodes.minimize.addEventListener('click', () => { closeLayoutMenu(); settings.minimized = maximized ? true : !settings.minimized; maximized = false; saveLayout(); refresh(); });
    nodes.maximize.addEventListener('click', () => { closeLayoutMenu(); finishGesture(true); maximized = !maximized; refresh(); nodes.maximize.focus({ preventScroll: true }); });
    nodes.reset.addEventListener('click', () => { settings = { ...defaults(), yaw: settings.yaw, pitch: settings.pitch }; closeLayoutMenu(); saveLayout(); refresh(); nodes.drag.focus({ preventScroll: true }); });
    nodes.dock.addEventListener('click', () => {
      closeLayoutMenu(); settings.floating = false; settings.minimized = false;
      if (root.innerWidth <= 1120) document.getElementById('openInspectorButton')?.click?.();
      else if (document.getElementById('appShell')?.classList?.contains('right-panel-collapsed')) document.getElementById('rightPanelToggle')?.click?.();
      saveLayout(); refresh(); nodes.drag.focus({ preventScroll: true });
    });
    nodes.cameraReset.addEventListener('click', () => setCamera(0, 0, true));
    nodes.cameraHome.addEventListener('click', () => setCamera(0, 0, true));
    nodes.talk.addEventListener('click', () => { document.getElementById('talkButton')?.click(); });
    bindGeometry(nodes.drag, 'move'); bindGeometry(nodes.resize, 'resize');
    nodes.host.addEventListener('pointerdown', event => {
      if (event.isPrimary === false || (event.button !== undefined && event.button !== 0)) return;
      event.preventDefault(); orbitGesture = { id: event.pointerId, x: event.clientX, y: event.clientY, yaw: settings.yaw, pitch: settings.pitch };
      try { nodes.host.setPointerCapture?.(event.pointerId); } catch { finishOrbit(true); }
    });
    nodes.host.addEventListener('pointermove', event => { if (orbitGesture?.id === event.pointerId) setCamera(orbitGesture.yaw - (event.clientX - orbitGesture.x) * 0.012, orbitGesture.pitch + (event.clientY - orbitGesture.y) * 0.009); });
    nodes.host.addEventListener('pointerup', event => { if (orbitGesture?.id === event.pointerId) finishOrbit(false); });
    for (const type of ['pointercancel', 'lostpointercapture']) nodes.host.addEventListener(type, event => { if (orbitGesture?.id === event.pointerId) finishOrbit(true); });
    nodes.host.addEventListener('keydown', event => { if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) { event.preventDefault(); event.stopPropagation(); orbitStep(event.key.replace('Arrow', '').toLowerCase()); } });
    for (const button of document.querySelectorAll?.('[data-ares-move]') || []) button.addEventListener('click', () => adjust('move', button.dataset.aresMove));
    for (const button of document.querySelectorAll?.('[data-ares-size]') || []) button.addEventListener('click', () => { const step = Number(button.dataset.aresSize) * 24; place({ ...rendered, width: rendered.width + step, height: rendered.height + step }); saveLayout(); });
    for (const button of document.querySelectorAll?.('[data-ares-orbit]') || []) button.addEventListener('click', () => orbitStep(button.dataset.aresOrbit));
    root.addEventListener('resize', () => { finishGesture(true); finishOrbit(true); layout(); }); root.visualViewport?.addEventListener('resize', layout);
    document.addEventListener('visibilitychange', refresh); reduced?.addEventListener('change', refresh);
    if (root.ResizeObserver) new root.ResizeObserver(layout).observe(nodes.form);
    if (root.IntersectionObserver) new root.IntersectionObserver(entries => {
      onScreen = entries.some(entry => entry.isIntersecting);
      view?.setVisible(onScreen && !nodes.panel.hidden && (!settings.minimized || maximized));
    }).observe(nodes.panel);
    if (root.MutationObserver) {
      const observer = new root.MutationObserver(layout);
      for (const element of document.querySelectorAll('dialog:not(#aresStage), #permissionDock, #questionDock, #modelPickerMenu, #inspector, #composerOptions, #appShell, .sidebar, body')) observer.observe(element, { attributes: true, attributeFilter: ['hidden', 'open', 'class'] });
      const feedback = document.getElementById('voiceFeedback');
      if (feedback) new root.MutationObserver(() => { nodes.feedback.textContent = feedback.textContent; }).observe(feedback, { childList: true, characterData: true, subtree: true });
    }
    root.addEventListener('beforeunload', () => { generation++; root.clearTimeout?.(loadDeadline); view?.dispose(); analyser = null; });
    refresh(); if (enabled) void show(true, loadScene);
  }
  root.SeneschalAres = { init, setState, setAnalyser };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => init(), { once: true }); else init();
})(window);
