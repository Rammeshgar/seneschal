(() => {
  'use strict';
  // A second UI guard; the server and gateway enforce the real boundary.
  if (location.hostname !== '127.0.0.1' || document.querySelector('.remote-host-bar')) return;
  const settings = document.querySelector('#settingsDialog');
  const grid = settings?.querySelector('.settings-grid');
  if (!grid) return;
  const opener = document.createElement('button');
  opener.type = 'button'; opener.className = 'setting-card interactive-setting';
  opener.id = 'settingsPhoneAccessButton';
  opener.innerHTML = '<span>Private phone access</span><strong>Start, stop and pair</strong><small>PC-only controls · no automatic startup</small>';
  grid.prepend(opener);
  const dialog = document.createElement('dialog');
  dialog.className = 'modal phone-access-modal'; dialog.setAttribute('aria-labelledby', 'phoneAccessTitle');
  dialog.innerHTML = `<header class="phone-access-head"><div><span class="phone-access-kicker">SENESCHAL · PC CONTROL</span><h2 id="phoneAccessTitle">Phone access</h2></div><button type="button" class="secondary-button" id="phoneAccessClose" aria-label="Close phone access" autofocus>Close</button></header>
    <div class="phone-access-content">
      <section aria-labelledby="phoneAccessState"><h3 id="phoneAccessState">Checking gateway…</h3><p id="phoneAccessDetail" role="status"></p><p>Closing the Seneschal window does <strong>not</strong> stop the PC host. Your PC must stay awake and connected. Docker is only needed for verification.</p>
        <div class="phone-access-actions"><button type="button" class="primary-button" data-action="start">Start phone access</button><button type="button" class="secondary-button" data-action="pair">Pair a browser</button><button type="button" class="secondary-button phone-access-danger" data-action="stop" aria-describedby="phoneAccessStopHelp">Stop phone access</button></div>
        <p id="phoneAccessStopHelp">Stop revokes every paired browser and unused code. It does not cancel PC tasks, delete history or remove the private Tailscale mapping.</p>
      </section>
      <section id="phoneAccessAddress" hidden><h3>Open on your phone</h3><a id="phoneAccessUrl" target="_blank" rel="noreferrer"></a><p>Keep Tailscale connected on both devices. This control does not create a network mapping.</p></section>
      <section id="phoneAccessPair" hidden><h3>Pair this browser</h3><label for="phoneAccessCode">One-time code · enter only on your phone</label><input id="phoneAccessCode" readonly autocomplete="off" spellcheck="false" aria-describedby="phoneAccessCodeHelp"><p id="phoneAccessCodeHelp">Single use. Expires in 10 minutes. Do not paste or screenshot this code into chat.</p><p>The same paired browser can return for 12 hours without another code, unless disconnected, revoked or its cookie is cleared. Restarting the gateway alone does not revoke it.</p></section>
      <section><div class="phone-access-section-head"><h3>Paired browsers</h3><button type="button" class="secondary-button" id="phoneAccessRefresh">Refresh</button></div><ul id="phoneAccessDevices"></ul></section>
      <p id="phoneAccessFeedback" role="status" aria-live="polite" aria-atomic="true"></p>
    </div>`;
  document.body.append(dialog);
  const $ = selector => dialog.querySelector(selector);
  let snapshot = null, pending = false, epoch = 0, poll = null, expiry = null;
  let statusRequest = null, loading = false;
  function clearCode() {
    clearTimeout(expiry); expiry = null;
    const code = $('#phoneAccessCode'), wasFocused = document.activeElement === code;
    code.value = ''; $('#phoneAccessPair').hidden = true;
    if (wasFocused && dialog.open) $('#phoneAccessClose').focus();
  }
  function buttons() {
    $('[data-action="start"]').disabled = pending || !snapshot?.qualified || snapshot.state !== 'stopped';
    $('[data-action="pair"]').disabled = pending || !snapshot?.qualified || snapshot.state !== 'running' || snapshot.devices.length >= 4;
    $('[data-action="stop"]').disabled = pending || snapshot?.state !== 'running';
    $('#phoneAccessRefresh').disabled = pending || loading;
    dialog.querySelectorAll('[data-revoke]').forEach(button => { button.disabled = pending || snapshot?.state !== 'running'; });
    dialog.setAttribute('aria-busy', String(pending || loading));
  }
  async function request(action, input, signal) {
    const mutation = action !== 'status';
    const response = await fetch('/workspace/phone-access/' + action, {
      method: mutation ? 'POST' : 'GET', credentials: 'same-origin', cache: 'no-store', signal,
      headers: { Accept: 'application/json', ...(mutation ? { 'Content-Type': 'application/json' } : {}) },
      ...(mutation ? { body: JSON.stringify(input || {}) } : {})
    });
    if (response.status === 404) throw Error('The running PC host needs the new version loaded. Reopen the browser alone does not restart it; follow the PC activation guide.');
    const data = await response.json(); if (!response.ok) throw Error(data.error || 'Phone access request failed.'); return data;
  }
  function render(value) {
    const focusedRevoke = document.activeElement?.getAttribute('data-revoke');
    snapshot = value;
    $('#phoneAccessState').textContent = ({ running: 'Gateway running', stopped: 'Gateway stopped', unknown: 'Gateway status unknown', blocked: 'Setup needs review', 'needs-setup': 'Private setup needed' })[value.state] || 'Gateway status unknown';
    $('#phoneAccessDetail').textContent = value.message;
    const url = $('#phoneAccessUrl');
    $('#phoneAccessAddress').hidden = !value.url;
    if (value.url) { url.href = value.url; url.textContent = value.url; }
    const devices = $('#phoneAccessDevices'); devices.replaceChildren();
    if (!value.devices.length) { const empty = document.createElement('li'); empty.textContent = value.state === 'running' ? 'No active paired browsers.' : 'Active browsers can be checked when the gateway is running.'; devices.append(empty); }
    for (const device of value.devices) {
      const item = document.createElement('li'), label = document.createElement('span'), revoke = document.createElement('button');
      label.textContent = `${device.label} · expires ${new Date(device.expiresAt).toLocaleString()}`;
      revoke.type = 'button'; revoke.className = 'secondary-button'; revoke.textContent = 'Revoke'; revoke.setAttribute('data-revoke', device.id);
      revoke.setAttribute('aria-label', `Revoke ${device.label}`);
      revoke.onclick = () => { if (confirm(`Revoke ${device.label}? Its active connection will close. PC tasks will continue.`)) perform('revoke', { id: device.id }); };
      item.append(label, revoke); devices.append(item);
      if (focusedRevoke === device.id) revoke.focus();
    }
    if (value.devices.length >= 4) $('#phoneAccessDetail').textContent += ' Four-browser limit reached. Revoke an old browser before pairing another.';
    if (value.state !== 'running') clearCode();
    buttons();
    if (focusedRevoke && !value.devices.some(device => device.id === focusedRevoke)) $('#phoneAccessClose').focus();
  }
  async function refresh() {
    if (!dialog.open || loading || pending) return;
    const opened = epoch; loading = true; statusRequest = new AbortController();
    const controller = statusRequest, timeout = setTimeout(() => controller.abort(), 12000); buttons();
    try { const value = await request('status', undefined, controller.signal); if (dialog.open && epoch === opened) render(value); }
    catch (error) { if (dialog.open && epoch === opened) { snapshot = null; $('#phoneAccessState').textContent = 'Gateway status unknown'; $('#phoneAccessDetail').textContent = error.name === 'AbortError' ? 'Status check timed out. Refresh to check again; no action was retried.' : error.message; clearCode(); } }
    finally { clearTimeout(timeout); if (statusRequest === controller) statusRequest = null; loading = false; buttons(); }
  }
  async function perform(action, input) {
    if (pending) return;
    // Discard a read already in flight so it cannot overwrite a newer action result.
    statusRequest?.abort();
    pending = true; const opened = ++epoch; buttons();
    if (action === 'pair') clearCode();
    const feedback = $('#phoneAccessFeedback'); feedback.textContent = 'Working…'; feedback.setAttribute('role', 'status');
    const controller = new AbortController(), timeout = setTimeout(() => controller.abort(), 15000);
    try {
      const result = await request(action, input, controller.signal);
      if (!dialog.open || epoch !== opened) return;
      if (action === 'pair') {
        clearCode(); $('#phoneAccessCode').value = result.code; $('#phoneAccessPair').hidden = false;
        $('#phoneAccessCode').focus(); $('#phoneAccessCode').select();
        expiry = setTimeout(() => { clearCode(); if (dialog.open) feedback.textContent = 'The displayed code expired. Request a new code on this PC.'; }, result.expiresInMinutes * 60000);
        feedback.textContent = 'New code ready. Any earlier unused code is no longer valid.';
      } else { clearCode(); feedback.textContent = result.message || 'Browser revoked. PC tasks continue.'; }
    } catch (error) {
      if (dialog.open && epoch === opened) { feedback.setAttribute('role', 'alert'); feedback.textContent = error.name === 'AbortError' ? 'Action timed out and may have completed. Refresh the status before trying again; nothing was automatically retried.' : error.message; }
    } finally { clearTimeout(timeout); pending = false; buttons(); if (dialog.open) await refresh(); }
  }
  opener.onclick = () => {
    epoch++; settings.close(); dialog.showModal(); snapshot = null; clearCode(); $('#phoneAccessFeedback').textContent = ''; buttons();
    refresh(); poll = setInterval(refresh, 10000);
  };
  $('#phoneAccessClose').onclick = () => dialog.close();
  dialog.addEventListener('close', () => {
    epoch++; clearInterval(poll); poll = null; statusRequest?.abort(); clearCode();
    if (!settings.open) settings.showModal(); opener.focus();
  });
  $('#phoneAccessRefresh').onclick = refresh;
  dialog.querySelectorAll('[data-action]').forEach(button => { button.onclick = () => {
    const action = button.dataset.action;
    if (action !== 'stop' || confirm('Stop phone access and revoke every paired browser and unused code? PC tasks will continue.')) perform(action);
  }; });
  addEventListener('pagehide', event => { if (!event.persisted) { clearInterval(poll); clearCode(); statusRequest?.abort(); } });
})();
