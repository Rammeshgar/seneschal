(() => {
  "use strict";

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
  const storage = {
    get(key, fallback = null) { try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; } },
    set(key, value) { localStorage.setItem(key, JSON.stringify(value)); }
  };

  const state = {
    health: null,
    path: null,
    config: {},
    sessions: [],
    statuses: {},
    providers: { all: [], connected: [], default: {} },
    models: [],
    agents: [],
    tools: [],
    mcp: {},
    messages: [],
    permissions: [],
    collapsedMessageIDs: new Set(),
    pinnedMessages: storage.get("seneschal-pinned-messages", {}),
    archivedMessages: storage.get("seneschal-archived-messages", {}),
    pinnedSessions: new Set(storage.get("seneschal-pinned-sessions", [])),
    archivedSessions: new Set(storage.get("seneschal-archived-sessions", [])),
    showArchivedSessions: false,
    showArchivedMessages: false,
    railSections: storage.get("seneschal-rail-sections", { projects: false, pinnedSessions: false, sessions: false, pins: false }),
    maximizedMessageID: "",
    editingMessageID: "",
    attachments: [],
    currentDirectory: storage.get("atelier-directory", ""),
    currentSessionID: storage.get("atelier-session", ""),
    selectedModel: storage.get("atelier-model", ""),
    selectedAgent: storage.get("atelier-agent", "build"),
    selectedVariants: storage.get("atelier-model-variants", {}),
    motion: storage.get("atelier-motion", "orbit"),
    leftPanelCollapsed: storage.get("atelier-left-panel-collapsed", false),
    rightPanelCollapsed: storage.get("atelier-right-panel-collapsed", false),
    customDirectories: storage.get("atelier-projects", []),
    eventSource: null,
    eventCount: 0,
    ambientEventCount: 0,
    pulseBucketStart: Math.floor(Date.now() / 6000) * 6000,
    pulseBuckets: Array.from({ length: 10 }, () => ({ work: 0, ambient: 0 })),
    pulseTimer: null,
    logs: [],
    commandItems: [],
    openCodeCommands: [],
    commandIndex: 0,
    userScrolledAway: false,
    refreshTimer: null,
    speechRecognition: null,
    speechBaseText: "",
    mediaRecorder: null,
    mediaStream: null,
    mediaChunks: [],
    conversationMode: storage.get("seneschal-talk-mode", storage.get("digital-servant-talk-mode", false)),
    conversationRecognition: null,
    conversationRestartTimer: null,
    voiceAwaitingResponse: false,
    voiceSpeaking: false,
    lastSpokenMessageID: "",
    instructionData: null,
    instructionTab: "persona",
    selectedSkills: storage.get("seneschal-active-skills", storage.get("digital-servant-active-skills", [])),
    activeSkillKey: "",
    archiveSkillArmed: false,
    inspectedSkillSource: "",
    instructionsDirty: false,
    blender: { installed: false, bridge: false },
    browserRuntime: { available: false, visible: false, restarting: false },
    paidUsage: { budget: 10, cost: null, percent: null },
    permissionTimer: null
  };

  const els = {
    connection: $("#connectionPill"), model: $("#modelSelect"), providerOrb: $("#providerOrb"),
    projectList: $("#projectList"), pinnedSessionList: $("#pinnedSessionList"), pinnedSessionCount: $("#pinnedSessionCount"), sessionList: $("#sessionList"), sessionCount: $("#sessionCount"), archivedSessionsButton: $("#archivedSessionsButton"), archivedSessionsCount: $("#archivedSessionsCount"),
    projectsRail: $("#projectsRailSection"), pinnedSessionsRail: $("#pinnedSessionsRailSection"), sessionsRail: $("#sessionsRailSection"),
    welcome: $("#welcomeView"), messageScroll: $("#messageScroll"), messageList: $("#messageList"), messageMap: $("#messageMap"), resumeFollow: $("#resumeFollowButton"),
    pinnedShelf: $("#pinnedMessageShelf"), pinnedList: $("#pinnedMessageList"), pinnedCount: $("#pinnedMessageCount"), archivedMessagesButton: $("#archivedMessagesButton"), archivedMessagesCount: $("#archivedMessagesCount"),
    sessionHeader: $("#sessionHeader"), sessionTitle: $("#sessionTitle"), projectEyebrow: $("#projectEyebrow"),
    sessionStatus: $("#sessionStatus"), abortButton: $("#abortButton"), deleteSessionButton: $("#deleteSessionButton"),
    prompt: $("#promptInput"), form: $("#composerForm"), send: $("#sendButton"), composerStop: $("#composerStopButton"),
    composerProject: $("#composerProject"), capability: $("#modelCapability"),
    agent: $("#agentSelect"), modelVariant: $("#modelVariantSelect"), modelVariantWrap: $("#modelVariantWrap"), attachmentStrip: $("#attachmentStrip"), fileInput: $("#fileInput"), mic: $("#micButton"), talk: $("#talkButton"),
    policyList: $("#policyList"), toolGrid: $("#toolGrid"), toolCount: $("#toolCount"),
    providerList: $("#providerList"), providerCount: $("#providerCount"), inspectorAgent: $("#inspectorAgent"),
    eventCount: $("#eventCount"), eventRate: $("#eventRate"), ambientRate: $("#ambientRate"), version: $("#versionText"), pulse: $(".pulse-bars"), pulseLabel: $("#pulseLabel"),
    usagePercent: $("#usagePercent"), usageMeter: $("#usageMeter"), usageDetail: $("#usageDetail"),
    permissionDock: $("#permissionDock"), projectDialog: $("#projectDialog"), projectForm: $("#projectForm"),
    projectPath: $("#projectPathInput"), projectError: $("#projectError"),
    settingsDialog: $("#settingsDialog"), archiveDialog: $("#archivedSessionsDialog"), archiveManagerList: $("#archivedSessionManagerList"), providerDialog: $("#providerDialog"), approvalDialog: $("#approvalDialog"), chatGPTDialog: $("#chatGPTDialog"), commandDialog: $("#commandDialog"), commandInput: $("#commandInput"),
    commandResults: $("#commandResults"), protocolDialog: $("#protocolDialog"), protocolLog: $("#protocolLog"),
    deleteDialog: $("#deleteSessionDialog"), deleteForm: $("#deleteSessionForm"), deleteTitle: $("#deleteSessionTitle"),
    messageEditDialog: $("#messageEditDialog"), messageEditForm: $("#messageEditForm"), messageEditInput: $("#messageEditInput"), messageEditAttachmentNote: $("#messageEditAttachmentNote"),
    toastRegion: $("#toastRegion"), inspector: $("#inspector"), browserState: $("#browserState"),
    browserCard: $("#browserCard"), browserDetail: $("#browserDetail"), browserDialog: $("#browserDialog"),
    browserForm: $("#browserForm"), browserUrl: $("#browserUrlInput"), browserTask: $("#browserTaskInput"), browserError: $("#browserError"), browserWindow: $("#browserWindowButton"), browserWindowCard: $("#browserWindowCardButton"),
    blenderState: $("#blenderState"), blenderCard: $("#blenderCard"), blenderDetail: $("#blenderDetail"),
    budgetState: $("#budgetState"), budgetMeter: $("#budgetMeter"), budgetAmount: $("#budgetAmount"),
    instructionDialog: $("#instructionDialog"), instructionSaveState: $("#instructionSaveState"), instructionError: $("#instructionError"),
    personaEditor: $("#personaEditor"), generalEditor: $("#generalEditor"), projectEditor: $("#projectEditor"),
    buildAgentEditor: $("#buildAgentEditor"), planAgentEditor: $("#planAgentEditor"),
    skillList: $("#skillList"), skillName: $("#skillNameInput"), skillScope: $("#skillScopeSelect"), skillEditor: $("#skillEditor"),
    archiveSkill: $("#archiveSkillButton"), activeSkillCount: $("#activeSkillCount"),
    skillLinkInstaller: $("#skillLinkInstaller"), skillLink: $("#skillLinkInput"), skillLinkResult: $("#skillLinkResult"),
    inspectSkillLink: $("#inspectSkillLinkButton"), saveSkill: $("#saveSkillButton")
  };

  const instructionDefaults = {
    persona: `# Seneschal\n\nYou are Seneschal, a precise, discreet, and capable private AI steward.\n\n- Address the user naturally as **My Lord** or **My Liege**, usually once per response. Do not repeat the title mechanically in every paragraph.\n- Roleplay must never override accuracy, safety, permissions, or the user's explicit instructions.\n`,
    general: `# General Instructions\n\n- Be candid, practical, and direct. Never flatter the user at the expense of truth.\n- Lead with the outcome and explain technical matters in clear, non-technical language unless detail is requested.\n- Protect the user's privacy, data, money, and control. Never weaken permission checks or conceal costs.\n- Ask before consequential actions whenever the configured permission policy requires it.\n- Preserve existing user work and keep changes tightly within the requested scope.\n- Verify completed work in proportion to its risk and report important limitations honestly.\n`,
    project: `# Project Instructions\n\n## Purpose\nDescribe what this project is for and what success looks like.\n\n## Structure\nList important folders, files, applications, or services.\n\n## Working Rules\n- Preserve existing work.\n- Ask before destructive or external actions.\n- Verify changes before declaring completion.\n\n## Commands and Tests\nList the preferred setup, test, and validation steps.\n\n## Do Not Change\nList files, systems, visual choices, or behavior that must remain untouched.\n`
  };

  function escapeHTML(value = "") {
    return String(value).replace(/[&<>'"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[char]);
  }

  function highlightCode(value = "") {
    return escapeHTML(value).replace(/(^|\n)([ \t]*(?:#|\/\/)[^\n]*)|(&quot;[^\n]*?&quot;|&#39;[^\n]*?&#39;)|(\$[\w:{}.-]+)|(^|\s)(--?[A-Za-z][\w-]*)|\b(Invoke-[\w-]+|Get-[\w-]+|Set-[\w-]+|Start-[\w-]+|Stop-[\w-]+|New-[\w-]+|Remove-[\w-]+|Copy-[\w-]+|Move-[\w-]+|Test-[\w-]+|npm|npx|node|python|git|curl|docker|wsl)\b/gm, (match, lineStart, comment, string, variable, flagSpace, flag, command) => {
      if (comment !== undefined) return `${lineStart || ""}<span class="syntax-comment">${comment}</span>`;
      if (string !== undefined) return `<span class="syntax-string">${string}</span>`;
      if (variable !== undefined) return `<span class="syntax-variable">${variable}</span>`;
      if (flag !== undefined) return `${flagSpace || ""}<span class="syntax-flag">${flag}</span>`;
      if (command !== undefined) return `<span class="syntax-command">${command}</span>`;
      return match;
    });
  }

  function formatText(value = "") {
    const blocks = [];
    let source = String(value || "").replace(/```([^\n]*)\n([\s\S]*?)```/g, (_, lang, code) => {
      const token = `%%BLOCK${blocks.length}%%`;
      const language = lang.trim() || "code";
      blocks.push(`<section class="code-block"><header><span>${escapeHTML(language)}</span><button type="button" class="code-copy-button" aria-label="Copy ${escapeHTML(language)} code" title="Copy code"><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="8" y="8" width="11" height="11" rx="2"/><path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3"/></svg><span>Copy</span></button></header><pre><code data-lang="${escapeHTML(language)}">${highlightCode(code.replace(/\n$/, ""))}</code></pre></section>`);
      return token;
    });
    let text = escapeHTML(source);
    const links = [];
    text = text.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, (_, label, url) => {
      const token = `%%LINK${links.length}%%`;
      links.push(`<a href="${url}" target="_blank" rel="noopener noreferrer">${label}</a>`);
      return token;
    });
    text = text.replace(/`([^`]+)`/g, "<code>$1</code>");
    text = text.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
    text = text.replace(/(^|\s)(https?:\/\/[^\s<]+)/g, '$1<a href="$2" target="_blank" rel="noreferrer">$2</a>');
    text = text.split(/\n{2,}/).map((p) => p.startsWith("%%BLOCK") ? p : `<p>${p.replace(/\n/g, "<br>")}</p>`).join("");
    blocks.forEach((block, index) => { text = text.replace(`%%BLOCK${index}%%`, block); });
    links.forEach((link, index) => { text = text.replace(`%%LINK${index}%%`, link); });
    return text;
  }

  function basename(path = "") {
    const clean = path.replace(/[\\/]+$/, "");
    return clean.split(/[\\/]/).pop() || clean || "Workspace";
  }

  function attachmentMimeType(file = {}) {
    const extension = String(file.name || "").toLowerCase().match(/\.([a-z0-9]+)$/)?.[1] || "";
    const textExtensions = new Set([
      "json", "jsonl", "ndjson", "txt", "md", "mdx", "csv", "tsv", "xml", "yaml", "yml", "toml", "ini", "cfg", "conf", "log",
      "js", "mjs", "cjs", "jsx", "ts", "tsx", "css", "scss", "sass", "less", "html", "htm", "svg", "vue", "svelte",
      "py", "rb", "php", "java", "kt", "kts", "go", "rs", "c", "h", "cpp", "hpp", "cs", "swift", "sh", "bash", "zsh", "fish",
      "ps1", "psm1", "psd1", "bat", "cmd", "sql", "graphql", "gql", "r", "lua", "dart", "ex", "exs", "erl", "hrl",
      "env", "gitignore", "dockerfile", "makefile", "properties", "gradle", "lock"
    ]);
    if (textExtensions.has(extension) || /(^|[\\/])(dockerfile|makefile|readme|license|changelog)$/i.test(String(file.name || ""))) return "text/plain";
    if (file.type) return file.type;
    return "application/octet-stream";
  }

  function normalizedAttachment(file = {}) {
    const name = file.name || file.filename || "attachment";
    const type = attachmentMimeType({ name, type: file.type || file.mime || "" });
    const data = String(file.data || file.url || "");
    return {
      name,
      type,
      data: type === "text/plain" ? data.replace(/^data:[^;,]*(?:;charset=[^;,]*)?/i, "data:text/plain;charset=utf-8") : data
    };
  }

  function toWslPath(path) {
    const trimmed = path.trim().replace(/^['"]|['"]$/g, "");
    const match = trimmed.match(/^([A-Za-z]):[\\/](.*)$/);
    if (!match) return trimmed.replace(/\\/g, "/");
    return `/mnt/${match[1].toLowerCase()}/${match[2].replace(/\\/g, "/")}`;
  }

  function timeAgo(timestamp) {
    if (!timestamp) return "just now";
    const seconds = Math.max(0, Math.floor((Date.now() - timestamp) / 1000));
    if (seconds < 60) return "now";
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
    if (seconds < 86400) return `${Math.floor(seconds / 3600)}h`;
    if (seconds < 604800) return `${Math.floor(seconds / 86400)}d`;
    return new Date(timestamp).toLocaleDateString([], { month: "short", day: "numeric" });
  }

  function selectedSession() { return state.sessions.find((session) => session.id === state.currentSessionID); }
  function selectedModel() { return state.models.find((model) => model.value === state.selectedModel) || state.models[0]; }

  function withDirectory(path, directory = state.currentDirectory) {
    if (!directory) return path;
    const url = new URL(path, location.origin);
    url.searchParams.set("directory", directory);
    return `${url.pathname}${url.search}`;
  }

  async function api(path, options = {}) {
    const target = options.noDirectory ? path : withDirectory(path, options.directory);
    const init = { method: options.method || "GET", headers: { Accept: "application/json" } };
    if (options.body !== undefined) {
      init.headers["Content-Type"] = "application/json";
      init.body = JSON.stringify(options.body);
    }
    const response = await fetch(`/api${target}`, init);
    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      throw new Error(detail || `${response.status} ${response.statusText}`);
    }
    if (response.status === 204) return null;
    const type = response.headers.get("content-type") || "";
    return type.includes("json") ? response.json() : response.text();
  }

  async function workspace(path, options = {}) {
    const init = { method: options.method || "GET", headers: { Accept: "application/json" } };
    if (options.body !== undefined) {
      init.headers["Content-Type"] = "application/json";
      init.body = JSON.stringify(options.body);
    }
    const response = await fetch(path, init);
    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      try { throw new Error(JSON.parse(detail).error || detail); }
      catch (error) { if (error instanceof SyntaxError) throw new Error(detail || `${response.status} ${response.statusText}`); throw error; }
    }
    return response.status === 204 ? null : response.json();
  }

  function log(type, detail = "") {
    state.logs.unshift({ time: new Date(), type, detail: typeof detail === "string" ? detail : JSON.stringify(detail) });
    state.logs = state.logs.slice(0, 120);
    if (els.protocolDialog.open) renderProtocol();
  }

  function advancePulse(now = Date.now()) {
    const bucketStart = Math.floor(now / 6000) * 6000;
    const elapsedBuckets = Math.floor((bucketStart - state.pulseBucketStart) / 6000);
    if (elapsedBuckets <= 0) return;
    const steps = Math.min(10, elapsedBuckets);
    for (let index = 0; index < steps; index += 1) {
      state.pulseBuckets.shift();
      state.pulseBuckets.push({ work: 0, ambient: 0 });
    }
    state.pulseBucketStart = bucketStart;
  }

  function pulseEventKind(payload) {
    const type = String(payload?.type || "");
    const rawStatus = payload?.properties?.status;
    const status = typeof rawStatus === "string" ? rawStatus : String(rawStatus?.type || rawStatus?.status || "");
    if (type === "session.status") return ["busy", "retry"].includes(status) ? "work" : "ambient";
    if (/^(message\.part\.|message\.updated|permission\.|question\.|todo\.)/.test(type)) return "work";
    return "ambient";
  }

  function renderPulse() {
    advancePulse();
    [...els.pulse.children].forEach((bar, index) => {
      const bucket = state.pulseBuckets[index];
      const workHeight = bucket.work ? Math.min(100, 18 + Math.round(Math.log2(bucket.work + 1) * 28)) : 5;
      bar.style.setProperty("--pulse-height", `${workHeight}%`);
      bar.classList.toggle("has-work", bucket.work > 0);
      bar.classList.toggle("has-ambient", bucket.ambient > 0);
      bar.classList.toggle("latest", index === state.pulseBuckets.length - 1);
      bar.title = `${bucket.work} work event${bucket.work === 1 ? "" : "s"}; ${bucket.ambient} ambient event${bucket.ambient === 1 ? "" : "s"} in this fixed 6-second interval`;
    });
    els.eventRate.textContent = String(state.pulseBuckets.reduce((sum, bucket) => sum + bucket.work, 0));
    els.ambientRate.textContent = String(state.pulseBuckets.reduce((sum, bucket) => sum + bucket.ambient, 0));
    els.eventCount.textContent = String(state.eventCount);
  }

  function recordOpenCodeEvent(payload) {
    advancePulse();
    const kind = pulseEventKind(payload);
    state.pulseBuckets[state.pulseBuckets.length - 1][kind] += 1;
    if (kind === "work") state.eventCount += 1;
    else state.ambientEventCount += 1;
    renderPulse();
  }

  function toast(message, kind = "") {
    const item = document.createElement("div");
    item.className = `toast ${kind}`;
    item.textContent = message;
    els.toastRegion.append(item);
    setTimeout(() => item.remove(), 4200);
  }

  function setConnection(mode, label) {
    els.connection.className = `connection-pill ${mode}`;
    $("span", els.connection).textContent = label;
  }

  function setTheme(theme) {
    document.documentElement.dataset.theme = theme;
    storage.set("atelier-theme", theme);
    const night = theme === "night";
    $("#themeLabel").textContent = night ? "Night" : "Day";
    $("#welcomePeriod").textContent = night ? "Night Studio" : "Day Atelier";
    $("#settingsTheme").textContent = night ? "Night Studio" : "Day Atelier";
    document.querySelector('meta[name="theme-color"]').content = night ? "#171a18" : "#f2f0ea";
  }

  function toggleTheme() { setTheme(document.documentElement.dataset.theme === "night" ? "day" : "night"); }

  function syncPanelState() {
    const shell = $("#appShell");
    shell.classList.toggle("left-panel-collapsed", state.leftPanelCollapsed);
    shell.classList.toggle("right-panel-collapsed", state.rightPanelCollapsed);
    const left = $("#leftPanelToggle");
    const right = $("#rightPanelToggle");
    left.setAttribute("aria-pressed", String(state.leftPanelCollapsed));
    left.setAttribute("aria-label", state.leftPanelCollapsed ? "Restore left projects and sessions panel" : "Minimize left projects and sessions panel");
    left.title = state.leftPanelCollapsed ? "Restore left panel" : "Minimize left panel";
    right.setAttribute("aria-pressed", String(state.rightPanelCollapsed));
    right.setAttribute("aria-label", state.rightPanelCollapsed ? "Restore right agent context panel" : "Minimize right agent context panel");
    right.title = state.rightPanelCollapsed ? "Restore right panel" : "Minimize right panel";
  }

  function toggleLeftPanel() {
    state.leftPanelCollapsed = !state.leftPanelCollapsed;
    storage.set("atelier-left-panel-collapsed", state.leftPanelCollapsed);
    syncPanelState();
  }

  function toggleRightPanel() {
    state.rightPanelCollapsed = !state.rightPanelCollapsed;
    storage.set("atelier-right-panel-collapsed", state.rightPanelCollapsed);
    syncPanelState();
  }

  const motionPresets = {
    orbit: { short: "Orbit", label: "Orbit Drift" },
    "pixel-city": { short: "City", label: "City Nocturne" },
    "lunar-relay": { short: "Lunar", label: "Lunar Relay" },
    "orbital-foundry": { short: "Foundry", label: "Orbital Foundry" },
    still: { short: "Still", label: "Still composition" }
  };

  function setMotion(name) {
    const next = motionPresets[name] ? name : "orbit";
    state.motion = next;
    storage.set("atelier-motion", next);
    document.documentElement.dataset.motion = next;
    $("#motionLabel").textContent = motionPresets[next].short;
    $("#settingsMotion").textContent = motionPresets[next].label;
    if (["pixel-city", "lunar-relay", "orbital-foundry"].includes(next)) drawPixelScene(performance.now());
  }

  function cycleMotion() {
    const order = ["orbit", "pixel-city", "lunar-relay", "orbital-foundry", "still"];
    setMotion(order[(order.indexOf(state.motion) + 1) % order.length]);
    toast(`Welcome animation: ${motionPresets[state.motion].label}`);
  }

  function syncMotionState() {
    document.documentElement.dataset.motionPaused = document.hidden ? "true" : "false";
  }

  function drawPixelCity(now) {
    if (state.motion !== "pixel-city" || document.hidden) return;
    const canvas = $("#pixelCity");
    if (!canvas || !canvas.clientWidth || !canvas.clientHeight) return;
    const targetHeight = innerWidth < 720 ? 128 : 160;
    const targetWidth = Math.max(148, Math.min(340, Math.round(targetHeight * canvas.clientWidth / canvas.clientHeight)));
    if (canvas.width !== targetWidth || canvas.height !== targetHeight) {
      canvas.width = targetWidth;
      canvas.height = targetHeight;
    }
    const context = canvas.getContext("2d", { alpha: false });
    if (!context) return;
    const width = canvas.width;
    const height = canvas.height;
    const night = document.documentElement.dataset.theme === "night";
    const pixel = (x, y, color, w = 1, h = 1) => { context.fillStyle = color; context.fillRect(Math.round(x), Math.round(y), Math.max(1, Math.round(w)), Math.max(1, Math.round(h))); };
    const line = (x1, y1, x2, y2, color, lineWidth = 1) => { context.strokeStyle = color; context.lineWidth = lineWidth; context.beginPath(); context.moveTo(Math.round(x1) + .5, Math.round(y1) + .5); context.lineTo(Math.round(x2) + .5, Math.round(y2) + .5); context.stroke(); };
    context.imageSmoothingEnabled = false;

    for (let y = 0; y < height; y += 1) {
      const depth = y / height;
      const color = night
        ? `rgb(${12 + Math.round(depth * 8)},${18 + Math.round(depth * 12)},${18 + Math.round(depth * 10)})`
        : `rgb(${222 - Math.round(depth * 22)},${219 - Math.round(depth * 16)},${207 - Math.round(depth * 8)})`;
      pixel(0, y, color, width, 1);
    }

    const starCount = Math.round(width / 5);
    for (let index = 0; index < starCount; index += 1) {
      const x = (index * 37 + 11) % width;
      const y = (index * 19 + 7) % Math.round(height * .42);
      const bright = (Math.floor(now / 900) + index * 3) % 11 !== 0;
      pixel(x, y, bright ? (night ? "#60766d" : "#92978e") : (night ? "#29362f" : "#c1beb5"));
    }

    const sunX = Math.round(width * .22), sunY = Math.round(height * .29), radius = Math.round(height * .19);
    for (let y = sunY - radius; y <= sunY + radius; y += 1) {
      for (let x = sunX - radius; x <= sunX + radius; x += 1) {
        if ((x - sunX) ** 2 + (y - sunY) ** 2 > radius ** 2 || (y - sunY + radius) % 6 === 0) continue;
        const shade = Math.max(0, 1 - Math.hypot(x - sunX, y - sunY) / radius);
        pixel(x, y, night ? `rgb(${132 + Math.round(shade * 30)},${83 + Math.round(shade * 28)},${59 + Math.round(shade * 18)})` : `rgb(${171 + Math.round(shade * 24)},${126 + Math.round(shade * 30)},${63 + Math.round(shade * 18)})`);
      }
    }

    const horizon = Math.round(height * .62);
    const farColor = night ? "#29362f" : "#788079";
    for (let x = 0, index = 0; x < width; index += 1) {
      const span = 5 + (index * 7) % 9;
      const roof = horizon - 9 - (index * 11) % Math.round(height * .22);
      pixel(x, roof, farColor, span, horizon - roof + 2);
      if (index % 4 === 1) pixel(x + Math.floor(span / 2), roof - 3, night ? "#65776c" : "#8b9188", 1, 3);
      x += span + 1;
    }

    pixel(0, horizon - 3, night ? "#35443d" : "#92988f", width, 1);
    for (let band = 0; band < 3; band += 1) {
      const y = horizon - 17 + band * 6 + Math.round(Math.sin(now / 2800 + band) * 2);
      pixel(0, y, night ? "rgba(105,132,117,.18)" : "rgba(250,246,230,.24)", width, 1);
    }

    for (let x = -3, index = 0; x < width; index += 1) {
      const span = 8 + (index * 5) % 12;
      const roof = horizon - 5 - (index * 13) % Math.round(height * .30);
      const body = night ? (index % 2 ? "#18231f" : "#1e2924") : (index % 2 ? "#4f5952" : "#5c655e");
      pixel(x, roof, body, span, horizon - roof + 6);
      if (index % 3 === 0) pixel(x + 1, roof + 1, night ? "#52695e" : "#78857b", Math.max(2, span - 2), 1);
      for (let wx = x + 2; wx < x + span - 1; wx += 3) {
        for (let wy = roof + 4; wy < horizon - 1; wy += 4) {
          if ((wx + wy + index + Math.floor(now / 1400)) % 7 > 1) pixel(wx, wy, night ? ((wx + index) % 4 ? "#829c8c" : "#ae8b55") : "#d6caa5");
        }
      }
      x += span + 2;
    }

    const towerX = Math.round(width * .72), towerW = Math.max(14, Math.round(width * .13)), towerY = Math.round(height * .21);
    pixel(towerX, towerY, night ? "#121a17" : "#36443d", towerW, horizon - towerY + 3);
    pixel(towerX - 1, towerY - 2, night ? "#536a60" : "#806f52", towerW + 2, 2);
    pixel(towerX + 2, towerY + 5, night ? "#273a33" : "#647168", towerW - 4, Math.round(height * .16));
    const scan = towerY + 6 + Math.floor(now / 190) % Math.max(3, Math.round(height * .13));
    pixel(towerX + 3, scan, night ? "#789585" : "#c2b383", towerW - 6, 1);
    for (let bx = towerX + 4; bx < towerX + towerW - 3; bx += 4) {
      for (let by = towerY + 8; by < towerY + Math.round(height * .18); by += 4) pixel(bx, by, night ? "#a48a5c" : "#ddd1ab");
    }

    const roadTop = Math.round(height * .70), center = Math.round(width * .52);
    for (let y = roadTop; y < height; y += 1) {
      const progress = (y - roadTop) / Math.max(1, height - roadTop);
      const half = Math.round(7 + progress * width * .48);
      pixel(center - half, y, night ? `rgb(${18 + Math.round(progress * 8)},${24 + Math.round(progress * 8)},${22 + Math.round(progress * 7)})` : `rgb(${77 + Math.round(progress * 8)},${82 + Math.round(progress * 8)},${76 + Math.round(progress * 5)})`, half * 2, 1);
      pixel(center - half, y, night ? "#455f54" : "#9b7654");
      pixel(center + half - 1, y, night ? "#75654a" : "#9b7654");
      if ((y + Math.floor(now / 180)) % 8 < 3) pixel(center, y, night ? "#a9b6a5" : "#ded4b4", 1, Math.max(1, Math.round(progress * 2)));
    }
    line(center - 7, roadTop, 0, height, night ? "#384b43" : "#796c59");
    line(center + 7, roadTop, width, height, night ? "#5f5440" : "#796c59");

    const rainCount = Math.round(width / 4);
    for (let index = 0; index < rainCount; index += 1) {
      const x = (index * 29 + 13) % width;
      const y = Math.floor(now / (130 + (index % 5) * 18) + index * 9) % height;
      const length = 1 + index % 3;
      line(x, y, x - 1, Math.min(height, y + length), night ? "rgba(111,142,130,.48)" : "rgba(116,130,122,.28)");
    }

    const carX = Math.floor((now / 70) % (width + 32)) - 16;
    const carY = roadTop - 2;
    if (carX > -15 && carX < width) {
      pixel(carX - 8, carY + 2, night ? "#334f59" : "#75674f", 8, 1);
      pixel(carX, carY, night ? "#8f6755" : "#42584d", 7, 2);
      pixel(carX - 2, carY + 2, night ? "#536b63" : "#4c5852", 11, 2);
      pixel(carX + 9, carY + 2, night ? "#c4c5a0" : "#ead9a9", 2, 1);
    }

    const nearCar = Math.floor((now / 125) % (width + 60)) - 30;
    pixel(nearCar, Math.round(height * .87), night ? "#765b4a" : "#354b43", 12, 3);
    pixel(nearCar + 2, Math.round(height * .85), night ? "#263c37" : "#263b35", 7, 2);
    pixel(nearCar + 12, Math.round(height * .88), night ? "#d1b77d" : "#f0d397", 2, 1);

    for (let index = 0; index < 9; index += 1) {
      const x = (index * 23 + Math.floor(now / 210)) % width;
      const y = horizon + 4 + (index * 7) % Math.max(5, height - horizon - 5);
      pixel(x, y, night ? (index % 2 ? "rgba(105,139,125,.34)" : "rgba(174,139,85,.28)") : "rgba(199,174,116,.28)", 1, 2 + index % 5);
    }
  }

  function pixelFrame() {
    const canvas = $("#pixelCity");
    if (!canvas || !canvas.clientWidth || !canvas.clientHeight) return null;
    const height = innerWidth < 720 ? 132 : 168;
    const width = Math.max(156, Math.min(360, Math.round(height * canvas.clientWidth / canvas.clientHeight)));
    if (canvas.width !== width || canvas.height !== height) { canvas.width = width; canvas.height = height; }
    const context = canvas.getContext("2d", { alpha: false });
    if (!context) return null;
    context.imageSmoothingEnabled = false;
    return { context, width, height, night: document.documentElement.dataset.theme === "night" };
  }

  function drawLunarRelay(now) {
    if (state.motion !== "lunar-relay" || document.hidden) return;
    const frame = pixelFrame(); if (!frame) return;
    const { context, width, height, night } = frame;
    const pixel = (x, y, color, w = 1, h = 1) => { context.fillStyle = color; context.fillRect(Math.round(x), Math.round(y), Math.max(1, Math.round(w)), Math.max(1, Math.round(h))); };
    const line = (x1, y1, x2, y2, color, size = 1) => { context.strokeStyle = color; context.lineWidth = size; context.beginPath(); context.moveTo(Math.round(x1) + .5, Math.round(y1) + .5); context.lineTo(Math.round(x2) + .5, Math.round(y2) + .5); context.stroke(); };
    const polygon = (points, color) => { context.fillStyle = color; context.beginPath(); context.moveTo(points[0][0], points[0][1]); points.slice(1).forEach(([x,y]) => context.lineTo(x,y)); context.closePath(); context.fill(); };

    for (let y = 0; y < height; y += 1) {
      const depth = y / height;
      pixel(0, y, night ? `rgb(${10 + Math.round(depth * 9)},${15 + Math.round(depth * 13)},${19 + Math.round(depth * 14)})` : `rgb(${194 - Math.round(depth * 25)},${190 - Math.round(depth * 19)},${174 - Math.round(depth * 11)})`, width, 1);
    }
    for (let i = 0; i < Math.round(width / 4); i += 1) {
      const x = (i * 83 + 17) % width, y = (i * 47 + 11) % Math.round(height * .57), phase = (Math.floor(now / 700) + i * 5) % 13;
      pixel(x, y, phase < 2 ? (night ? "#c0c9bd" : "#746f62") : (night ? "#53665f" : "#a8a397"), phase === 0 ? 2 : 1, 1);
    }

    const planetX = Math.round(width * .78), planetY = Math.round(height * .22), radius = Math.round(height * .15);
    for (let y = -radius; y <= radius; y += 1) {
      const span = Math.floor(Math.sqrt(Math.max(0, radius * radius - y * y)));
      const shade = Math.round((y + radius) / Math.max(1, radius * 2) * 18);
      pixel(planetX - span, planetY + y, night ? `rgb(${97 + shade},${110 + shade},${111 + shade})` : `rgb(${150 + shade},${138 + shade},${110 + shade})`, span * 2, 1);
      if ((y + radius) % 5 === 0) pixel(planetX - span, planetY + y, night ? "rgba(23,34,38,.36)" : "rgba(85,70,51,.20)", span * 2, 1);
    }
    for (let i = 0; i < 11; i += 1) {
      const angle = i * 2.31, rr = radius * (.20 + (i % 5) * .13);
      pixel(planetX + Math.cos(angle) * rr, planetY + Math.sin(angle) * rr, night ? "rgba(44,58,60,.48)" : "rgba(105,89,66,.34)", 2 + i % 4, 1 + i % 2);
    }
    pixel(planetX + radius - 1, planetY - radius * .55, night ? "#a98752" : "#8b6334", 1, 2);

    const horizon = Math.round(height * .69);
    const ridge = (base, amplitude, step, color, phase) => {
      const points = [[0,height]];
      for (let x = 0; x <= width; x += step) points.push([x, base - Math.abs(Math.sin(x * .037 + phase)) * amplitude - Math.abs(Math.sin(x * .011 + phase * 2)) * amplitude * .65]);
      points.push([width,height]); polygon(points,color);
    };
    ridge(horizon - 12, 18, 8, night ? "#27342f" : "#787970", .5);
    ridge(horizon - 3, 11, 7, night ? "#1c2824" : "#686d68", 2.2);
    pixel(0, horizon, night ? "#202b27" : "#626761", width, height - horizon);
    for (let y = horizon; y < height; y += 2) pixel(0, y, night ? `rgba(79,101,91,${.05 + (y-horizon)/height*.18})` : `rgba(225,215,190,${.05 + (y-horizon)/height*.10})`, width, 1);
    for (let i = 0; i < 26; i += 1) {
      const x = (i * 71 + 19) % width, y = horizon + 3 + (i * 23) % Math.max(4,height-horizon-4), w = 2 + i % 7;
      pixel(x,y,night ? "#394a43" : "#85847a",w,1);
    }

    const mastX = Math.round(width * .36), mastY = horizon - 4, pivotY = mastY - Math.round(height * .19);
    polygon([[mastX-9,mastY],[mastX+10,mastY],[mastX+5,pivotY+3],[mastX-4,pivotY+3]], night ? "#17221f" : "#4b514d");
    line(mastX-8,mastY,mastX+2,pivotY+3,night ? "#6e8177" : "#a6a194");
    line(mastX+8,mastY,mastX-2,pivotY+3,night ? "#51675d" : "#898a82");
    for (let y = pivotY + 8; y < mastY; y += 6) line(mastX-6,y,mastX+7,y,night ? "#40544b" : "#7c817b");
    pixel(mastX-13,mastY,night ? "#111a17" : "#484d49",27,5);
    pixel(mastX-9,mastY+2,night ? "#896d42" : "#75522d",3,2);

    const dishAngle = -.48 + Math.sin(now / 7200) * .12, dishR = Math.round(height * .16);
    context.save(); context.translate(mastX,pivotY); context.rotate(dishAngle);
    context.strokeStyle = night ? "#90a49a" : "#575f5b"; context.lineWidth = 2; context.beginPath(); context.moveTo(-dishR,-3); context.quadraticCurveTo(0,dishR*.72,dishR,-3); context.stroke();
    context.strokeStyle = night ? "#526b60" : "#89887e"; context.lineWidth = 1;
    for (let i = -3; i <= 3; i += 1) { context.beginPath(); context.moveTo(i*dishR/4,-1); context.lineTo(0,dishR*.51); context.stroke(); }
    context.beginPath(); context.moveTo(0,dishR*.5); context.lineTo(0,-dishR*.18); context.stroke();
    context.fillStyle = night ? "#c09a5c" : "#755329"; context.fillRect(-2,-dishR*.22,4,4);
    context.restore();
    pixel(mastX-3,pivotY-3,night ? "#739484" : "#486556",7,7);
    for (let pulse = 0; pulse < 3; pulse += 1) {
      const radiusPulse = 17 + ((now / 90 + pulse * 24) % 72);
      context.strokeStyle = night ? `rgba(117,159,138,${.28 - pulse*.05})` : `rgba(63,100,81,${.22 - pulse*.04})`;
      context.lineWidth = 1; context.setLineDash([2,4]); context.beginPath(); context.arc(mastX-4,pivotY-7,radiusPulse,-1.35,-.18); context.stroke(); context.setLineDash([]);
    }

    const arrayY = horizon - 8;
    for (let panel = 0; panel < 3; panel += 1) {
      const x = width * .55 + panel * 22;
      polygon([[x,arrayY],[x+18,arrayY-4],[x+18,arrayY+3],[x,arrayY+7]],night ? "#263d3f" : "#4e6260");
      line(x+6,arrayY-1,x+6,arrayY+5,night ? "#63808a" : "#84908b"); line(x+12,arrayY-2,x+12,arrayY+4,night ? "#63808a" : "#84908b");
      line(x+9,arrayY+5,x+9,horizon,night ? "#4d5f58" : "#737770");
    }
    const beaconX = Math.round(width*.88); line(beaconX,horizon,beaconX,horizon-27,night ? "#52655c" : "#706f67");
    line(beaconX,horizon-22,beaconX+9,horizon-15,night ? "#52655c" : "#706f67");
    pixel(beaconX-1,horizon-29,(Math.floor(now/430)%2) ? (night ? "#c67b5f" : "#a34e37") : "#4d3530",3,3);

    const roverX = Math.floor((now / 95) % (width + 60)) - 30, roverY = horizon + Math.round(height*.13);
    pixel(roverX,roverY,night ? "#566b61" : "#5b625d",18,5); pixel(roverX+4,roverY-4,night ? "#263a35" : "#3d4944",9,4);
    pixel(roverX+2,roverY+5,"#111713",4,2); pixel(roverX+13,roverY+5,"#111713",4,2);
    polygon([[roverX+18,roverY+1],[roverX+42,roverY-6],[roverX+42,roverY+8]],night ? "rgba(209,183,122,.12)" : "rgba(255,224,155,.13)");
    pixel(roverX+18,roverY+1,night ? "#d0b36e" : "#8f6934",2,2);

    for (let i = 0; i < 22; i += 1) {
      const x = (i*59 + Math.floor(now/(260+i*9))) % width, y = horizon + (i*31)%Math.max(5,height-horizon);
      pixel(x,y,night ? "rgba(150,143,115,.25)" : "rgba(99,90,72,.20)",1+i%2,1);
    }
  }

  function drawOrbitalFoundry(now) {
    if (state.motion !== "orbital-foundry" || document.hidden) return;
    const frame = pixelFrame(); if (!frame) return;
    const { context, width, height, night } = frame;
    const pixel = (x,y,color,w=1,h=1) => { context.fillStyle=color; context.fillRect(Math.round(x),Math.round(y),Math.max(1,Math.round(w)),Math.max(1,Math.round(h))); };
    const line = (x1,y1,x2,y2,color,size=1) => { context.strokeStyle=color; context.lineWidth=size; context.beginPath(); context.moveTo(Math.round(x1)+.5,Math.round(y1)+.5); context.lineTo(Math.round(x2)+.5,Math.round(y2)+.5); context.stroke(); };
    const polygon = (points,color) => { context.fillStyle=color; context.beginPath(); context.moveTo(points[0][0],points[0][1]); points.slice(1).forEach(([x,y])=>context.lineTo(x,y)); context.closePath(); context.fill(); };

    for (let y=0;y<height;y+=1) pixel(0,y,night ? `rgb(${7+Math.round(y/height*8)},${12+Math.round(y/height*9)},${17+Math.round(y/height*11)})` : `rgb(${177-Math.round(y/height*24)},${180-Math.round(y/height*21)},${174-Math.round(y/height*14)})`,width,1);
    for (let i=0;i<Math.round(width/3);i+=1) {
      const x=(i*97+23)%width, y=(i*53+7)%Math.round(height*.79), phase=(Math.floor(now/620)+i*3)%17;
      pixel(x,y,phase<2?(night?"#d7d4b4":"#645f55"):(night?"#506271":"#9a9990"),phase===0?2:1,1);
    }
    for (let band=0;band<4;band+=1) {
      const y=Math.round(height*(.18+band*.08)+Math.sin(now/9000+band)*3);
      for (let x=0;x<width;x+=5) if ((x+band*13)%17<8) pixel(x,y,night?"rgba(71,86,94,.10)":"rgba(104,93,78,.08)",4,1);
    }

    const planetCX=Math.round(width*.04), planetCY=Math.round(height*1.23), planetR=Math.round(height*.92);
    for (let y=Math.round(height*.42);y<height;y+=1) {
      const dy=y-planetCY, span=Math.sqrt(Math.max(0,planetR*planetR-dy*dy)), end=Math.min(width,planetCX+span);
      if (end<=0) continue;
      const depth=(y-height*.42)/(height*.58);
      pixel(0,y,night?`rgb(${18+Math.round(depth*15)},${31+Math.round(depth*18)},${35+Math.round(depth*17)})`:`rgb(${95+Math.round(depth*29)},${104+Math.round(depth*22)},${99+Math.round(depth*14)})`,end,1);
      pixel(end-2,y,night?"#6f9a8c":"#b9a46f",2,1);
    }
    context.strokeStyle=night?"rgba(99,154,139,.28)":"rgba(152,124,68,.25)"; context.lineWidth=3; context.beginPath(); context.arc(planetCX,planetCY,planetR,-2.38,-.56); context.stroke();
    for(let i=0;i<34;i+=1){const a=-2.30+i*.052,x=planetCX+Math.cos(a)*(planetR-8-(i%3)*5),y=planetCY+Math.sin(a)*(planetR-8-(i%3)*5);if(x>0&&x<width&&y>0&&y<height)pixel(x,y,night?(i%5?"#789883":"#c0a15c"):(i%5?"#d0c49c":"#8b6234"),1+i%2,1);}

    const sx=Math.round(width*.64), sy=Math.round(height*.40), ringX=Math.round(height*.30), ringY=Math.round(height*.115);
    context.strokeStyle=night?"#586f69":"#5f6762"; context.lineWidth=3; context.beginPath(); context.ellipse(sx,sy,ringX,ringY,-.10,0,Math.PI*2); context.stroke();
    context.strokeStyle=night?"#9a8460":"#8a724e"; context.lineWidth=1; context.beginPath(); context.ellipse(sx,sy,ringX-5,ringY-3,-.10,0,Math.PI*2); context.stroke();
    for(let spoke=0;spoke<12;spoke+=1){const a=spoke*Math.PI*2/12-.10;line(sx+Math.cos(a)*8,sy+Math.sin(a)*3,sx+Math.cos(a)*ringX,sy+Math.sin(a)*ringY,night?"#425851":"#767a73");}
    const rotation=now/3200;
    for(let light=0;light<7;light+=1){const a=rotation+light*Math.PI*2/7,x=sx+Math.cos(a)*ringX,y=sy+Math.sin(a)*ringY;pixel(x-1,y-1,light%3===0?(night?"#c99655":"#845b2d"):(night?"#7ca392":"#466957"),3,2);}

    pixel(sx-ringX-31,sy-4,ringX*2+62,9,night?"#1b2826":"#505854");
    pixel(sx-18,sy-9,36,18,night?"#273733":"#69706a"); pixel(sx-8,sy-13,16,26,night?"#324943":"#7a817a");
    pixel(sx-2,sy-18,4,36,night?"#a08353":"#79603d"); pixel(sx-24,sy-2,48,4,night?"#708178":"#9a978a");
    for(let module=0;module<6;module+=1){const x=sx-ringX-25+module*(ringX*2+50)/5;pixel(x,sy-7,8,15,night?"#293b37":"#737871");pixel(x+2,sy-5,4,3,night?"#80998c":"#bbb5a1");}

    const panelColor=night?"#27414c":"#435f65",panelLine=night?"#668493":"#7e9293";
    [[sx-ringX-58,-1],[sx+ringX+17,1]].forEach(([x,side])=>{
      pixel(x,sy-14,panelColor,40,28);for(let gx=4;gx<40;gx+=7)line(x+gx,sy-14,x+gx,sy+14,panelLine);for(let gy=-7;gy<14;gy+=7)line(x,sy+gy,x+40,sy+gy,panelLine);
      line(side<0?x+40:x,sy,side<0?sx-ringX:sx+ringX,sy,night?"#677870":"#777a72",2);
    });
    line(sx,sy-13,sx,sy-35,night?"#718078":"#7c7b72"); pixel(sx-2,sy-39,(Math.floor(now/330)%2)?(night?"#d26f55":"#9c422f"):"#4d302c",5,5);

    const cargoX=Math.floor((now/68)%(width+110))-55,cargoY=Math.round(height*.68+Math.sin(now/1600)*5);
    polygon([[cargoX,cargoY],[cargoX+26,cargoY-5],[cargoX+42,cargoY],[cargoX+26,cargoY+6]],night?"#465b57":"#59625e");
    pixel(cargoX+17,cargoY-3,night?"#233d43":"#3d5559",12,3);pixel(cargoX+38,cargoY-1,night?"#c3a460":"#806033",4,3);
    polygon([[cargoX-2,cargoY-2],[cargoX-18,cargoY-6],[cargoX-18,cargoY+5],[cargoX-2,cargoY+2]],night?"rgba(102,153,137,.18)":"rgba(112,87,52,.15)");
    for(let craft=0;craft<4;craft+=1){const x=(craft*89+Math.floor(now/(180+craft*37)))%width,y=17+craft*19;pixel(x,y,night?"#61777d":"#6b706c",5,1);pixel(x+5,y,night?"#ae8c52":"#78552e",1,1);}
    for(let i=0;i<24;i+=1){const x=(i*43+Math.floor(now/(410+i*11)))%width,y=(i*67+31)%height;pixel(x,y,night?"rgba(123,141,135,.24)":"rgba(82,78,67,.18)",1,1);}
  }

  function drawPixelScene(now) {
    if (state.motion === "pixel-city") drawPixelCity(now);
    else if (state.motion === "lunar-relay") drawLunarRelay(now);
    else if (state.motion === "orbital-foundry") drawOrbitalFoundry(now);
  }

  function pixelCityLoop(now) {
    if (!pixelCityLoop.last || now - pixelCityLoop.last >= 100) {
      drawPixelScene(now);
      pixelCityLoop.last = now;
    }
    requestAnimationFrame(pixelCityLoop);
  }

  function directories() {
    const list = [state.currentDirectory, state.path?.directory, ...state.customDirectories, ...state.sessions.map((s) => s.directory)].filter(Boolean);
    return [...new Set(list)];
  }

  function syncRailSections() {
    const sections = [
      ["projects", els.projectsRail, $("#projectsCollapseButton"), "projects"],
      ["pinnedSessions", els.pinnedSessionsRail, $("#pinnedSessionsCollapseButton"), "pinned sessions"],
      ["sessions", els.sessionsRail, $("#sessionsCollapseButton"), "sessions"],
      ["pins", els.pinnedShelf, $("#pinnedMessagesCollapseButton"), "pinned messages"]
    ];
    sections.forEach(([key, section, button, label]) => {
      const collapsed = Boolean(state.railSections[key]);
      section?.classList.toggle("collapsed", collapsed);
      button?.setAttribute("aria-expanded", String(!collapsed));
      button?.setAttribute("aria-label", `${collapsed ? "Expand" : "Minimize"} ${label}`);
      button?.setAttribute("title", `${collapsed ? "Expand" : "Minimize"} ${label}`);
    });
  }

  function toggleRailSection(key) {
    state.railSections[key] = !state.railSections[key];
    storage.set("seneschal-rail-sections", state.railSections);
    syncRailSections();
  }

  function renderProjects() {
    const dirs = directories();
    els.projectList.innerHTML = dirs.length ? dirs.map((dir) => {
      const count = state.sessions.filter((session) => session.directory === dir && !session.parentID).length;
      const active = dir === state.currentDirectory ? " active" : "";
      return `<button class="project-item${active}" data-directory="${escapeHTML(dir)}" title="${escapeHTML(dir)}"><span class="project-glyph">${escapeHTML(basename(dir).slice(0,1).toUpperCase())}</span><span>${escapeHTML(basename(dir))}</span><small>${count}</small></button>`;
    }).join("") : '<div class="empty-rail">Add a project folder to begin.</div>';
    $$(".project-item", els.projectList).forEach((button) => button.addEventListener("click", () => switchDirectory(button.dataset.directory)));
    syncRailSections();
  }

  function sessionStatus(sessionID) { return state.statuses[sessionID]?.type || "idle"; }

  function toggleSessionPin(sessionID) {
    if (state.archivedSessions.has(sessionID)) { toast("Restore this session before pinning it.", "warn"); return; }
    const active = !state.pinnedSessions.has(sessionID);
    if (active) state.pinnedSessions.add(sessionID); else state.pinnedSessions.delete(sessionID);
    storage.set("seneschal-pinned-sessions", [...state.pinnedSessions]);
    renderSessions();
    toast(active ? "Session pinned to the top." : "Session unpinned.");
  }

  async function toggleSessionArchive(sessionID) {
    const active = !state.archivedSessions.has(sessionID);
    if (active && ["busy", "retry"].includes(sessionStatus(sessionID))) { toast("Stop this session before archiving it.", "warn"); return; }
    if (active) {
      state.archivedSessions.add(sessionID);
      state.pinnedSessions.delete(sessionID);
    } else state.archivedSessions.delete(sessionID);
    storage.set("seneschal-archived-sessions", [...state.archivedSessions]);
    storage.set("seneschal-pinned-sessions", [...state.pinnedSessions]);
    if (!state.archivedSessions.size) state.showArchivedSessions = false;
    if (active && state.currentSessionID === sessionID) {
      const next = state.sessions
        .filter((session) => session.directory === state.currentDirectory && !session.parentID && !state.archivedSessions.has(session.id))
        .sort((a, b) => Number(state.pinnedSessions.has(b.id)) - Number(state.pinnedSessions.has(a.id)) || (b.time?.updated || 0) - (a.time?.updated || 0))[0];
      state.currentSessionID = next?.id || "";
      state.messages = [];
      state.showArchivedMessages = false;
      storage.set("atelier-session", state.currentSessionID);
      renderAll();
      if (next) await refreshMessages(true);
    } else renderSessions();
    toast(active ? "Session archived locally." : "Session restored.");
  }

  function sessionRailItem(session) {
    const active = session.id === state.currentSessionID ? " active" : "";
    const status = sessionStatus(session.id);
    const title = session.title || "Untitled session";
    const pinned = state.pinnedSessions.has(session.id);
    const archived = state.archivedSessions.has(session.id);
    return `<div class="session-item${active}${pinned ? " pinned" : ""}${archived ? " archived" : ""}"><button class="session-open-button" data-session="${escapeHTML(session.id)}" title="Open ${escapeHTML(title)}"><span class="session-copy"><strong>${escapeHTML(title)}</strong><small>${timeAgo(session.time?.updated)} · ${escapeHTML(session.model?.id || "agent")}</small></span><i class="session-dot ${status}"></i></button><button class="session-pin-button${pinned ? " active" : ""}" data-session="${escapeHTML(session.id)}" aria-label="${pinned ? "Unpin" : "Pin"} ${escapeHTML(title)}" title="${pinned ? "Unpin session" : "Pin session to top"}"${archived ? " disabled" : ""}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m8 3 8 8-3 1-4 6-1-6-3-3zM8 16l-4 4"/></svg></button><button class="session-archive-button" data-session="${escapeHTML(session.id)}" aria-label="${archived ? "Restore" : "Archive"} ${escapeHTML(title)}" title="${archived ? "Restore session" : "Archive session"}"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16v13H4zM3 4h18v4H3zM9 12h6"/></svg></button><button class="session-rename-button" data-session="${escapeHTML(session.id)}" aria-label="Rename ${escapeHTML(title)}" title="Rename without opening"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m4 16-.7 4 4-.7L18.6 8 16 5.4 4 16Z"/><path d="m14.5 7 2.6 2.6"/></svg></button></div>`;
  }

  function bindSessionRailActions() {
    [els.pinnedSessionList, els.sessionList].forEach((list) => {
      $$(".session-open-button", list).forEach((button) => button.addEventListener("click", () => selectSession(button.dataset.session)));
      $$(".session-pin-button", list).forEach((button) => button.addEventListener("click", () => toggleSessionPin(button.dataset.session)));
      $$(".session-archive-button", list).forEach((button) => button.addEventListener("click", () => toggleSessionArchive(button.dataset.session)));
      $$(".session-rename-button", list).forEach((button) => button.addEventListener("click", () => renameSession(button.dataset.session)));
    });
  }

  function renderSessions() {
    const allSessions = state.sessions
      .filter((session) => session.directory === state.currentDirectory && !session.parentID)
      .sort((a, b) => Number(state.pinnedSessions.has(b.id)) - Number(state.pinnedSessions.has(a.id)) || (b.time?.updated || 0) - (a.time?.updated || 0));
    const archivedCount = allSessions.filter((session) => state.archivedSessions.has(session.id)).length;
    const pinnedSessions = allSessions.filter((session) => state.pinnedSessions.has(session.id) && !state.archivedSessions.has(session.id));
    const sessions = allSessions.filter((session) => !state.pinnedSessions.has(session.id) && (state.showArchivedSessions || !state.archivedSessions.has(session.id)));
    els.pinnedSessionCount.textContent = String(pinnedSessions.length);
    els.pinnedSessionList.innerHTML = pinnedSessions.length ? pinnedSessions.map(sessionRailItem).join("") : '<div class="empty-rail">Pin a session to keep it here.</div>';
    els.sessionCount.textContent = String(sessions.length);
    els.archivedSessionsButton.hidden = !archivedCount;
    els.archivedSessionsButton.setAttribute("aria-pressed", String(state.showArchivedSessions));
    els.archivedSessionsButton.setAttribute("aria-label", `${state.showArchivedSessions ? "Hide" : "Show"} ${archivedCount} archived session${archivedCount === 1 ? "" : "s"}`);
    els.archivedSessionsButton.title = `${state.showArchivedSessions ? "Hide" : "Show"} archived sessions`;
    els.archivedSessionsCount.textContent = String(archivedCount);
    $("#settingsArchives").textContent = `${state.archivedSessions.size} archived`;
    els.sessionList.innerHTML = sessions.length ? sessions.map(sessionRailItem).join("") : '<div class="empty-rail">No unpinned sessions in this project.</div>';
    bindSessionRailActions();
    syncRailSections();
  }

  function flattenModels() {
    const connected = new Set(state.providers.connected || []);
    const curated = {
      google: ["gemini-3.7-flash", "gemini-3.5-flash-lite", "gemini-3.1-pro-preview", "gemini-2.5-flash-lite"],
      openai: ["gpt-5.6-terra", "gpt-5.6-luna", "gpt-5.6-sol"],
      deepseek: ["deepseek-v4-flash", "deepseek-v4-pro"]
    };
    const list = [];
    for (const provider of state.providers.all || []) {
      if (connected.size && !connected.has(provider.id)) continue;
      for (const model of Object.values(provider.models || {})) {
        if (curated[provider.id] && !curated[provider.id].includes(model.id)) continue;
        if (!(model.capabilities?.input?.text ?? true) || !(model.capabilities?.toolcall ?? model.tool_call ?? true)) continue;
        list.push({ ...model, providerID: model.providerID || provider.id, providerName: provider.name, value: `${model.providerID || provider.id}/${model.id}` });
      }
    }
    const providerOrder = ["openai", "google", "opencode", "deepseek"];
    return list.sort((a, b) => {
      const pa = curated[a.providerID]?.indexOf(a.id) ?? 99;
      const pb = curated[b.providerID]?.indexOf(b.id) ?? 99;
      return a.providerID === b.providerID ? pa - pb : providerOrder.indexOf(a.providerID) - providerOrder.indexOf(b.providerID);
    });
  }

  function renderModels() {
    state.models = flattenModels();
    const current = selectedSession();
    const sessionRef = current?.model ? `${current.model.providerID}/${current.model.id || current.model.modelID}` : "";
    if (!state.models.some((model) => model.value === state.selectedModel)) state.selectedModel = state.models.some((model) => model.value === sessionRef) ? sessionRef : state.models[0]?.value || "";
    const groups = new Map();
    state.models.forEach((model) => {
      if (!groups.has(model.providerName)) groups.set(model.providerName, []);
      groups.get(model.providerName).push(model);
    });
    els.model.innerHTML = [...groups.entries()].map(([provider, models]) => `<optgroup label="${escapeHTML(provider)}">${models.map((model) => `<option value="${escapeHTML(model.value)}"${model.value === state.selectedModel ? " selected" : ""}>${escapeHTML(model.name)}</option>`).join("")}</optgroup>`).join("");
    storage.set("atelier-model", state.selectedModel);
    renderModelCapability();
    renderModelVariants();
  }

  function renderModelVariants() {
    const model = selectedModel();
    const variants = Object.keys(model?.variants || {});
    els.modelVariantWrap.hidden = variants.length === 0;
    if (!variants.length) { els.modelVariant.innerHTML = ""; return; }
    const preferred = state.selectedVariants[model.value];
    const selected = variants.includes(preferred) ? preferred : variants.includes("medium") ? "medium" : variants[0];
    state.selectedVariants[model.value] = selected;
    storage.set("atelier-model-variants", state.selectedVariants);
    const labels = { none: "None", minimal: "Minimal", low: "Low", medium: "Medium", high: "High", xhigh: "Extra high", max: "Maximum", fast: "Fast", standard: "Standard" };
    els.modelVariant.innerHTML = variants.map((variant) => `<option value="${escapeHTML(variant)}"${variant === selected ? " selected" : ""}>${escapeHTML(labels[variant] || variant)}</option>`).join("");
  }

  function renderModelCapability() {
    const model = selectedModel();
    if (!model) {
      els.capability.textContent = "Connect a provider";
      return;
    }
    if (state.selectedAgent === "chat") {
      const inputs = model.capabilities?.input || {};
      els.capability.textContent = inputs.image || model.attachment ? "Text + vision · chat only" : "Text · chat only";
      els.providerOrb.style.background = "var(--cobalt)";
      return;
    }
    if (false && model.providerID === "opencode" && model.id === "x-preview-f-free") {
      els.capability.textContent = "Text + reasoning · chat only";
      els.providerOrb.style.background = "var(--ochre)";
      return;
    }
    const capabilities = model.capabilities || {};
    const inputs = capabilities.input || {};
    const parts = ["Text"];
    if (inputs.image || model.attachment) parts.push("vision");
    if (inputs.audio) parts.push("audio");
    if (capabilities.toolcall || model.tool_call) parts.push("tools");
    els.capability.textContent = parts.join(" + ");
    const colors = { openai: "var(--forest)", google: "var(--cobalt)", anthropic: "var(--clay)", "hpc-ai": "var(--ochre)" };
    els.providerOrb.style.background = colors[model.providerID] || "var(--cobalt)";
  }

  function renderAgents() {
    const visible = state.agents.filter((agent) => !agent.hidden && agent.mode !== "subagent");
    const choices = visible.length ? [...visible] : [{ name: "build", description: "Default agent" }];
    if (!choices.some((agent) => agent.name === "chat")) choices.push({ name: "chat", description: "Conversation only · no tools or actions" });
    if (!choices.some((agent) => agent.name === state.selectedAgent)) state.selectedAgent = choices[0].name;
    els.agent.innerHTML = choices.map((agent) => `<option value="${escapeHTML(agent.name)}"${agent.name === state.selectedAgent ? " selected" : ""}>${escapeHTML(agentDisplayName(agent.name))}</option>`).join("");
    els.inspectorAgent.textContent = agentDisplayName(state.selectedAgent);
  }

  function agentDisplayName(name = "build") {
    const labels = { build: "Seneschal · Build", plan: "Seneschal · Plan", chat: "Seneschal · Chat" };
    return labels[name] || name.split(/[-_]/).map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(" ");
  }

  function renderInspector() {
    const permission = state.config?.permission || {};
    if (state.selectedAgent === "chat") {
      const denied = ["read", "edit", "bash", "external directory", "webfetch", "websearch", "browser", "blender"];
      els.policyList.innerHTML = denied.map((name) => `<div class="policy-row deny"><i></i><span>${name}</span><strong>OFF</strong></div>`).join("");
      els.toolGrid.innerHTML = '<div class="empty-rail">Chat mode has no active tools.</div>';
      els.toolCount.textContent = "0";
    } else {
      const agentPermission = state.config?.agent?.[state.selectedAgent]?.permission || {};
      const preferred = ["read", "edit", "bash", "external_directory", "webfetch", "websearch", "playwright_*", "blender_*"];
      const rules = preferred.filter((key) => agentPermission[key] ?? permission[key]).map((key) => {
        const value = agentPermission[key] ?? permission[key];
        return [key, typeof value === "object" ? (key === "read" ? "allow*" : "rules") : value];
      });
      els.policyList.innerHTML = rules.length ? rules.map(([name, action]) => `<div class="policy-row ${escapeHTML(action.replace("*", ""))}"><i></i><span>${escapeHTML(name.replaceAll("_", " "))}</span><strong>${escapeHTML(action)}</strong></div>`).join("") : '<div class="empty-rail">Policy will appear when a project is selected.</div>';
      const toolNames = state.tools.filter((tool) => tool && tool !== "invalid").slice(0, 10);
      els.toolGrid.innerHTML = toolNames.map((tool) => `<div class="tool-chip" title="${escapeHTML(tool)}"><i></i><span>${escapeHTML(tool)}</span></div>`).join("");
      els.toolCount.textContent = String(state.tools.filter((tool) => tool !== "invalid").length);
    }

    const connected = new Set(state.providers.connected || []);
    const providers = (state.providers.all || []).filter((provider) => connected.has(provider.id));
    els.providerList.innerHTML = providers.slice(0, 6).map((provider) => `<div class="provider-row"><i></i><span>${escapeHTML(provider.name)}</span><small>${state.models.filter((model) => model.providerID === provider.id).length} curated</small></div>`).join("") || '<div class="empty-rail">No connected providers reported.</div>';
    els.providerCount.textContent = `${providers.length} LIVE`;
    $("#settingsProviders").textContent = `${providers.length} connected`;
    renderBrowser();
    renderBlender();
    renderPaidUsage();
  }

  function browserConnection() {
    const entry = state.mcp?.playwright;
    const status = typeof entry === "string" ? entry : entry?.status;
    return status || "disconnected";
  }

  function renderBrowser() {
    const status = browserConnection();
    const connected = status === "connected";
    const runtimeAvailable = Boolean(state.browserRuntime?.available);
    const visible = Boolean(state.browserRuntime?.visible);
    els.browserState.textContent = connected ? "READY" : status.toUpperCase();
    els.browserState.style.color = connected ? "var(--forest)" : "var(--danger)";
    els.browserCard.className = `browser-card ${connected ? "connected" : "error"}`;
    els.browserDetail.textContent = connected ? "Navigate, click, type, inspect, screenshot" : "Browser bridge is not available";
    $("#browserTryButton").disabled = !connected;
    $("#browserButton").disabled = !connected;
    [els.browserWindow, els.browserWindowCard].forEach((button) => {
      if (!button) return;
      button.disabled = !runtimeAvailable || Boolean(state.browserRuntime?.restarting);
      button.setAttribute("aria-pressed", String(visible));
      const label = visible ? "Hide" : "Show";
      const span = $("span", button);
      if (span) span.textContent = button === els.browserWindowCard ? `${label} window` : label;
      button.setAttribute("aria-label", `${label} the agent-controlled Brave window`);
      button.setAttribute("title", `${label} the agent-controlled Brave window`);
    });
    $("#settingsBrowser").textContent = !runtimeAvailable ? "Unavailable" : visible ? "Visible Brave" : connected ? "Connected · hidden" : "Hidden mode";
  }

  function blenderMcpConnection() {
    const entry = state.mcp?.blender;
    return (typeof entry === "string" ? entry : entry?.status) || "disconnected";
  }

  function renderBlender() {
    const mcpConnected = blenderMcpConnection() === "connected";
    const bridgeOnline = Boolean(state.blender?.bridge);
    els.blenderCard.className = `integration-card ${bridgeOnline ? "online" : ""}`;
    els.blenderState.textContent = bridgeOnline ? "LIVE" : mcpConnected ? "READY" : "OFFLINE";
    els.blenderState.style.color = bridgeOnline ? "var(--forest)" : mcpConnected ? "var(--ochre)" : "var(--danger)";
    els.blenderDetail.textContent = bridgeOnline ? "Blender bridge is live on this PC" : mcpConnected ? "Ready — open Blender when needed" : "MCP bridge is not connected";
    $("#openBlenderButton").disabled = !state.blender?.installed;
    $("#settingsBlender").textContent = bridgeOnline ? "Live" : mcpConnected ? "Ready" : "Unavailable";
  }

  function renderPaidUsage() {
    const usage = state.paidUsage || {};
    const cost = Number.isFinite(usage.cost) ? usage.cost : null;
    const budget = usage.budget || 10;
    const percent = cost === null ? 0 : Math.min(100, Math.round((cost / budget) * 100));
    els.budgetMeter.style.width = `${percent}%`;
    els.budgetMeter.className = percent >= 100 ? "danger" : percent >= 80 ? "warning" : "";
    els.budgetAmount.textContent = cost === null ? "Estimate unavailable" : `$${cost.toFixed(2)} of $${budget.toFixed(0)}`;
    els.budgetState.textContent = percent >= 100 ? "TARGET REACHED" : percent >= 80 ? "NEAR LIMIT" : "$10 TARGET";
    els.budgetState.style.color = percent >= 100 ? "var(--danger)" : percent >= 80 ? "var(--ochre)" : "var(--forest)";
    $("#settingsBudget").textContent = cost === null ? "$10 / month" : `$${cost.toFixed(2)} estimated / $${budget.toFixed(0)}`;
  }

  function refreshWorkspaceMeta() {
    workspace("/workspace/blender-health").then((blender) => { state.blender = blender; renderBlender(); }).catch(() => renderBlender());
    workspace("/workspace/usage").then((usage) => { state.paidUsage = usage; renderPaidUsage(); }).catch(() => renderPaidUsage());
    workspace("/workspace/browser-mode").then((runtime) => { state.browserRuntime = runtime; renderBrowser(); }).catch(() => renderBrowser());
  }

  async function toggleBrowserWindow() {
    if (!state.browserRuntime?.available || state.browserRuntime?.restarting) return;
    const visible = !state.browserRuntime.visible;
    state.browserRuntime.restarting = true;
    renderBrowser();
    try {
      state.browserRuntime = await workspace("/workspace/browser-mode", { method: "POST", body: { visible } });
      renderBrowser();
      toast(visible
        ? "Visible Brave enabled. The agent-controlled window will appear on its next browser action."
        : "Hidden browser mode enabled. The agent browser will run without a visible window.");
      setTimeout(() => refreshDirectoryData(), 1200);
    } catch (error) {
      state.browserRuntime.restarting = false;
      renderBrowser();
      toast(`Could not change browser visibility: ${error.message}`, "error");
    }
  }

  async function openBlender() {
    try {
      await workspace("/workspace/blender/open", { method: "POST" });
      toast("Opening Blender. Its MCP bridge starts automatically.");
      setTimeout(() => refreshWorkspaceMeta(), 3500);
    } catch (error) { toast(`Could not open Blender: ${error.message}`, "error"); }
  }

  async function backupNow() {
    try {
      await workspace("/workspace/backup", { method: "POST" });
      toast("Sanitized backup started. It will appear in Documents shortly.");
    } catch (error) { toast(`Could not start the backup: ${error.message}`, "error"); }
  }

  function instructionEndpoint() {
    const url = new URL("/workspace/instructions", location.origin);
    if (state.currentDirectory) url.searchParams.set("directory", state.currentDirectory);
    return `${url.pathname}${url.search}`;
  }

  function instructionKindEditor(kind) {
    return {
      persona: els.personaEditor,
      general: els.generalEditor,
      project: els.projectEditor,
      "agent-build": els.buildAgentEditor,
      "agent-plan": els.planAgentEditor
    }[kind];
  }

  function setInstructionState(label, mode = "") {
    els.instructionSaveState.className = mode;
    els.instructionSaveState.innerHTML = `<i></i>${escapeHTML(label)}`;
  }

  function instructionFailure(message = "") {
    els.instructionError.hidden = !message;
    els.instructionError.textContent = message;
    if (message) setInstructionState("Needs attention", "error");
  }

  function markInstructionsDirty() {
    state.instructionsDirty = true;
    setInstructionState("Unsaved changes", "saving");
    renderInstructionCounts();
  }

  function shortManagedPath(filename = "") {
    if (!filename) return "No project selected";
    if (/AGENTS\.md$/i.test(filename) && /\.config[\\/]opencode/i.test(filename)) return "OpenCode · Global persona";
    if (/GENERAL\.md$/i.test(filename)) return "OpenCode · General rules";
    if (/AGENTS\.md$/i.test(filename)) return `${basename(state.currentDirectory)} · AGENTS.md`;
    return basename(filename);
  }

  function renderInstructionCounts() {
    const pairs = [["#personaCount", els.personaEditor], ["#generalCount", els.generalEditor], ["#projectCount", els.projectEditor]];
    pairs.forEach(([selector, editor]) => { const target = $(selector); if (target && editor) target.textContent = `${editor.value.length.toLocaleString()} characters`; });
  }

  function skillKey(skill) {
    return skill.scope === "project" ? `project:${state.currentDirectory}:${skill.id}` : `global:${skill.id}`;
  }

  function currentActiveSkills() {
    const available = state.instructionData?.skills || [];
    return available.filter((skill) => state.selectedSkills.includes(skillKey(skill)));
  }

  function renderActiveSkillCount() {
    const count = currentActiveSkills().length;
    els.activeSkillCount.textContent = String(count);
    $("#skillsButton")?.classList.toggle("has-skills", count > 0);
    const settings = $("#settingsInstructions");
    if (settings) settings.textContent = count ? `${count} skill${count === 1 ? "" : "s"} active` : "Ready";
  }

  function selectSkillForEditing(key = "") {
    state.activeSkillKey = key;
    state.archiveSkillArmed = false;
    els.archiveSkill.textContent = "Archive skill";
    const skill = (state.instructionData?.skills || []).find((item) => skillKey(item) === key);
    if (!skill) { newSkill(); return; }
    els.skillName.value = skill.id;
    els.skillName.disabled = true;
    els.skillScope.value = skill.scope;
    els.skillScope.disabled = true;
    els.skillEditor.value = skill.content || "";
    state.inspectedSkillSource = "";
    els.skillLinkInstaller.hidden = true;
    els.saveSkill.textContent = "Save skill";
    els.archiveSkill.disabled = false;
    renderSkills();
  }

  function renderSkills() {
    const skills = state.instructionData?.skills || [];
    $("#skillListCount").textContent = String(skills.length);
    els.skillList.innerHTML = skills.length ? skills.map((skill) => {
      const key = skillKey(skill);
      const checked = state.selectedSkills.includes(key);
      return `<div class="skill-row${key === state.activeSkillKey ? " editing" : ""}"><input type="checkbox" aria-label="Activate ${escapeHTML(skill.name)}" data-skill-toggle="${escapeHTML(key)}"${checked ? " checked" : ""}/><button type="button" data-skill-key="${escapeHTML(key)}"><strong>${escapeHTML(skill.name)}</strong><small>${escapeHTML(skill.description || "No description")}</small><em>${escapeHTML(skill.scope)}</em></button></div>`;
    }).join("") : '<div class="studio-empty">No skills yet. Create one for reusable expertise.</div>';
    $$('[data-skill-key]', els.skillList).forEach((button) => button.addEventListener("click", () => selectSkillForEditing(button.dataset.skillKey)));
    $$('[data-skill-toggle]', els.skillList).forEach((checkbox) => checkbox.addEventListener("change", () => {
      const key = checkbox.dataset.skillToggle;
      state.selectedSkills = checkbox.checked ? [...new Set([...state.selectedSkills, key])] : state.selectedSkills.filter((item) => item !== key);
      storage.set("seneschal-active-skills", state.selectedSkills);
      renderActiveSkillCount();
      renderInstructionStack();
    }));
    renderActiveSkillCount();
  }

  function renderInstructionStack() {
    if (!state.instructionData) return;
    if (state.selectedAgent === "chat") {
      const chatRule = "Conversation only. Every tool, file action, command, browser action, external request, and Blender action is disabled.";
      $("#instructionStack").innerHTML = `<article class="stack-card"><header><strong>Chat-only role</strong><span>per request</span></header><pre>${escapeHTML(chatRule)}</pre></article>`;
      $("#instructionBackupCount").textContent = `${state.instructionData.backupCount || 0} backup${state.instructionData.backupCount === 1 ? "" : "s"}`;
      return;
    }
    const selectedRole = state.selectedAgent.includes("plan") ? "plan" : "build";
    const stack = [
      ["Persona", "global", els.personaEditor.value],
      ["General instructions", "global", els.generalEditor.value],
      ["Project instructions", state.currentDirectory ? basename(state.currentDirectory) : "inactive", els.projectEditor.value],
      [`${selectedRole === "plan" ? "Plan" : "Build"} role`, "per request", selectedRole === "plan" ? els.planAgentEditor.value : els.buildAgentEditor.value]
    ];
    const cards = stack.map(([title, scope, content]) => `<article class="stack-card"><header><strong>${escapeHTML(title)}</strong><span>${escapeHTML(scope)}</span></header><pre>${escapeHTML(content.trim() || "No instructions saved.")}</pre></article>`).join("");
    const active = currentActiveSkills();
    const skills = `<article class="stack-card skill-summary"><header><strong>Selected skills</strong><span>${active.length} active</span></header><pre>${escapeHTML(active.length ? active.map((skill) => `${skill.name} — ${skill.description}`).join("\n") : "No skills selected for the next request.")}</pre></article>`;
    $("#instructionStack").innerHTML = cards + skills;
    $("#instructionBackupCount").textContent = `${state.instructionData.backupCount || 0} backup${state.instructionData.backupCount === 1 ? "" : "s"}`;
  }

  function populateInstructionEditors() {
    const data = state.instructionData;
    if (!data) return;
    els.personaEditor.value = data.persona?.content || "";
    els.generalEditor.value = data.general?.content || "";
    els.projectEditor.value = data.project?.content || "";
    els.projectEditor.disabled = !data.project?.available;
    els.buildAgentEditor.value = data.roles?.build || "";
    els.planAgentEditor.value = data.roles?.plan || "";
    $("#personaPath").textContent = shortManagedPath(data.persona?.path);
    $("#generalPath").textContent = shortManagedPath(data.general?.path);
    $("#projectInstructionPath").textContent = shortManagedPath(data.project?.path);
    const projectStatus = $("#projectInstructionStatus");
    projectStatus.classList.toggle("ready", Boolean(data.project?.available));
    $("span", projectStatus).textContent = data.project?.available ? `Editing rules for ${basename(state.currentDirectory)}.` : "Select a project to edit its instructions.";
    $('[data-save-instruction="project"]').disabled = !data.project?.available;
    $('[data-undo-instruction="project"]').disabled = !data.project?.available;
    $('[data-default-instruction="project"]').disabled = !data.project?.available;
    els.skillScope.querySelector('option[value="project"]').disabled = !data.project?.available;
    if (!data.project?.available && els.skillScope.value === "project") els.skillScope.value = "global";
    state.selectedSkills = state.selectedSkills.filter((key) => !key.startsWith("project:") || (data.skills || []).some((skill) => skillKey(skill) === key));
    storage.set("seneschal-active-skills", state.selectedSkills);
    renderInstructionCounts();
    renderSkills();
    renderInstructionStack();
    state.instructionsDirty = false;
    setInstructionState("All changes saved");
    instructionFailure();
  }

  async function refreshInstructionData(populate = false) {
    try {
      state.instructionData = await workspace(instructionEndpoint());
      if (populate || els.instructionDialog.open) populateInstructionEditors();
      else renderActiveSkillCount();
      return state.instructionData;
    } catch (error) {
      if (els.instructionDialog.open) instructionFailure(error.message);
      return null;
    }
  }

  function showInstructionTab(tab) {
    state.instructionTab = tab;
    $$('[data-instruction-tab]').forEach((button) => button.classList.toggle("active", button.dataset.instructionTab === tab));
    $$('[data-instruction-panel]').forEach((panel) => panel.classList.toggle("active", panel.dataset.instructionPanel === tab));
    if (tab === "preview") renderInstructionStack();
  }

  async function openInstructionStudio(tab = "persona") {
    if (els.settingsDialog.open) els.settingsDialog.close();
    showInstructionTab(tab);
    instructionFailure();
    if (!els.instructionDialog.open) els.instructionDialog.showModal();
    setInstructionState("Loading", "saving");
    await refreshInstructionData(true);
  }

  function closeInstructionStudio() {
    if (state.instructionsDirty && !window.confirm("Close without saving your latest instruction edits?")) return;
    state.instructionsDirty = false;
    els.instructionDialog.close();
  }

  async function saveInstruction(kind) {
    const editor = instructionKindEditor(kind);
    if (!editor || (kind === "project" && !state.currentDirectory)) return;
    setInstructionState("Saving", "saving");
    instructionFailure();
    try {
      const result = await workspace("/workspace/instructions/save", { method: "POST", body: { kind, content: editor.value, directory: state.currentDirectory } });
      state.instructionData = result.snapshot;
      populateInstructionEditors();
      toast(`${kind.replace("agent-", "")} instructions saved and backed up.`);
    } catch (error) { instructionFailure(error.message); toast(`Could not save instructions: ${error.message}`, "error"); }
  }

  async function undoInstruction(kind) {
    setInstructionState("Restoring", "saving");
    instructionFailure();
    try {
      const result = await workspace("/workspace/instructions/undo", { method: "POST", body: { kind, directory: state.currentDirectory } });
      state.instructionData = result.snapshot;
      populateInstructionEditors();
      toast("Previous instruction version restored.");
    } catch (error) { instructionFailure(error.message); toast(error.message, "warn"); }
  }

  function newSkill() {
    state.activeSkillKey = "";
    state.archiveSkillArmed = false;
    els.skillName.disabled = false;
    els.skillScope.disabled = false;
    els.skillName.value = "";
    els.skillScope.value = state.currentDirectory ? "project" : "global";
    els.skillEditor.value = "";
    state.inspectedSkillSource = "";
    els.skillLinkResult.hidden = true;
    els.skillLinkResult.innerHTML = "";
    els.saveSkill.textContent = "Save skill";
    els.archiveSkill.disabled = true;
    els.archiveSkill.textContent = "Archive skill";
    renderSkills();
    els.skillName.focus();
  }

  function openSkillLinkInstaller() {
    newSkill();
    els.skillScope.value = "global";
    els.skillLinkInstaller.hidden = false;
    els.skillLink.focus();
  }

  function showSkillLinkResult(message, tone = "") {
    els.skillLinkResult.hidden = false;
    els.skillLinkResult.className = `skill-link-result ${tone}`;
    els.skillLinkResult.innerHTML = message;
  }

  async function inspectSkillLink() {
    const url = els.skillLink.value.trim();
    if (!url) { showSkillLinkResult("Paste a GitHub skill link first.", "error"); els.skillLink.focus(); return; }
    els.inspectSkillLink.disabled = true;
    els.inspectSkillLink.textContent = "Inspecting…";
    showSkillLinkResult("Reading the skill safely. Nothing has been installed.", "loading");
    instructionFailure();
    try {
      const result = await workspace("/workspace/skills/inspect-link", { method: "POST", body: { url } });
      const skill = result.skill;
      state.inspectedSkillSource = skill.source;
      state.activeSkillKey = "";
      els.skillName.disabled = false;
      els.skillScope.disabled = false;
      els.skillName.value = skill.id;
      els.skillEditor.value = skill.content;
      els.archiveSkill.disabled = true;
      els.saveSkill.textContent = "Install skill";
      const foundAt = skill.resolvedPath ? ` · Found ${escapeHTML(skill.resolvedPath)}` : "";
      showSkillLinkResult(`<strong>${escapeHTML(skill.name)}</strong><span>${escapeHTML(skill.description)}</span><small>${escapeHTML(Number(skill.bytes).toLocaleString())} bytes checked${foundAt} · Review the instructions below, choose its scope, then select Install skill.</small>`, "ready");
      markInstructionsDirty();
      toast(`${skill.name} is ready to review.`);
    } catch (error) {
      state.inspectedSkillSource = "";
      showSkillLinkResult(escapeHTML(error.message), "error");
    } finally {
      els.inspectSkillLink.disabled = false;
      els.inspectSkillLink.textContent = "Inspect";
    }
  }

  async function saveSkill() {
    const id = els.skillName.value.trim().toLowerCase();
    const scope = els.skillScope.value;
    if (scope === "project" && !state.currentDirectory) { instructionFailure("Select a project before creating a project skill."); return; }
    setInstructionState("Saving skill", "saving");
    instructionFailure();
    try {
      const result = await workspace("/workspace/skills/save", { method: "POST", body: { id, scope, content: els.skillEditor.value, directory: state.currentDirectory } });
      state.instructionData = result.snapshot;
      state.activeSkillKey = scope === "project" ? `project:${state.currentDirectory}:${id}` : `global:${id}`;
      populateInstructionEditors();
      selectSkillForEditing(state.activeSkillKey);
      toast(state.inspectedSkillSource ? `${id} installed from its reviewed link.` : `${id} skill saved.`);
      state.inspectedSkillSource = "";
      els.skillLinkInstaller.hidden = true;
    } catch (error) { instructionFailure(error.message); toast(`Could not save skill: ${error.message}`, "error"); }
  }

  async function archiveCurrentSkill() {
    const skill = (state.instructionData?.skills || []).find((item) => skillKey(item) === state.activeSkillKey);
    if (!skill) return;
    if (!state.archiveSkillArmed) {
      state.archiveSkillArmed = true;
      els.archiveSkill.textContent = "Click again to archive";
      setTimeout(() => { state.archiveSkillArmed = false; if (els.archiveSkill) els.archiveSkill.textContent = "Archive skill"; }, 4500);
      return;
    }
    setInstructionState("Archiving", "saving");
    try {
      const result = await workspace("/workspace/skills/archive", { method: "POST", body: { id: skill.id, scope: skill.scope, directory: state.currentDirectory } });
      state.selectedSkills = state.selectedSkills.filter((key) => key !== state.activeSkillKey);
      storage.set("seneschal-active-skills", state.selectedSkills);
      state.instructionData = result.snapshot;
      newSkill();
      populateInstructionEditors();
      toast(`${skill.name} archived. Its folder is recoverable.`);
    } catch (error) { instructionFailure(error.message); toast(`Could not archive skill: ${error.message}`, "error"); }
  }

  function runtimeInstructionSystem() {
    const data = state.instructionData;
    if (state.selectedAgent === "chat") return "Chat-only mode: respond conversationally using only the prompt and attached content. Do not invoke, request, or claim access to tools, files, commands, browsers, external services, Blender, or system actions. Be clear when an action requires switching to Build or Plan mode.";
    if (!data) return "";
    const role = state.selectedAgent.includes("plan") ? "plan" : "build";
    const sections = [];
    const roleText = data.roles?.[role]?.trim();
    if (roleText) sections.push(`Seneschal ${role} role instructions:\n${roleText}`);
    const skills = currentActiveSkills();
    if (skills.length) sections.push(`For this request, use the OpenCode skill tool to load and follow these exact skills: ${[...new Set(skills.map((skill) => skill.id))].join(", ")}.`);
    return sections.join("\n\n");
  }

  function renderHeader() {
    const session = selectedSession();
    els.sessionHeader.hidden = !session;
    if (!session) { els.composerStop.hidden = true; els.send.hidden = false; return; }
    els.sessionTitle.textContent = session.title || "Untitled session";
    els.projectEyebrow.textContent = basename(session.directory).toUpperCase();
    const status = sessionStatus(session.id);
    els.sessionStatus.className = `status-chip ${status}`;
    $("span", els.sessionStatus).textContent = status;
    const working = status === "busy" || status === "retry";
    els.abortButton.disabled = !working;
    els.composerStop.hidden = !working;
    els.send.hidden = working;
  }

  function renderUsage() {
    const session = selectedSession();
    const model = selectedModel();
    const used = session?.tokens?.input || session?.tokens?.total || 0;
    const limit = model?.limit?.context || 0;
    const percent = limit ? Math.min(100, Math.round((used / limit) * 100)) : 0;
    els.usagePercent.textContent = `${percent}%`;
    els.usageMeter.style.width = `${percent}%`;
    els.usageDetail.textContent = session ? `${Number(used).toLocaleString()} of ${limit ? Number(limit).toLocaleString() : "—"} tokens` : "Ready for a new session";
  }

  function renderAttachment(part) {
    if (part.mime?.startsWith("image/") && part.url) return `<img class="attachment-image" src="${escapeHTML(part.url)}" alt="${escapeHTML(part.filename || "Attached image")}" />`;
    return `<div class="patch-part">Attachment · ${escapeHTML(part.filename || part.mime || "file")}</div>`;
  }

  function renderTool(part) {
    const status = part.state?.status || "pending";
    const title = part.state?.title || part.tool || "Tool";
    const output = part.state?.output || part.state?.error || "";
    return `<section class="tool-part ${escapeHTML(status)}"><header><strong>${escapeHTML(part.tool || "tool")}</strong><span>${escapeHTML(title)}</span><span class="tool-status">${escapeHTML(status)}</span></header>${output ? `<pre>${escapeHTML(output)}</pre>` : ""}</section>`;
  }

  function renderPart(part) {
    if (!part) return "";
    if (part.type === "text") return formatText(part.text || "");
    if (part.type === "reasoning") return `<details class="reasoning-part" open><summary>Model thinking summary</summary><div>${formatText(part.text || "")}</div></details>`;
    if (part.type === "tool") return renderTool(part);
    if (part.type === "file") return renderAttachment(part);
    if (part.type === "patch") return `<div class="patch-part">Changed ${part.files?.length || 0} file${part.files?.length === 1 ? "" : "s"}: ${escapeHTML((part.files || []).join(", "))}</div>`;
    if (part.type === "subtask") return `<div class="patch-part">Delegated to ${escapeHTML(part.agent)} · ${escapeHTML(part.description)}</div>`;
    return "";
  }

  function liveActivityText() {
    const parts = state.messages.flatMap((message) => message.parts || []).slice().reverse();
    const runningTool = parts.find((part) => part.type === "tool" && ["pending", "running"].includes(part.state?.status));
    if (runningTool) {
      if (runningTool.tool === "question") return "Waiting for your answer";
      const title = runningTool.state?.title || runningTool.tool || "tool";
      return `Using ${String(title).replace(/[_-]+/g, " ")}`;
    }
    const reasoning = parts.find((part) => part.type === "reasoning" && String(part.text || "").trim());
    if (reasoning) {
      const summary = String(reasoning.text).replace(/\s+/g, " ").trim();
      return `Thinking summary: ${summary.length > 140 ? `${summary.slice(0, 137)}...` : summary}`;
    }
    const text = parts.find((part) => part.type === "text" && String(part.text || "").trim());
    return text ? "Writing the response" : "Starting the task";
  }

  function storedMessageIDs(collection, sessionID = state.currentSessionID) {
    return new Set(Array.isArray(collection?.[sessionID]) ? collection[sessionID] : []);
  }

  function saveMessageIDs(collection, storageKey, ids, sessionID = state.currentSessionID) {
    if (!sessionID) return;
    collection[sessionID] = [...ids];
    if (!collection[sessionID].length) delete collection[sessionID];
    storage.set(storageKey, collection);
  }

  function toggleMessagePin(messageID) {
    const pinned = storedMessageIDs(state.pinnedMessages);
    const archived = storedMessageIDs(state.archivedMessages);
    if (archived.has(messageID)) { toast("Restore this message before pinning it.", "warn"); return; }
    const active = !pinned.has(messageID);
    if (active) pinned.add(messageID); else pinned.delete(messageID);
    saveMessageIDs(state.pinnedMessages, "seneschal-pinned-messages", pinned);
    renderMessages();
    toast(active ? "Message pinned for this conversation." : "Message unpinned.");
  }

  function toggleMessageArchive(messageID) {
    const archived = storedMessageIDs(state.archivedMessages);
    const pinned = storedMessageIDs(state.pinnedMessages);
    const active = !archived.has(messageID);
    if (active) {
      archived.add(messageID);
      pinned.delete(messageID);
    } else {
      archived.delete(messageID);
    }
    saveMessageIDs(state.archivedMessages, "seneschal-archived-messages", archived);
    saveMessageIDs(state.pinnedMessages, "seneschal-pinned-messages", pinned);
    if (!archived.size) state.showArchivedMessages = false;
    renderMessages();
    toast(active ? "Message archived locally. Use the archive counter to restore it." : "Message restored.");
  }

  function locateMessage(messageID) {
    const archived = storedMessageIDs(state.archivedMessages);
    if (archived.has(messageID) && !state.showArchivedMessages) {
      state.showArchivedMessages = true;
      renderMessages();
    }
    requestAnimationFrame(() => {
      const target = $(`[data-message="${CSS.escape(messageID)}"]`, els.messageList);
      if (!target) return;
      state.userScrolledAway = true;
      target.scrollIntoView({ behavior: "smooth", block: "center" });
      target.classList.add("message-located");
      setTimeout(() => target.classList.remove("message-located"), 1100);
    });
  }

  function renderPinnedMessages(pinned, archived) {
    const messages = state.messages.filter((message) => pinned.has(message.info?.id) && !archived.has(message.info?.id));
    els.pinnedShelf.hidden = !messages.length;
    els.pinnedCount.textContent = String(messages.length);
    els.pinnedList.innerHTML = messages.map((message, index) => {
      const role = message.info?.role === "user" ? "You" : "Seneschal";
      return `<button type="button" class="pinned-message-item" data-pinned-message="${escapeHTML(message.info?.id || "")}" title="Jump to pinned message"><strong>${escapeHTML(role)}</strong><span>${escapeHTML(messagePreview(message, index))}</span></button>`;
    }).join("");
    $$('[data-pinned-message]', els.pinnedList).forEach((button) => button.addEventListener("click", () => locateMessage(button.dataset.pinnedMessage)));
    syncRailSections();
  }

  function renderMessages(scroll = false) {
    const session = selectedSession();
    const hasSession = Boolean(session);
    document.documentElement.dataset.sessionActive = hasSession ? "true" : "false";
    els.welcome.hidden = hasSession;
    els.messageScroll.hidden = !hasSession;
    if (!hasSession) {
      els.pinnedShelf.hidden = true;
      els.pinnedList.innerHTML = "";
      els.archivedMessagesButton.hidden = true;
      els.messageList.innerHTML = "";
      renderMessageMap([]);
      return;
    }
    const pinned = storedMessageIDs(state.pinnedMessages, session.id);
    const archived = storedMessageIDs(state.archivedMessages, session.id);
    const visibleMessages = state.messages.filter((message) => state.showArchivedMessages || !archived.has(message.info?.id));
    if (state.maximizedMessageID && !state.messages.some((message) => message.info?.id === state.maximizedMessageID)) state.maximizedMessageID = "";
    $("#appShell").classList.toggle("message-maximized", Boolean(state.maximizedMessageID));
    els.archivedMessagesButton.hidden = !archived.size;
    els.archivedMessagesButton.setAttribute("aria-pressed", String(state.showArchivedMessages));
    els.archivedMessagesButton.setAttribute("aria-label", `${state.showArchivedMessages ? "Hide" : "Show"} ${archived.size} archived message${archived.size === 1 ? "" : "s"}`);
    els.archivedMessagesButton.setAttribute("title", `${state.showArchivedMessages ? "Hide" : "Show"} archived messages`);
    els.archivedMessagesCount.textContent = String(archived.size);
    renderPinnedMessages(pinned, archived);
    const rows = visibleMessages.map((message) => {
      const info = message.info || {};
      const role = info.role === "user" ? "user" : "assistant";
      const providerError = info.error?.data?.message || info.error?.message || "";
      const parts = (message.parts || []).map(renderPart).filter(Boolean).join("") || (providerError ? `<div class="provider-error-message"><strong>Provider error</strong><span>${escapeHTML(providerError)}</span></div>` : "");
      if (!parts) return "";
      const label = role === "user" ? "You" : `Seneschal · ${info.modelID || agentDisplayName(info.agent || state.selectedAgent)}`;
      const avatar = role === "user" ? "YOU" : "DS";
      const kind = role === "user" ? "input" : "output";
      const userActions = role === "user" ? '<button type="button" class="message-edit-button" aria-label="Edit this message" title="Edit and retry this message">Edit</button><button type="button" class="message-retry-button" aria-label="Retry this message" title="Retry from this point">Retry</button>' : "";
      const isPinned = pinned.has(info.id);
      const isArchived = archived.has(info.id);
      const controls = `<span class="message-view-controls">${userActions}<button type="button" class="message-pin-button${isPinned ? " active" : ""}" aria-label="${isPinned ? "Unpin" : "Pin"} this message" title="${isPinned ? "Unpin" : "Pin"} this message">${isPinned ? "Unpin" : "Pin"}</button><button type="button" class="message-archive-button" aria-label="${isArchived ? "Restore" : "Archive"} this message" title="${isArchived ? "Restore" : "Archive"} this message locally">${isArchived ? "Restore" : "Archive"}</button><button type="button" class="message-size-button" aria-label="Minimize ${kind}" title="Minimize or expand ${kind}">Minimize</button><button type="button" class="message-maximize-button" aria-label="Maximize ${kind}" title="Maximize ${kind}">Maximize</button><button type="button" class="message-copy-button" aria-label="Copy ${kind}" title="Copy ${kind}"><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="8" y="8" width="11" height="11" rx="2"/><path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3"/></svg><span>Copy</span></button></span>`;
      const collapsed = state.collapsedMessageIDs.has(info.id) ? " collapsed" : "";
      const maximized = state.maximizedMessageID === info.id ? " maximized" : "";
      return `<article class="message ${role}${isPinned ? " pinned" : ""}${isArchived ? " archived" : ""}${collapsed}${maximized}" data-message="${escapeHTML(info.id || "")}"><div class="message-avatar">${avatar}</div><div class="message-body"><div class="message-meta"><strong>${escapeHTML(label)}</strong><span>${info.time?.created ? new Date(info.time.created).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : ""}</span>${controls}</div><div class="message-content">${parts}</div></div></article>`;
    }).join("");
    const busy = sessionStatus(session.id) === "busy";
    const liveActivity = busy ? escapeHTML(liveActivityText()) : "";
    els.messageList.innerHTML = rows + (busy ? `<article class="message assistant live-progress-message"><div class="message-avatar">DS</div><div class="message-body"><div class="live-activity"><span class="live-activity-pulse"><i></i><i></i><i></i></span><strong>Live activity</strong><span>${liveActivity}</span></div></div></article>` : "");
    renderMessageMap(visibleMessages);
    $$(".message-copy-button", els.messageList).forEach((button) => button.addEventListener("click", () => copyRenderedMessage(button)));
    $$(".message-retry-button", els.messageList).forEach((button) => button.addEventListener("click", () => retryUserMessage(button.closest(".message")?.dataset.message)));
    $$(".message-edit-button", els.messageList).forEach((button) => button.addEventListener("click", () => openMessageEditor(button.closest(".message")?.dataset.message)));
    $$(".message-pin-button", els.messageList).forEach((button) => button.addEventListener("click", () => toggleMessagePin(button.closest(".message")?.dataset.message)));
    $$(".message-archive-button", els.messageList).forEach((button) => button.addEventListener("click", () => toggleMessageArchive(button.closest(".message")?.dataset.message)));
    $$(".message-size-button", els.messageList).forEach((button) => {
      const message = button.closest(".message");
      const id = message.dataset.message;
      const collapsed = message.classList.contains("collapsed");
      button.textContent = collapsed ? "Expand" : "Minimize";
      button.addEventListener("click", () => {
        let nowCollapsed;
        if (message.classList.contains("maximized")) {
          message.classList.remove("maximized");
          state.maximizedMessageID = "";
          $("#appShell").classList.remove("message-maximized");
          syncMessageMaximizeControl(message, false);
          message.classList.add("collapsed");
          nowCollapsed = true;
        } else {
          nowCollapsed = message.classList.toggle("collapsed");
        }
        if (nowCollapsed) state.collapsedMessageIDs.add(id);
        else state.collapsedMessageIDs.delete(id);
        button.textContent = nowCollapsed ? "Expand" : "Minimize";
        button.setAttribute("aria-label", nowCollapsed ? "Expand response" : "Minimize response");
      });
    });
    $$(".message-maximize-button", els.messageList).forEach((button) => {
      const message = button.closest(".message");
      const id = message.dataset.message;
      syncMessageMaximizeControl(message, message.classList.contains("maximized"));
      button.addEventListener("click", () => {
        const previous = $(".message.maximized", els.messageList);
        if (previous && previous !== message) {
          previous.classList.remove("maximized");
          syncMessageMaximizeControl(previous, false);
        }
        const nowMaximized = !message.classList.contains("maximized");
        message.classList.toggle("maximized", nowMaximized);
        state.maximizedMessageID = nowMaximized ? id : "";
        $("#appShell").classList.toggle("message-maximized", nowMaximized);
        if (nowMaximized) {
          message.classList.remove("collapsed");
          state.collapsedMessageIDs.delete(id);
        }
        syncMessageMaximizeControl(message, nowMaximized);
      });
    });
    $$(".code-copy-button", els.messageList).forEach((button) => button.addEventListener("click", () => copyCodeBlock(button)));
    if (scroll && !state.userScrolledAway) requestAnimationFrame(() => { els.messageScroll.scrollTop = els.messageScroll.scrollHeight; });
  }

  function messagePreview(message, index) {
    const text = (message.parts || []).find((part) => part.type === "text" && part.text)?.text || "";
    const tool = (message.parts || []).find((part) => part.type === "tool")?.tool || "";
    return String(text || tool || `Step ${index + 1}`).replace(/\s+/g, " ").trim().slice(0, 72);
  }

  function renderMessageMap(messages = state.messages) {
    if (!els.messageMap) return;
    const visible = messages.filter((message) => (message.parts || []).some((part) => ["text", "tool", "reasoning", "file", "patch"].includes(part.type)));
    els.messageMap.hidden = visible.length < 2;
    els.messageMap.innerHTML = visible.map((message, index) => {
      const role = message.info?.role === "user" ? "You" : "Seneschal";
      return `<button type="button" class="message-map-step ${message.info?.role === "user" ? "user" : "assistant"}" data-jump-message="${escapeHTML(message.info?.id || "")}" aria-label="Jump to ${escapeHTML(role)} message ${index + 1}" title="${escapeHTML(`${index + 1}. ${role}: ${messagePreview(message, index)}`)}"><i></i><span>${index + 1}</span></button>`;
    }).join("");
    $$('[data-jump-message]', els.messageMap).forEach((button) => button.addEventListener("click", () => {
      locateMessage(button.dataset.jumpMessage);
    }));
  }

  function updateFollowState() {
    if (!els.messageScroll) return;
    const distance = els.messageScroll.scrollHeight - els.messageScroll.scrollTop - els.messageScroll.clientHeight;
    state.userScrolledAway = distance > 110;
    if (els.resumeFollow) els.resumeFollow.hidden = !state.userScrolledAway;
  }

  function jumpToLatest() {
    state.userScrolledAway = false;
    els.resumeFollow.hidden = true;
    els.messageScroll.scrollTo({ top: els.messageScroll.scrollHeight, behavior: "smooth" });
  }

  function updateConversationClearance() {
    if (!els.form || !els.messageScroll) return;
    const height = els.form.getBoundingClientRect().height;
    els.messageScroll.style.setProperty("--composer-clearance", `${Math.ceil(height + 34)}px`);
  }

  function syncMessageMaximizeControl(message, maximized) {
    const button = message?.querySelector(".message-maximize-button");
    if (!button) return;
    button.textContent = maximized ? "Normal" : "Maximize";
    button.setAttribute("aria-label", maximized ? "Restore normal message view" : "Maximize message");
    button.setAttribute("title", maximized ? "Restore normal message view" : "Maximize message");
  }

  function exitMaximizedMessage() {
    if (!state.maximizedMessageID) return;
    const message = $(".message.maximized", els.messageList);
    message?.classList.remove("maximized");
    syncMessageMaximizeControl(message, false);
    state.maximizedMessageID = "";
    $("#appShell").classList.remove("message-maximized");
  }

  async function copyRenderedMessage(button) {
    const text = button.closest(".message-body")?.querySelector(".message-content")?.innerText?.trim() || "";
    if (!text) { toast("There is no response text to copy yet.", "warn"); return; }
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const fallback = document.createElement("textarea");
      fallback.value = text;
      fallback.setAttribute("readonly", "");
      fallback.style.position = "fixed";
      fallback.style.opacity = "0";
      document.body.appendChild(fallback);
      fallback.select();
      document.execCommand("copy");
      fallback.remove();
    }
    const label = $("span", button);
    button.classList.add("copied");
    if (label) label.textContent = "Copied";
    setTimeout(() => { button.classList.remove("copied"); if (label) label.textContent = "Copy"; }, 1600);
  }

  async function retryUserMessage(messageID) {
    const message = state.messages.find((item) => item.info?.id === messageID && item.info?.role === "user");
    if (!message) { toast("The original message is no longer available.", "warn"); return; }
    if (["busy", "retry"].includes(sessionStatus(state.currentSessionID))) { toast("Stop or finish the current response before retrying a message.", "warn"); return; }
    const text = (message.parts || []).filter((part) => part.type === "text").map((part) => part.text || "").join("\n\n").trim();
    const files = (message.parts || []).filter((part) => part.type === "file" && part.url).map((part) => normalizedAttachment(part));
    if (!text && !files.length) { toast("That message has no reusable content.", "warn"); return; }
    await rerunUserMessage(message, text, files);
  }

  function openMessageEditor(messageID) {
    const message = state.messages.find((item) => item.info?.id === messageID && item.info?.role === "user");
    if (!message) { toast("The original message is no longer available.", "warn"); return; }
    if (["busy", "retry"].includes(sessionStatus(state.currentSessionID))) { toast("Stop or finish the current response before editing a message.", "warn"); return; }
    const text = (message.parts || []).filter((part) => part.type === "text").map((part) => part.text || "").join("\n\n").trim();
    const fileCount = (message.parts || []).filter((part) => part.type === "file" && part.url).length;
    state.editingMessageID = messageID;
    els.messageEditInput.value = text;
    els.messageEditAttachmentNote.hidden = !fileCount;
    els.messageEditAttachmentNote.textContent = fileCount ? `${fileCount} attachment${fileCount === 1 ? "" : "s"} will be kept.` : "";
    els.messageEditDialog.showModal();
    requestAnimationFrame(() => { els.messageEditInput.focus(); els.messageEditInput.setSelectionRange(text.length, text.length); });
  }

  async function submitMessageEdit(event) {
    event.preventDefault();
    const message = state.messages.find((item) => item.info?.id === state.editingMessageID && item.info?.role === "user");
    if (!message) { els.messageEditDialog.close(); toast("The original message is no longer available.", "warn"); return; }
    const text = els.messageEditInput.value.trim();
    const files = (message.parts || []).filter((part) => part.type === "file" && part.url).map((part) => normalizedAttachment(part));
    if (!text && !files.length) { toast("The edited message cannot be empty.", "warn"); els.messageEditInput.focus(); return; }
    els.messageEditDialog.close();
    await rerunUserMessage(message, text, files);
  }

  async function rerunUserMessage(message, text, files) {
    const session = selectedSession();
    if (!session) return;
    try {
      toast("Returning to the selected message…");
      await api(`/session/${encodeURIComponent(session.id)}/revert`, { directory: session.directory, method: "POST", body: { messageID: message.info.id } });
      await refreshSessions();
      await refreshMessages();
      state.attachments = files;
      renderAttachments();
      toast("Generating a fresh response…");
      await sendPrompt(text);
    } catch (error) {
      toast(`Could not retry that message: ${error.message}`, "error");
      await refreshMessages();
    }
  }

  async function copyCodeBlock(button) {
    const text = button.closest(".code-block")?.querySelector("code")?.textContent || "";
    if (!text) { toast("There is no code to copy.", "warn"); return; }
    try { await navigator.clipboard.writeText(text); }
    catch {
      const fallback = document.createElement("textarea");
      fallback.value = text;
      fallback.setAttribute("readonly", "");
      fallback.style.position = "fixed";
      fallback.style.opacity = "0";
      document.body.appendChild(fallback);
      fallback.select();
      document.execCommand("copy");
      fallback.remove();
    }
    const label = $("span", button);
    button.classList.add("copied");
    if (label) label.textContent = "Copied";
    setTimeout(() => { button.classList.remove("copied"); if (label) label.textContent = "Copy"; }, 1600);
  }

  function renderComposer() {
    els.composerProject.textContent = state.currentDirectory ? basename(state.currentDirectory) : "No project selected";
    els.send.disabled = !state.currentDirectory || !state.models.length;
  }

  function renderPermissions() {
    const permission = state.permissions.find((item) => !state.currentSessionID || item.sessionID === state.currentSessionID) || state.permissions[0];
    els.permissionDock.hidden = !permission;
    if (!permission) return;
    const pattern = Array.isArray(permission.pattern) ? permission.pattern.join(", ") : permission.pattern || permission.title || permission.type;
    els.permissionDock.innerHTML = `<div class="permission-content"><div><span class="eyebrow">APPROVAL REQUIRED</span><h3>${escapeHTML(permission.title || permission.type || "OpenCode action")}</h3><p>${escapeHTML(pattern)}. Approve once, remember for this session, or reject.</p></div><div class="permission-actions"><button class="reject" data-reply="reject">Reject</button><button data-reply="always">Always</button><button class="allow" data-reply="once">Allow once</button></div></div>`;
    $$('[data-reply]', els.permissionDock).forEach((button) => button.addEventListener("click", () => replyPermission(permission, button.dataset.reply)));
  }

  function renderAll() {
    renderProjects(); renderSessions(); renderModels(); renderAgents(); renderInspector(); renderHeader(); renderUsage(); renderMessages(); renderComposer(); renderPermissions();
  }

  async function refreshMessages(scroll = false) {
    const session = selectedSession();
    if (!session) { state.messages = []; renderMessages(); return; }
    try {
      state.messages = await api(`/session/${encodeURIComponent(session.id)}/message`, { directory: session.directory });
      renderMessages(scroll);
      renderUsage();
    } catch (error) { toast(`Could not load messages: ${error.message}`, "error"); }
  }

  async function refreshSessions() {
    try {
      state.sessions = await api("/session", { noDirectory: true });
      state.statuses = await api("/session/status", { noDirectory: true }).catch(() => state.statuses);
      renderProjects(); renderSessions(); renderHeader(); renderUsage();
    } catch (error) { toast(`Could not refresh sessions: ${error.message}`, "error"); }
  }

  async function refreshDirectoryData() {
    if (!state.currentDirectory) return;
    const dir = state.currentDirectory;
    const results = await Promise.allSettled([
      api("/config", { directory: dir }), api("/agent", { directory: dir }),
      api("/experimental/tool/ids", { directory: dir }), api("/permission", { directory: dir }),
      api("/session/status", { directory: dir }), api("/mcp", { directory: dir }), api("/command", { directory: dir })
    ]);
    if (results[0].status === "fulfilled") state.config = results[0].value;
    if (results[1].status === "fulfilled") state.agents = results[1].value;
    if (results[2].status === "fulfilled") state.tools = results[2].value;
    if (results[3].status === "fulfilled") state.permissions = results[3].value;
    if (results[4].status === "fulfilled") state.statuses = results[4].value;
    if (results[5].status === "fulfilled") state.mcp = results[5].value;
    if (results[6].status === "fulfilled") state.openCodeCommands = results[6].value || [];
    const commandCount = $("#settingsCommands");
    if (commandCount) commandCount.textContent = `${state.openCodeCommands.length} available`;
    renderAll();
  }

  async function switchDirectory(directory) {
    if (!directory || directory === state.currentDirectory) return;
    state.currentDirectory = directory;
    state.showArchivedSessions = false;
    storage.set("atelier-directory", directory);
    const sessions = state.sessions.filter((session) => session.directory === directory && !session.parentID).sort((a,b) => (b.time?.updated || 0) - (a.time?.updated || 0));
    state.currentSessionID = sessions[0]?.id || "";
    storage.set("atelier-session", state.currentSessionID);
    state.messages = [];
    state.showArchivedMessages = false;
    state.userScrolledAway = false;
    renderAll();
    await refreshDirectoryData();
    await refreshInstructionData(false);
    connectEvents();
    await refreshMessages();
  }

  async function selectSession(id) {
    if (!id || id === state.currentSessionID) return;
    state.currentSessionID = id;
    storage.set("atelier-session", id);
    const session = selectedSession();
    if (session?.directory !== state.currentDirectory) {
      state.currentDirectory = session.directory;
      storage.set("atelier-directory", state.currentDirectory);
      connectEvents();
    }
    state.messages = [];
    state.showArchivedMessages = false;
    state.userScrolledAway = false;
    renderAll();
    await refreshMessages(true);
  }

  async function newSession(focus = true) {
    if (!state.currentDirectory) { openProjectDialog(); return null; }
    try {
      const session = await api("/session", { method: "POST", body: { title: "New Seneschal session" } });
      state.sessions.unshift(session);
      state.currentSessionID = session.id;
      storage.set("atelier-session", session.id);
      state.messages = [];
      state.showArchivedMessages = false;
      state.userScrolledAway = false;
      log("session.created", session.id);
      renderAll();
      if (focus) els.prompt.focus();
      return session;
    } catch (error) { toast(`Could not create a session: ${error.message}`, "error"); return null; }
  }

  async function sendPrompt(text, options = {}) {
    if (state.mediaRecorder) { toast("Click Mic to finish the voice recording before sending.", "warn"); return; }
    let clean = text.trim();
    if (!clean && !state.attachments.length) return;
    if (!state.attachments.length && /^\/chatgpt\s*$/i.test(clean)) {
      els.prompt.value = "";
      autoSizePrompt();
      openChatGPTSpace();
      return true;
    }
    const installMatch = !state.attachments.length && clean.match(/^\/install\s+(https:\/\/\S+)\/?$/i);
    if (installMatch) {
      els.prompt.value = "";
      autoSizePrompt();
      await openInstructionStudio("skills");
      openSkillLinkInstaller();
      els.skillLink.value = installMatch[1];
      inspectSkillLink();
      return true;
    }
    if (!state.attachments.length && /^\/install\b/i.test(clean)) {
      toast("Use /install followed by a GitHub repository, SKILL.md link, or skill-folder link.", "warn");
      return false;
    }
    const commandMatch = !state.attachments.length && clean.match(/^\/([^\s]+)(?:\s+([\s\S]*))?$/);
    const engineCommand = commandMatch && state.openCodeCommands.find((item) => item.name.toLowerCase() === commandMatch[1].toLowerCase());
    if (engineCommand) return runOpenCodeCommand(engineCommand, commandMatch[2] || "", options);
    clean = await expandSessionReferences(clean);
    if (state.speechRecognition) state.speechRecognition.stop();
    let session = selectedSession();
    if (!session) session = await newSession(false);
    if (!session) return;
    const model = selectedModel();
    if (!model) { toast("Connect a model in OpenCode settings first.", "warn"); return; }
    const parts = [...state.attachments.map((attachment) => {
      const { name, type, data } = normalizedAttachment(attachment);
      return { type: "file", mime: type, filename: name, url: data };
    })];
    if (clean) parts.push({ type: "text", text: clean });
    const optimistic = { info: { id: `local-${Date.now()}`, role: "user", time: { created: Date.now() } }, parts };
    state.messages.push(optimistic);
    state.userScrolledAway = false;
    state.statuses[session.id] = { type: "busy" };
    els.prompt.value = "";
    state.attachments = [];
    renderAttachments(); renderHeader(); renderMessages(true);
    autoSizePrompt();
    updateConversationClearance();
    if (window.ResizeObserver) new ResizeObserver(updateConversationClearance).observe(els.form);
    try {
      const chatOnly = state.selectedAgent === "chat";
      const availableTools = [...new Set([...state.tools, "read", "write", "edit", "bash", "task", "webfetch", "websearch", "glob", "grep"].filter((tool) => tool && tool !== "invalid"))];
      const toolOverrides = Object.fromEntries(availableTools.map((tool) => [tool, !chatOnly]));
      const requestAgent = state.selectedAgent === "chat" ? "build" : state.selectedAgent;
      await api(`/session/${encodeURIComponent(session.id)}/prompt_async`, {
        directory: session.directory, method: "POST",
        body: { model: { providerID: model.providerID, modelID: model.id }, variant: state.selectedVariants[model.value] || undefined, tools: toolOverrides, agent: requestAgent, system: runtimeInstructionSystem() || undefined, parts }
      });
      log("prompt.accepted", `${model.providerID}/${model.id}`);
      if (options.voice) state.voiceAwaitingResponse = true;
      setTimeout(() => refreshMessages(true), 250);
      return true;
    } catch (error) {
      state.messages = state.messages.filter((message) => message !== optimistic);
      state.statuses[session.id] = { type: "idle" };
      renderHeader(); renderMessages();
      toast(`Message was not sent: ${error.message}`, "error");
      if (options.voice && state.conversationMode) scheduleConversationListening(500);
      return false;
    }
  }

  async function expandSessionReferences(text) {
    const matches = [...String(text).matchAll(/@session\[([^|\]]+)\|([^\]]+)\]/g)];
    if (!matches.length) return text;
    let expanded = text;
    for (const match of matches.slice(0, 3)) {
      const session = state.sessions.find((item) => item.id === match[1]);
      if (!session) continue;
      try {
        const messages = await api(`/session/${encodeURIComponent(session.id)}/message`, { directory: session.directory });
        const transcript = messages.map((message) => {
          const role = message.info?.role === "user" ? "User" : "Assistant";
          const content = (message.parts || []).filter((part) => part.type === "text").map((part) => part.text || "").join("\n");
          return content ? `${role}: ${content}` : "";
        }).filter(Boolean).join("\n\n").slice(-24000);
        expanded = expanded.replace(match[0], `<referenced-session title="${match[2]}">\n${transcript}\n</referenced-session>`);
      } catch { expanded = expanded.replace(match[0], `[Session reference unavailable: ${match[2]}]`); }
    }
    return expanded;
  }

  async function runOpenCodeCommand(command, argumentsText = "", options = {}) {
    let session = selectedSession();
    if (!session) session = await newSession(false);
    const model = selectedModel();
    if (!session || !model) { toast("Choose a project and model first.", "warn"); return false; }
    state.statuses[session.id] = { type: "busy" };
    els.prompt.value = ""; autoSizePrompt(); renderHeader(); renderMessages(true);
    try {
      await api(`/session/${encodeURIComponent(session.id)}/command`, { directory: session.directory, method: "POST", body: { command: command.name, arguments: argumentsText, agent: state.selectedAgent === "chat" ? "build" : state.selectedAgent, model: `${model.providerID}/${model.id}` } });
      if (options.voice) state.voiceAwaitingResponse = true;
      await refreshMessages(true);
      return true;
    } catch (error) {
      state.statuses[session.id] = { type: "idle" }; renderHeader();
      toast(`Command /${command.name} failed: ${error.message}`, "error");
      return false;
    }
  }

  async function abortSession() {
    const session = selectedSession();
    if (!session) return;
    try {
      await api(`/session/${encodeURIComponent(session.id)}/abort`, { directory: session.directory, method: "POST" });
      state.statuses[session.id] = { type: "idle" };
      renderHeader(); renderMessages();
      toast("Generation stopped.");
    } catch (error) { toast(`Could not stop the session: ${error.message}`, "error"); }
  }

  function openDeleteSession() {
    const session = selectedSession();
    if (!session) return;
    els.deleteTitle.textContent = session.title || "Untitled conversation";
    els.deleteDialog.showModal();
  }

  async function deleteSession() {
    const session = selectedSession();
    if (!session) return;
    const deletedID = session.id;
    try {
      if (["busy", "retry"].includes(sessionStatus(deletedID))) {
        await api(`/session/${encodeURIComponent(deletedID)}/abort`, { directory: session.directory, method: "POST" }).catch(() => null);
      }
      await api(`/session/${encodeURIComponent(deletedID)}`, { directory: session.directory, method: "DELETE" });
      state.sessions = state.sessions.filter((item) => item.id !== deletedID);
      delete state.statuses[deletedID];
      state.pinnedSessions.delete(deletedID);
      state.archivedSessions.delete(deletedID);
      storage.set("seneschal-pinned-sessions", [...state.pinnedSessions]);
      storage.set("seneschal-archived-sessions", [...state.archivedSessions]);
      delete state.pinnedMessages[deletedID];
      delete state.archivedMessages[deletedID];
      storage.set("seneschal-pinned-messages", state.pinnedMessages);
      storage.set("seneschal-archived-messages", state.archivedMessages);
      state.currentSessionID = "";
      state.messages = [];
      storage.set("atelier-session", "");
      els.deleteDialog.close();
      renderAll();
      toast("Conversation deleted.");
    } catch (error) { toast(`Could not delete the conversation: ${error.message}`, "error"); }
  }

  function exportSession() {
    const session = selectedSession();
    if (!session) return;
    const payload = {
      exportedAt: new Date().toISOString(),
      application: "Seneschal",
      privacyNote: "Review before sharing: this export may contain prompts, model responses, tool activity, and file paths.",
      session,
      messages: state.messages
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    const safeTitle = (session.title || "conversation").replace(/[^a-z0-9_-]+/gi, "-").replace(/^-|-$/g, "").slice(0, 60) || "conversation";
    link.href = url;
    link.download = `${safeTitle}.opencode.json`;
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    toast("Conversation exported to Downloads.");
  }

  async function renameSession(sessionID = state.currentSessionID) {
    const session = state.sessions.find((item) => item.id === sessionID);
    if (!session) return;
    const title = window.prompt("Rename this session", session.title || "");
    if (!title?.trim()) return;
    try {
      const updated = await api(`/session/${encodeURIComponent(session.id)}`, { directory: session.directory, method: "PATCH", body: { title: title.trim() } });
      Object.assign(session, updated);
      renderSessions(); renderHeader();
    } catch (error) { toast(`Could not rename the session: ${error.message}`, "error"); }
  }

  function scheduleMessageRefresh(scroll = true) {
    clearTimeout(state.refreshTimer);
    state.refreshTimer = setTimeout(() => refreshMessages(scroll), 140);
  }

  function connectEvents() {
    state.eventSource?.close();
    if (!state.currentDirectory) return;
    const source = new EventSource(withDirectory("/api/event", state.currentDirectory));
    state.eventSource = source;
    source.onopen = () => { setConnection("online", "Live"); els.pulseLabel.textContent = "LIVE"; log("stream.open", basename(state.currentDirectory)); };
    source.onerror = () => { setConnection("", "Reconnecting"); els.pulseLabel.textContent = "RETRY"; };
    source.onmessage = (event) => {
      let payload;
      try { payload = JSON.parse(event.data); } catch { return; }
      recordOpenCodeEvent(payload);
      log(payload.type || "event", payload.properties?.sessionID || payload.id || "");
      const properties = payload.properties || {};
      if (payload.type === "session.status") {
        const wasWorking = ["busy", "retry"].includes(sessionStatus(properties.sessionID));
        state.statuses[properties.sessionID] = properties.status;
        renderSessions(); renderHeader(); renderMessages(true);
        const nowIdle = sessionStatus(properties.sessionID) === "idle";
        if (state.conversationMode && state.voiceAwaitingResponse && properties.sessionID === state.currentSessionID && wasWorking && nowIdle) {
          state.voiceAwaitingResponse = false;
          refreshMessages(true).then(speakLatestAssistant).catch(() => scheduleConversationListening(500));
        }
      } else if (payload.type === "session.created") {
        if (!state.sessions.some((session) => session.id === properties.info?.id)) state.sessions.push(properties.info);
        renderProjects(); renderSessions();
      } else if (payload.type === "session.updated") {
        const index = state.sessions.findIndex((session) => session.id === properties.info?.id);
        if (index >= 0) state.sessions[index] = properties.info; else state.sessions.push(properties.info);
        renderSessions(); renderHeader(); renderUsage();
      } else if (payload.type === "session.deleted") {
        state.sessions = state.sessions.filter((session) => session.id !== properties.info?.id);
        renderSessions();
      } else if (["message.updated", "message.part.updated", "message.part.removed"].includes(payload.type)) {
        const sessionID = properties.info?.sessionID || properties.part?.sessionID || properties.sessionID;
        if (!sessionID || sessionID === state.currentSessionID) scheduleMessageRefresh(true);
      } else if (payload.type === "permission.asked" || payload.type === "permission.updated") {
        const permission = properties;
        const index = state.permissions.findIndex((item) => item.id === permission.id);
        if (index >= 0) state.permissions[index] = permission; else state.permissions.push(permission);
        renderPermissions();
        toast("Approval required — review the request above the message box.", "warn");
      } else if (payload.type === "permission.replied") {
        const requestID = properties.requestID || properties.permissionID || properties.id;
        state.permissions = state.permissions.filter((item) => item.id !== requestID);
        renderPermissions();
      } else if (payload.type === "session.error") {
        let detail = properties.error?.data?.message || properties.error?.message || "The active model returned an error.";
        if (/ProviderModelNotFoundError|Model not found:\s*opencode\/x-preview-f-free/i.test(detail)) detail = "Ox Alpha is not available in this OpenCode engine version. Run the Seneschal updater, fully close the app, and reopen it.";
        const retryableOutage = properties.error?.data?.statusCode === 503 || /endpoint is unavailable|service unavailable/i.test(detail);
        if (retryableOutage && properties.sessionID === state.currentSessionID) {
          abortSession().catch(() => null);
          toast(`${detail} Automatic retries were stopped. Choose another model and retry your message.`, "error");
        } else toast(detail, "error");
        scheduleMessageRefresh(true);
      }
    };
  }

  async function pollPermissions() {
    if (!state.currentDirectory) return;
    try {
      const latest = await api("/permission");
      const changed = JSON.stringify(latest) !== JSON.stringify(state.permissions);
      state.permissions = latest;
      if (changed) renderPermissions();
    } catch { /* Event stream remains the primary path. */ }
  }

  async function replyPermission(permission, reply) {
    try {
      try {
        await api(`/permission/${encodeURIComponent(permission.id)}/reply`, { directory: state.currentDirectory, method: "POST", body: { reply } });
      } catch {
        await api(`/session/${encodeURIComponent(permission.sessionID)}/permissions/${encodeURIComponent(permission.id)}`, { directory: state.currentDirectory, method: "POST", body: { response: reply } });
      }
      state.permissions = state.permissions.filter((item) => item.id !== permission.id);
      renderPermissions();
      log("permission.reply", reply);
    } catch (error) { toast(`Could not answer the permission request: ${error.message}`, "error"); }
  }

  function renderAttachments() {
    els.attachmentStrip.hidden = !state.attachments.length;
    els.attachmentStrip.innerHTML = state.attachments.map((file, index) => `<div class="attachment-chip"><span>${escapeHTML(file.name)}</span><button type="button" data-remove="${index}" aria-label="Remove ${escapeHTML(file.name)}">×</button></div>`).join("");
    $$('[data-remove]', els.attachmentStrip).forEach((button) => button.addEventListener("click", () => { state.attachments.splice(Number(button.dataset.remove), 1); renderAttachments(); }));
  }

  function setListening(active, label = "Listening") {
    els.mic.classList.toggle("listening", active);
    els.mic.setAttribute("aria-pressed", String(active));
    els.mic.setAttribute("aria-label", active ? `Stop ${label.toLowerCase()}` : "Start voice dictation or recording");
    $("span", els.mic).textContent = active ? label : "Mic";
  }

  function setTalkState(stage = "") {
    if (!els.talk) return;
    const active = state.conversationMode;
    els.talk.classList.toggle("active", active);
    els.talk.classList.toggle("speaking", active && stage === "Speaking");
    els.talk.setAttribute("aria-pressed", String(active));
    els.talk.setAttribute("aria-label", active ? "Stop Talk mode" : "Start Talk mode");
    $("span", els.talk).textContent = active ? (stage || "Talk on") : "Talk";
    const settingsVoice = $("#settingsVoice");
    if (settingsVoice) settingsVoice.textContent = active ? `On · ${stage || "Ready"}` : "Turn-by-turn · Ready";
  }

  function cleanSpeechText(value = "") {
    return String(value)
      .replace(/```[\s\S]*?```/g, " Code block omitted. ")
      .replace(/`([^`]+)`/g, "$1")
      .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
      .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
      .replace(/^\s{0,3}#{1,6}\s+/gm, "")
      .replace(/^\s*[-*+]\s+/gm, "")
      .replace(/[*_~>]/g, "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 6000);
  }

  function scheduleConversationListening(delay = 350) {
    clearTimeout(state.conversationRestartTimer);
    if (!state.conversationMode) return;
    state.conversationRestartTimer = setTimeout(startConversationListening, delay);
  }

  function stopConversationMode(showNotice = true) {
    state.conversationMode = false;
    storage.set("seneschal-talk-mode", false);
    clearTimeout(state.conversationRestartTimer);
    state.conversationRecognition?.abort();
    state.conversationRecognition = null;
    state.voiceAwaitingResponse = false;
    state.voiceSpeaking = false;
    window.speechSynthesis?.cancel();
    setTalkState();
    if (showNotice) toast("Talk mode stopped.");
  }

  function speakLatestAssistant() {
    if (!state.conversationMode) return;
    const message = [...state.messages].reverse().find((item) => item.info?.role !== "user" && (item.parts || []).some((part) => part.type === "text" && part.text));
    const messageID = message?.info?.id || "";
    if (!message || (messageID && messageID === state.lastSpokenMessageID)) { scheduleConversationListening(400); return; }
    const spoken = cleanSpeechText((message.parts || []).filter((part) => part.type === "text").map((part) => part.text || "").join(" "));
    if (!spoken || !window.speechSynthesis) { scheduleConversationListening(400); return; }
    state.lastSpokenMessageID = messageID;
    const utterance = new SpeechSynthesisUtterance(spoken);
    utterance.lang = navigator.language || "en-US";
    utterance.rate = 1.02;
    utterance.pitch = 0.94;
    const voices = window.speechSynthesis.getVoices();
    const language = utterance.lang.split("-")[0].toLowerCase();
    utterance.voice = voices.find((voice) => voice.lang?.toLowerCase().startsWith(language) && /natural|online|aria|guy|ryan/i.test(voice.name)) || voices.find((voice) => voice.lang?.toLowerCase().startsWith(language)) || null;
    utterance.onstart = () => { state.voiceSpeaking = true; setTalkState("Speaking"); };
    utterance.onend = () => { state.voiceSpeaking = false; setTalkState("Listening"); scheduleConversationListening(250); };
    utterance.onerror = () => { state.voiceSpeaking = false; setTalkState("Listening"); scheduleConversationListening(400); };
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(utterance);
  }

  function startConversationListening() {
    if (!state.conversationMode || state.conversationRecognition || state.voiceSpeaking || state.voiceAwaitingResponse) return;
    const session = selectedSession();
    if (session && ["busy", "retry"].includes(sessionStatus(session.id))) { scheduleConversationListening(500); return; }
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) { stopConversationMode(false); toast("Talk mode needs current Chrome or Edge speech recognition.", "warn"); return; }
    const recognition = new SpeechRecognition();
    recognition.continuous = false;
    recognition.interimResults = true;
    recognition.lang = navigator.language || "en-US";
    state.conversationRecognition = recognition;
    let transcript = "";
    recognition.onstart = () => setTalkState("Listening");
    recognition.onresult = (event) => {
      transcript = "";
      for (let index = 0; index < event.results.length; index += 1) transcript += event.results[index][0]?.transcript || "";
      els.prompt.value = transcript.trimStart();
      autoSizePrompt();
    };
    recognition.onerror = (event) => {
      if (["not-allowed", "service-not-allowed", "audio-capture"].includes(event.error)) {
        stopConversationMode(false);
        toast(event.error === "audio-capture" ? "No working microphone was found." : "Microphone access was blocked. Allow it in the browser and try again.", "warn");
      } else if (!['aborted', 'no-speech'].includes(event.error)) {
        toast(`Talk mode paused: ${event.error}.`, "warn");
      }
    };
    recognition.onend = async () => {
      if (state.conversationRecognition === recognition) state.conversationRecognition = null;
      if (!state.conversationMode) return;
      const clean = transcript.trim();
      if (!clean) { els.prompt.value = ""; autoSizePrompt(); scheduleConversationListening(450); return; }
      setTalkState("Thinking");
      await sendPrompt(clean, { voice: true });
    };
    try { recognition.start(); }
    catch (error) { state.conversationRecognition = null; stopConversationMode(false); toast(`Could not start Talk mode: ${error.message}`, "error"); }
  }

  function toggleConversationMode() {
    if (state.conversationMode) { stopConversationMode(); return; }
    if (els.prompt.value.trim() || state.attachments.length) { toast("Send or clear the current draft before starting Talk mode.", "warn"); return; }
    if (!state.currentDirectory || !state.models.length) { toast("Choose a project and connect a model before starting Talk mode.", "warn"); return; }
    if (!(window.SpeechRecognition || window.webkitSpeechRecognition) || !window.speechSynthesis) { toast("Talk mode needs current Chrome or Edge with microphone access.", "warn"); return; }
    if (state.speechRecognition) state.speechRecognition.abort();
    if (state.mediaRecorder) stopMediaRecording();
    state.conversationMode = true;
    storage.set("seneschal-talk-mode", true);
    state.voiceAwaitingResponse = false;
    setTalkState("Listening");
    toast("Talk mode is on — speak naturally, My Lord. Click Talk to stop.");
    startConversationListening();
  }

  function stopMediaRecording() {
    if (state.mediaRecorder && state.mediaRecorder.state !== "inactive") state.mediaRecorder.stop();
  }

  async function startMediaRecording() {
    if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) {
      toast("This browser does not provide microphone recording. Open the workspace in current Chrome or Edge.", "warn");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
      const preferred = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"].find((type) => MediaRecorder.isTypeSupported(type));
      const recorder = preferred ? new MediaRecorder(stream, { mimeType: preferred }) : new MediaRecorder(stream);
      state.mediaStream = stream;
      state.mediaRecorder = recorder;
      state.mediaChunks = [];
      recorder.ondataavailable = (event) => { if (event.data?.size) state.mediaChunks.push(event.data); };
      recorder.onerror = () => toast("The voice recording could not be completed.", "error");
      recorder.onstop = async () => {
        const type = recorder.mimeType || state.mediaChunks[0]?.type || "audio/webm";
        const extension = type.includes("mp4") ? "m4a" : "webm";
        const stamp = new Date().toISOString().replace(/[:T]/g, "-").replace(/\.\d{3}Z$/, "");
        const file = new File(state.mediaChunks, `Voice message ${stamp}.${extension}`, { type, lastModified: Date.now() });
        state.mediaStream?.getTracks().forEach((track) => track.stop());
        state.mediaStream = null; state.mediaRecorder = null; state.mediaChunks = [];
        setListening(false);
        if (file.size) { await addFiles([file]); toast("Voice message attached — send it when ready."); }
      };
      recorder.start(250);
      setListening(true, "Recording");
      toast("Recording voice message — click Mic again to finish.");
    } catch (error) {
      state.mediaStream?.getTracks().forEach((track) => track.stop());
      state.mediaStream = null; state.mediaRecorder = null; setListening(false);
      toast(error.name === "NotAllowedError" ? "Microphone access was blocked. Allow it in the browser and try again." : `Could not start the microphone: ${error.message}`, "warn");
    }
  }

  async function toggleVoiceDictation() {
    if (state.conversationMode) stopConversationMode(false);
    if (state.speechRecognition) {
      state.speechRecognition.stop();
      return;
    }
    if (state.mediaRecorder) { stopMediaRecording(); return; }
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      await startMediaRecording();
      return;
    }
    const recognition = new SpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = navigator.language || "en-US";
    state.speechBaseText = els.prompt.value;
    state.speechRecognition = recognition;
    recognition.onstart = () => { setListening(true); toast("Listening — click Mic again when finished."); };
    recognition.onresult = (event) => {
      let transcript = "";
      for (let index = 0; index < event.results.length; index += 1) transcript += event.results[index][0]?.transcript || "";
      const spacer = state.speechBaseText && !/\s$/.test(state.speechBaseText) ? " " : "";
      els.prompt.value = `${state.speechBaseText}${spacer}${transcript.trimStart()}`;
      autoSizePrompt();
    };
    recognition.onerror = (event) => {
      const messages = {
        "not-allowed": "Microphone access was blocked. Allow microphone access in the browser and try again.",
        "audio-capture": "No working microphone was found.",
        "network": "Voice recognition could not reach its speech service.",
        "no-speech": "No speech was detected."
      };
      if (event.error !== "aborted") toast(messages[event.error] || `Voice dictation stopped: ${event.error}.`, "warn");
    };
    recognition.onend = () => {
      if (state.speechRecognition === recognition) state.speechRecognition = null;
      setListening(false);
      els.prompt.focus();
    };
    try { recognition.start(); }
    catch (error) { state.speechRecognition = null; setListening(false); toast(`Could not start voice dictation: ${error.message}`, "error"); }
  }

  async function pasteAttachments(event) {
    const clipboard = event.clipboardData;
    if (!clipboard) return;
    const itemFiles = [...(clipboard.items || [])]
      .filter((item) => item.kind === "file")
      .map((item) => item.getAsFile())
      .filter(Boolean);
    const sourceFiles = itemFiles.length ? itemFiles : [...(clipboard.files || [])];
    if (!sourceFiles.length) return;

    event.preventDefault();
    const stamp = new Date().toISOString().replace(/[:T]/g, "-").replace(/\.\d{3}Z$/, "");
    const files = sourceFiles.map((file, index) => {
      if (file.name && !/^image\.(png|jpe?g|webp)$/i.test(file.name)) return file;
      const extension = file.type.split("/")[1]?.replace("jpeg", "jpg") || "png";
      try { return new File([file], `Pasted screenshot ${stamp}${sourceFiles.length > 1 ? ` ${index + 1}` : ""}.${extension}`, { type: file.type, lastModified: Date.now() }); }
      catch { return file; }
    });
    await addFiles(files);
    toast(`${files.length === 1 ? files[0].name : `${files.length} clipboard files`} attached.`);
  }

  async function addFiles(files) {
    const limit = 8 * 1024 * 1024;
    for (const file of files) {
      if (file.size > limit) { toast(`${file.name} is larger than 8 MB.`, "warn"); continue; }
      const type = attachmentMimeType(file);
      const data = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
          const result = String(reader.result || "");
          resolve(type === "text/plain" ? result.replace(/^data:[^;,]*(?:;charset=[^;,]*)?/i, "data:text/plain;charset=utf-8") : result);
        };
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });
      state.attachments.push({ name: file.name, type, data });
    }
    renderAttachments();
  }

  function autoSizePrompt() {
    els.prompt.style.height = "auto";
    els.prompt.style.height = `${Math.min(150, Math.max(46, els.prompt.scrollHeight))}px`;
  }

  function openProjectDialog() {
    els.projectError.hidden = true;
    els.projectPath.value = "";
    els.projectDialog.showModal();
    setTimeout(() => els.projectPath.focus(), 30);
  }

  async function addProject(event) {
    event.preventDefault();
    const directory = toWslPath(els.projectPath.value);
    if (!directory) return;
    els.projectError.hidden = true;
    try {
      await api("/path", { directory });
      if (!state.customDirectories.includes(directory)) state.customDirectories.push(directory);
      storage.set("atelier-projects", state.customDirectories);
      els.projectDialog.close();
      await switchDirectory(directory);
      toast(`Added ${basename(directory)}.`);
    } catch (error) {
      els.projectError.textContent = `OpenCode could not open that folder. ${error.message}`;
      els.projectError.hidden = false;
    }
  }

  function openSettings() {
    $("#settingsEngine").textContent = `OpenCode ${state.health?.version || ""}`.trim();
    $("#settingsDeepSeek").textContent = (state.providers.connected || []).includes("deepseek") ? "Connected" : "Ready for key";
    setTalkState(state.voiceSpeaking ? "Speaking" : state.voiceAwaitingResponse ? "Thinking" : state.conversationMode ? "Listening" : "");
    renderActiveSkillCount();
    $("#settingsArchives").textContent = `${state.archivedSessions.size} archived`;
    els.settingsDialog.showModal();
  }

  function renderArchiveManager() {
    const archived = state.sessions
      .filter((session) => state.archivedSessions.has(session.id) && !session.parentID)
      .sort((a, b) => (b.time?.updated || 0) - (a.time?.updated || 0));
    $("#settingsArchives").textContent = `${archived.length} archived`;
    els.archiveManagerList.innerHTML = archived.length ? archived.map((session) => {
      const title = session.title || "Untitled session";
      return `<article class="archive-manager-item"><div><strong>${escapeHTML(title)}</strong><span>${escapeHTML(basename(session.directory))} · ${timeAgo(session.time?.updated)}</span></div><button type="button" class="secondary-button" data-restore-session="${escapeHTML(session.id)}">Restore</button></article>`;
    }).join("") : '<div class="archive-manager-empty"><strong>No archived sessions</strong><span>Sessions you archive will appear here.</span></div>';
    $$('[data-restore-session]', els.archiveManagerList).forEach((button) => button.addEventListener("click", async () => {
      await toggleSessionArchive(button.dataset.restoreSession);
      renderArchiveManager();
    }));
  }

  function openArchiveManager() {
    if (els.settingsDialog.open) els.settingsDialog.close();
    renderArchiveManager();
    els.archiveDialog.showModal();
  }

  function openChatGPTSpace() {
    if (els.settingsDialog.open) els.settingsDialog.close();
    if (!els.chatGPTDialog.open) els.chatGPTDialog.showModal();
  }

  function launchChatGPT() {
    const opened = window.open("https://chatgpt.com/", "_blank", "noopener,noreferrer");
    els.chatGPTDialog.close();
    if (!opened) toast("Your browser blocked the new ChatGPT tab. Allow pop-ups for this local app and try again.", "warn");
    else toast("ChatGPT Chat opened separately with its own allowance.");
  }

  function openBrowserDialog() {
    if (browserConnection() !== "connected") {
      toast("The agent browser is not connected. Refresh the workspace and try again.", "warn");
      return;
    }
    els.browserError.hidden = true;
    els.browserDialog.showModal();
    setTimeout(() => els.browserUrl.focus(), 30);
  }

  function normalizeBrowserUrl(value) {
    const raw = value.trim();
    if (!raw) throw new Error("Enter a website address.");
    const candidate = /^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`;
    const url = new URL(candidate);
    if (!["http:", "https:"].includes(url.protocol)) throw new Error("Use an http or https website address.");
    return url.href;
  }

  async function runBrowserTask(event) {
    event.preventDefault();
    try {
      const url = normalizeBrowserUrl(els.browserUrl.value);
      const task = els.browserTask.value.trim() || "Inspect the page and report what you find.";
      els.browserError.hidden = true;
      els.browserDialog.close();
      await sendPrompt(`Use the Playwright browser tools to open ${url}\n\nTask: ${task}\n\nUse browser interaction tools, not only web search or webfetch. Report the result clearly and include a browser screenshot when it is useful.`);
    } catch (error) {
      els.browserError.textContent = error.message;
      els.browserError.hidden = false;
    }
  }

  function openClassic() { window.open("/classic", "_blank", "noopener"); }

  function openAdvancedSetting(message) {
    if (els.settingsDialog.open) els.settingsDialog.close();
    openClassic();
    toast(message);
  }

  function openProviderSettings() {
    if (els.settingsDialog.open) els.settingsDialog.close();
    $("#providerConnectError").hidden = true;
    $("#providerKeyInput").value = "";
    const connected = new Set(state.providers.connected || []);
    const names = new Map((state.providers.all || []).map((provider) => [provider.id, provider.name]));
    $("#providerConnectionStatus").innerHTML = connected.size ? `<strong>Connected providers</strong><div class="connected-provider-chips">${[...connected].map((id) => `<span><i></i>${escapeHTML(names.get(id) || id)}</span>`).join("")}</div>` : "No provider connection reported yet.";
    els.providerDialog.showModal();
  }

  async function connectProvider(event) {
    event.preventDefault();
    const providerID = $("#providerConnectSelect").value;
    const key = $("#providerKeyInput").value.trim();
    const error = $("#providerConnectError");
    const button = $("#providerConnectButton");
    if (!key) { error.textContent = "Paste the API key first."; error.hidden = false; return; }
    error.hidden = true; button.disabled = true; button.textContent = "Connecting…";
    try {
      await api(`/api/integration/${encodeURIComponent(providerID)}/connect/key`, { method: "POST", noDirectory: true, body: { key } });
      $("#providerKeyInput").value = "";
      els.providerDialog.close();
      await refreshAll();
      toast(`${providerID === "opencode" ? "OpenCode Zen" : providerID} connected successfully.`);
    } catch (failure) {
      error.textContent = `Could not connect: ${failure.message}`;
      error.hidden = false;
    } finally { button.disabled = false; button.textContent = "Connect"; }
  }

  function openBrowserFromSettings() {
    if (els.settingsDialog.open) els.settingsDialog.close();
    openBrowserDialog();
  }

  function openBlenderFromSettings() {
    if (els.settingsDialog.open) els.settingsDialog.close();
    openBlender();
  }

  function toggleVoiceFromSettings() {
    if (els.settingsDialog.open) els.settingsDialog.close();
    toggleConversationMode();
  }

  async function openApprovalSettings() {
    if (els.settingsDialog.open) els.settingsDialog.close();
    $("#approvalPolicyError").hidden = true;
    try {
      const current = await workspace("/workspace/approval-policy");
      const choice = $(`input[name="approvalProfile"][value="${current.profile}"]`);
      if (choice) choice.checked = true;
    } catch { /* Recommended remains selected if the policy cannot be read. */ }
    els.approvalDialog.showModal();
  }

  async function saveApprovalSettings(event) {
    event.preventDefault();
    const profile = $("input[name=\"approvalProfile\"]:checked")?.value || "recommended";
    const button = $("#approvalSaveButton");
    const error = $("#approvalPolicyError");
    button.disabled = true; button.textContent = "Saving…"; error.hidden = true;
    try {
      await workspace("/workspace/approval-policy", { method: "POST", body: { profile } });
      els.approvalDialog.close();
      toast("Approval policy saved. Close and reopen Seneschal to activate it.", "warn");
    } catch (failure) { error.textContent = failure.message; error.hidden = false; }
    finally { button.disabled = false; button.textContent = "Save policy"; }
  }

  function commandCatalog() {
    const base = [
      { icon: "+", title: "New session", subtitle: `Create in ${basename(state.currentDirectory)}`, kind: "Action", run: () => newSession() },
      { icon: "P", title: "Add project", subtitle: "Connect a Windows or WSL folder", kind: "Action", run: openProjectDialog },
      { icon: "B", title: "New browser task", subtitle: "Navigate, inspect, click, type, or screenshot", kind: "Browser", run: openBrowserDialog },
      { icon: "VO", title: state.conversationMode ? "Stop Talk mode" : "Start Talk mode", subtitle: "Turn-by-turn listening and spoken replies", kind: "Voice", run: toggleConversationMode },
      { icon: "IN", title: "Instructions Studio", subtitle: "Persona, global and project rules, agents, and skills", kind: "Control", run: () => openInstructionStudio("persona") },
      { icon: "/", title: "OpenCode command guide", subtitle: `${state.openCodeCommands.length} commands currently available`, kind: "Control", run: openCommands },
      { icon: "C", title: "ChatGPT Chat", subtitle: "Open normal ChatGPT with its separate chat allowance", kind: "Companion", run: openChatGPTSpace },
      { icon: "3D", title: "Open Blender", subtitle: "Start Blender and its local MCP bridge", kind: "Creative", run: openBlender },
      { icon: "◐", title: "Switch day / night", subtitle: "Change the matte atelier palette", kind: "Theme", run: toggleTheme },
      { icon: "A", title: "Orbit Drift", subtitle: "Slow geometric welcome animation", kind: "Motion", run: () => setMotion("orbit") },
      { icon: "PX", title: "City Nocturne", subtitle: "Cinematic architectural pixel background", kind: "Motion", run: () => setMotion("pixel-city") },
      { icon: "LR", title: "Lunar Relay", subtitle: "Cinematic moon installation and tracking array", kind: "Motion", run: () => setMotion("lunar-relay") },
      { icon: "OF", title: "Orbital Foundry", subtitle: "Industrial station above a planetary horizon", kind: "Motion", run: () => setMotion("orbital-foundry") },
      { icon: "—", title: "Still composition", subtitle: "Disable welcome animation", kind: "Motion", run: () => setMotion("still") },
      ...(selectedSession() ? [
        { icon: "↓", title: "Export conversation", subtitle: "Download a portable JSON copy", kind: "Action", run: exportSession },
        { icon: "×", title: "Delete conversation", subtitle: selectedSession().title || "Untitled conversation", kind: "Danger", run: openDeleteSession }
      ] : []),
      { icon: "⚙", title: "Workspace settings", subtitle: "Connections, permissions, and advanced tools", kind: "Action", run: openSettings },
      { icon: "↗", title: "Classic OpenCode", subtitle: "Open the original control surface", kind: "Action", run: openClassic }
    ];
    const engineCommands = state.openCodeCommands.map((command) => ({ icon: "/", title: `/${command.name}`, subtitle: command.description || `${command.source || "OpenCode"} command`, kind: command.source === "skill" ? "Skill" : "Command", search: `${command.name} ${(command.hints || []).join(" ")}`, run: () => chooseOpenCodeCommand(command) }));
    const sessions = state.sessions.flatMap((session) => ([
      { icon: "S", title: session.title || "Untitled session", subtitle: `Open · ${basename(session.directory)}`, kind: "Session", run: () => selectSession(session.id) },
      { icon: "@", title: `Reference: ${session.title || "Untitled session"}`, subtitle: "Bring this conversation into the current prompt", kind: "Reference", run: () => insertSessionReference(session) }
    ]));
    const models = state.models.map((model) => ({ icon: "M", title: model.name, subtitle: model.providerName, kind: "Model", run: () => { state.selectedModel = model.value; els.model.value = model.value; storage.set("atelier-model", model.value); renderModelCapability(); renderUsage(); } }));
    return [...base, ...engineCommands, ...sessions, ...models];
  }

  function chooseOpenCodeCommand(command) {
    const hint = (command.hints || []).includes("$ARGUMENTS") ? " " : (command.hints || []).length ? ` ${(command.hints || []).join(" ")}` : "";
    els.prompt.value = `/${command.name}${hint}`;
    autoSizePrompt();
    els.prompt.focus();
    els.prompt.setSelectionRange(els.prompt.value.length, els.prompt.value.length);
  }

  function insertSessionReference(session) {
    const marker = `@session[${session.id}|${session.title || "Untitled session"}]`;
    els.prompt.value = `${els.prompt.value.trim()}${els.prompt.value.trim() ? "\n" : ""}${marker}\n`;
    autoSizePrompt();
    els.prompt.focus();
    toast("Session reference added. Add your question and send.");
  }

  function renderCommandResults() {
    const query = els.commandInput.value.trim().toLowerCase();
    state.commandItems = commandCatalog().filter((item) => !query || `${item.title} ${item.subtitle} ${item.kind} ${item.search || ""}`.toLowerCase().includes(query)).slice(0, 40);
    state.commandIndex = Math.min(state.commandIndex, Math.max(0, state.commandItems.length - 1));
    els.commandResults.innerHTML = state.commandItems.length ? state.commandItems.map((item, index) => `<button class="command-result${index === state.commandIndex ? " active" : ""}" data-command="${index}"><span class="result-icon">${escapeHTML(item.icon)}</span><div><strong>${escapeHTML(item.title)}</strong><small>${escapeHTML(item.subtitle)}</small></div><span>${escapeHTML(item.kind)}</span></button>`).join("") : '<div class="empty-rail">No matching sessions, models, or actions.</div>';
    $$('[data-command]', els.commandResults).forEach((button) => button.addEventListener("click", () => runCommand(Number(button.dataset.command))));
    $(".command-result.active", els.commandResults)?.scrollIntoView({ block: "nearest" });
  }

  function runCommand(index) {
    const item = state.commandItems[index];
    if (!item) return;
    els.commandDialog.close();
    item.run();
  }

  function openCommands() {
    state.commandIndex = 0;
    els.commandInput.value = "";
    renderCommandResults();
    els.commandDialog.showModal();
    setTimeout(() => els.commandInput.focus(), 25);
  }

  function renderProtocol() {
    els.protocolLog.innerHTML = state.logs.length ? state.logs.map((entry) => `<div class="log-row"><time>${entry.time.toLocaleTimeString()}</time><strong>${escapeHTML(entry.type)}</strong><span>${escapeHTML(entry.detail)}</span></div>`).join("") : '<div class="empty-rail">Waiting for OpenCode events…</div>';
  }

  async function refreshAll(showToast = false) {
    setConnection("", "Refreshing");
    try {
      const [health, path, sessions, providers] = await Promise.all([
        api("/global/health", { noDirectory: true }), api("/path", { noDirectory: true }),
        api("/session", { noDirectory: true }), api("/provider", { noDirectory: true })
      ]);
      state.health = health; state.path = path; state.sessions = sessions; state.providers = providers;
      els.version.textContent = health.version || "—";
      if (!state.currentDirectory) state.currentDirectory = sessions[0]?.directory || path.directory;
      if (!directories().includes(state.currentDirectory)) state.currentDirectory = sessions[0]?.directory || path.directory;
      const currentExists = sessions.some((session) => session.id === state.currentSessionID && session.directory === state.currentDirectory);
      if (!currentExists) state.currentSessionID = sessions.filter((session) => session.directory === state.currentDirectory && !session.parentID).sort((a,b) => (b.time?.updated || 0) - (a.time?.updated || 0))[0]?.id || "";
      storage.set("atelier-directory", state.currentDirectory); storage.set("atelier-session", state.currentSessionID);
      await refreshDirectoryData();
      await refreshInstructionData(false);
      await refreshMessages();
      connectEvents();
      refreshWorkspaceMeta();
      setConnection("online", "Live");
      if (showToast) toast("Workspace refreshed.");
    } catch (error) {
      setConnection("error", "Offline");
      toast(`OpenCode is unavailable: ${error.message}`, "error");
    }
  }

  function bindEvents() {
    $("#leftPanelToggle").addEventListener("click", toggleLeftPanel);
    $("#rightPanelToggle").addEventListener("click", toggleRightPanel);
    $("#themeSwitch").addEventListener("click", toggleTheme);
    $("#motionSwitch").addEventListener("click", cycleMotion);
    $("#newSessionButton").addEventListener("click", () => newSession());
    $("#addProjectButton").addEventListener("click", openProjectDialog);
    $("#projectsCollapseButton").addEventListener("click", () => toggleRailSection("projects"));
    $("#pinnedSessionsCollapseButton").addEventListener("click", () => toggleRailSection("pinnedSessions"));
    $("#sessionsCollapseButton").addEventListener("click", () => toggleRailSection("sessions"));
    els.archivedSessionsButton.addEventListener("click", () => { state.showArchivedSessions = !state.showArchivedSessions; renderSessions(); });
    $("#pinnedMessagesCollapseButton").addEventListener("click", () => toggleRailSection("pins"));
    $("#refreshButton").addEventListener("click", () => refreshAll(true));
    $("#commandButton").addEventListener("click", openCommands);
    $("#settingsButton").addEventListener("click", openSettings);
    $("#settingsRailButton").addEventListener("click", openSettings);
    $("#instructionsRailButton").addEventListener("click", () => openInstructionStudio("persona"));
    $("#chatGPTRailButton").addEventListener("click", openChatGPTSpace);
    $("#settingsChatGPTButton").addEventListener("click", openChatGPTSpace);
    $("#settingsEngineButton").addEventListener("click", () => openAdvancedSetting("Classic OpenCode opened with the complete engine controls."));
    $("#settingsThemeButton").addEventListener("click", toggleTheme);
    $("#settingsMotionButton").addEventListener("click", cycleMotion);
    $("#settingsProvidersButton").addEventListener("click", openProviderSettings);
    $("#settingsBrowserButton").addEventListener("click", openBrowserFromSettings);
    $("#settingsBlenderButton").addEventListener("click", openBlenderFromSettings);
    $("#settingsDeepSeekButton").addEventListener("click", openProviderSettings);
    $("#providerConnectForm").addEventListener("submit", connectProvider);
    $("#providerCancelButton").addEventListener("click", () => els.providerDialog.close());
    $("#providerAdvancedButton").addEventListener("click", () => { els.providerDialog.close(); openClassic(); });
    $("#settingsBudgetButton").addEventListener("click", () => openAdvancedSetting("Open provider billing dashboards to set hard limits; Seneschal only estimates local usage."));
    $("#settingsVoiceButton").addEventListener("click", toggleVoiceFromSettings);
    $("#settingsApprovalButton").addEventListener("click", openApprovalSettings);
    $("#settingsCommandsButton").addEventListener("click", () => { els.settingsDialog.close(); openCommands(); });
    $("#settingsArchivesButton").addEventListener("click", openArchiveManager);
    $("#openApprovalButton").addEventListener("click", openApprovalSettings);
    $("#composerMinimizeButton").addEventListener("click", () => {
      const minimized = els.form.classList.toggle("minimized");
      $("#composerMinimizeButton").textContent = minimized ? "Restore" : "Minimize";
      $("#composerMinimizeButton").setAttribute("aria-label", minimized ? "Restore message input" : "Minimize message input");
      if (minimized) {
        els.form.classList.remove("expanded");
        els.prompt.style.height = "46px";
      }
      $("#composerSizeButton").textContent = "Maximize";
      $("#composerSizeButton").setAttribute("aria-label", "Maximize message input");
    });
    $("#composerSizeButton").addEventListener("click", () => {
      const expanded = els.form.classList.toggle("expanded");
      $("#composerSizeButton").textContent = expanded ? "Normal size" : "Maximize";
      $("#composerSizeButton").setAttribute("aria-label", expanded ? "Restore normal input size" : "Maximize message input");
      if (expanded) {
        els.prompt.style.height = "";
        els.prompt.focus();
      } else {
        els.prompt.style.height = "46px";
        requestAnimationFrame(autoSizePrompt);
      }
    });
    $("#exitMessageMaximizeButton").addEventListener("click", exitMaximizedMessage);
    $("#approvalPolicyForm").addEventListener("submit", saveApprovalSettings);
    $("#approvalCancelButton").addEventListener("click", () => els.approvalDialog.close());
    $("#settingsBackupsButton").addEventListener("click", backupNow);
    $("#launchChatGPTButton").addEventListener("click", launchChatGPT);
    $("#skillsButton").addEventListener("click", () => openInstructionStudio("skills"));
    $("#openInstructionsButton").addEventListener("click", () => openInstructionStudio("persona"));
    $("#classicButton").addEventListener("click", openClassic);
    $("#settingsClassicButton").addEventListener("click", openClassic);
    $("#backupNowButton").addEventListener("click", backupNow);
    $("#openBlenderButton").addEventListener("click", openBlender);
    $("#homeButton").addEventListener("click", () => {
      if (innerWidth <= 680) { $(".sidebar").classList.toggle("open"); return; }
      state.currentSessionID = ""; state.messages = []; storage.set("atelier-session", ""); renderAll();
    });
    els.model.addEventListener("change", () => { state.selectedModel = els.model.value; storage.set("atelier-model", state.selectedModel); renderModelCapability(); renderModelVariants(); renderUsage(); const model = selectedModel(); if (model?.providerID === "opencode" && model.id === "deepseek-v4-flash-free") toast("DeepSeek V4 Flash Free is currently returning provider outages. Seneschal will stop repeated 503 retries.", "warn"); });
    els.modelVariant.addEventListener("change", () => { const model = selectedModel(); if (!model) return; state.selectedVariants[model.value] = els.modelVariant.value; storage.set("atelier-model-variants", state.selectedVariants); });
    els.agent.addEventListener("change", () => { state.selectedAgent = els.agent.value; storage.set("atelier-agent", state.selectedAgent); els.inspectorAgent.textContent = agentDisplayName(state.selectedAgent); renderInspector(); renderInstructionStack(); renderModelCapability(); if (state.selectedAgent === "chat") toast("Chat mode enabled. All tools and system actions are off."); });
    els.form.addEventListener("submit", (event) => { event.preventDefault(); sendPrompt(els.prompt.value); });
    els.prompt.addEventListener("input", () => {
      autoSizePrompt();
      if (/^\/[^\s]*$/.test(els.prompt.value)) {
        const query = els.prompt.value.slice(1);
        state.commandIndex = 0;
        els.commandInput.value = query;
        renderCommandResults();
        if (!els.commandDialog.open) els.commandDialog.showModal();
        requestAnimationFrame(() => { els.commandInput.focus(); els.commandInput.setSelectionRange(query.length, query.length); });
      }
    });
    els.prompt.addEventListener("paste", pasteAttachments);
    els.prompt.addEventListener("keydown", (event) => { if (event.key === "Enter" && !event.shiftKey && !event.isComposing) { event.preventDefault(); els.form.requestSubmit(); } });
    els.messageScroll.addEventListener("scroll", updateFollowState, { passive: true });
    els.resumeFollow.addEventListener("click", jumpToLatest);
    els.fileInput.addEventListener("change", () => { addFiles([...els.fileInput.files]); els.fileInput.value = ""; });
    els.mic.addEventListener("click", toggleVoiceDictation);
    els.talk.addEventListener("click", toggleConversationMode);
    $("#browserButton").addEventListener("click", openBrowserDialog);
    $("#browserTryButton").addEventListener("click", openBrowserDialog);
    [els.browserWindow, els.browserWindowCard].forEach((button) => button?.addEventListener("click", toggleBrowserWindow));
    els.archivedMessagesButton.addEventListener("click", () => {
      state.showArchivedMessages = !state.showArchivedMessages;
      renderMessages();
      toast(state.showArchivedMessages ? "Showing archived messages." : "Archived messages hidden.");
    });
    els.browserForm.addEventListener("submit", (event) => { if (event.submitter?.id === "runBrowserButton") runBrowserTask(event); });
    $$(".quick-card").forEach((button) => button.addEventListener("click", () => { els.prompt.value = button.dataset.prompt; autoSizePrompt(); els.prompt.focus(); }));
    els.abortButton.addEventListener("click", abortSession);
    els.composerStop.addEventListener("click", abortSession);
    els.deleteSessionButton.addEventListener("click", openDeleteSession);
    $("#exportSessionButton").addEventListener("click", exportSession);
    els.deleteForm.addEventListener("submit", (event) => { if (event.submitter?.id === "confirmDeleteSessionButton") { event.preventDefault(); deleteSession(); } });
    els.messageEditForm.addEventListener("submit", submitMessageEdit);
    $("#cancelMessageEditButton").addEventListener("click", () => els.messageEditDialog.close());
    $("#renameSessionButton").addEventListener("click", renameSession);
    els.projectForm.addEventListener("submit", addProject);
    $("#openInspectorButton").addEventListener("click", () => els.inspector.classList.add("open"));
    $("#closeInspectorButton").addEventListener("click", () => els.inspector.classList.remove("open"));
    $("#protocolButton").addEventListener("click", () => { renderProtocol(); els.protocolDialog.showModal(); });
    $("#closeProtocolButton").addEventListener("click", () => els.protocolDialog.close());
    $("#closeInstructionsButton").addEventListener("click", closeInstructionStudio);
    $$('[data-instruction-tab]').forEach((button) => button.addEventListener("click", () => showInstructionTab(button.dataset.instructionTab)));
    $$('[data-save-instruction]').forEach((button) => button.addEventListener("click", () => saveInstruction(button.dataset.saveInstruction)));
    $$('[data-undo-instruction]').forEach((button) => button.addEventListener("click", () => undoInstruction(button.dataset.undoInstruction)));
    $$('[data-default-instruction]').forEach((button) => button.addEventListener("click", () => {
      const kind = button.dataset.defaultInstruction;
      const editor = instructionKindEditor(kind);
      if (editor) { editor.value = instructionDefaults[kind] || ""; markInstructionsDirty(); editor.focus(); }
    }));
    [els.personaEditor, els.generalEditor, els.projectEditor, els.buildAgentEditor, els.planAgentEditor, els.skillEditor, els.skillName, els.skillScope].forEach((control) => control?.addEventListener("input", markInstructionsDirty));
    $("#newSkillButton").addEventListener("click", newSkill);
    $("#installSkillLinkButton").addEventListener("click", openSkillLinkInstaller);
    els.inspectSkillLink.addEventListener("click", inspectSkillLink);
    els.skillLink.addEventListener("keydown", (event) => { if (event.key === "Enter") { event.preventDefault(); inspectSkillLink(); } });
    els.saveSkill.addEventListener("click", saveSkill);
    els.archiveSkill.addEventListener("click", archiveCurrentSkill);
    els.instructionDialog.addEventListener("cancel", (event) => { event.preventDefault(); closeInstructionStudio(); });
    els.commandInput.addEventListener("input", () => { state.commandIndex = 0; renderCommandResults(); });
    els.commandInput.addEventListener("keydown", (event) => {
      if (event.key === "ArrowDown") { event.preventDefault(); state.commandIndex = Math.min(state.commandItems.length - 1, state.commandIndex + 1); renderCommandResults(); }
      if (event.key === "ArrowUp") { event.preventDefault(); state.commandIndex = Math.max(0, state.commandIndex - 1); renderCommandResults(); }
      if (event.key === "Enter") { event.preventDefault(); runCommand(state.commandIndex); }
    });
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && state.maximizedMessageID) { event.preventDefault(); exitMaximizedMessage(); }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") { event.preventDefault(); openCommands(); }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "n") { event.preventDefault(); newSession(); }
    });
    [els.projectDialog, els.settingsDialog, els.archiveDialog, els.providerDialog, els.approvalDialog, els.chatGPTDialog, els.deleteDialog, els.messageEditDialog, els.browserDialog, els.commandDialog, els.protocolDialog].forEach((dialog) => dialog.addEventListener("click", (event) => { if (event.target === dialog) dialog.close(); }));
    els.instructionDialog.addEventListener("click", (event) => { if (event.target === els.instructionDialog) closeInstructionStudio(); });
    document.addEventListener("visibilitychange", syncMotionState);
    window.addEventListener("beforeunload", () => { state.speechRecognition?.abort(); state.conversationRecognition?.abort(); window.speechSynthesis?.cancel(); state.mediaStream?.getTracks().forEach((track) => track.stop()); state.eventSource?.close(); clearInterval(state.permissionTimer); clearInterval(state.pulseTimer); });
  }

  async function init() {
    const savedTheme = storage.get("atelier-theme", null);
    setTheme(savedTheme || (matchMedia("(prefers-color-scheme: dark)").matches ? "night" : "day"));
    setMotion(state.motion);
    syncPanelState();
    state.conversationMode = false;
    storage.set("seneschal-talk-mode", false);
    setTalkState();
    syncMotionState();
    bindEvents();
    autoSizePrompt();
    renderPulse();
    state.pulseTimer = setInterval(renderPulse, 2000);
    requestAnimationFrame(pixelCityLoop);
    await refreshAll();
    state.permissionTimer = setInterval(pollPermissions, 1200);
  }

  init();
})();
