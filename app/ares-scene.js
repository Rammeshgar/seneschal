import * as THREE from './assets/ares/three.module.js';
import { GLTFLoader } from './assets/ares/GLTFLoader.js';

export function fittedCameraDistance(size, aspect, yaw, pitch, fov, points) {
  const vertical = Math.tan(fov * Math.PI / 360), horizontal = vertical * aspect;
  const sy = Math.sin(yaw), cy = Math.cos(yaw), sp = Math.sin(pitch), cp = Math.cos(pitch);
  let safe = 0;
  // Fill the available view, retaining padding around the rotated model's box.
  const corners = points?.length ? points : [-1, 1].flatMap(x => [-1, 1].flatMap(y => [-1, 1].map(z => ({ x: x * size.x / 2, y: y * size.y / 2, z: z * size.z / 2 }))));
  for (const { x, y, z } of corners) {
    const right = cy * x - sy * z, up = -sp * sy * x + cp * y - sp * cy * z;
    const depth = cp * sy * x + sp * y + cp * cy * z;
    safe = Math.max(safe, depth + 1.08 * Math.max(Math.abs(right) / horizontal, Math.abs(up) / vertical));
  }
  return safe;
}

export function companionMouthTargets(state, level, time) {
  const result = { Mouth_Smile: 0, viseme_AA: 0, viseme_EE: 0, viseme_OO: 0, viseme_FV: 0, viseme_MBP: 0, viseme_L: 0, viseme_TH: 0 };
  if (state !== 'Speaking') {
    result.Mouth_Smile = state === 'Idle' || state === 'Ready' ? 0.30 : state === 'Listening' ? 0.18 : 0.08;
    if (['Thinking', 'Preparing voice', 'Transcribing'].includes(state)) result.viseme_OO = 0.12;
    return result;
  }
  const t = Number.isFinite(time) ? time : 0;
  // Negative levels mean browser speech has no analyser. Zero really is silence.
  const raw = Math.max(0, Math.min(1, Number.isFinite(level) ? level : 0));
  // Lift quiet speech visibly, but retain an exactly closed mouth for silence.
  const strength = level < 0 ? 0.65 + 0.30 * Math.abs(Math.sin(t * 6.2)) : Math.min(1, 1.65 * raw ** 0.45);
  // Distinct, smoothly changing shapes instead of averaging every vowel flat.
  const aa = 0.04 + (0.5 + 0.5 * Math.sin(t * 7)) ** 4, ee = 0.04 + (0.5 + 0.5 * Math.sin(t * 9 + 2.1)) ** 4, oo = 0.04 + (0.5 + 0.5 * Math.sin(t * 5 + 4.2)) ** 4;
  const total = aa + ee + oo;
  result.viseme_AA = strength * aa / total; result.viseme_EE = strength * ee / total; result.viseme_OO = strength * oo / total;
  result.viseme_MBP = 1 - strength;
  return result;
}

