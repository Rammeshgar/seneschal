(() => {
  'use strict';
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
  document.querySelector('.browser-compose-group').hidden = true;
  document.querySelector('#modelCapability').hidden = true;
  const collapsePrompt = document.querySelector('#composerMinimizeButton');
  collapsePrompt.hidden = false;
  collapsePrompt.textContent = '⌄';
  collapsePrompt.title = 'Collapse prompt for reading';
  collapsePrompt.setAttribute('aria-expanded', 'true');
  collapsePrompt.setAttribute('aria-controls', 'promptInput');
})();
