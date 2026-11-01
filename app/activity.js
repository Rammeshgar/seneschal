// Shared, dependency-free chart calculations; also exercised directly by tests.
const SeneschalChart = (() => {
  const series = { totalTokens: ['Total tokens', 'tokens'], inputTokens: ['Input tokens', 'tokens'], outputTokens: ['Output tokens', 'tokens'], cacheReadTokens: ['Cache read', 'tokens'], cacheWriteTokens: ['Cache write', 'tokens'], cost: ['Estimated cost', 'USD'], sessionCount: ['Active sessions', 'sessions'] };
  const valid = value => typeof value === 'number' && Number.isFinite(value) && value >= 0;
  const format = (value, key) => !valid(value) ? 'Unavailable' : key === 'cost' ? '$' + value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 6 }) : value.toLocaleString();
  function prepare(days, key = 'totalTokens') {
    key = Object.hasOwn(series, key) ? key : 'totalTokens';
    const rows = (Array.isArray(days) ? days : []).filter(day => day && /^\d{4}-\d{2}-\d{2}$/.test(day.date || '') && Number.isFinite(Date.parse(day.date)) && new Date(day.date).toISOString().slice(0,10) === day.date).slice().sort((a,b) => a.date.localeCompare(b.date));
    const values = rows.map(day => valid(day[key]) ? day[key] : null);
    const peak = values.reduce((max,v) => v === null ? max : Math.max(max,v), 0);
    const stepRaw = (peak || (key === 'cost' ? .04 : 4)) / 4;
    const base = 10 ** Math.floor(Math.log10(stepRaw));
    const niceStep = [1,2,2.5,5,10].map(n => n * base).find(n => n >= stepRaw);
    const step = key === 'cost' ? niceStep : Math.max(1,niceStep);
    const ceiling = step * 4;
    const times = rows.map(row => Date.parse(row.date)), span = times.length ? times.at(-1)-times[0] : 0;
    const x = i => !span ? 430 : 76 + (times[i]-times[0]) / span * 708;
    const nearest = px => rows.reduce((best,_,i) => Math.abs(x(i)-px) < Math.abs(x(best)-px) ? i : best,0);
    const y = value => 210 - value / ceiling * 168;
    const segments = []; let current = [];
    values.forEach((value,i) => { if (i && times[i]-times[i-1] > 86400000 && current.length) { segments.push(current); current = []; } if (value === null) { if (current.length) segments.push(current); current = []; } else current.push([x(i),y(value)]); });
    if (current.length) segments.push(current);
    return { key, rows, values, peak: values.some(v => v !== null) ? peak : null, ceiling, step, x, y, nearest, segments, available: values.some(v => v !== null) };
  }
  return { series, valid, format, prepare };
})();
if (typeof module !== 'undefined' && module.exports) module.exports = SeneschalChart;
(() => {
  'use strict';
  if (typeof document === 'undefined') return;
  const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const count = value => typeof value === 'number' && Number.isFinite(value) ? (window.SeneschalI18n?.number(value) || value.toLocaleString()) : 'Unavailable';
  const cost = value => typeof value === 'number' && Number.isFinite(value) ? '$' + value.toFixed(2) : 'Unavailable';
  const date = value => value && Number.isFinite(new Date(value).getTime()) ? (window.SeneschalI18n?.date(value, { dateStyle: 'medium', timeStyle: 'short' }) || new Date(value).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })) : 'Not recorded';
  const confirm = message => window.confirm(window.SeneschalI18n?.t(message) || message);
  const short = value => (value || '').split('/').filter(Boolean).pop() || value || 'No project';
  const state = { view: 'overview', window: '7d', runtime: null, overview: null, sessions: [], pagination: null, query: '', project: '', status: '', searchMode: 'metadata', detail: null, turns: [], turnPage: null, selectedId: '', currentChat: '', error: '', notice: '', busy: false, paused: false, sequence: 0 };
  state.chartKey = 'totalTokens'; state.chartMode = 'line'; state.chartDate = '';
  state.startup = { enabled: false, loaded: false, draft: null, saving: false, message: '' };
  const remote = () => Boolean(document.querySelector('.remote-host-bar'));
  const historyAvailable = () => ['ready', 'indexing', 'degraded'].includes(state.runtime?.phase);
  function waitingForHost() {
    return empty('Waiting for PC history', 'On your PC, open Activity → Service and enable “Start Activity with Seneschal”. Prepare local history once on the PC if needed. This phone will load the dashboard when the service is available.', '<button type="button" class="secondary-button" data-action="check-host">Check PC status</button>');
  }
  try { state.currentChat = localStorage.getItem('atelier-session') || ''; } catch {}
  const captured = new Map();
  let pausedCapture = null;
  let opener, returnModal = null, refreshTimer, liveTimer, searchTimer, refreshBusy = false, bootPromise, lastReconcile = 0;
  const dialog = document.createElement('dialog');
  dialog.className = 'activity-workspace';
  dialog.setAttribute('aria-labelledby', 'activityTitle');
  dialog.innerHTML = `<div class="activity-shell"><header class="activity-header"><div><div class="modal-kicker">SENESCHAL · LOCAL ACTIVITY</div><h2 id="activityTitle">A record of your work</h2><p>Explore sessions, inspect tools, and understand usage.</p></div><div class="activity-header-actions"><span class="activity-health" role="status"></span><button type="button" class="secondary-button" data-action="refresh">Refresh history</button><button type="button" class="icon-button" data-action="close" aria-label="Close Activity">×</button></div></header><div class="activity-body"><nav class="activity-navigation" aria-label="Activity views"><div role="tablist" aria-label="Activity"><button role="tab" id="activityTab-overview" aria-controls="activityPanel" data-view="overview">Overview</button><button role="tab" id="activityTab-sessions" aria-controls="activityPanel" data-view="sessions">Sessions</button><button role="tab" id="activityTab-usage" aria-controls="activityPanel" data-view="usage">Usage</button><button role="tab" id="activityTab-service" aria-controls="activityPanel" data-view="service">Service</button></div><div class="activity-nav-note"><i></i>Stored on this computer<span>Powered by Agent Trail</span></div></nav><section class="activity-main" id="activityPanel" role="tabpanel" tabindex="0"><div class="activity-feedback" role="alert" hidden></div><div class="activity-notice" role="status" hidden></div><div class="activity-content"></div></section></div><footer class="activity-footer"><span class="activity-freshness">Local history</span><button type="button" class="activity-text-button" data-action="current">Inspect current chat</button></footer></div>`;
  document.body.append(dialog);
  const main = dialog.querySelector('.activity-main');
  const content = dialog.querySelector('.activity-content');
  const health = dialog.querySelector('.activity-health');
  const tabs = [...dialog.querySelectorAll('[data-view]')];
  const chatActivity = document.createElement('details');
  chatActivity.className = 'chat-agent-activity';
  chatActivity.innerHTML = '<summary>Live agent activity</summary><div class="activity-chat-heading"><span>Latest progress for this chat</span><button type="button" class="activity-text-button">Inspect history</button></div><div class="chat-activity-list"></div>';
  document.querySelector('#attachmentStrip')?.after(chatActivity);
  chatActivity.querySelector('button').onclick = event => openSession(state.currentChat, event.currentTarget);
  async function request(route, method = 'GET', controller, body) {
    const headers = { Accept: 'application/json' };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    const response = await fetch('/workspace/activity' + route, { method, headers, signal: controller?.signal, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    let data;
    try { data = await response.json(); } catch { throw Error('The running Seneschal service needs restarting to load Activity.'); }
    if (!response.ok) throw Object.assign(Error(data.error || 'Activity could not load this view.'), { status: response.status });
    return data;
  }
  function feedback() {
    const error = dialog.querySelector('.activity-feedback'); error.hidden = !state.error; error.textContent = state.error;
    const notice = dialog.querySelector('.activity-notice'); notice.hidden = !state.notice; notice.textContent = state.notice;
    dialog.querySelector('[data-action="refresh"]').disabled = state.busy || !['ready', 'indexing', 'degraded'].includes(state.runtime?.phase);
  }
  function renderStatus() {
    const runtime = state.runtime;
    health.dataset.phase = runtime?.phase || 'stopped';
    health.textContent = runtime ? ({ ready: 'History ready', indexing: 'Indexing', starting: 'Starting', installing: 'Preparing', degraded: 'History incomplete', failed: 'Service unavailable', stopping: 'Stopping', stopped: 'Stopped' }[runtime.phase] || runtime.phase) : 'Checking service';
    dialog.querySelector('.activity-freshness').textContent = runtime?.lastSyncAt ? 'Last indexed ' + date(runtime.lastSyncAt) + (runtime.complete ? '' : ' · Coverage may be incomplete') : runtime?.message || 'Local history';
    feedback();
  }
  function empty(title, description, action = '') {
    return `<div class="activity-empty"><span class="activity-empty-mark" aria-hidden="true">◇</span><h3>${escape(title)}</h3><p>${escape(description)}</p>${action}</div>`;
  }
  function metric(label, value, detail = '') {
    return `<article class="activity-metric"><span>${escape(label)}</span><strong>${escape(value)}</strong>${detail ? `<small>${escape(detail)}</small>` : ''}</article>`;
  }
  function period() {
    return `<label class="activity-period">Period<select id="activityPeriod">${[['today','Today'],['7d','Last 7 days'],['30d','Last 30 days'],['all','All history']].map(([value,label]) => `<option value="${value}" ${state.window === value ? 'selected' : ''}>${label}</option>`).join('')}</select></label>`;
  }
  function ranking(rows, property, title) {
    return `<section class="activity-card"><h3>${escape(title)}</h3>${rows?.length ? `<div class="activity-ranking">${rows.map(row => `<div>${property === 'project' ? `<button type="button" class="activity-text-button" data-project="${escape(row[property])}" title="${escape(row[property])}">${escape(short(row[property]))}</button>` : `<span title="${escape(row[property])}">${escape(row[property])}</span>`}<strong>${count(row.totalTokens)}</strong><small>${count(row.sessionCount)} sessions · ${cost(row.cost)} est.</small></div>`).join('')}</div>` : '<p>No ranking records available.</p>'}</section>`;
  }
  function trend(days) {
    const model = SeneschalChart.prepare(days, state.chartKey), { rows, values, x, y } = model;
    if (!rows.length) return '<p>No daily usage records available.</p>';
    let index = rows.findIndex(day => day.date === state.chartDate); if (index < 0) index = rows.length - 1;
    state.chartDate = rows[index].date;
    const tick = value => model.key === 'cost' ? SeneschalChart.format(value,'cost') : value >= 1e6 ? +(value/1e6).toFixed(2) + 'm' : value >= 1000 ? +(value/1000).toFixed(2) + 'k' : +value.toFixed(2);
    const indices = [...new Set(Array.from({length: Math.min(5,rows.length)},(_,i) => Math.round(i * (rows.length - 1) / Math.max(1,Math.min(5,rows.length) - 1))))];
    const grid = Array.from({length:5},(_,i) => { const value = model.step * i; return `<line class="activity-gridline" x1="76" x2="784" y1="${y(value)}" y2="${y(value)}"/><text class="activity-axis" x="64" y="${y(value)+4}" text-anchor="end">${tick(value)}</text>`; }).join('');
    const lines = model.segments.map(segment => `<path class="activity-area" d="M${segment[0][0]},210 L${segment.map(p => p.join(',')).join(' L')} L${segment.at(-1)[0]},210 Z"/><polyline class="activity-line" points="${segment.map(p => p.join(',')).join(' ')}"/>${segment.length === 1 ? `<circle class="activity-dot" cx="${segment[0][0]}" cy="${segment[0][1]}" r="4"/>` : ''}`).join('');
    const bars = values.map((value,i) => value === null ? '' : `<rect class="activity-bar" data-chart-bar="${i}" x="${x(i)-Math.min(24,280/rows.length)}" y="${y(value)}" width="${Math.min(48,560/rows.length)}" height="${Math.max(0,210-y(value))}" rx="3"><title>${escape(rows[i].date)}: ${escape(SeneschalChart.format(value,model.key))}</title></rect>`).join('');
    return `<div class="activity-chart"><div class="activity-chart-toolbar"><div class="activity-series-controls" role="group" aria-label="Chart metric">${Object.entries(SeneschalChart.series).map(([key,[label]]) => `<button type="button" id="chartMetric-${key}" data-chart-key="${key}" aria-pressed="${model.key === key}">${label}</button>`).join('')}</div><div class="activity-chart-modes" role="group" aria-label="Chart style">${['line','bar'].map(mode => `<button type="button" id="chartMode-${mode}" data-chart-mode="${mode}" aria-pressed="${state.chartMode === mode}">${mode === 'line' ? 'Line' : 'Bars'}</button>`).join('')}</div></div><div class="activity-chart-summary"><span><i aria-hidden="true"></i>${SeneschalChart.series[model.key][0]} / day</span><span>Peak <strong>${escape(SeneschalChart.format(model.peak,model.key))}</strong>${!model.available ? ' · No reported values' : ''}</span></div><div class="activity-plot-scroll"><svg class="activity-plot" viewBox="0 0 820 250" role="img" aria-labelledby="activity-plot-title activity-plot-desc"><title id="activity-plot-title">${SeneschalChart.series[model.key][0]} by day</title><desc id="activity-plot-desc">Daily recorded values with a zero baseline. Missing values are gaps. Use the day slider below for exact values.</desc>${grid}<text class="activity-axis-unit" x="76" y="20">${SeneschalChart.series[model.key][1]}</text>${state.chartMode === 'bar' ? bars : lines}${indices.map(i => `<text class="activity-axis" x="${x(i)}" y="238" text-anchor="${i === 0 ? 'start' : i === rows.length-1 ? 'end' : 'middle'}">${escape(rows[i].date.slice(5).replace('-','/'))}</text>`).join('')}<line class="activity-crosshair" x1="${x(index)}" x2="${x(index)}" y1="34" y2="210"/><circle class="activity-selected-dot" cx="${x(index)}" cy="${y(values[index] || 0)}" r="6" ${values[index] === null ? 'hidden' : ''}/><rect class="activity-plot-hit" x="64" y="30" width="732" height="185" fill="transparent"/></svg></div><div class="activity-day-controls"><button type="button" class="secondary-button" id="chartPrevious" data-chart-step="-1" aria-label="Previous chart day" ${index === 0 ? 'disabled' : ''}>←</button><label for="activityChartDay">Inspect day<input type="range" id="activityChartDay" min="0" max="${rows.length-1}" step="1" value="${index}" aria-valuetext="${escape(rows[index].date)}" ${rows.length === 1 ? 'disabled' : ''}/></label><button type="button" class="secondary-button" id="chartNext" data-chart-step="1" aria-label="Next chart day" ${index === rows.length-1 ? 'disabled' : ''}>→</button></div><div class="activity-day-detail" id="activityChartDetail" role="status" aria-live="polite">${dayDetail(rows[index],model.key)}</div><p class="activity-chart-help">Hover or tap the plot to inspect a day. Use the slider or arrow buttons on a keyboard. Gaps mean unavailable, not zero.${model.key === 'sessionCount' ? ' Active sessions are daily counts, not newly started sessions.' : model.key === 'cost' ? ' Local estimates; unpriced usage may be excluded.' : ''}</p><details data-record="daily-values"><summary>Exact daily values · ${count(rows.length)} days</summary><div class="activity-table-scroll"><table><caption>Recorded daily usage</caption><thead><tr><th scope="col">Date</th><th scope="col">Total tokens</th><th scope="col">Input</th><th scope="col">Output</th><th scope="col">Cache read</th><th scope="col">Cache write</th><th scope="col">Active sessions</th><th scope="col">Estimated cost</th></tr></thead><tbody>${rows.map(day => `<tr><td>${escape(day.date)}</td>${['totalTokens','inputTokens','outputTokens','cacheReadTokens','cacheWriteTokens','sessionCount','cost'].map(key => `<td>${escape(SeneschalChart.format(day[key],key))}</td>`).join('')}</tr>`).join('')}</tbody></table></div></details></div>`;
  }
  function dayDetail(day, key) {
    return `<div><span>${escape(day.date)}</span><strong>${escape(SeneschalChart.format(day[key],key))}</strong><small>${SeneschalChart.series[key][0]}</small></div><dl>${[['Input','inputTokens'],['Output','outputTokens'],['Cache read','cacheReadTokens'],['Cost estimate','cost']].map(([label,k]) => `<div><dt>${label}</dt><dd>${escape(SeneschalChart.format(day[k],k))}</dd></div>`).join('')}</dl>`;
  }
  function bindChart() {
    const plot = content.querySelector('.activity-plot'), range = content.querySelector('#activityChartDay'); if (!plot || !range) return;
    const model = SeneschalChart.prepare(state.overview?.daily?.days,state.chartKey);
    const tooltip = document.createElementNS('http://www.w3.org/2000/svg','text'); tooltip.classList.add('activity-point-value'); plot.insertBefore(tooltip,plot.querySelector('.activity-plot-hit'));
    let frame, pending;
    const select = value => {
      const i = Math.max(0,Math.min(model.rows.length-1,Math.round(value))); if (!model.rows[i]) return;
      state.chartDate = model.rows[i].date; range.value = i; range.setAttribute('aria-valuetext',state.chartDate);
      const line = plot.querySelector('.activity-crosshair'), dot = plot.querySelector('.activity-selected-dot');
      line.setAttribute('x1',model.x(i)); line.setAttribute('x2',model.x(i)); dot.setAttribute('cx',model.x(i)); dot.setAttribute('cy',model.y(model.values[i] || 0)); dot.hidden = model.values[i] === null;
      tooltip.setAttribute('x',model.x(i)); tooltip.setAttribute('y',Math.max(28,model.y(model.values[i] || 0)-15)); tooltip.setAttribute('text-anchor',i === 0 ? 'start' : i === model.rows.length-1 ? 'end' : 'middle'); tooltip.textContent = SeneschalChart.format(model.values[i],model.key);
      dot.toggleAttribute('hidden', model.values[i] === null);
      content.querySelector('#chartPrevious').disabled = i === 0; content.querySelector('#chartNext').disabled = i === model.rows.length-1;
      const detail = content.querySelector('#activityChartDetail'); const html = dayDetail(model.rows[i],model.key); if (detail.innerHTML !== html) detail.innerHTML = html;
      plot.querySelectorAll('[data-chart-bar]').forEach(bar => bar.classList.toggle('selected',Number(bar.dataset.chartBar) === i));
    };
    range.oninput = () => select(Number(range.value));
    content.querySelectorAll('[data-chart-step]').forEach(button => button.onclick = () => select(Number(range.value)+Number(button.dataset.chartStep)));
    const point = event => { const box = plot.getBoundingClientRect(); const px = (event.clientX-box.left) * 820 / box.width; if (px < 64 || px > 796) return; pending = model.nearest(px); if (!frame) frame = requestAnimationFrame(() => { frame = 0; if (plot.isConnected) select(pending); }); };
    plot.onpointermove = event => { if (event.pointerType === 'mouse') point(event); };
    plot.onclick = point;
    select(Number(range.value));
  }
  function tokenMix() {
    const totals = state.overview?.totals || {}, keys = [['Input','inputTokens'],['Output','outputTokens'],['Cache read','cacheReadTokens'],['Cache write','cacheWriteTokens']];
    const complete = keys.every(([,key]) => SeneschalChart.valid(totals[key]));
    const sum = keys.reduce((n,[,key]) => n + (SeneschalChart.valid(totals[key]) ? totals[key] : 0),0);
    let offset = 0;
    const arcs = keys.map(([,key],i) => { const share = complete && sum ? totals[key]/sum*100 : 0; const arc = share > 0 ? `<circle class="activity-mix-segment mix-${i}" cx="90" cy="90" r="68" pathLength="100" stroke-dasharray="${share} ${100-share}" stroke-dashoffset="${-offset}"/>` : ''; offset += share; return arc; }).join('');
    return `<section class="activity-card"><h3>Where tokens go</h3><div class="activity-token-mix"><svg viewBox="0 0 180 180" role="img" aria-labelledby="activity-mix-title activity-mix-desc"><title id="activity-mix-title">Recorded token categories</title><desc id="activity-mix-desc">Input, output, cache read and cache write tokens. Exact counts and proportions follow in the legend.</desc><circle class="activity-mix-track" cx="90" cy="90" r="68"/>${arcs}<text x="90" y="85" text-anchor="middle" class="activity-mix-total">${complete ? escape(sum.toLocaleString()) : 'Partial'}</text><text x="90" y="105" text-anchor="middle" class="activity-axis">category tokens</text></svg><div class="activity-mix-legend">${keys.map(([label,key],i) => `<button type="button" id="chartMix-${key}" class="mix-${i}" data-chart-key="${key}"><i aria-hidden="true"></i><span>${label}<small>${complete && sum ? (totals[key]/sum*100).toFixed(1)+'%' : 'Share unavailable'}</small></span><strong>${count(totals[key])}</strong></button>`).join('')}</div></div><p class="activity-caption">${complete ? 'Shares of the four recorded categories.' : 'Category reporting is incomplete; proportions are hidden.'} Reasoning is shown separately to avoid double-counting: ${count(totals.reasoningTokens)}.</p></section>`;
  }
  function flowDiagram() {
    const phase = state.runtime?.phase || 'Checking';
    return `<section class="activity-card activity-flow-card"><div class="activity-card-heading"><h3>From conversation to insight</h3><span>Local history pipeline</span></div><ol class="activity-flow"><li><button type="button" data-view="sessions"><span>01 · SOURCE</span><strong>Recorded chats</strong><small>OpenCode sessions and tool outputs</small><b>Explore history ↗</b></button></li><li><button type="button" data-view="service"><span>02 · LOCAL INDEX</span><strong>History service</strong><small>Agent Trail reads and indexes records</small><b>${escape(phase)} · inspect service ↗</b></button></li><li><button type="button" data-view="usage"><span>03 · INSIGHTS</span><strong>Usage & estimates</strong><small>Daily consumption, projects and models</small><b>Explore usage ↗</b></button></li></ol><p class="activity-caption">Original history is the source; the local index powers these views. Live progress below is captured separately in this window.</p></section>`;
  }
  function sessionMap() {
    const rows = state.sessions.slice(0,5), parents = new Set(rows.map(row => row.parentSessionId).filter(Boolean));
    const roots = rows.filter(row => !row.parentSessionId || !rows.some(parent => parent.id === row.parentSessionId));
    const node = (row,child = false) => `<button type="button" data-session="${escape(row.id)}"><span>${child ? 'WORKER' : row.parentSessionId ? 'PARENT OUTSIDE THIS VIEW' : parents.has(row.id) ? 'PARENT CHAT' : 'CHAT'}</span><strong>${escape(row.title || 'Untitled session')}</strong><small>${count(row.tokens?.totalTokens)} tokens · ${escape(short(row.project))}</small></button>`;
    const seen = new Set();
    const branch = (row,child = false) => { if (seen.has(row.id)) return ''; seen.add(row.id); const children = rows.filter(item => item.parentSessionId === row.id && !seen.has(item.id)); return `<li>${node(row,child)}${children.length ? `<ul>${children.map(item => branch(item,true)).join('')}</ul>` : ''}</li>`; };
    const tree = roots.map(row => branch(row)).join('') + rows.filter(row => !seen.has(row.id)).map(row => branch(row)).join('');
    return `<section class="activity-card"><h3>How recent sessions connect</h3>${rows.length ? `<ul class="activity-session-map">${tree}</ul>` : '<p>No recorded relationships yet.</p>'}<p class="activity-caption">Only the five recently updated records are shown. Lines connect recorded parent and worker sessions; select a node to inspect it.</p></section>`;
  }
  function sessionRows(rows) {
    return `<div class="activity-session-list">${rows.map(row => `<button type="button" class="activity-session-row" data-session="${escape(row.id || row.sessionId)}"><div><strong>${escape(row.title || row.displayTitle || row.name || 'Untitled session')}</strong><span>${escape(short(row.project))} · ${escape(row.model || 'Model not recorded')}${row.parentSessionId ? ' · Worker / child session' : ''}</span>${row.snippet ? `<p>${escape(row.snippet)}</p>` : ''}</div><div class="activity-session-meta"><span class="activity-badge" data-status="${escape(row.status || 'unknown')}">${escape(row.status || 'Historical match')}</span><small>${date(row.updatedAt)}</small>${row.tokens ? `<small>${count(row.tokens.totalTokens)} tokens</small>` : ''}</div><span aria-hidden="true">›</span></button>`).join('')}</div>`;
  }
  function overviewView(usage = false) {
    const data = state.overview, totals = data?.totals;
    if (!totals) return empty('Your work, in perspective', 'Start the local history service to explore recorded sessions and usage.', '<button type="button" class="primary-button" data-action="start">Start local history</button>');
    const pricing = totals.pricingStatus === 'partial' ? 'Partial estimate · some usage is unpriced' : !totals.pricingStatus || totals.pricingStatus === 'unknown' ? 'Pricing coverage unavailable' : 'Local pricing estimate';
    return `<div class="activity-view-heading"><div><h3>${usage ? 'Usage and estimates' : 'Your recent work'}</h3><p>${usage ? 'Recorded consumption from OpenCode sessions.' : 'A local overview of sessions and recorded usage.'}</p></div>${period()}</div><div class="activity-metrics">${metric('Sessions started', count(totals.sessionCount), 'Includes worker sessions')}${metric('Recorded tokens', count(totals.totalTokens), 'Usage recorded in this period')}${metric('Estimated cost', cost(totals.totalCost), pricing)}${metric('Projects', count(totals.projectCount))}</div>${data.warnings?.length ? `<p class="activity-warning">Some summaries could not load. ${escape(data.warnings.join(' '))}</p>` : ''}<section class="activity-card"><div class="activity-card-heading"><h3>Recorded token activity</h3><span>${escape(state.window === 'all' ? 'All indexed days' : state.window === 'today' ? 'Today' : state.window === '7d' ? '7 days' : '30 days')}</span></div>${trend(data.daily?.days)}</section>${usage ? `<section class="activity-card"><h3>Token categories</h3><dl class="activity-token-grid">${[['Input','inputTokens'],['Output','outputTokens'],['Cache read','cacheReadTokens'],['Cache write','cacheWriteTokens'],['Reasoning tokens','reasoningTokens']].map(([label,key]) => `<div><dt>${label}</dt><dd>${count(totals[key])}</dd></div>`).join('')}</dl><p class="activity-caption">${escape(data.costBasis)}</p></section><div class="activity-card-grid">${ranking(data.models?.models, 'name', 'Models · session attribution')}${ranking(data.projects?.projects, 'project', 'Projects · sessions started')}</div><p class="activity-caption">${escape(data.rankingBasis)}</p>` : `<section class="activity-card"><div class="activity-card-heading"><h3>Recently updated sessions</h3><button type="button" class="activity-text-button" data-view="sessions">View all sessions</button></div>${state.sessions.length ? sessionRows(state.sessions.slice(0,5)) : '<p>No indexed sessions yet.</p>'}</section><section class="activity-card"><div class="activity-card-heading"><h3>Live progress in this window</h3><div class="activity-inline-actions"><button type="button" class="activity-text-button" data-action="export-live">Export live events</button><button type="button" class="activity-text-button" data-action="pause">${state.paused ? 'Resume' : 'Pause'} view</button></div></div><div class="activity-live-feed"></div></section>`}`;
  }
  function sessionsView() {
    const page = state.pagination;
    return `<div class="activity-view-heading"><div><h3>Session history</h3><p>Search titles and projects, or find text within recorded conversations.</p></div></div><form class="activity-filters" id="activitySearch"><label>Search<input id="activityQuery" value="${escape(state.query)}" maxlength="240" placeholder="Find a session…" autocomplete="off"></label><label>Search in<select id="activitySearchMode"><option value="metadata" ${state.searchMode === 'metadata' ? 'selected' : ''}>Titles and projects</option><option value="content" ${state.searchMode === 'content' ? 'selected' : ''}>Conversation text</option></select></label><label>Recorded status<select id="activityStatus" ${state.searchMode === 'content' ? 'disabled' : ''}><option value="">All statuses</option>${['active','idle','error','aborted','unknown'].map(value => `<option ${state.status === value ? 'selected' : ''}>${value}</option>`).join('')}</select></label><button type="submit" id="activitySearchSubmit" class="secondary-button">Search</button></form>${state.project ? `<div class="activity-filter-chip">Project: ${escape(state.project)}<button type="button" data-action="clear-project" aria-label="Clear project filter">×</button></div>` : ''}<p class="activity-caption">${state.searchMode === 'content' ? 'Conversation search shows up to 50 matching sessions. Refine the text for more specific results.' : 'Includes ordinary chats and worker sessions. Status is recorded history; it may differ from a currently running task.'}</p>${state.sessions.length ? sessionRows(state.sessions) : empty('No matching sessions', state.query || state.project || state.status ? 'Change your filters or search text.' : state.runtime?.phase === 'indexing' ? 'History is still indexing. Refresh shortly.' : 'Refresh history after running an OpenCode session.')}<div class="activity-pagination"><span>${state.searchMode === 'content' ? count(state.sessions.length) + ' matches' : page ? `${page.offset + (state.sessions.length ? 1 : 0)}–${page.offset + state.sessions.length} of ${count(page.total)}` : ''}</span>${state.searchMode === 'metadata' ? `<div><button type="button" class="secondary-button" data-action="previous" ${!page || page.offset === 0 ? 'disabled' : ''}>Previous</button><button type="button" class="secondary-button" data-action="next" ${!page?.hasMore ? 'disabled' : ''}>Next</button></div>` : ''}</div>`;
  }
  function activityBlock(activity, key) {
    if (activity.type === 'tool_call') return `<details class="activity-tool" data-record="${escape(key)}"><summary><span class="activity-badge" data-status="${escape(activity.status)}">${escape(activity.status)}</span><strong>${escape(activity.displayName || activity.name)}</strong>${typeof activity.durationMs === 'number' ? `<small>${(activity.durationMs / 1000).toFixed(1)} s</small>` : ''}</summary><h5>Arguments</h5><pre>${escape(activity.inputJson)}</pre><h5>Recorded output</h5>${(activity.resultEvents || []).map(result => `<pre>${escape(result.content)}${result.isPartial ? '\n[Partial output]' : ''}</pre>`).join('') || '<p>No output recorded.</p>'}${activity.error ? `<p class="activity-warning">${escape(activity.error)}</p>` : ''}</details>`;
    if (activity.type === 'subagent_link') return `<button type="button" class="secondary-button" data-session="${escape(activity.subagentSessionId)}">Inspect child session</button>`;
    if (activity.type === 'thinking') return activity.isRedacted ? '<p class="activity-caption">Reasoning record is redacted.</p>' : `<details class="activity-tool" data-record="${escape(key)}"><summary>Recorded reasoning summary</summary><div class="activity-message">${escape(activity.content)}</div></details>`;
    return `<details class="activity-tool" data-record="${escape(key)}"><summary>${escape(activity.displayName || activity.name || activity.subtype || activity.type)}</summary><pre>${escape(activity.content || activity.result || activity.inputSummary || '')}</pre></details>`;
  }
  function messageBlock(message) {
    if (!message) return '';
    const html = window.SeneschalMarkdown ? window.SeneschalMarkdown.render(message.content || '') : escape(message.content);
    return `<article class="activity-replay-message ${message.role === 'user' ? 'user' : ''}"><div class="activity-message-label">${escape(message.role === 'user' ? 'You' : message.role === 'assistant' ? 'Seneschal' : message.role)}${message.model ? ` · ${escape(message.model)}` : ''}</div><div class="activity-markdown">${html}</div></article>`;
  }
  function detailView() {
    const session = state.detail;
    if (!session) return empty('Loading session history', 'Retrieving the recorded conversation…');
    return `<div class="activity-view-heading activity-detail-heading"><div><button type="button" class="activity-text-button" data-view="sessions">← Session history</button><h3>${escape(session.title)}</h3><p>${escape(session.cwd || session.project)} · ${escape(session.model || 'Model not recorded')}</p></div>${session.sourceSessionId ? '<button type="button" class="secondary-button" data-action="open-chat">Open chat</button>' : ''}</div><div class="activity-detail-meta"><span class="activity-badge" data-status="${escape(session.status)}">${escape(session.status)}</span><span>${count(session.turns)} turns</span><span>${count(session.toolCalls)} tool calls</span><span>${count(session.tokens?.totalTokens)} tokens</span><span>${cost(session.estimatedCost)} estimated</span>${session.parentSessionId ? `<button class="activity-text-button" data-session="${escape(session.parentSessionId)}">Parent session</button>` : ''}</div>${session.truncated ? '<p class="activity-warning">This record is incomplete or contains a compaction boundary.</p>' : ''}<section class="activity-card activity-live-card"><div class="activity-card-heading"><h3>Latest live progress</h3><span>Captured in this window</span></div><div class="activity-live-feed"></div></section><div class="activity-replay">${state.turns.length ? state.turns.map(turn => `<section class="activity-turn" data-turn="${escape(turn.id)}"><header><span>Turn ${turn.index + 1}</span><time>${date(turn.startedAt)}</time>${turn.isTruncated ? '<span>Incomplete</span>' : ''}</header>${messageBlock(turn.userMessage)}${(turn.assistantMessages || []).map(messageBlock).join('')}<div class="activity-turn-tools">${(turn.activities || []).map((activity,i) => activityBlock(activity, `${turn.id}:${activity.id || i}`)).join('')}</div></section>`).join('') : empty('No turns indexed yet', 'Refresh history to pick up the latest recorded messages.')}</div>${state.turnPage?.hasMore ? '<button type="button" class="secondary-button activity-load-more" data-action="more-turns">Load more turns</button>' : ''}<p class="activity-caption">Historical inspection displays recorded outputs. Last indexed ${date(session.lastSyncAt)}.</p>`;
  }
  function serviceView() {
    if (remote()) return `<div class="activity-view-heading"><div><h3>PC history service</h3><p>${escape(state.runtime?.message || 'Checking the PC…')}</p></div></div>${historyAvailable() ? '<section class="activity-card"><h3>History is available</h3><p>Use Overview, Sessions or Usage to explore the PC history index.</p></section>' : waitingForHost()}<p class="activity-caption">Startup preferences and service controls are managed on your PC. Your private connection does not expose the history service publicly.</p>`;
    const preference = state.startup;
    const checked = preference.draft ?? preference.enabled;
    return serviceRuntimeView() + `<section class="activity-card"><h3>Available from your phone</h3><label class="activity-startup-option" for="activityStartup"><input type="checkbox" id="activityStartup" aria-describedby="activityStartupHelp activityStartupStatus" ${checked ? 'checked' : ''} ${!preference.loaded || preference.saving ? 'disabled' : ''}/><span>Start Activity with Seneschal</span></label><p id="activityStartupHelp" class="activity-caption">Off by default. Applies to future Seneschal host launches, not Windows startup. Uses the installed history runtime only; prepare it once here on the PC if needed. Saving does not start or stop the current service. The PC must stay awake and connected.</p><button type="button" class="secondary-button" data-action="save-startup" ${!preference.loaded || preference.saving ? 'disabled' : ''}>${preference.saving ? 'Saving…' : 'Save startup preference'}</button><p id="activityStartupStatus" role="status" aria-live="polite">${escape(preference.message || (!preference.loaded ? 'Loading startup preference…' : ''))}</p></section>`;
  }
  async function loadStartupPreference() {
    if (remote()) return;
    try { const value = await request('/preferences'); if (typeof value.enabled !== 'boolean') throw Error('Invalid preference'); state.startup.enabled = value.enabled; state.startup.loaded = true; state.startup.message = value.startupError || ''; }
    catch { state.startup.message = 'Startup preference could not load. If Seneschal was just updated, restart its host once, then reopen Service.'; }
  }
  async function saveStartupPreference() {
    if (remote() || !state.startup.loaded || state.startup.saving) return;
    const enabled = state.startup.draft ?? state.startup.enabled;
    state.startup.saving = true; state.startup.message = 'Saving startup preference…'; render(true);
    try {
      const value = await request('/preferences', 'POST', undefined, { enabled });
      if (typeof value.enabled !== 'boolean') throw Error('Invalid preference');
      state.startup.enabled = value.enabled; state.startup.draft = null;
      state.startup.message = value.enabled ? 'Saved. Activity will start with future Seneschal host launches. No Windows startup task was added.' : 'Saved. Automatic Activity startup is off; a running history service was not stopped.';
    } catch (error) { state.startup.message = error.message || 'Startup preference could not be saved.'; }
    finally { state.startup.saving = false; render(true); }
  }
  function serviceRuntimeView() {
    const runtime = state.runtime;
    const active = Boolean(runtime?.owned), preparing = ['installing','starting','stopping'].includes(runtime?.phase);
    return `<div class="activity-view-heading"><div><h3>Local history service</h3><p>Manage the runtime and the derived history index.</p></div></div><section class="activity-card"><div class="activity-service-status"><span class="activity-health" data-phase="${escape(runtime?.phase || 'stopped')}">${escape(runtime?.phase || 'Checking')}</span><p>${escape(runtime?.message || 'Checking local service…')}</p></div><dl class="activity-service-fields"><div><dt>Runtime</dt><dd><bdi dir="ltr" data-no-i18n class="activity-technical">Agent Trail ${escape(runtime?.version || runtime?.testedVersion || '0.1.7')}</bdi></dd></div><div><dt>History source</dt><dd>${runtime?.source ? `<bdi dir="ltr" data-no-i18n class="activity-technical">${escape(runtime.source)}</bdi>` : 'Configured OpenCode database'}</dd></div><div><dt>Local index</dt><dd>${runtime?.index ? `<bdi dir="ltr" data-no-i18n class="activity-technical">${escape(runtime.index)}</bdi>` : 'Created on first start'}</dd></div><div><dt>Last refreshed</dt><dd>${date(runtime?.lastSyncAt)}</dd></div><div><dt>Recorded source sessions</dt><dd>${count(runtime?.sourceSessions)}</dd></div></dl>${runtime?.lastError ? `<p class="activity-warning" dir="auto" data-no-i18n>${escape(runtime.lastError)}</p>` : ''}<div class="activity-service-actions"><button type="button" class="primary-button" data-action="${active ? 'restart' : 'start'}" ${state.busy || preparing ? 'disabled' : ''}>${active ? 'Restart service' : 'Start local history'}</button><button type="button" class="secondary-button" data-action="stop" ${!active || state.busy || preparing ? 'disabled' : ''}>Stop service</button><button type="button" class="secondary-button" data-action="rebuild" ${state.busy || preparing ? 'disabled' : ''}>Rebuild history index</button></div><p class="activity-caption">Rebuilding preserves the previous index as a local backup and reads the original history again.</p></section><section class="activity-card"><h3>Diagnostics and compatibility</h3><p>The tested runtime is Agent Trail 0.1.7. Logs are saved in <code>data/agent-trail.log</code>.</p><p>Session history is read from OpenCode. Other applications are excluded from this Seneschal index.</p><a class="activity-text-button" href="http://localhost:3030/all/dashboard" target="_blank" rel="noopener noreferrer">Open original Agent Trail dashboard ↗</a></section>`;
  }
  function render(preserve = false) {
    const scroll = main.scrollTop;
    const focused = content.contains(document.activeElement) ? document.activeElement : null;
    const focusId = focused?.id;
    const focusAction = focused?.dataset.action;
    const expanded = preserve ? new Set([...content.querySelectorAll('details[open][data-record]')].map(item => item.dataset.record)) : new Set();
    tabs.forEach(tab => { const selected = tab.dataset.view === (state.view === 'detail' ? 'sessions' : state.view); tab.setAttribute('aria-selected', String(selected)); tab.tabIndex = selected ? 0 : -1; });
    main.setAttribute('aria-labelledby', 'activityTab-' + (state.view === 'detail' ? 'sessions' : state.view));
    content.innerHTML = state.view === 'service' ? serviceView() : remote() && !historyAvailable() ? waitingForHost() : state.view === 'sessions' ? sessionsView() : state.view === 'detail' ? detailView() : overviewView(state.view === 'usage');
    if (state.overview?.totals && ['overview','usage'].includes(state.view)) {
      const chartCard = content.querySelector('.activity-chart')?.closest('section');
      if (chartCard) {
        chartCard.querySelector('h3').textContent = 'Activity explorer';
        chartCard.insertAdjacentHTML('afterend', `<div class="activity-card-grid activity-explain-grid">${tokenMix()}${state.view === 'overview' ? sessionMap() : ''}</div>${flowDiagram()}`);
      }
    }
    content.querySelectorAll('details[data-record]').forEach(item => { item.open = expanded.has(item.dataset.record); });
    renderStatus(); renderLive(true); bindChart(); main.scrollTop = preserve ? scroll : 0;
    if (focused) {
      const replacement = focusId ? content.querySelector('#' + CSS.escape(focusId)) : focusAction ? content.querySelector('[data-action="' + CSS.escape(focusAction) + '"]') : null;
      (replacement && !replacement.disabled ? replacement : main).focus({ preventScroll: true });
    }
    const select = content.querySelector('#activityPeriod'); if (select) select.onchange = async () => { state.window = select.value; await load(); };
    const startup = content.querySelector('#activityStartup'); if (startup) startup.onchange = () => { state.startup.draft = startup.checked; };
    const form = content.querySelector('#activitySearch');
    if (form) {
      form.querySelector('#activityQuery').required = state.searchMode === 'content';
      form.querySelector('#activitySearchMode').onchange = event => { form.querySelector('#activityStatus').disabled = event.target.value === 'content'; form.querySelector('#activityQuery').required = event.target.value === 'content'; };
      form.onsubmit = async event => { event.preventDefault(); state.query = form.querySelector('#activityQuery').value.trim(); state.searchMode = form.querySelector('#activitySearchMode').value; state.status = state.searchMode === 'content' ? '' : form.querySelector('#activityStatus').value; if (state.searchMode === 'content') state.project = ''; await loadSessions(0); };
    }
  }
  function liveRows(sessionId = '') {
    return [...(pausedCapture || captured).values()].filter(row => !sessionId || row.sessionId === sessionId).slice(-8).reverse();
  }
  function liveHTML(sessionId = '') {
    const rows = liveRows(sessionId);
    return rows.length ? rows.map(row => `<details class="activity-live-row" data-record="live:${escape(row.key)}"><summary><time>${date(row.time)}</time><strong>${escape(row.label)}</strong></summary><pre>${escape(row.text || 'Progress event recorded.')}</pre></details>`).join('') : '<p class="activity-caption">No live progress captured for this scope in this window.</p>';
  }
  function renderLive(force = false) {
    if (state.paused && force !== true) return;
    const chat = chatActivity.querySelector('.chat-activity-list');
    if (chatActivity.open && !chat.contains(document.activeElement)) updateLive(chat, liveHTML(state.currentChat));
    if (dialog.open) for (const feed of content.querySelectorAll('.activity-live-feed')) if (!feed.contains(document.activeElement)) updateLive(feed, liveHTML(state.view === 'detail' ? state.detail?.sourceSessionId || '__unmapped__' : ''));
  }
  function updateLive(container, html) {
    const expanded = new Set([...container.querySelectorAll('details[open]')].map(item => item.dataset.record));
    if (container.dataset.lastHTML === html) return;
    container.dataset.lastHTML = html; container.innerHTML = html;
    container.querySelectorAll('details').forEach(item => { item.open = expanded.has(item.dataset.record); });
  }
  async function loadSessions(offset = 0) {
    const seq = ++state.sequence; state.error = ''; feedback();
    main.setAttribute('aria-busy', 'true');
    try {
      const query = new URLSearchParams({ q: state.query, limit: '30', offset: String(offset) });
      if (state.status) query.set('status', state.status);
      if (state.project) query.set('project', state.project);
      const textSearch = state.searchMode === 'content' && state.query;
      const result = await request((textSearch ? '/search?' : '/sessions?') + query);
      if (seq !== state.sequence || !dialog.open) return;
      state.sessions = textSearch ? result.results : result.sessions; state.pagination = result.pagination;
      render();
    } catch (error) { if (seq === state.sequence) { state.error = error.message; feedback(); } }
    finally { if (seq === state.sequence) main.setAttribute('aria-busy', 'false'); }
  }
  async function load(preserve = false) {
    if (remote() && !historyAvailable()) { state.error = ''; render(preserve); return; }
    if (state.view === 'sessions') return loadSessions(state.pagination?.offset || 0);
    if (state.view === 'service') { await loadStartupPreference(); render(preserve); return; }
    if (state.view === 'detail') return loadDetail(state.selectedId, preserve);
    const seq = ++state.sequence; state.error = ''; feedback();
    main.setAttribute('aria-busy', 'true');
    try {
      const [overview, recent] = await Promise.all([request('/overview?window=' + state.window), request('/sessions?limit=5')]);
      if (seq !== state.sequence || !dialog.open) return;
      state.overview = overview; state.sessions = recent.sessions; render(preserve);
    } catch (error) { if (seq === state.sequence) { state.error = error.message; feedback(); } }
    finally { if (seq === state.sequence) main.setAttribute('aria-busy', 'false'); }
  }
  async function loadDetail(id, preserve = false) {
    const seq = ++state.sequence; state.error = ''; feedback();
    main.setAttribute('aria-busy', 'true');
    try {
      const wanted = Math.max(20, state.turns.length || 20);
      const endpoint = '/sessions/' + encodeURIComponent(id);
      const [session, turns] = await Promise.all([request(endpoint), request(endpoint + '/turns?limit=' + Math.min(100, wanted))]);
      while (turns.pagination.hasMore && turns.turns.length < wanted) {
        if (seq !== state.sequence || !dialog.open) return;
        const page = await request(endpoint + '/turns?limit=' + Math.min(100, wanted - turns.turns.length) + '&offset=' + (turns.pagination.offset + turns.pagination.limit));
        if (!page.turns.length) break;
        turns.turns.push(...page.turns); turns.pagination = page.pagination;
      }
      if (seq !== state.sequence || !dialog.open) return;
      state.detail = session; state.turns = turns.turns; state.turnPage = turns.pagination; render(preserve);
    } catch (error) { if (seq === state.sequence) { state.error = error.message; feedback(); } }
    finally { if (seq === state.sequence) main.setAttribute('aria-busy', 'false'); }
  }
  async function boot() {
    if (bootPromise) return bootPromise;
    bootPromise = (async () => {
      state.runtime = await request('/status'); renderStatus();
      if (historyAvailable()) return true;
      if (remote()) return false;
      state.runtime = await request('/start', 'POST'); renderStatus();
      return true;
    })().finally(() => { bootPromise = null; });
    return bootPromise;
  }
  async function open(view, button) {
    if (!dialog.open) {
      opener = button || document.activeElement;
      returnModal = document.querySelector('dialog[open]');
      for (const modal of document.querySelectorAll('dialog[open]')) modal.close();
      dialog.showModal();
      state.error = ''; state.notice = ''; state.view = view || state.view;
      render();
      dialog.querySelector('[role="tab"][aria-selected="true"]')?.focus();
      refreshTimer = setInterval(poll, 5000);
    } else if (view) state.view = view;
    try { const available = await boot(); if (dialog.open) { if (available) await load(); else { state.error = ''; render(); } } }
    catch (error) { state.error = error.message; state.runtime = await request('/status').catch(() => state.runtime); render(); }
  }
  async function openSession(sourceId, button) {
    if (!sourceId) return open('sessions', button);
    await open('sessions', button);
    if (!dialog.open || state.view !== 'sessions') return;
    const seq = ++state.sequence;
    try {
      let session;
      try { session = await request('/lookup?key=' + encodeURIComponent(sourceId)); }
      catch (error) { if (error.status !== 404 || document.querySelector('.remote-host-bar')) throw error; await request('/sync', 'POST'); session = await request('/lookup?key=' + encodeURIComponent(sourceId)); }
      if (seq !== state.sequence || !dialog.open) return;
      state.selectedId = session.id; state.detail = session; state.turns = []; state.view = 'detail'; render(); await loadDetail(session.id);
    } catch (error) { if (seq === state.sequence && dialog.open) { state.error = error.status === 404 ? 'This chat has not appeared in history yet. Refresh history after its next recorded turn.' : error.message; feedback(); } }
  }
  async function poll() {
    if (!dialog.open || refreshBusy || document.hidden) return;
    refreshBusy = true;
    try {
      const previous = state.runtime?.phase;
      state.runtime = await request('/status'); renderStatus();
      if (state.view === 'service' && !state.busy && !content.contains(document.activeElement)) render(true);
      if (!['ready', 'indexing', 'degraded'].includes(previous) && historyAvailable() && !state.paused && (!content.contains(document.activeElement) || !state.overview) && !content.querySelector('details[open]') && state.view !== 'service') await load(true);
      if (!state.busy && state.runtime.phase === 'ready' && Date.now() - lastReconcile > 30000) {
        lastReconcile = Date.now();
        if (!document.querySelector('.remote-host-bar')) await request('/sync', 'POST');
        if (!state.paused && !content.contains(document.activeElement) && !content.querySelector('details[open]') && state.view !== 'sessions' && state.view !== 'service') await load(true);
      }
    } catch (error) { state.notice = error.message; feedback(); }
    finally { refreshBusy = false; }
  }
  async function operation(action) {
    if (state.busy) return;
    if (document.querySelector('.remote-host-bar')) {
      if (action === 'check-host') { try { state.error = ''; state.runtime = await request('/status'); if (historyAvailable()) { state.notice = ''; await load(true); } else { state.notice = 'Waiting for the history service on your PC. No service was started from this phone.'; render(true); } } catch (error) { state.error = error.message; feedback(); } return; }
      if (action === 'refresh') { state.notice = 'Showing the latest index available from the PC.'; await load(true); feedback(); }
      else { state.notice = 'Manage the history service on your host PC.'; feedback(); }
      return;
    }
    if (action === 'rebuild' && !confirm('Rebuild the local history index? The previous index will be backed up, and recorded history will be imported again.')) return;
    state.busy = true; state.error = ''; state.notice = action === 'refresh' ? 'Refreshing recorded history…' : 'Updating local history service…'; feedback();
    try {
      const result = await request('/' + (action === 'refresh' ? 'sync' : action), 'POST');
      state.runtime = await request('/status'); state.notice = result.message || state.runtime.message;
      if (action === 'stop') { state.overview = null; state.sessions = []; state.detail = null; state.turns = []; }
      if (dialog.open && action !== 'stop') await load(true);
    } catch (error) { state.error = error.message; state.notice = ''; state.runtime = await request('/status').catch(() => state.runtime); }
    finally { state.busy = false; if (dialog.open) render(state.view !== 'sessions'); }
  }
  function exportLive() {
    const rows = [...captured.values()];
    const url = URL.createObjectURL(new Blob([JSON.stringify({ exportedAt: new Date().toISOString(), scope: 'Events captured in this Seneschal window; not the historical index.', events: rows }, null, 2)], { type: 'application/json' }));
    const link = document.createElement('a'); link.href = url; link.download = 'seneschal-live-activity.json'; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    state.notice = 'Exported ' + count(rows.length) + ' locally captured events. Review before sharing.'; feedback();
  }
  dialog.addEventListener('click', async event => {
    const button = event.target.closest('button'); if (!button || button.disabled) return;
    if (button.dataset.chartKey || button.dataset.chartMode) { const fromMix = button.id.startsWith('chartMix-'); if (button.dataset.chartKey) state.chartKey = button.dataset.chartKey; if (button.dataset.chartMode) state.chartMode = button.dataset.chartMode; render(true); if (fromMix) { content.querySelector('.activity-chart')?.closest('section').scrollIntoView({block:'start'}); content.querySelector('#chartMetric-' + state.chartKey)?.focus({preventScroll:true}); } return; }
    if (button.dataset.view) { state.view = button.dataset.view; state.error = ''; state.notice = ''; state.pagination = null; ++state.sequence; render(); await load(); return; }
    if (button.dataset.project) { state.view = 'sessions'; state.project = button.dataset.project; state.searchMode = 'metadata'; state.query = ''; state.status = ''; render(); await loadSessions(0); return; }
    if (button.dataset.session) { state.selectedId = button.dataset.session; state.detail = null; state.turns = []; state.view = 'detail'; render(); await loadDetail(state.selectedId); return; }
    const action = button.dataset.action;
    if (action === 'close') dialog.close();
    else if (action === 'current') await openSession(state.currentChat, button);
    else if (action === 'save-startup') await saveStartupPreference();
    else if (['start','stop','restart','rebuild','refresh','check-host'].includes(action)) await operation(action);
    else if (action === 'pause') { state.paused = !state.paused; pausedCapture = state.paused ? new Map(captured) : null; render(true); renderLive(true); }
    else if (action === 'export-live') exportLive();
    else if (action === 'previous' || action === 'next') await loadSessions(Math.max(0, (state.pagination?.offset || 0) + (action === 'next' ? 30 : -30)));
    else if (action === 'clear-project') { state.project = ''; await loadSessions(0); }
    else if (action === 'open-chat') { const session = state.detail; returnModal = null; dialog.close(); window.dispatchEvent(new CustomEvent('seneschal-open-history-session', { detail: { id: session.sourceSessionId, directory: session.cwd } })); }
    else if (action === 'more-turns') {
      const id = state.selectedId, seq = state.sequence;
      button.disabled = true;
      try { const result = await request('/sessions/' + encodeURIComponent(id) + '/turns?limit=20&offset=' + state.turns.length); if (state.selectedId === id && state.sequence === seq && dialog.open) { state.turns.push(...result.turns.filter(turn => !state.turns.some(old => old.id === turn.id))); state.turnPage = result.pagination; render(true); } }
      catch (error) { state.error = error.message; feedback(); button.disabled = false; }
    }
  });
  dialog.querySelector('[role="tablist"]').addEventListener('keydown', event => {
    if (!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Home','End'].includes(event.key)) return;
    event.preventDefault(); const index = tabs.indexOf(document.activeElement);
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : (index + (['ArrowRight','ArrowDown'].includes(event.key) ? 1 : -1) + tabs.length) % tabs.length;
    tabs[next].focus(); tabs[next].click();
  });
  dialog.addEventListener('close', () => {
    clearInterval(refreshTimer); ++state.sequence;
    state.error = ''; state.notice = '';
    if (returnModal?.isConnected && !returnModal.open) returnModal.showModal();
    opener?.focus(); returnModal = null;
  });
  chatActivity.addEventListener('toggle', renderLive);
  document.querySelector('#activityRailButton')?.addEventListener('click', event => open('overview', event.currentTarget));
  document.querySelector('#settingsTrailButton')?.addEventListener('click', event => open('overview', event.currentTarget));
  window.addEventListener('seneschal-session-selected', event => { state.currentChat = event.detail || ''; renderLive(); });
  window.addEventListener('seneschal-activity', event => {
    const payload = event.detail || {}, props = payload.properties || {}, part = props.part || {};
    if (!payload.type || /heartbeat|server\.connected/.test(payload.type)) return;
    const sessionId = props.sessionID || part.sessionID || props.info?.sessionID || (payload.type.startsWith('session.') ? props.info?.id : '') || '';
    const partId = part.id || props.partID;
    const key = sessionId + ':' + (partId ? 'part:' + partId : payload.type + ':' + (props.info?.id || props.messageID || props.status?.type || 'progress'));
    const previous = captured.get(key);
    const label = part.type === 'tool' ? `${part.tool || 'Tool'} · ${part.state?.status || 'working'}` : part.type === 'reasoning' ? 'Reported reasoning summary' : previous?.label || payload.type.replaceAll('.', ' · ');
    const text = payload.type === 'message.part.delta' ? (previous?.text || '') + (props.delta || '') : part.text || part.state?.output || part.state?.error || part.state?.title || props.status?.type || '';
    captured.delete(key); captured.set(key, { key, sessionId, label, time: Date.now(), text: String(text).slice(-12000) });
    if (captured.size > 1000) captured.delete(captured.keys().next().value);
    clearTimeout(liveTimer); liveTimer = setTimeout(renderLive, 150);
    if (dialog.open && (props.status?.type === 'idle' || payload.type === 'session.idle')) { clearTimeout(searchTimer); searchTimer = setTimeout(poll, 1000); lastReconcile = 0; }
  });
  window.addEventListener('beforeunload', () => { clearInterval(refreshTimer); clearTimeout(liveTimer); clearTimeout(searchTimer); });
  // Refresh formatted dates and counts locally; language changes never operate
  // the service or reload history. Preserve the current view, focus and scroll.
  window.addEventListener('seneschal:languagechange', () => { if (dialog.open) render(true); });
  window.SeneschalActivity = { open: button => open('overview', button), openSession };
})();
