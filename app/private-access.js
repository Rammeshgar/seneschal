(() => {
  'use strict';
  // A non-modal drawer: hidden controls are inert; Escape/outside selection closes it.
  function setupMobileNavigation(doc, view) {
    const sidebar = doc.querySelector('.sidebar'), home = doc.getElementById('homeButton');
    const head = sidebar?.querySelector('.sidebar-head-controls');
    if (!sidebar || !home || !head) return () => {};
    const toolsButton = doc.getElementById('workspaceToolsButton'), toolsPanel = doc.getElementById('workspaceToolsPanel');
    const originalPopover = toolsPanel?.getAttribute('popover') || 'auto';
    const toolsClose = toolsPanel ? doc.createElement('button') : null;
    if (toolsClose) {
      toolsClose.type = 'button'; toolsClose.className = 'remote-workspace-tools-close';
      toolsClose.textContent = 'Close Workspace tools'; toolsClose.setAttribute('aria-label', 'Close Workspace tools');
      toolsPanel.append(toolsClose);
    }
    const media = view.matchMedia('(max-width: 680px)');
    const toggle = doc.createElement('button');
    toggle.type = 'button'; toggle.className = 'remote-navigation-toggle';
    toggle.textContent = '☰'; toggle.title = 'Projects and sessions';
    home.before(toggle);
    home.setAttribute('aria-label', 'Open workspace home');
    const close = doc.createElement('button');
    close.type = 'button'; close.className = 'remote-sidebar-close';
    close.setAttribute('aria-label', 'Close projects and sessions'); close.textContent = '×';
    head.append(close);
    sidebar.id ||= 'remoteSidebar'; sidebar.setAttribute('aria-label', 'Projects and sessions');
    let isOpen = false;
    function sync() {
      const active = media.matches;
      const open = active && sidebar.classList.contains('open');
      const hadFocus = sidebar.contains(doc.activeElement);
      if (active && !open && toolsPanel?.matches(':popover-open')) toolsPanel.hidePopover();
      if (toolsPanel) {
        const popover = active ? 'manual' : originalPopover;
        if (toolsPanel.getAttribute('popover') !== popover) toolsPanel.setAttribute('popover', popover);
        if (active) toolsPanel.setAttribute('data-remote-persistent', '');
        else toolsPanel.removeAttribute('data-remote-persistent');
      }
      sidebar.inert = active && !open;
      toggle.setAttribute('aria-controls', sidebar.id);
      toggle.setAttribute('aria-expanded', String(open));
      toggle.setAttribute('aria-label', open ? 'Close projects and sessions' : 'Open projects and sessions');
      if (open && !isOpen) close.focus();
      if (!open && isOpen && hadFocus) (active ? toggle : home).focus();
      isOpen = open;
    }
    function setOpen(value) { sidebar.classList.toggle('open', value); sync(); }
    const onToggle = event => {
      if (!media.matches) return;
      event.preventDefault(); event.stopImmediatePropagation();
      doc.getElementById('inspector')?.classList.remove('open');
      setOpen(!sidebar.classList.contains('open'));
    };
    // Allow the app's home handler to clear its selected session and render the dashboard.
    const onHome = () => { if (media.matches) { setOpen(false); doc.getElementById('inspector')?.classList.remove('open'); } };
    const onClose = () => setOpen(false);
    const onToolsClose = () => { toolsPanel.hidePopover(); toolsButton?.focus(); };
    const onClick = event => {
      if (!media.matches || !sidebar.classList.contains('open')) return;
      // Tool dialogs may cover the menu; interacting with them must not dismiss it.
      if (toolsPanel?.contains(event.target) || event.target.closest('dialog')) return;
      if (!sidebar.contains(event.target) && !toggle.contains(event.target)) setOpen(false);
      else {
        const selected = event.target.closest('.session-open-button, .project-item, .rail-link, #newSessionButton, #addProjectButton');
        // Opening the nested popover is not navigation. Keep its ancestor interactive.
        if (selected && selected !== toolsButton) setOpen(false);
      }
    };
    const onKey = event => {
      if (event.key === 'Escape' && media.matches && sidebar.classList.contains('open') && !doc.querySelector('dialog[open]')) {
        event.preventDefault();
        if (toolsPanel?.matches(':popover-open')) onToolsClose();
        else setOpen(false);
      }
    };
    const onMedia = () => { if (!media.matches) sidebar.classList.remove('open'); sync(); };
    home.addEventListener('click', onHome, true); toggle.addEventListener('click', onToggle); close.addEventListener('click', onClose);
    toolsClose?.addEventListener('click', onToolsClose);
    // Tool handlers must run before their ancestor becomes inert.
    doc.addEventListener('click', onClick); doc.addEventListener('keydown', onKey);
    media.addEventListener('change', onMedia);
    const observer = new view.MutationObserver(sync);
    observer.observe(sidebar, { attributes: true, attributeFilter: ['class'] });
    sync();
    return () => {
      observer.disconnect(); media.removeEventListener('change', onMedia);
      toolsClose?.removeEventListener('click', onToolsClose); toolsClose?.remove();
      if (toolsPanel) { toolsPanel.removeAttribute('data-remote-persistent'); toolsPanel.setAttribute('popover', originalPopover); }
      home.removeEventListener('click', onHome, true); toggle.removeEventListener('click', onToggle); close.removeEventListener('click', onClose);
      doc.removeEventListener('click', onClick); doc.removeEventListener('keydown', onKey);
    };
  }
  function setupInspectorNavigation(doc, view) {
    const panel = doc.getElementById('inspector'), trigger = doc.getElementById('openInspectorButton'), close = doc.getElementById('closeInspectorButton');
    if (!panel || !trigger || !close) return () => {};
    const media = view.matchMedia('(max-width: 1120px)');
    let wasOpen = false;
    function sync() {
      const open = media.matches && panel.classList.contains('open');
      const hadFocus = panel.contains(doc.activeElement);
      panel.inert = media.matches && !open;
      trigger.hidden = open;
      trigger.setAttribute('aria-controls', panel.id);
      trigger.setAttribute('aria-expanded', String(open));
      close.setAttribute('aria-label', 'Close agent context');
      if (open && !wasOpen) close.focus({ preventScroll: true });
      if (!open && wasOpen && hadFocus && media.matches) trigger.focus({ preventScroll: true });
      wasOpen = open;
    }
    function setOpen(value) { panel.classList.toggle('open', value); sync(); }
    const onOpen = event => {
      if (!media.matches) return;
      event.preventDefault(); event.stopImmediatePropagation();
      doc.querySelector('.sidebar')?.classList.remove('open');
      setOpen(true);
    };
    const onClose = event => {
      if (!media.matches) return;
      event.preventDefault(); event.stopImmediatePropagation(); setOpen(false);
    };
    const onClick = event => {
      if (media.matches && panel.classList.contains('open') && !panel.contains(event.target) && !trigger.contains(event.target)) setOpen(false);
    };
    const onKey = event => {
      if (event.key === 'Escape' && media.matches && panel.classList.contains('open') && !doc.querySelector('dialog[open]')) { event.preventDefault(); setOpen(false); }
    };
    const onMedia = () => { if (!media.matches) panel.classList.remove('open'); sync(); };
    trigger.addEventListener('click', onOpen, true); close.addEventListener('click', onClose, true);
    doc.addEventListener('click', onClick, true); doc.addEventListener('keydown', onKey);
    media.addEventListener('change', onMedia);
    const observer = new view.MutationObserver(sync);
    observer.observe(panel, { attributes: true, attributeFilter: ['class'] }); sync();
    return () => {
      observer.disconnect(); media.removeEventListener('change', onMedia);
      trigger.removeEventListener('click', onOpen, true); close.removeEventListener('click', onClose, true);
      doc.removeEventListener('click', onClick, true); doc.removeEventListener('keydown', onKey);
    };
  }
  // Export only pure UI setup for the isolated synthetic DOM regression fixture.
  if (typeof module !== 'undefined' && module.exports) { module.exports = { setupMobileNavigation, setupInspectorNavigation }; return; }
  document.body.classList.add('remote-client');
  const cleanupNavigation = setupMobileNavigation(document, window);
  const cleanupInspector = setupInspectorNavigation(document, window);
  const hostOnly = ['classicButton', 'settingsClassicButton', 'settingsEngineButton', 'settingsProvidersButton', 'settingsBudgetButton', 'settingsUpdatesButton', 'settingsBackupsButton', 'backupNowButton', 'settingsDeepSeekButton', 'settingsBonsaiButton', 'settingsLocalModelButton', 'browserWindowButton', 'browserWindowCardButton', 'settingsVsCodeButton', 'settingsBlenderButton', 'approvalSaveButton'];
  function constrain() {
    for (const id of hostOnly) {
      const control = document.getElementById(id);
      if (control) {
        if (!control.disabled) control.disabled = true;
        if (!control.hasAttribute('data-remote-host-only')) { control.setAttribute('data-remote-host-only', ''); control.title = 'Use this control on the host PC.'; }
      }
    }
    for (const link of document.querySelectorAll('a[href]')) {
      let url; try { url = new URL(link.href); } catch { continue; }
      if (['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) && !link.hasAttribute('data-remote-host-only')) {
        link.setAttribute('data-remote-host-only', ''); link.removeAttribute('href'); link.setAttribute('aria-disabled', 'true'); link.title = 'This dashboard is available on the host PC only.';
      }
    }
    for (const control of document.querySelectorAll('.activity-service-actions button, [data-save-instruction], [data-undo-instruction], [data-default-instruction]')) {
      if (!control.disabled) control.disabled = true;
      if (!control.hasAttribute('data-remote-host-only')) { control.setAttribute('data-remote-host-only', ''); control.title = 'Manage this setting on the host PC.'; }
    }
  }
  constrain();
  // UI hints only. The gateway independently denies PC-only requests.
  const observer = new MutationObserver(constrain); observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['disabled', 'href'] });
  let timer;
  const diagnosticsController = new AbortController();
  async function diagnoseLoading() {
    const routes = [['Engine', '/api/global/health'], ['Models', '/api/provider'], ['Sessions', '/api/session'], ['Project mapping', '/workspace/session-projects']];
    const timeout = setTimeout(() => diagnosticsController.abort(), 10000);
    try {
      const results = await Promise.all(routes.map(async ([label, route]) => {
        try {
          const response = await fetch(route, { credentials: 'same-origin', cache: 'no-store', signal: diagnosticsController.signal });
          const status = response.status;
          // Do not read conversation bodies or display account names, titles or credentials.
          if (response.body) await response.body.cancel();
          return response.ok ? '' : `${label} HTTP ${status}`;
        } catch { return `${label} unreachable`; }
      }));
      const failed = results.filter(Boolean);
      if (!failed.length) return;
      const notice = document.createElement('p');
      notice.className = 'remote-load-status'; notice.setAttribute('role', 'status');
      notice.textContent = `PC data could not load: ${failed.join('; ')}. Keep Seneschal open on the PC, then refresh. These are connection errors, not empty history.`;
      document.querySelector('.remote-host-bar')?.after(notice);
      const measure = () => document.documentElement.style.setProperty('--remote-status-height', `${notice.getBoundingClientRect().height}px`);
      measure();
      if (typeof ResizeObserver === 'function') { const sizes = new ResizeObserver(measure); sizes.observe(notice); addEventListener('pagehide', event => { if (!event.persisted) sizes.disconnect(); }); }
    } finally { clearTimeout(timeout); }
  }
  fetch('/remote/status', { credentials: 'same-origin', cache: 'no-store' }).then(async response => {
    if (!response.ok) { location.replace('/remote/pair'); return; }
    const status = await response.json();
    diagnoseLoading().catch(() => {});
    timer = setTimeout(() => location.replace('/remote/pair'), Math.max(0, status.expiresAt - Date.now()));
    const bar = document.querySelector('.remote-host-bar');
    if (bar) bar.title = `This browser expires at ${new Date(status.expiresAt).toLocaleString()}. Files and tools belong to the PC, not this phone.`;
  }).catch(() => { /* A dropped connection must never resubmit a task. */ });
  const heartbeat = setInterval(() => fetch('/remote/status', { cache: 'no-store' }).then(response => {
    if (response.status === 401 || response.status === 403) location.replace('/remote/pair');
  }).catch(() => {}), 30000);
  // A cached Back/Forward return keeps the same controls; only a final exit tears them down.
  addEventListener('pagehide', event => { if (event.persisted) return; clearInterval(heartbeat); clearTimeout(timer); observer.disconnect(); cleanupNavigation(); cleanupInspector(); diagnosticsController.abort(); });
})();