export function createAresView(host, callbacks) {
  let disposed = false, ready = false, visible = true, paused = false, state = 'Idle', frame = 0, last = 0, elapsed = 0, mixer, model, active, current = '', fittedSize, nextPlayfulAt = 24;
  const fittedPoints = [];
  const control = new AbortController(), scene = new THREE.Scene(), mouths = [], actions = new Map();
  const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, powerPreference: 'low-power' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.25)); renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.0;
  renderer.domElement.setAttribute('aria-hidden', 'true'); host.replaceChildren(renderer.domElement);
  const camera = new THREE.PerspectiveCamera(38, 1, 0.01, 100);
  let yaw = 0, pitch = 0, distance = 4;
  function aimCamera() {
    if (fittedSize) distance = fittedCameraDistance(fittedSize, camera.aspect, yaw, pitch, camera.fov, fittedPoints);
    const horizontal = distance * Math.cos(pitch);
    camera.position.set(horizontal * Math.sin(yaw), distance * Math.sin(pitch), horizontal * Math.cos(yaw)); camera.lookAt(0, 0, 0);
    host.dataset.cameraYaw = yaw.toFixed(3); host.dataset.cameraPitch = pitch.toFixed(3); renderOnce();
  }
  scene.add(new THREE.HemisphereLight(0xffffff, 0x445966, 2.1));
  for (const [color, intensity, x, y, z] of [[0xffffff, 3.2, 3, 5, 4], [0x78ece2, 1.5, -3, 2, 3], [0xffeedc, 1.7, -2, 3, -3]]) {
    const light = new THREE.DirectionalLight(color, intensity); light.position.set(x, y, z); scene.add(light);
  }
  const mouthNames = ['Mouth_Smile', 'viseme_AA', 'viseme_EE', 'viseme_OO', 'viseme_FV', 'viseme_MBP', 'viseme_L', 'viseme_TH'];
  const actionFor = key => actions.get(`Seneschal_${key}`) || actions.get(`EARIS_${key}`);
  function play(key, once = false) {
    const next = actionFor(key) || actionFor('Idle');
    if (!next) return;
    current = key; host.dataset.animationClip = next.getClip().name;
    if (active && active !== next) active.fadeOut(0.2);
    next.reset().setEffectiveWeight(1).setLoop(once ? THREE.LoopOnce : THREE.LoopRepeat, once ? 1 : Infinity);
    next.clampWhenFinished = once; next.fadeIn(0.2).play(); active = next;
    nextPlayfulAt = elapsed + 24;
    if (paused) mixer.update(0.25);
  }
  function pose() {
    if (!ready) return;
    const key = state === 'Speaking' ? 'Speaking' : state === 'Listening' ? 'Listening' : ['Thinking', 'Preparing voice', 'Transcribing'].includes(state) ? 'Thinking' : 'Idle';
    if (current === key || (key === 'Idle' && ['Greeting', 'Playful'].includes(current) && active?.isRunning())) return;
    play(key);
  }
  function mouth(delta) {
    const measured = state === 'Speaking' && !paused ? callbacks.level() : 0;
    const targets = companionMouthTargets(state, measured, elapsed), blend = 1 - Math.exp(-Math.max(0, delta) * 15);
    for (const mesh of mouths) for (const name of mouthNames) {
      const index = mesh.morphTargetDictionary[name]; if (index === undefined) continue;
      mesh.morphTargetInfluences[index] = THREE.MathUtils.lerp(mesh.morphTargetInfluences[index] || 0, targets[name], blend);
    }
  }
  function renderOnce() { if (!disposed && ready && visible) { mouth(1); renderer.render(scene, camera); } }
  function tick(now) {
    frame = 0;
    if (disposed || !ready || !visible || paused) return;
    if (now - last >= 1000 / 30) {
      const delta = Math.min((now - last) / 1000 || 0.033, 0.05); last = now; elapsed += delta;
      if (current === 'Idle' && elapsed >= nextPlayfulAt && actionFor('Playful')) play('Playful', true);
      mixer.update(delta); mouth(delta); renderer.render(scene, camera);
    }
    frame = requestAnimationFrame(tick);
  }
  function syncLoop() {
    cancelAnimationFrame(frame); frame = 0; last = performance.now();
    if (!disposed && ready && visible && !paused) frame = requestAnimationFrame(tick); else renderOnce();
  }
  function resize() {
    if (disposed) return;
    const width = Math.max(1, host.clientWidth), height = Math.max(1, host.clientHeight);
    renderer.setSize(width, height, false); camera.aspect = width / height; camera.updateProjectionMatrix(); renderOnce();
    if (fittedSize) aimCamera();
  }
  function disposeScene() {
    scene.traverse(object => { object.geometry?.dispose(); for (const material of Array.isArray(object.material) ? object.material : object.material ? [object.material] : []) { for (const value of Object.values(material)) if (value?.isTexture) value.dispose(); material.dispose(); } });
  }
  (async () => {
    const response = await fetch('/workspace/assets/ares/ares.glb?v=seneschal-head-v06', { credentials: 'same-origin', cache: 'no-store', signal: control.signal });
    if (!response.ok) throw Error('Mascot asset unavailable');
    const bytes = await response.arrayBuffer();
    if (disposed) return;
    if (bytes.byteLength > 8 * 1024 * 1024) throw Error('Unexpected mascot size');
    const header = new DataView(bytes), length = header.getUint32(12, true);
    if (header.getUint32(0, true) !== 0x46546c67 || length > bytes.byteLength - 20) throw Error('Invalid mascot asset');
    const description = JSON.parse(new TextDecoder().decode(new Uint8Array(bytes, 20, length)));
    if ((description.buffers || []).some(item => item.uri) || (description.images || []).some(item => item.uri) || (description.extensionsUsed || []).includes('KHR_draco_mesh_compression')) throw Error('Mascot requires unsupported external resources');
    let textureFailed = false;
    const manager = new THREE.LoadingManager(); manager.onError = () => { textureFailed = true; };
    const loader = new GLTFLoader(manager).register(parser => {
      // ImageBitmapLoader fetches blob: URLs, which connect-src intentionally
      // forbids. A parser-local image-element loader uses the existing img-src
      // permission instead. No global/vendor patch or CSP relaxation is needed.
      parser.textureLoader = new THREE.TextureLoader(parser.options.manager);
      return { name: 'SeneschalEmbeddedImageElements' };
    });
    const gltf = await loader.parseAsync(bytes, '');
    const texturedMaterials = new Set(); gltf.scene.traverse(object => { for (const material of Array.isArray(object.material) ? object.material : object.material ? [object.material] : []) texturedMaterials.add(material); });
    if (textureFailed || ((description.images || []).length && ![...texturedMaterials].some(material => material.map?.image?.width > 0))) throw Error('Embedded mascot artwork could not be decoded');
    model = gltf.scene; scene.add(model); if (disposed) { disposeScene(); return; }
    model.traverse(object => { if (object.isMesh && object.morphTargetDictionary) mouths.push(object); });
    model.updateMatrixWorld(true); let bounds = new THREE.Box3().setFromObject(model); const size = bounds.getSize(new THREE.Vector3());
    model.scale.multiplyScalar(size.y ? 2.2 / size.y : 1); model.updateMatrixWorld(true);
    bounds = new THREE.Box3().setFromObject(model); const center = bounds.getCenter(new THREE.Vector3()); model.position.sub(center); model.updateMatrixWorld(true);
    bounds = new THREE.Box3().setFromObject(model); const fitted = bounds.getSize(new THREE.Vector3());
    fittedSize = fitted;
    mixer = new THREE.AnimationMixer(model);
    for (const source of gltf.animations) if (source.name !== 'EARIS_Blink') {
      // Audio owns the mouth in the app. Keep authored mouth tracks in the GLB,
      // but do not let the body mixer overwrite live level-driven visemes.
      const clip = source.clone(); clip.tracks = clip.tracks.filter(track => !track.name.endsWith('.morphTargetInfluences'));
      actions.set(clip.name, mixer.clipAction(clip));
    }
    if (!['Idle', 'Listening', 'Thinking', 'Speaking'].every(actionFor)) throw Error('Companion animation states unavailable');
    // Fit the motion envelope too, so a wave cannot be cut off in a narrow card.
    const envelope = new THREE.Box3().makeEmpty();
    for (const action of actions.values()) {
      mixer.stopAllAction(); action.reset().play();
      for (const fraction of [0, 0.25, 0.5, 0.75]) {
        mixer.setTime(action.getClip().duration * fraction); model.updateMatrixWorld(true); envelope.union(new THREE.Box3().setFromObject(model));
        // Cache each rigid part's bounds, not one giant empty corner box around
        // the whole robot. This retains the close framing while allowing waves.
        model.traverse(object => {
          if (!object.isMesh) return;
          if (!object.geometry.boundingBox) object.geometry.computeBoundingBox();
          const box = object.geometry.boundingBox;
          for (const x of [box.min.x, box.max.x]) for (const y of [box.min.y, box.max.y]) for (const z of [box.min.z, box.max.z]) fittedPoints.push(new THREE.Vector3(x, y, z).applyMatrix4(object.matrixWorld));
        });
      }
    }
    mixer.stopAllAction(); mixer.setTime(0);
    fittedSize.set(2 * Math.max(Math.abs(envelope.min.x), Math.abs(envelope.max.x)), 2 * Math.max(Math.abs(envelope.min.y), Math.abs(envelope.max.y)), 2 * Math.max(Math.abs(envelope.min.z), Math.abs(envelope.max.z)));
    mixer.addEventListener('finished', event => { if (event.action === active && ['Greeting', 'Playful'].includes(current)) { current = ''; pose(); } });
    ready = true; current = ''; pose();
    if (current === 'Idle' && actionFor('Greeting') && !paused) play('Greeting', true);
    resize(); syncLoop(); callbacks.ready();
  })().catch(error => { if (!disposed && error.name !== 'AbortError') callbacks.error(); });
  renderer.domElement.addEventListener('webglcontextlost', event => { event.preventDefault(); if (!disposed) { cancelAnimationFrame(frame); callbacks.error(); } });
  return {
    setState(value) { if (state === value) return; state = value; pose(); renderOnce(); },
    setCamera(nextYaw, nextPitch) {
      if (disposed) return;
      yaw = Number.isFinite(nextYaw) ? nextYaw : 0; pitch = Number.isFinite(nextPitch) ? THREE.MathUtils.clamp(nextPitch, -1.15, 1.15) : 0;
      aimCamera();
    },
    setPaused(value) { if (paused === value) return; paused = value; syncLoop(); },
    setVisible(value) { if (visible === value) return; visible = value; syncLoop(); }, resize,
    dispose() { if (disposed) return; disposed = true; control.abort(); cancelAnimationFrame(frame); mixer?.stopAllAction(); if (model) mixer?.uncacheRoot(model); disposeScene(); renderer.dispose(); renderer.forceContextLoss(); renderer.domElement.remove(); }
  };
}
