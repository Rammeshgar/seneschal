/* Seneschal atmosphere host. Art is local; no audio, engine or provider access. */
(function (root) {
  'use strict';
  const catalog = [
    { id: 'orbit', name: 'Orbit Drift', short: 'Orbit', group: 'Essentials', description: 'The original slow geometric composition.', kind: 'css' },
    { id: 'still', name: 'Still composition', short: 'Still', group: 'Essentials', description: 'A quiet workspace without background animation.', kind: 'css' },
    { id: 'citylight', name: 'Citylight', short: 'Citylight', group: 'Seneschal originals', badge: 'RESTORED · LIVING ORIGINAL', description: 'The original jade skyline and copper moon, with a living avenue, rooftop lanterns and rain-lit reflections.', actions: [['traffic', 'Send avenue traffic'], ['lanterns', 'Release rooftop lanterns'], ['cat', 'Greet the rooftop cat'], ['signal', 'Sweep the tower signal'], ['lights', 'Switch city lights'], ['puddles', 'Ripple the avenue puddles']], kind: 'legacy' },
    { id: 'pixel-city', name: 'City Nocturne', short: 'City', group: 'Seneschal originals', description: 'A working night street: passing traffic, a busy kitchen, rooftop company and reflections in the rain.', actions: [['traffic', 'Send street traffic'], ['kitchen', 'Wake the night kitchen'], ['cat', 'Greet the street cat'], ['signal', 'Send the rooftop signal'], ['lights', 'Switch window lights'], ['puddles', 'Ripple the street puddles']], kind: 'legacy' },
    { id: 'lunar-relay', name: 'Lunar Relay', short: 'Lunar', group: 'Seneschal originals', description: 'A working lunar outpost: rovers, service drones and a survey team move beneath the light of Earth.', actions: [['rover', 'Dispatch a lunar rover'], ['drone', 'Launch the service drone'], ['surveyor', 'Call the lunar surveyor'], ['signal', 'Send a relay pulse'], ['lights', 'Switch base lights'], ['dust', 'Stir a lunar dust trail']], kind: 'legacy' },
    { id: 'orbital-foundry', name: 'Orbital Foundry', short: 'Foundry', group: 'Seneschal originals', description: 'A living orbital shipyard, with docking traffic, repair operations and a working habitat ring.', actions: [['cargo', 'Dispatch a cargo shuttle'], ['repair', 'Start a robotic repair'], ['robot', 'Call the maintenance robot'], ['signal', 'Send a dock signal'], ['lights', 'Switch station lights'], ['vent', 'Release a coolant vent']], kind: 'legacy' },
    { id: 'afterlight-city', name: 'Canal City', short: 'Starlight', group: 'Afterlight collection', description: 'A sleepless city, passing trains and a warm rooftop studio.', actions: [['train', 'Send a night train'], ['lantern', 'Release a lantern'], ['cat', 'Say hello to the cat'], ['meteor', 'Make a wish'], ['light', 'Switch studio lights'], ['water', 'Ripple the canal']], kind: 'afterlight' },
    { id: 'afterlight-observatory', name: 'Northstar', short: 'Northstar', group: 'Afterlight collection', description: 'A timber observatory above a glacial lake. The northern sky keeps watch.', actions: [['train', 'Sweep the telescope'], ['lantern', 'Send a firefly flight'], ['cat', 'Wake the fox'], ['meteor', 'Send a falling star'], ['light', 'Switch cabin lights'], ['water', 'Ripple the lake']], kind: 'afterlight' },
    { id: 'afterlight-sleeper', name: 'The Last Sleeper', short: 'Sleeper', group: 'Afterlight collection', description: 'The quietest seat on a night train. Snowy valleys slip past your window.', actions: [['train', 'Pass a lit village'], ['lantern', 'Pour another tea'], ['cat', 'Wake the sleeping cat'], ['meteor', 'A shooting star outside'], ['light', 'Switch reading lamp'], ['water', 'Draw / open curtains']], kind: 'afterlight' },
    { id: 'afterlight-pelagic', name: 'Pelagic Archive', short: 'Pelagic', group: 'Afterlight collection', description: 'A glass research room at the ocean floor. A whale moves through the blue.', actions: [['train', 'Launch the submersible'], ['lantern', 'Release a jellyfish bloom'], ['cat', 'Call the whale'], ['meteor', 'Pulse the sonar'], ['light', 'Switch station lights'], ['water', 'Send a bubble column']], kind: 'afterlight' },
    { id: 'afterlight-sanctuary', name: 'Lantern Sanctuary', short: 'Sanctuary', group: 'Afterlight collection', description: 'A cedar pavilion, a reflecting pool and a thousand quiet mountain steps.', actions: [['train', 'Ring the mountain bell'], ['lantern', 'Release floating lanterns'], ['cat', 'Visit the koi pond'], ['meteor', 'Light the hillside path'], ['light', 'Switch pavilion lights'], ['water', 'Ripple the reflecting pool']], kind: 'afterlight' }
  ];
  const KEY = 'seneschal-atmosphere.v1';
  const sceneDefaults = id => ({ palette: 'auto', weather: ['citylight', 'pixel-city', 'afterlight-city'].includes(id) ? 'rain' : id === 'afterlight-sleeper' ? 'snow' : ['afterlight-pelagic', 'afterlight-sanctuary'].includes(id) ? 'mist' : 'clear', intensity: 55, worldActivity: 60, worldGlow: 60, worldFeature: true });
  const defaults = () => ({ version: 1, quality: 30, strength: 78, conversationStrength: 18, animateConversation: false, paused: false, rotation: false, minutes: 10, shuffle: false, scenes: {} });
  const numeric = (value, fallback, min, max) => Number.isFinite(Number(value)) ? Math.min(max, Math.max(min, Number(value))) : fallback;
  const oneOf = (value, allowed, fallback) => allowed.includes(value) ? value : fallback;
  function normalizeScene(input, id) {
    const p = input && typeof input === 'object' ? input : {}, d = sceneDefaults(id);
    return { palette: oneOf(p.palette, ['auto', 'nocturne', 'ember', 'sakura'], d.palette), weather: oneOf(p.weather, ['clear', 'rain', 'snow', 'mist'], d.weather), intensity: numeric(p.intensity, d.intensity, 0, 100), worldActivity: numeric(p.worldActivity, d.worldActivity, 0, 100), worldGlow: numeric(p.worldGlow, d.worldGlow, 0, 100), worldFeature: typeof p.worldFeature === 'boolean' ? p.worldFeature : true };
  }
  function normalize(input) {
    const p = input && typeof input === 'object' && input.version === 1 ? input : {}, d = defaults(), scenes = {};
    for (const world of catalog.filter(w => w.kind !== 'css')) scenes[world.id] = normalizeScene(p.scenes?.[world.id], world.id);
    return { ...d, quality: oneOf(p.quality, [15, 30, 60], d.quality), strength: numeric(p.strength, d.strength, 0, 100), conversationStrength: numeric(p.conversationStrength, d.conversationStrength, 0, 40), animateConversation: p.animateConversation === true, paused: p.paused === true, rotation: p.rotation === true, minutes: oneOf(p.minutes, [1, 5, 10, 15, 30, 60], d.minutes), shuffle: p.shuffle === true, scenes };
  }
  const exported = { catalog, defaults, normalize, normalizeScene };
  if (typeof module !== 'undefined' && module.exports) module.exports = exported;
  if (!root.document) return;

  function create({ canvas, document: doc = root.document, storage } = {}) {
    if (!canvas) throw Error('Atmosphere canvas is required.');
    if (storage === undefined) { try { storage = root.localStorage; } catch { storage = null; } }
    const html = doc.documentElement, find = id => doc.getElementById(id);
    const gallery = find('atmosphereDialog'), preview = find('atmospherePreview');
    const read = (key, fallback) => { try { return JSON.parse(storage.getItem(key)) ?? fallback; } catch { return fallback; } };
    const save = () => { try { storage.setItem(KEY, JSON.stringify(prefs)); storage.setItem('atelier-motion', JSON.stringify(selected)); } catch { /* Storage restrictions must not break the workspace. */ } };
    let prefs = normalize(read(KEY, null)), selected = 'orbit', legacy = null, afterlight = null;
    let raf = 0, lastFrame = -Infinity, time = 19, previous = 0, destroyed = false, returnFocus = null;
    let rotationTimer = 0, remaining = prefs.minutes * 60, rotationStamp = 0, previewFromGallery = false;
    let renders = 0, lastError = '', transientUntil = 0, initialized = false;
    let showSpots = false, hoveredAction = '', lastAction = '';
    const reduced = root.matchMedia('(prefers-reduced-motion: reduce)');
    const cleanups = [], anchor = doc.createComment('Seneschal atmosphere canvas');
    canvas.before(anchor);
    canvas.width = 960; canvas.height = 540;
    const listen = (target, event, fn, options) => { target.addEventListener(event, fn, options); cleanups.push(() => target.removeEventListener(event, fn, options)); };
    const restoreFocus = () => { const target = returnFocus && (!returnFocus.getClientRects || returnFocus.getClientRects().length) ? returnFocus : find('settingsButton'); target?.focus?.(); };
    const world = () => catalog.find(w => w.id === selected);
    const pixel = () => world().kind !== 'css';
    const isPreview = () => Boolean(preview?.open);
    const conversation = () => html.dataset.sessionActive === 'true' && !isPreview();
    const settings = () => {
      const p = prefs.scenes[selected] || sceneDefaults(selected);
      return { ...p, palette: p.palette === 'auto' ? (html.dataset.theme === 'day' ? 'ember' : 'nocturne') : p.palette, quality: prefs.quality, caption: false, parallax: false, reduced: false };
    };
    const canAnimate = () => !destroyed && !lastError && !doc.hidden && !reduced.matches && !prefs.paused && (!gallery?.open || isPreview()) && (!conversation() || prefs.animateConversation);
    const motionState = () => lastError ? 'error' : reduced.matches ? 'reduced' : prefs.paused ? 'paused' : doc.hidden ? 'hidden' : conversation() && !prefs.animateConversation ? 'quiet' : gallery?.open && !isPreview() ? 'gallery' : selected === 'still' ? 'still' : 'live';
    const canRotate = () => canAnimate() && pixel() && !isPreview() && prefs.rotation;
    const cancel = () => { if (raf) root.cancelAnimationFrame(raf); raf = 0; previous = 0; lastFrame = -Infinity; };
    function fail(error) {
      lastError = String(error?.message || error); cancel(); afterlight?.pause(true);
      updateStatus();
    }
    function draw() {
      try { if (legacy) { legacy.draw(time, settings()); renders++; } else if (afterlight && world().kind === 'afterlight') { afterlight.renderCurrent(); renders++; } }
      catch (error) { fail(error); }
    }
    function frame(now) {
      raf = 0;
      if (!legacy || !canAnimate()) { previous = 0; return; }
      if (now - lastFrame >= 1000 / prefs.quality - .5) {
        if (previous) time += Math.min(.1, (now - previous) / 1000);
        previous = now; lastFrame = now; draw();
      }
      if (canAnimate() && legacy) raf = root.requestAnimationFrame(frame);
    }
    function syncRotation() {
      const eligible = canRotate();
      if (!eligible && rotationTimer) { root.clearInterval(rotationTimer); rotationTimer = 0; rotationStamp = 0; }
      if (eligible && !rotationTimer) {
        rotationStamp = root.performance.now();
        rotationTimer = root.setInterval(() => {
          if (!canRotate()) { syncRotation(); return; }
          const now = root.performance.now(); remaining -= Math.min(2, (now - rotationStamp) / 1000); rotationStamp = now;
          if (remaining <= 0) next();
          updateStatus();
        }, 1000);
      }
    }
    function updateStatus() {
      const state = motionState();
      const labels = {
        error: 'This scene could not load. Choose another scene or reload the workspace.',
        reduced: 'Still frame · system Reduced motion is on. Actions show one frame without starting animation.',
        paused: 'Still frame · motion is manually paused. Select Resume to animate again.',
        hidden: 'Motion paused while this window is hidden.',
        quiet: 'Still frame · quiet conversation mode. Enable Animate during conversations to keep the background moving.',
        gallery: 'Gallery thumbnails are still images. Explore full scene to see the animation.',
        still: 'Still composition · no animation by design.',
        live: pixel() ? `Live animation · up to ${prefs.quality} fps · rendered locally` : world().description
      };
      let label = labels[state];
      if (prefs.rotation && pixel()) label += ` · rotation ${canRotate() ? 'in ' + Math.ceil(remaining / 60) + ' min' : 'paused'}`;
      const status = find('atmosphereStatus'); if (status && status.textContent !== label) status.textContent = label;
      const previewStatus = find('atmospherePreviewStatus');
      const previewLabel = state === 'live' ? `Live animation · ${prefs.quality} fps limit · click a detail or press 1–6 · Esc to return` : labels[state];
      if (previewStatus && previewStatus.textContent !== previewLabel) previewStatus.textContent = previewLabel;
      const comfort = find('atmosphereConversationHint');
      if (comfort) comfort.textContent = prefs.animateConversation ? 'Conversation animation is enabled. Manual pause, hidden windows and system Reduced motion still take priority.' : 'Conversations use a still frame by default. Home and full-scene previews animate unless motion is paused or system Reduced motion is on.';
      const quick = find('atmosphereEnableConversation'); if (quick) quick.hidden = html.dataset.sessionActive !== 'true' || prefs.animateConversation || !pixel();
    }
    function sync() {
      if (destroyed) return;
      const running = canAnimate();
      html.dataset.motionPaused = String(!running);
      html.dataset.atmospherePaused = String(!running);
      html.style.setProperty('--atmosphere-strength', String(prefs.strength / 100));
      html.style.setProperty('--atmosphere-conversation-strength', String(prefs.conversationStrength / 100));
      if (legacy) {
        if (running && !raf) raf = root.requestAnimationFrame(frame);
        if (!running) cancel();
      } else cancel();
      if (afterlight) {
        afterlight.hostPause(!running || world().kind !== 'afterlight');
        afterlight.pause(!running || world().kind !== 'afterlight');
      }
      syncRotation(); updateStatus();
    }
    function select(id, options = {}) {
      if (destroyed) return selected;
      const nextWorld = catalog.find(w => w.id === id) || catalog[0];
      if (initialized && nextWorld.id === selected && !lastError) { updateControls(); sync(); return selected; }
      const changed = nextWorld.id !== selected;
      cancel(); legacy?.dispose(); legacy = null;
      afterlight?.pause(true); afterlight?.hostPause(true);
      selected = nextWorld.id; initialized = true; lastError = ''; transientUntil = 0; hoveredAction = 'changed'; lastAction = ''; hover(null);
      canvas.width = 960; canvas.height = 540;
      html.dataset.motion = selected; html.dataset.atmosphereKind = pixel() ? 'pixel' : 'css';
      if (!pixel()) prefs.rotation = false;
      try {
        if (nextWorld.kind === 'legacy') legacy = selected === 'citylight' ? root.SeneschalCitylight.create(canvas) : root.SeneschalLegacyWorlds.create(selected, canvas);
        if (nextWorld.kind === 'afterlight') {
          if (!afterlight) afterlight = root.SeneschalAfterlight.create(canvas);
          afterlight.select(selected); afterlight.set(settings()); afterlight.renderAt(19);
        }
        draw();
      } catch (error) { fail(error); }
      remaining = prefs.minutes * 60;
      save(); updateControls(); sync();
      if (options.notify !== false && changed) root.dispatchEvent(new root.CustomEvent('seneschal-atmosphere-change', { detail: { id: selected } }));
      return selected;
    }
    function next() {
      const choices = catalog.filter(w => w.kind !== 'css'), current = choices.findIndex(w => w.id === selected);
      const candidates = choices.filter(w => w.id !== selected);
      select(prefs.shuffle ? candidates[Math.floor(Math.random() * candidates.length)].id : choices[(current + 1) % choices.length].id);
    }
    function change(key, value, perScene = false) {
      if (destroyed) return;
      if (perScene) prefs.scenes[selected] = normalizeScene({ ...prefs.scenes[selected], [key]: value }, selected);
      else prefs = normalize({ ...prefs, [key]: value });
      if (key === 'minutes' || key === 'rotation') remaining = prefs.minutes * 60;
      if (afterlight && world().kind === 'afterlight') afterlight.set(settings());
      draw(); save(); updateControls(); sync();
    }
    function effect(action) {
      if (!pixel() || destroyed) return;
      const valid = world().actions.some(item => item[0] === action); if (!valid) return;
      try {
        if (legacy) legacy.effect(action, time);
        else { afterlight.effect(action); }
        transientUntil = time + 5;
        // In reduced-motion/manual pause, show the result without starting a loop.
        if (!canAnimate()) { if (legacy) time += .8; draw(); }
        else if (legacy) draw();
        lastAction = action;
        const feedback = find('atmosphereActionFeedback');
        if (feedback) feedback.textContent = `${world().actions.find(item => item[0] === action)[1]}${canAnimate() ? ' · triggered' : ' · still-frame result; motion remains paused'}`;
      } catch (error) { fail(error); }
    }
    function hotspots() {
      const items = legacy?.hotspots?.() || (world().kind === 'afterlight' ? afterlight?.hotspots?.() : []) || [];
      return items.filter(spot => world().actions?.some(item => item[0] === spot.action) && [spot.x, spot.y, spot.w, spot.h].every(Number.isFinite) && spot.w > 0 && spot.h > 0).map(spot => ({ ...spot }));
    }
    function hitTest(x, y) {
      if (legacy?.hitTest) return legacy.hitTest(x, y);
      return hotspots().find(spot => x >= spot.x && x <= spot.x + spot.w && y >= spot.y && y <= spot.y + spot.h) || null;
    }
    function hover(spot) {
      const action = spot?.action || ''; if (hoveredAction === action) return; hoveredAction = action;
      const label = find('atmosphereHoverLabel');
      if (label) label.textContent = spot ? `${world().actions.find(item => item[0] === action)?.[1] || spot.label} · click or use the matching number` : 'Explore the details, or use the six action buttons below.';
      const stage = find('atmospherePreviewStage'); if (stage) stage.dataset.hot = String(Boolean(spot));
    }
    function resizeHotspots() {
      const stage = find('atmospherePreviewStage'), layer = find('atmosphereHotspots'); if (!stage || !layer || !isPreview()) return;
      const rect = stage.getBoundingClientRect(), scale = Math.min(rect.width / 960, rect.height / 540);
      layer.style.width = `${960 * scale}px`; layer.style.height = `${540 * scale}px`;
      layer.style.left = `${(rect.width - 960 * scale) / 2}px`; layer.style.top = `${(rect.height - 540 * scale) / 2}px`;
    }
    function buildHotspots() {
      const layer = find('atmosphereHotspots'); if (!layer) return; layer.hidden = !showSpots;
      const toggle = find('atmosphereShowHotspots'); if (toggle) toggle.setAttribute('aria-pressed', String(showSpots));
      if (layer.dataset.world === selected) { resizeHotspots(); return; }
      layer.replaceChildren(); layer.dataset.world = selected;
      for (const spot of hotspots()) {
        const index = world().actions.findIndex(item => item[0] === spot.action), label = world().actions[index][1];
        const button = make('button', 'atmosphere-hotspot', String(index + 1)); button.type = 'button'; button.dataset.action = spot.action;
        button.setAttribute('aria-label', `${index + 1}. ${label}`); button.setAttribute('aria-keyshortcuts', String(index + 1)); button.title = label;
        button.style.left = `${spot.x / 960 * 100}%`; button.style.top = `${spot.y / 540 * 100}%`; button.style.width = `${spot.w / 960 * 100}%`; button.style.height = `${spot.h / 540 * 100}%`;
        button.addEventListener('click', event => { event.stopPropagation?.(); effect(spot.action); });
        button.addEventListener('focus', () => hover(spot)); button.addEventListener('pointerenter', () => hover(spot));
        button.addEventListener('blur', () => hover(null)); button.addEventListener('pointerleave', () => hover(null)); layer.append(button);
      }
      resizeHotspots();
    }
    function make(tag, className, text) { const node = doc.createElement(tag); if (className) node.className = className; if (text !== undefined) node.textContent = text; return node; }
    function buildGallery() {
      const host = find('atmosphereGallery'); if (!host) return;
      for (const group of ['Seneschal originals', 'Afterlight collection', 'Essentials']) {
        const section = make('section', 'atmosphere-group'), title = make('h3', '', group), grid = make('div', 'atmosphere-grid');
        section.append(title, grid);
        for (const item of catalog.filter(w => w.group === group)) {
          const button = make('button', 'atmosphere-card'); button.type = 'button'; button.dataset.world = item.id; button.setAttribute('aria-pressed', 'false');
          if (item.kind !== 'css') { const img = make('img'); img.src = `/workspace/assets/wallpapers/${item.id}.png`; img.alt = ''; img.loading = 'lazy'; img.width = 480; img.height = 270; button.append(img); }
          else button.append(make('span', 'atmosphere-symbol', item.id === 'orbit' ? '◇' : '—'));
          const caption = make('span', 'atmosphere-card-caption'); caption.append(make('strong', '', item.name), make('small', '', item.kind === 'css' ? item.description : item.badge || 'PIXEL WORLD')); button.append(caption);
          listen(button, 'click', () => select(item.id)); grid.append(button);
        }
        host.append(section);
      }
    }
    function buildActions(host) {
      if (!host || host.dataset.actionsFor === selected) return; host.replaceChildren(); host.dataset.actionsFor = selected;
      const previewActions = host.id === 'atmospherePreviewActions';
      for (const [index, [key, label]] of (world().actions || []).entries()) {
        const button = make('button', 'secondary-button', label); button.type = 'button';
        button.dataset.action = key;
        if (previewActions) { const shortcut = make('kbd', '', String(index + 1)); shortcut.setAttribute('aria-hidden', 'true'); button.append(shortcut); button.setAttribute('aria-keyshortcuts', String(index + 1)); }
        button.addEventListener('click', () => effect(key)); host.append(button);
      }
    }
    function updateControls() {
      if (!gallery) return;
      gallery.querySelectorAll('[data-world]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.world === selected)));
      find('atmosphereName').textContent = world().name; find('atmosphereDescription').textContent = world().description;
      find('atmospherePreviewName').textContent = world().name;
      find('atmosphereSceneControls').hidden = !pixel(); find('atmospherePreviewButton').disabled = !pixel();
      const scene = prefs.scenes[selected] || sceneDefaults(selected);
      const vacuum = ['lunar-relay', 'orbital-foundry'].includes(selected);
      const weatherGroup = find('atmosphereWeatherControls'); if (weatherGroup) weatherGroup.hidden = vacuum;
      const weatherLabel = find('atmosphereWeatherLabel'); if (weatherLabel) weatherLabel.textContent = selected === 'afterlight-pelagic' ? 'Water movement' : 'Weather';
      const intensityLabel = find('atmosphereIntensityLabel'); if (intensityLabel) intensityLabel.textContent = selected === 'afterlight-pelagic' ? 'Water particles' : 'Weather strength';
      const weather = find('atmosphereWeather');
      if (weather?.options) for (const option of weather.options) option.textContent = (selected === 'afterlight-pelagic' ? { clear: 'Calm', rain: 'Current', snow: 'Drifting particles', mist: 'Suspended haze' } : { clear: 'Clear', rain: 'Rain', snow: 'Snow', mist: 'Mist' })[option.value];
      const source = root.SeneschalAfterlightWorlds?.catalog.find(w => `afterlight-${w.id}` === selected);
      const originalLabels = {
        citylight: ['City life & avenue traffic', 'Window warmth', 'Rooftop life & skyline details'],
        'pixel-city': ['Street life & passing traffic', 'Shop & window warmth', 'Night kitchen & rooftop life'],
        'lunar-relay': ['Rovers, drones & survey activity', 'Habitat & relay lights', 'Surface operations & relay details'],
        'orbital-foundry': ['Docking traffic & machinery', 'Station & work lights', 'Shipyard operations & ring details']
      }[selected];
      for (const [id, text] of [['atmosphereActivityLabel', source?.activity || originalLabels?.[0] || 'World activity'], ['atmosphereGlowLabel', source?.glow || originalLabels?.[1] || 'Ambient glow'], ['atmosphereFeatureLabel', source?.feature || originalLabels?.[2] || 'Signature scene details']]) { const node = find(id); if (node) node.textContent = text; }
      for (const input of gallery.querySelectorAll('[data-pref]')) {
        const key = input.dataset.pref, value = input.dataset.scene === 'true' ? scene[key] : prefs[key];
        if (input.type === 'checkbox') input.checked = Boolean(value); else input.value = String(value);
        const output = find(input.id + 'Value'); if (output) output.value = `${value}${key === 'quality' ? ' fps' : '%'}`;
        if (key === 'rotation' || key === 'minutes' || key === 'shuffle') input.disabled = !pixel();
      }
      const pause = find('atmospherePause'); if (pause) { pause.textContent = prefs.paused ? 'Resume motion' : 'Pause motion'; pause.setAttribute('aria-pressed', String(prefs.paused)); }
      const previewPause = find('atmospherePreviewPause'); if (previewPause) { previewPause.textContent = prefs.paused ? 'Resume' : 'Pause'; previewPause.setAttribute('aria-pressed', String(prefs.paused)); }
      buildActions(find('atmosphereActions')); buildActions(find('atmospherePreviewActions'));
      const feedback = find('atmosphereActionFeedback'); if (feedback && feedback.dataset.world !== selected) { feedback.dataset.world = selected; feedback.textContent = pixel() ? 'Six actions · use the buttons, numbered keys, or scene hotspots.' : ''; }
      buildHotspots();
      updateStatus();
    }
    function open(trigger) {
      if (!gallery || destroyed) return;
      returnFocus = trigger || doc.activeElement;
      const settingsDialog = find('settingsDialog'); if (settingsDialog?.open) { settingsDialog.close(); returnFocus = find('settingsButton'); }
      if (!gallery.open) gallery.showModal();
      updateControls(); sync();
    }
    function openPreview() {
      if (!preview || !pixel()) return;
      previewFromGallery = Boolean(gallery?.open); gallery?.close();
      find('atmospherePreviewStage').append(canvas); preview.showModal();
      if (afterlight && world().kind === 'afterlight') afterlight.showHotspots(false);
      buildHotspots(); resizeHotspots(); draw(); sync();
    }
    buildGallery();
    if (gallery) {
      listen(find('atmosphereClose'), 'click', () => gallery.close());
      listen(gallery, 'close', () => { sync(); if (!preview?.open) restoreFocus(); });
      listen(gallery, 'click', event => { if (event.target === gallery) gallery.close(); });
      listen(find('atmospherePreviewButton'), 'click', openPreview);
      listen(find('atmosphereNext'), 'click', next);
      listen(find('atmospherePause'), 'click', () => change('paused', !prefs.paused));
      const quick = find('atmosphereEnableConversation'); if (quick) listen(quick, 'click', () => change('animateConversation', true));
      listen(find('atmosphereReset'), 'click', () => { if (pixel()) { prefs.scenes[selected] = sceneDefaults(selected); change('quality', prefs.quality); } });
      gallery.querySelectorAll('[data-pref]').forEach(input => listen(input, input.type === 'range' ? 'input' : 'change', () => change(input.dataset.pref, input.type === 'checkbox' ? input.checked : input.type === 'range' || ['quality', 'minutes'].includes(input.dataset.pref) ? Number(input.value) : input.value, input.dataset.scene === 'true')));
    }
    if (preview) {
      listen(find('atmospherePreviewClose'), 'click', () => preview.close());
      listen(find('atmospherePreviewPause'), 'click', () => change('paused', !prefs.paused));
      listen(find('atmospherePreviewNext'), 'click', next);
      const show = find('atmosphereShowHotspots'); if (show) listen(show, 'click', () => { showSpots = !showSpots; buildHotspots(); });
      listen(preview, 'close', () => { hover(null); anchor.after(canvas); if (previewFromGallery) { previewFromGallery = false; gallery.showModal(); find('atmospherePreviewButton').focus(); } else restoreFocus(); sync(); });
      const stage = find('atmospherePreviewStage');
      const point = event => { const rect = stage.getBoundingClientRect(), scale = Math.min(rect.width / 960, rect.height / 540), x = (event.clientX - rect.left - (rect.width - 960 * scale) / 2) / scale, y = (event.clientY - rect.top - (rect.height - 540 * scale) / 2) / scale; return x >= 0 && x <= 960 && y >= 0 && y <= 540 ? { x, y } : null; };
      listen(stage, 'pointermove', event => { const p = point(event); hover(p ? hitTest(p.x, p.y) : null); if (p && world().kind === 'afterlight') afterlight.pointer(p.x, p.y); });
      listen(stage, 'pointerleave', () => hover(null));
      listen(stage, 'click', event => { const p = point(event); if (!p) return; if (world().kind === 'afterlight') { afterlight.pointer(p.x, p.y, true); if (!canAnimate()) draw(); } else { const spot = hitTest(p.x, p.y); if (spot) effect(spot.action); } });
      listen(preview, 'keydown', event => {
        if (!isPreview() || event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey || event.repeat || !/^[1-6]$/.test(event.key)) return;
        const target = event.target || doc.activeElement;
        if (target?.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target?.tagName)) return;
        const action = world().actions?.[Number(event.key) - 1]; if (!action) return;
        event.preventDefault?.(); effect(action[0]);
      });
      listen(root, 'resize', resizeHotspots);
      if (root.ResizeObserver) { const resize = new root.ResizeObserver(resizeHotspots); resize.observe(stage); cleanups.push(() => resize.disconnect()); }
    }
    listen(doc, 'visibilitychange', sync);
    listen(reduced, 'change', sync);
    listen(root, 'pagehide', () => { cancel(); afterlight?.hostPause(true); afterlight?.pause(true); if (rotationTimer) root.clearInterval(rotationTimer); rotationTimer = 0; });
    listen(root, 'pageshow', sync);
    const observer = new root.MutationObserver(records => {
      if (records.some(record => record.attributeName === 'data-theme')) { if (afterlight && world().kind === 'afterlight') afterlight.set(settings()); draw(); }
      sync();
    });
    observer.observe(html, { attributes: true, attributeFilter: ['data-theme', 'data-session-active'] });
    function dispose() {
      if (destroyed) return; destroyed = true; cancel(); if (rotationTimer) root.clearInterval(rotationTimer); rotationTimer = 0;
      observer.disconnect(); cleanups.forEach(fn => fn()); legacy?.dispose(); afterlight?.dispose();
      if (preview?.open) { anchor.after(canvas); preview.close(); } if (gallery?.open) gallery.close(); anchor.remove();
    }
    const saved = read('atelier-motion', 'orbit'); select(saved, { notify: false });
    return { select, open, openPreview, next, change, effect, sync, dispose, catalog, hotspots, preferences: () => JSON.parse(JSON.stringify(prefs)), diagnostics: () => ({ selected, kind: world().kind, motionState: motionState(), legacyRAF: Boolean(raf), rotationTimer: Boolean(rotationTimer), canAnimate: canAnimate(), renders, lastError, transientUntil, hoveredAction, lastAction, hotspots: hotspots().length, afterlight: afterlight?.diagnostics() || null }) };
  }
  root.SeneschalAtmosphere = { ...exported, create, instance: null,
    init() { if (!this.instance) this.instance = create({ canvas: root.document.getElementById('pixelCity') }); return this.instance; },
    select(id) { return this.init().select(id); }, open(trigger) { return this.init().open(trigger); }, sync() { return this.instance?.sync(); }
  };
})(typeof window !== 'undefined' ? window : globalThis);
