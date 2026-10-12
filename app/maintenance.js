(() => {
  'use strict';
  const events = []; let selected = '', paused = false;
  const dialog = document.createElement('dialog'); dialog.className = 'modal maintenance-modal';
  dialog.innerHTML = `<div class="modal-kicker">SENESCHAL CONTROL</div><h2 id="maintenanceTitle"></h2><div id="maintenanceBody"></div><div class="modal-actions"><button type="button" class="secondary-button" id="maintenanceClose">Close</button></div>`;
  dialog.setAttribute('aria-labelledby', 'maintenanceTitle'); document.body.append(dialog);
  const body = dialog.querySelector('#maintenanceBody');
  const escape = value => String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  async function request(path, method = 'GET') { const r = await fetch(path, { method, headers: { Accept: 'application/json' } }); if (r.status === 404) throw Error('This running Seneschal service does not support this action yet. Close and reopen Seneschal only; Windows does not need restarting.'); let data; try { data = await r.json(); } catch { throw Error('The service returned an unexpected response. Close and reopen Seneschal only, then retry.'); } if (!r.ok) throw Error(data.error || 'Request failed'); return data; }
  let opener;
  function open(title, button) { opener = button; document.querySelector('#settingsDialog').close(); dialog.querySelector('h2').textContent = title; dialog.showModal(); }
  dialog.querySelector('#maintenanceClose').onclick = () => dialog.close();
  dialog.onclose = () => { if (opener) { document.querySelector('#settingsDialog').showModal(); opener.focus(); } };
  const updates = document.querySelector('#settingsUpdatesButton');
  updates.onclick = () => {
    open('Seneschal and OpenCode updates', updates);
    body.innerHTML = '<section><h3>Seneschal application</h3><button type="button" class="secondary-button" id="checkAppUpdate">Check latest Seneschal release</button><div id="appUpdateResult" role="status"></div></section><hr><section><h3>OpenCode engine</h3><p>Checked separately from Seneschal. Updates stay on the installed major version; existing sessions and configuration are preserved.</p><button type="button" class="secondary-button" id="checkEngineUpdate">Check latest OpenCode release</button><div id="engineUpdateResult" role="status"></div></section>';
    async function checkComponent(engine) {
      const result = body.querySelector(engine ? '#engineUpdateResult' : '#appUpdateResult');
      const checker = body.querySelector(engine ? '#checkEngineUpdate' : '#checkAppUpdate');
      checker.disabled = true; result.textContent = 'Checking installed version and official releases…';
      try {
        const info = await request(engine ? '/workspace/engine-updates/check' : '/workspace/updates/check');
        const allowed = engine ? info.available : info.installable;
        // A disabled action must explain why it cannot run, not resemble an active update.
        result.innerHTML = `<p>Installed: <strong>${escape(info.current)}</strong> · Latest ${engine ? 'compatible engine' : 'app'} release: <strong>${escape(info.version)}</strong></p><p>${info.available ? 'Update available.' : 'No newer compatible release found.'} ${escape(info.message || '')}</p>${engine && info.latest !== info.version ? '<p>A newer major version exists but is not selected automatically.</p>' : ''}<button type="button" class="primary-button" ${allowed ? '' : 'disabled'}>${engine ? 'Update OpenCode engine' : 'Update Seneschal'}</button><p class="component-update-status" role="status"></p>`;
        if (!allowed) result.querySelector('button').textContent = info.available ? 'Update unavailable' : 'No update available';
        result.querySelector('button').onclick = async event => {
          if (!confirm('Stop or finish running agent tasks before updating. Proceed with this update?')) return;
          event.target.disabled = true; checker.disabled = true;
          const status = result.querySelector('.component-update-status'); status.textContent = 'Downloading and installing…';
          try { const updated = await request(engine ? '/workspace/engine-updates/install' : '/workspace/updates/install', 'POST'); status.textContent = updated.message; }
          catch (error) { status.textContent = error.message; event.target.disabled = false; }
          finally { checker.disabled = false; }
        };
      } catch (error) { result.textContent = 'Check failed: ' + error.message; }
      finally { checker.disabled = false; }
    }
    body.querySelector('#checkAppUpdate').onclick = () => checkComponent(false);
    body.querySelector('#checkEngineUpdate').onclick = () => checkComponent(true);
    checkComponent(false); checkComponent(true);
  };
  const activity = document.querySelector('#settingsTrailButton');
  activity.onclick = () => {
    open('Agent activity', activity);
    body.innerHTML = `<p>Live events received since this app window opened. Expand an event for its tool arguments, results, status, or reported reasoning summary. This is not hidden model reasoning.</p><div class="activity-controls"><label>Session <select id="activitySession"><option value="">All sessions</option></select></label><button type="button" class="secondary-button" id="activityPause">Pause view</button><button type="button" class="secondary-button" id="activityExport">Export captured events</button></div><details><summary>Agent Trail — persistent session dashboard</summary><p>Optional third-party local dashboard by camtrik. First launch installs @camtrik/agent-trail 0.1.7 in WSL (requires Node 22+ and internet). It reads local session history and creates its own index. Your records are not uploaded by this integration.</p><button type="button" id="launchTrail" class="primary-button">Install / open Agent Trail</button><p role="status" id="trailStatus"></p><a href="http://localhost:3030" target="_blank" rel="noopener noreferrer">Open dashboard after it starts</a></details><p role="status" id="activityCount"></p><div id="activityEvents" class="activity-events"></div>`;
    const select = body.querySelector('#activitySession'); selected = ''; paused = false;
    select.onchange = () => { selected = select.value; render(); };
    body.querySelector('#activityPause').onclick = event => { paused = !paused; event.target.textContent = paused ? 'Resume view' : 'Pause view'; if (!paused) render(); };
    body.querySelector('#activityExport').onclick = () => { const url = URL.createObjectURL(new Blob([JSON.stringify(events, null, 2)], { type: 'application/json' })); const a = document.createElement('a'); a.href = url; a.download = 'seneschal-activity.json'; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); };
    body.querySelector('#launchTrail').onclick = async event => { event.target.disabled = true; const status = body.querySelector('#trailStatus'); status.textContent = 'Starting Agent Trail; first installation may take a few minutes…'; try { const result = await request('/workspace/agent-trail/start', 'POST'); status.textContent = result.message; } catch (error) { status.textContent = error.message; } finally { event.target.disabled = false; } };
    render();
  };
  function session(event) { const p = event.payload.properties || {}; return p.sessionID || p.part?.sessionID || p.info?.sessionID || (event.payload.type?.startsWith('session.') ? p.info?.id : '') || ''; }
  function render() {
    if (!dialog.open || !body.querySelector('#activityEvents') || paused) return;
    const select = body.querySelector('#activitySession'); const ids = [...new Set(events.map(session).filter(Boolean))];
    for (const id of ids) if (![...select.options].some(o => o.value === id)) { const option = document.createElement('option'); option.value = option.textContent = id; select.append(option); }
    const visible = events.filter(event => !selected || session(event) === selected).slice(-150).reverse();
    body.querySelector('#activityCount').textContent = `${events.length} events captured (latest 150 shown). ${paused ? 'View paused.' : 'Live.'}`;
    const container = body.querySelector('#activityEvents'); const expanded = new Set([...container.querySelectorAll('details[open]')].map(d => d.dataset.id));
    if (container.contains(document.activeElement)) return;
    container.innerHTML = visible.map(event => `<details data-id="${event.id}" ${expanded.has(String(event.id)) ? 'open' : ''}><summary><time>${escape(event.time)}</time> <strong>${escape(event.payload.type || 'event')}</strong> <small>${escape(session(event))}</small></summary><pre>${escape(JSON.stringify(event.payload.properties || event.payload, null, 2))}</pre></details>`).join('') || '<p>No activity yet. Run an agent task to see its events here.</p>';
  }
const tools = document.querySelector('.composer-tools');
  const mic = document.querySelector('#micButton');
  mic.querySelector('span').textContent = 'Voice';
  mic.title = 'Dictate a prompt';
  const voiceGroup = document.createElement('div'); voiceGroup.className = 'composer-voice-group';
  mic.before(voiceGroup); voiceGroup.append(mic);
  const voiceModes = document.createElement('details'); voiceModes.className = 'composer-dropdown';
  voiceModes.innerHTML = '<summary aria-label="Voice options" title="Voice options">▾</summary><div class="composer-option-panel"><p>Conversation mode</p></div>';
  voiceModes.querySelector('div').append(document.querySelector('#talkButton'));
  voiceGroup.append(voiceModes);
  const more = document.createElement('details'); more.className = 'composer-dropdown composer-more';
  more.innerHTML = '<summary>More options</summary><div class="composer-option-panel"></div>';
  for (const label of [...tools.querySelectorAll('.select-wrap')]) more.querySelector('div').append(label);
  tools.append(more);
  document.querySelector('.browser-compose-group').hidden = true;
  document.querySelector('#modelCapability').hidden = true;
  const collapsePrompt = document.querySelector('#composerMinimizeButton');
  collapsePrompt.hidden = false;
  collapsePrompt.textContent = '⌄';
  collapsePrompt.title = 'Collapse prompt for reading';
  collapsePrompt.setAttribute('aria-expanded', 'true');
  collapsePrompt.setAttribute('aria-controls', 'promptInput');
  const chatActivity = document.createElement('details');
  chatActivity.className = 'chat-agent-activity';
  chatActivity.innerHTML = '<summary>Live agent activity</summary><p>Provider-reported progress and tools—not private model reasoning.</p><button type="button" class="secondary-button">Open Agent Trail dashboard</button><div class="chat-activity-list"></div>';
  document.querySelector('#attachmentStrip').after(chatActivity);
  let currentChat = localStorage.getItem('atelier-session') || '';
  const dashboard = document.createElement('dialog');
  dashboard.className = 'modal maintenance-modal trail-dashboard-modal';
  dashboard.setAttribute('aria-label', 'Agent Trail dashboard');
  dashboard.innerHTML = '<h2>Agent Trail dashboard</h2><p role="status"></p><div class="trail-frame-host"></div><div class="modal-actions"><a href="http://localhost:3030/all/dashboard" target="_blank" rel="noopener noreferrer">Open in separate window</a><button type="button" class="secondary-button">Close</button></div>';
  document.body.append(dashboard);
  let dashboardOpener;
  dashboard.querySelector('button').onclick = () => dashboard.close();
  dashboard.onclose = () => { dashboard.querySelector('.trail-frame-host').replaceChildren(); dashboardOpener?.focus(); };
  chatActivity.querySelector('button').onclick = async event => {
    dashboardOpener = event.currentTarget; dashboard.showModal();
    const status = dashboard.querySelector('[role="status"]'); status.textContent = 'Starting local dashboard…';
    try {
      await request('/workspace/agent-trail/start', 'POST');
      if (!dashboard.open) return;
      const frame = document.createElement('iframe'); frame.title = 'Local Agent Trail dashboard'; frame.src = 'http://localhost:3030/all/dashboard'; frame.referrerPolicy = 'no-referrer';
      dashboard.querySelector('.trail-frame-host').replaceChildren(frame);
      status.textContent = 'Read-only local dashboard. If embedding is blocked, use Open in separate window.';
    } catch (error) { status.textContent = error.message; }
  };
  function renderChatActivity() {
    const rows = events.filter(event => currentChat && session(event) === currentChat && !event.payload.type?.includes('heartbeat')).slice(-6).reverse();
    chatActivity.querySelector('.chat-activity-list').innerHTML = rows.map(event => {
      const props = event.payload.properties || {}; const part = props.part || {};
      const label = part.type === 'reasoning' ? 'Reported reasoning summary' : part.type === 'tool' ? 'Tool: ' + (part.tool || 'tool') + ' · ' + (part.state?.status || 'running') : event.payload.type || 'Progress';
      const text = part.text || part.state?.title || props.status?.type || '';
      return '<details><summary>' + escape(event.time + ' · ' + label) + '</summary><p>' + escape(String(text).slice(-1400)) + '</p><pre>' + escape(JSON.stringify(props, null, 2)) + '</pre></details>';
    }).join('') || '<p>No live activity captured for this chat yet. Start a task to see updates.</p>';
  }
  window.addEventListener('seneschal-session-selected', event => { currentChat = event.detail || ''; renderChatActivity(); });
  window.addEventListener('seneschal-activity', () => { setTimeout(renderChatActivity, 0); });
  renderChatActivity();
  let sequence = 0, pending = false;
  window.addEventListener('seneschal-activity', event => { events.push({ id: ++sequence, time: new Date().toLocaleTimeString(), payload: JSON.parse(JSON.stringify(event.detail, (key, value) => typeof value === 'string' && value.length > 16384 ? value.slice(0, 16384) + '\n[Preview truncated; full record is in OpenCode / Agent Trail]' : value)) }); if (events.length > 1000) events.shift(); if (!pending) { pending = true; setTimeout(() => { pending = false; render(); }, 500); } });
})();
