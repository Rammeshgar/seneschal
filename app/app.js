(function (root) {
  "use strict";
  const escape = value => String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  function inline(value) {
    const tokens = [];
    const hold = html => `\u0000${tokens.push(html) - 1}\u0000`;
    let text = String(value).replace(/`([^`]+)`/g, (_, code) => hold(`<code>${escape(code)}</code>`));
    text = text.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, (_, label, url) => hold(`<a href="${escape(url)}" target="_blank" rel="noopener noreferrer">${escape(label)}</a>`));
    text = text.replace(/https?:\/\/[^\s<>\u0000]+/g, url => hold(`<a href="${escape(url)}" target="_blank" rel="noopener noreferrer">${escape(url)}</a>`));
    text = escape(text).replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>').replace(/\*([^*\n]+)\*/g, '<em>$1</em>');
    return text.replace(/\u0000(\d+)\u0000/g, (_, index) => tokens[Number(index)] || '');
  }
  function cells(line) {
    let text = line.trim().replace(/^\|/, '').replace(/(?<!\\)\|$/, '');
    const result = []; let cell = '', code = false;
    for (let i = 0; i < text.length; i++) {
      if (text[i] === '`') code = !code;
      if (text[i] === '|' && text[i - 1] !== '\\' && !code) { result.push(cell); cell = ''; }
      else cell += text[i];
    }
    result.push(cell);
    return result.map(value => value.trim().replace(/\\\|/g, '|'));
  }
  function render(value, codeRenderer) {
    const lines = String(value || '').replace(/\r\n?/g, '\n').replace(/\u0000/g, '').split('\n');
    const html = [];
    const special = (i) => /^\s*(```|~~~|#{1,6}\s|[-*+]\s|\d+\.\s|>\s|---+$)/.test(lines[i] || '') || (lines[i + 1]?.includes('|') && cells(lines[i + 1]).every(c => /^:?-{3,}:?$/.test(c)));
    for (let i = 0; i < lines.length;) {
      const line = lines[i];
      if (!line.trim()) { i++; continue; }
      const fence = line.match(/^\s*(```|~~~)(.*)$/);
      if (fence) {
        const body = []; i++;
        while (i < lines.length && !lines[i].trim().startsWith(fence[1])) body.push(lines[i++]);
        if (i < lines.length) i++;
        html.push(codeRenderer ? codeRenderer(fence[2].trim() || 'code', body.join('\n')) : `<pre><code>${escape(body.join('\n'))}</code></pre>`); continue;
      }
      if (line.includes('|') && lines[i + 1]?.includes('|')) {
        const separators = cells(lines[i + 1]); const headers = cells(line);
        if (separators.length === headers.length && separators.every(c => /^:?-{3,}:?$/.test(c))) {
          i += 2; const rows = [];
          while (i < lines.length && lines[i].trim() && lines[i].includes('|')) {
            const row = cells(lines[i++]); rows.push(`<tr>${headers.map((_, n) => `<td>${inline(row[n] || '')}</td>`).join('')}</tr>`);
          }
          html.push(`<div class="markdown-table-scroll" role="region" aria-label="Comparison table" tabindex="0"><table><thead><tr>${headers.map(h => `<th scope="col">${inline(h)}</th>`).join('')}</tr></thead><tbody>${rows.join('')}</tbody></table></div>`); continue;
        }
      }
      const heading = line.match(/^\s*(#{1,6})\s+(.+)$/);
      if (heading) { html.push(`<h${heading[1].length}>${inline(heading[2])}</h${heading[1].length}>`); i++; continue; }
      if (/^\s*---+\s*$/.test(line)) { html.push('<hr>'); i++; continue; }
      if (/^\s*>/.test(line)) {
        const quote = []; while (i < lines.length && /^\s*>/.test(lines[i])) quote.push(lines[i++].replace(/^\s*>\s?/, ''));
        html.push(`<blockquote>${render(quote.join('\n'), codeRenderer)}</blockquote>`); continue;
      }
      const list = line.match(/^\s*(?:([-*+])|\d+\.)\s+(.+)$/);
      if (list) {
        const tag = list[1] ? 'ul' : 'ol'; const items = [];
        while (i < lines.length) {
          const item = lines[i].match(/^\s*(?:([-*+])|\d+\.)\s+(.+)$/);
          if (!item || (item[1] ? 'ul' : 'ol') !== tag) break;
          items.push(`<li>${inline(item[2])}</li>`); i++;
          if (!lines[i]?.trim() && /^\s*(?:[-*+]|\d+\.)\s/.test(lines[i + 1] || '')) i++;
        }
        html.push(`<${tag}>${items.join('')}</${tag}>`); continue;
      }
      const paragraph = [line]; i++;
      while (i < lines.length && lines[i].trim() && !special(i)) paragraph.push(lines[i++]);
      html.push(`<p>${paragraph.map(inline).join('<br>')}</p>`);
    }
    return html.join('');
  }
  const api = { render, inline, cells };
  if (typeof module !== 'undefined') module.exports = api;
  else root.SeneschalMarkdown = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);

(() => {
  "use strict";

  const confirm = message => window.confirm(window.SeneschalI18n?.t(message) || message);
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
    sessionProjects: {},
    statuses: {},
    providers: { all: [], connected: [], default: {} },
    models: [],
    agents: [],
    tools: [],
    promptSubmissions: new Set(),
    mcp: {},
    messages: [],
    permissions: [],
    permissionReplies: new Map(),
    collapsedMessageIDs: new Set(),
    toolDetails: new Map(),
    pinnedMessages: storage.get("seneschal-pinned-messages", {}),
    archivedMessages: storage.get("seneschal-archived-messages", {}),
    deletedMessages: storage.get("seneschal-deleted-messages", {}),
    pinnedSessions: new Set(storage.get("seneschal-pinned-sessions", [])),
    archivedSessions: new Set(storage.get("seneschal-archived-sessions", [])),
    excludedProjects: new Set(storage.get("seneschal-excluded-projects", [])),
    projectAliases: storage.get("seneschal-project-aliases", {}),
    showArchivedSessions: false,
    showArchivedMessages: false,
    railSections: storage.get("seneschal-rail-sections-v2", { projects: true, pinnedSessions: true, sessions: true, pins: true }),
    inspectorSections: storage.get("seneschal-inspector-sections", { permissions: true, tools: true, browser: true, creative: true, code: true, budget: true, providers: true, pulse: true }),
    maximizedMessageID: "",
    editingMessageID: "",
    attachments: [],
    currentDirectory: storage.get("atelier-directory", ""),
    currentSessionID: storage.get("atelier-session", ""),
    launchSelection: { directory: new URLSearchParams(location.search).get("directory") || "", sessionID: new URLSearchParams(location.search).get("session") || "" },
    pendingDeleteSessionID: "",
    pendingDeleteMessageID: "",
    pendingDeleteProject: "",
    pendingRenameProject: "",
    selectedModel: storage.get("atelier-model", ""),
    sessionModels: storage.get("seneschal-session-models", {}),
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
    refreshingWorkspace: false,
    speechRecognition: null,
    speechBaseText: "",
    mediaRecorder: null,
    mediaStream: null,
    mediaChunks: [],
    conversationMode: storage.get("seneschal-talk-mode", storage.get("digital-servant-talk-mode", false)),
    conversationRecognition: null,
    conversationRestartTimer: null,
    voiceAwaitingResponse: false,
    voiceTurn: null,
    voiceSpeaking: false,
    voiceMicMuted: false,
    voiceSpeakerMuted: false,
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
    vscodeRuntime: { available: false, remote: "", companionAvailable: false },
    agentBoard: { version: 3, id: "", title: "", directory: "", objective: "", concurrency: 2, active: false, paused: false, agents: [], communications: [] },
    agentBoardHistory: [],
    agentBoardDesigning: false,
    agentBoardTimer: null,
    agentBoardSaving: null,
    paidUsage: { budget: 10, cost: null, percent: null },
    permissionMisses: {},
    permissionTimer: null
  };

  const els = {
    connection: $("#connectionPill"), model: $("#modelSelect"), providerOrb: $("#providerOrb"), modelPicker: $("#modelPicker"), modelPickerButton: $("#modelPickerButton"), modelPickerLabel: $("#modelPickerLabel"), modelPickerMenu: $("#modelPickerMenu"), modelSearch: $("#modelSearchInput"), modelPickerGroups: $("#modelPickerGroups"), modelPickerEmpty: $("#modelPickerEmpty"),
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
    deleteMessageDialog: $("#deleteMessageDialog"), deleteMessageForm: $("#deleteMessageForm"), deleteMessageTitle: $("#deleteMessageTitle"),
    deleteProjectDialog: $("#deleteProjectDialog"), deleteProjectForm: $("#deleteProjectForm"), deleteProjectTitle: $("#deleteProjectTitle"),
    messageEditDialog: $("#messageEditDialog"), messageEditForm: $("#messageEditForm"), messageEditInput: $("#messageEditInput"), messageEditAttachmentNote: $("#messageEditAttachmentNote"),
    toastRegion: $("#toastRegion"), inspector: $("#inspector"), browserState: $("#browserState"),
    browserCard: $("#browserCard"), browserDetail: $("#browserDetail"), browserDialog: $("#browserDialog"),
    browserForm: $("#browserForm"), browserUrl: $("#browserUrlInput"), browserTask: $("#browserTaskInput"), browserError: $("#browserError"), browserWindow: $("#browserWindowButton"), browserWindowCard: $("#browserWindowCardButton"),
    blenderState: $("#blenderState"), blenderCard: $("#blenderCard"), blenderDetail: $("#blenderDetail"),
    budgetState: $("#budgetState"), budgetMeter: $("#budgetMeter"), budgetAmount: $("#budgetAmount"),
    vscodeState: $("#vscodeState"), vscodeCard: $("#vscodeCard"), vscodeDetail: $("#vscodeDetail"), vscodeDialog: $("#vscodeDialog"), vscodeForm: $("#vscodeForm"), vscodePath: $("#vscodePathInput"), vscodeLine: $("#vscodeLineInput"), vscodeColumn: $("#vscodeColumnInput"), vscodeError: $("#vscodeError"),
    agentBoardDialog: $("#agentBoardDialog"), agentBoardColumns: $("#agentBoardColumns"), agentBoardObjective: $("#agentBoardObjective"), agentBoardConcurrency: $("#agentBoardConcurrency"), agentBoardState: $("#agentBoardState"), agentBoardSummary: $("#agentBoardSummary"), agentBoardHistoryDialog: $("#agentBoardHistoryDialog"), agentBoardHistoryList: $("#agentBoardHistoryList"),
    agentEditorDialog: $("#agentEditorDialog"), agentEditorForm: $("#agentEditorForm"), agentName: $("#agentNameInput"), agentRole: $("#agentRoleInput"), agentModel: $("#agentModelInput"), agentAccess: $("#agentAccessInput"), agentDependency: $("#agentDependencyInput"), agentPrompt: $("#agentPromptInput"), agentEditingID: $("#agentEditingID"), agentEditorError: $("#agentEditorError"),
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
    return window.SeneschalMarkdown.render(value, (language, code) => `<section class="code-block"><header><span>${escapeHTML(language)}</span><button type="button" class="code-copy-button" aria-label="Copy code"><span>Copy</span></button></header><pre><code data-lang="${escapeHTML(language)}">${highlightCode(code)}</code></pre></section>`);
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

  function normalizeSession(session) {
    if (state.sessionProjects[session?.id]) return { ...session, projectDirectory: state.sessionProjects[session.id] };
    if (typeof session?.metadata?.seneschalDirectory === "string" && session.metadata.seneschalDirectory.startsWith("/")) {
      return { ...session, projectDirectory: session.metadata.seneschalDirectory };
    }
    return session;
  }
  function selectedSession() { return state.sessions.find((session) => session.id === state.currentSessionID); }
  function sessionProject(session) { return session.projectDirectory || session.directory; }
  function workingDirectory() { return selectedSession()?.directory || state.currentDirectory; }
  function isBoardSession(session) {
    if (!session) return false;
    if (/^\[(?:Board|Board Architect)\]\s/i.test(String(session.title || ""))) return true;
    if (session.id && session.id === state.agentBoard.architectSessionID) return true;
    return state.agentBoard.agents.some((agent) => agent.sessionID && agent.sessionID === session.id && !agent.imported);
  }
  function ordinarySessions() { return state.sessions.filter((session) => !isBoardSession(session)); }
  function selectedModel() { return state.models.find((model) => model.value === state.selectedModel) || state.models[0]; }

  function modelReference(session) {
    const providerID = session?.model?.providerID;
    const modelID = session?.model?.id || session?.model?.modelID;
    return providerID && modelID ? `${providerID}/${modelID}` : "";
  }

  function rememberSessionModel(value = state.selectedModel) {
    const session = selectedSession();
    if (!session || !value) return;
    state.sessionModels[session.id] = value;
    storage.set("seneschal-session-models", state.sessionModels);
  }

  function withDirectory(path, directory = state.currentDirectory) {
    if (!directory) return path;
    const url = new URL(path, location.origin);
    url.searchParams.set("directory", directory);
    return `${url.pathname}${url.search}`;
  }

  async function api(path, options = {}) {
    const target = options.noDirectory ? path : withDirectory(path, options.directory);
    const init = { method: options.method || "GET", headers: { Accept: "application/json" } };
    if (options.signal) init.signal = options.signal;
    if (options.body !== undefined) {
      init.headers["Content-Type"] = "application/json";
      init.body = JSON.stringify(options.body);
    }
    const response = await fetch(`/api${target}`, init);
    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      const error = new Error(detail || `${response.status} ${response.statusText}`);
      error.status = response.status;
      throw error;
    }
    if (response.status === 204) return null;
    const type = response.headers.get("content-type") || "";
    return type.includes("json") ? response.json() : response.text();
  }

  async function workspace(path, options = {}) {
    const init = { method: options.method || "GET", headers: { Accept: "application/json" } };
    if (options.signal) init.signal = options.signal;
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

  function setRecoveryStatus(kind) {
    const messages = {
      offline: "Offline. PC tasks may still be running. Reconnecting when your connection returns…",
      reconnecting: "Reconnecting to the PC… Your messages will not be resent.",
      syncing: "Connected. Catching up with the latest messages and task status…",
      expired: document.body.classList.contains("remote-client") ? "Phone access expired or was revoked. Open the pairing page to reconnect." : "Access expired. Reopen Seneschal from its PC launcher."
    };
    const notice = $("#connectionRecoveryStatus");
    if (notice) {
      notice.textContent = messages[kind] || ""; notice.hidden = !notice.textContent;
      if (kind === "expired" && document.body.classList.contains("remote-client")) {
        const link = document.createElement("a"); link.href = "/remote/pair"; link.textContent = "Pair this browser";
        notice.append(" ", link);
      }
    }
    setConnection(kind === "live" ? "online" : kind === "expired" ? "error" : "", kind === "live" ? "Live" : kind === "offline" ? "Offline" : kind === "expired" ? "Sign in again" : "Reconnecting");
    els.pulseLabel.textContent = kind === "live" ? "LIVE" : "RETRY";
    updateConversationClearance();
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

  function revealRailSection(key) {
    if (key !== "projects" && key !== "sessions") return;
    state.leftPanelCollapsed = false;
    state.railSections[key] = false;
    storage.set("atelier-left-panel-collapsed", false);
    storage.set("seneschal-rail-sections-v2", state.railSections);
    syncPanelState(); syncRailSections();
    const section = $(key === "projects" ? "#projectsRailSection" : "#sessionsRailSection");
    if (section) {
      section.tabIndex = -1;
      section.setAttribute("aria-label", key === "projects" ? "Projects" : "Sessions");
      section.scrollIntoView({ block: "nearest", inline: "nearest" });
      section.focus({ preventScroll: true });
    }
  }

  function revealInspectorSection(key) {
    if (!["permissions", "tools", "providers", "pulse"].includes(key)) return;
    const section = $('.inspector-block[data-inspector-section="' + key + '"]');
    if (!section) return;
    state.rightPanelCollapsed = false;
    state.inspectorSections[key] = false;
    storage.set("atelier-right-panel-collapsed", false);
    storage.set("seneschal-inspector-sections", state.inspectorSections);
    syncPanelState(); syncInspectorSections();
    if (innerWidth <= 1120) els.inspector.classList.add("open");
    section.tabIndex = -1;
    section.setAttribute("aria-label", ({ permissions: "Permissions", tools: "Active tools", providers: "Providers", pulse: "Workspace pulse" })[key]);
    section.scrollIntoView({ block: "nearest", inline: "nearest" });
    section.focus({ preventScroll: true });
  }

  function syncCompactPermissionBadge(pending) {
    const badge = $("#compactPermissionBadge"), button = $("#compactPermissions");
    if (!badge || !button) return;
    const count = (pending || state.permissions.filter(item => state.permissionReplies.get(item.id)?.status !== "resolved")).length;
    const number = window.SeneschalI18n?.number(Math.min(count, 9)) || String(Math.min(count, 9));
    badge.hidden = count === 0;
    const label = number + (count > 9 ? "+" : "");
    if (badge.textContent !== label) badge.textContent = label;
    button.classList.toggle("has-pending", count > 0);
    const status = $("#compactPermissionStatus");
    const source = count ? "Permission required" : "No waiting approvals";
    if (status) {
      if (window.SeneschalI18n?.setText) window.SeneschalI18n.setText(status, source);
      else if (status.textContent !== source) status.textContent = source;
    }
  }

  function bindCompactNavigation() {
    $("#settingsRailButton")?.setAttribute("aria-label", "Workspace settings");
    $("#settingsRailButton")?.setAttribute("title", "Workspace settings");
    $("#compactNewSession")?.addEventListener("click", () => newSession());
    $("#compactProjects")?.addEventListener("click", () => revealRailSection("projects"));
    $("#compactSessions")?.addEventListener("click", () => revealRailSection("sessions"));
    $$("[data-context-section]").forEach(button => button.addEventListener("click", () => revealInspectorSection(button.dataset.contextSection)));
    const leftMedia = matchMedia("(min-width: 681px)"), rightMedia = matchMedia("(min-width: 1121px)");
    leftMedia.addEventListener("change", event => {
      if (!event.matches && $(".compact-left-nav")?.contains(document.activeElement)) $("#homeButton")?.focus({ preventScroll: true });
    });
    rightMedia.addEventListener("change", event => {
      if (!event.matches && $(".compact-context-nav")?.contains(document.activeElement)) $("#openInspectorButton")?.focus({ preventScroll: true });
    });
    window.addEventListener("seneschal:languagechange", () => syncCompactPermissionBadge());
    syncCompactPermissionBadge();
  }

  const motionPresets = {
    orbit: { short: "Orbit", label: "Orbit Drift" },
    citylight: { short: "Citylight", label: "Citylight" },
    "pixel-city": { short: "City", label: "City Nocturne" },
    "lunar-relay": { short: "Lunar", label: "Lunar Relay" },
    "orbital-foundry": { short: "Foundry", label: "Orbital Foundry" },
    "afterlight-city": { short: "Starlight", label: "Canal City" },
    "afterlight-observatory": { short: "Northstar", label: "Northstar" },
    "afterlight-sleeper": { short: "Sleeper", label: "The Last Sleeper" },
    "afterlight-pelagic": { short: "Pelagic", label: "Pelagic Archive" },
    "afterlight-sanctuary": { short: "Sanctuary", label: "Lantern Sanctuary" },
    still: { short: "Still", label: "Still composition" }
  };

  function setMotion(name) {
    const next = motionPresets[name] ? name : "orbit";
    state.motion = next;
    storage.set("atelier-motion", next);
    document.documentElement.dataset.motion = next;
    $("#motionLabel").textContent = motionPresets[next].short;
    $("#settingsMotion").textContent = motionPresets[next].label;
    if (window.SeneschalAtmosphere) window.SeneschalAtmosphere.select(next);
    else if (["pixel-city", "lunar-relay", "orbital-foundry"].includes(next)) drawPixelScene(performance.now());
  }

  function openAtmospheres(event) {
    if (window.SeneschalAtmosphere) window.SeneschalAtmosphere.open(event?.currentTarget || $("#settingsButton"));
    else cycleMotion();
  }

  function cycleMotion() {
    const order = ["orbit", "pixel-city", "lunar-relay", "orbital-foundry", "still"];
    setMotion(order[(order.indexOf(state.motion) + 1) % order.length]);
    toast(`Welcome animation: ${motionPresets[state.motion].label}`);
  }

  function syncMotionState() {
    document.documentElement.dataset.motionPaused = document.hidden ? "true" : "false";
    window.SeneschalAtmosphere?.sync();
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
    const list = [state.currentDirectory, state.path?.directory, ...state.customDirectories, ...state.sessions.map(sessionProject)].filter(Boolean);
    return [...new Set(list)].filter((directory) => !state.excludedProjects.has(directory));
  }

  function projectLabel(directory) { return state.projectAliases[directory] || basename(directory); }

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
    storage.set("seneschal-rail-sections-v2", state.railSections);
    syncRailSections();
  }

  function syncInspectorSections() {
    const keys = ["permissions", "tools", "browser", "creative", "code", "budget", "providers", "pulse"];
    $$(".inspector-block", els.inspector).forEach((section, index) => {
      const key = section.dataset.inspectorSection || keys[index] || `section-${index}`; section.dataset.inspectorSection = key;
      let button = $(".inspector-section-toggle", section);
      if (!button) {
        button = document.createElement("button"); button.type = "button"; button.className = "inspector-section-toggle"; button.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m7 10 5 5 5-5"/></svg>';
        $(".block-title", section)?.append(button);
        button.addEventListener("click", () => { state.inspectorSections[key] = !state.inspectorSections[key]; storage.set("seneschal-inspector-sections", state.inspectorSections); syncInspectorSections(); });
      }
      const content = [...section.children].filter(child => !child.classList.contains("block-title") && !child.classList.contains("pulse-summary"));
      content.forEach((child, childIndex) => { if (!child.id) child.id = `inspector-${key}-details-${childIndex}`; });
      button.setAttribute("aria-controls", content.map(child => child.id).join(" "));
      const collapsed = state.inspectorSections[key] !== false; section.classList.toggle("collapsed", collapsed); button.setAttribute("aria-expanded", String(!collapsed)); button.setAttribute("aria-label", `${collapsed ? "Expand" : "Minimize"} ${$(".block-title > span", section)?.textContent || "section"}`);
    });
  }

  function renderProjects() {
    const dirs = directories();
    els.projectList.innerHTML = dirs.length ? dirs.map((dir) => {
      const count = ordinarySessions().filter((session) => sessionProject(session) === dir && !session.parentID).length;
      const active = dir === state.currentDirectory ? " active" : "";
      const title = projectLabel(dir);
      return `<div class="project-row${active}"><button class="project-item${active}" data-directory="${escapeHTML(dir)}" title="Open ${escapeHTML(title)} · ${escapeHTML(dir)}"><span class="project-glyph">${escapeHTML(title.slice(0,1).toUpperCase())}</span><span>${escapeHTML(title)}</span><small>${count}</small></button><button class="project-rename-button" type="button" data-rename-project="${escapeHTML(dir)}" aria-label="Rename ${escapeHTML(title)} in Seneschal" title="Rename project label"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m4 16-.7 4 4-.7L18.6 8 16 5.4 4 16Z"/><path d="m14.5 7 2.6 2.6"/></svg></button><button class="project-delete-button" type="button" data-delete-project="${escapeHTML(dir)}" aria-label="Delete ${escapeHTML(title)} from Seneschal" title="Remove project from Seneschal"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M9 7V4h6v3M7 7l1 13h8l1-13M10 11v5M14 11v5"/></svg></button></div>`;
    }).join("") : '<div class="empty-rail">Add a project folder to begin.</div>';
    $$(".project-item", els.projectList).forEach((button) => button.addEventListener("click", () => switchDirectory(button.dataset.directory)));
    $$('[data-rename-project]', els.projectList).forEach((button) => button.addEventListener("click", () => openRenameProject(button.dataset.renameProject)));
    $$('[data-delete-project]', els.projectList).forEach((button) => button.addEventListener("click", () => openDeleteProject(button.dataset.deleteProject)));
    syncRailSections();
  }

  function openRenameProject(directory) {
    if (!directory) return;
    state.pendingRenameProject = directory;
    $("#projectNameInput").value = projectLabel(directory);
    $("#renameProjectPath").textContent = directory;
    $("#renameProjectError").hidden = true;
    $("#renameProjectDialog").showModal();
    setTimeout(() => { $("#projectNameInput").focus(); $("#projectNameInput").select(); }, 30);
  }

  function saveProjectName(event) {
    event.preventDefault();
    const directory = state.pendingRenameProject;
    const name = $("#projectNameInput").value.trim();
    if (!directory || !name) { $("#renameProjectError").textContent = "Enter a project name."; $("#renameProjectError").hidden = false; return; }
    if (name.length > 80 || /[\x00-\x1f\x7f]/.test(name)) { $("#renameProjectError").textContent = "Use 80 characters or fewer without control characters."; $("#renameProjectError").hidden = false; return; }
    state.projectAliases[directory] = name;
    storage.set("seneschal-project-aliases", state.projectAliases);
    state.pendingRenameProject = "";
    $("#renameProjectDialog").close();
    renderProjects(); renderHeader(); renderComposer();
    toast(`Project label changed to ${name}. The folder was not renamed.`);
  }

  function openDeleteProject(directory) {
    if (!directory) return;
    state.pendingDeleteProject = directory;
    els.deleteProjectTitle.textContent = basename(directory);
    els.deleteProjectDialog.showModal();
  }

  async function deleteProject() {
    const directory = state.pendingDeleteProject;
    if (!directory) return;
    state.excludedProjects.add(directory);
    state.customDirectories = state.customDirectories.filter((item) => item !== directory);
    delete state.projectAliases[directory];
    storage.set("seneschal-excluded-projects", [...state.excludedProjects]);
    storage.set("atelier-projects", state.customDirectories);
    storage.set("seneschal-project-aliases", state.projectAliases);
    state.pendingDeleteProject = "";
    els.deleteProjectDialog.close();
    if (state.currentDirectory === directory) {
      const nextDirectory = directories()[0] || "";
      state.currentDirectory = "";
      state.currentSessionID = "";
      state.messages = [];
      storage.set("atelier-directory", "");
      storage.set("atelier-session", "");
      if (nextDirectory) await switchDirectory(nextDirectory);
      else renderAll();
    } else renderProjects();
    toast(`${basename(directory)} removed from Seneschal. Its folder and sessions were not deleted.`);
  }

  function sessionStatus(sessionID) {
    const status = state.statuses[sessionID];
    return (typeof status === "string" ? status : status?.type || status?.status) || "idle";
  }

  function mergePermissionSnapshot(latest = [], session = selectedSession()) {
    latest = latest.filter(permission => state.permissionReplies?.get(permission.id)?.status !== "resolved");
    const latestByID = new Map(latest.map((permission) => [permission.id, permission]));
    const merged = [...latest];
    for (const permission of state.permissions) {
      if (state.permissionReplies?.get(permission.id)?.status === "resolved") continue;
      if (latestByID.has(permission.id)) { state.permissionMisses[permission.id] = 0; continue; }
      const belongsHere = !session || !permission.sessionID || permission.sessionID === session.id;
      if (!belongsHere) { merged.push(permission); continue; }
      const stillWorking = ["busy", "retry", "running"].includes(sessionStatus(permission.sessionID));
      state.permissionMisses[permission.id] = (state.permissionMisses[permission.id] || 0) + 1;
      // The REST snapshot can lag behind the live permission event. Never flash the
      // approval away: retain it while work is active and through ten verified idle polls.
      if (stillWorking || state.permissionMisses[permission.id] < 10) merged.push(permission);
      else delete state.permissionMisses[permission.id];
    }
    return merged;
  }

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
      const next = ordinarySessions()
        .filter((session) => sessionProject(session) === state.currentDirectory && !session.parentID && !state.archivedSessions.has(session.id))
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
    return `<div class="session-item${active}${pinned ? " pinned" : ""}${archived ? " archived" : ""}"><button class="session-open-button" data-session="${escapeHTML(session.id)}" title="Open ${escapeHTML(title)}"><span class="session-copy"><strong>${escapeHTML(title)}</strong><small>${timeAgo(session.time?.updated)} · ${escapeHTML(session.model?.id || "agent")}</small></span><i class="session-dot ${status}"></i></button><button class="session-pin-button${pinned ? " active" : ""}" data-session="${escapeHTML(session.id)}" aria-label="${pinned ? "Unpin" : "Pin"} ${escapeHTML(title)}" title="${pinned ? "Unpin session" : "Pin session to top"}"${archived ? " disabled" : ""}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m8 3 8 8-3 1-4 6-1-6-3-3zM8 16l-4 4"/></svg></button><button class="session-archive-button" data-session="${escapeHTML(session.id)}" aria-label="${archived ? "Restore" : "Archive"} ${escapeHTML(title)}" title="${archived ? "Restore session" : "Archive session"}"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16v13H4zM3 4h18v4H3zM9 12h6"/></svg></button><button class="session-rename-button" data-session="${escapeHTML(session.id)}" aria-label="Rename ${escapeHTML(title)}" title="Rename without opening"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m4 16-.7 4 4-.7L18.6 8 16 5.4 4 16Z"/><path d="m14.5 7 2.6 2.6"/></svg></button><button class="session-delete-button" data-session="${escapeHTML(session.id)}" aria-label="Delete ${escapeHTML(title)}" title="Delete session permanently"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M9 7V4h6v3M7 7l1 13h8l1-13M10 11v5M14 11v5"/></svg></button></div>`;
  }

  function bindSessionRailActions() {
    [els.pinnedSessionList, els.sessionList].forEach((list) => {
      $$(".session-open-button", list).forEach((button) => button.addEventListener("click", () => selectSession(button.dataset.session)));
      $$(".session-pin-button", list).forEach((button) => button.addEventListener("click", () => toggleSessionPin(button.dataset.session)));
      $$(".session-archive-button", list).forEach((button) => button.addEventListener("click", () => toggleSessionArchive(button.dataset.session)));
      $$(".session-rename-button", list).forEach((button) => button.addEventListener("click", () => renameSession(button.dataset.session)));
      $$(".session-delete-button", list).forEach((button) => button.addEventListener("click", () => openDeleteSession(button.dataset.session)));
    });
  }

  function renderSessions() {
    const allSessions = ordinarySessions()
      .filter((session) => sessionProject(session) === state.currentDirectory && !session.parentID)
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
    $("#settingsArchives").textContent = `${ordinarySessions().filter((session) => state.archivedSessions.has(session.id)).length} archived`;
    els.sessionList.innerHTML = sessions.length ? sessions.map(sessionRailItem).join("") : '<div class="empty-rail">No unpinned sessions in this project.</div>';
    bindSessionRailActions();
    syncRailSections();
  }

  function flattenModels() {
    const connected = new Set(state.providers.connected || []);
    const curated = {
      google: ["gemini-3.7-flash", "gemini-3.5-flash-lite", "gemini-3.1-pro-preview", "gemini-2.5-flash-lite"],
      openai: ["gpt-6-astra", "gpt-6.1-sol", "gpt-6-sol", "gpt-6-luna", "gpt-5.6-sol", "gpt-5.6-terra", "gpt-5.6-luna"],
      bonsai: ["ternary-bonsai-27b"],
      deepseek: ["deepseek-v4-flash", "deepseek-v4-pro"]
    };
    // A published model is not necessarily registered in this running engine.
    // Never manufacture selectable catalog entries or their capabilities/prices.
    const list = [];
    for (const provider of state.providers.all || []) {
      const configuredLocal = provider.id === "bonsai" && provider.source === "custom";
      if (connected.size && !connected.has(provider.id) && !configuredLocal) continue;
      const providerModels = Object.values(provider.models || {});
      for (const model of providerModels) {
        // Prefer known OpenAI entries in sorting, but retain engine-reported fallbacks.
        if (provider.id !== "openai" && curated[provider.id] && !curated[provider.id].includes(model.id)) continue;
        if (!(model.capabilities?.input?.text ?? true) || !(model.capabilities?.toolcall ?? model.tool_call ?? true)) continue;
        list.push({ ...model, providerID: model.providerID || provider.id, providerName: provider.name, value: `${model.providerID || provider.id}/${model.id}` });
      }
    }
    const providerOrder = ["openai", "bonsai", "google", "opencode", "deepseek"];
    const preferredRank = (model) => {
      const index = curated[model.providerID]?.indexOf(model.id) ?? -1;
      return index >= 0 ? index : 99;
    };
    return list.sort((a, b) => {
      const pa = preferredRank(a);
      const pb = preferredRank(b);
      return a.providerID === b.providerID ? pa - pb : providerOrder.indexOf(a.providerID) - providerOrder.indexOf(b.providerID);
    });
  }

  function renderModels() {
    state.models = flattenModels();
    const current = selectedSession();
    const available = new Set(state.models.map((model) => model.value));
    const remembered = current ? state.sessionModels[current.id] : "";
    const sessionRef = modelReference(current);
    const fallback = storage.get("atelier-model", "");
    state.selectedModel = [remembered, sessionRef, state.selectedModel, fallback, state.models[0]?.value].find((value) => value && available.has(value)) || "";
    if (current && state.selectedModel && state.sessionModels[current.id] !== state.selectedModel) rememberSessionModel();
    const groups = new Map();
    state.models.forEach((model) => {
      if (!groups.has(model.providerName)) groups.set(model.providerName, []);
      groups.get(model.providerName).push(model);
    });
    els.model.innerHTML = [...groups.entries()].map(([provider, models]) => `<optgroup label="${escapeHTML(provider)}">${models.map((model) => `<option value="${escapeHTML(model.value)}"${model.value === state.selectedModel ? " selected" : ""}>${escapeHTML(model.name)}</option>`).join("")}</optgroup>`).join("");
    renderModelPicker();
    if (!current) storage.set("atelier-model", state.selectedModel);
    renderModelCapability();
    renderModelVariants();
  }

  function renderModelPicker(query = els.modelSearch?.value || "") {
    const selected = selectedModel();
    els.modelPickerLabel.dataset.modelName = String(Boolean(selected?.name));
    els.modelPickerLabel.textContent = selected?.name || "Select model";
    const needle = query.trim().toLowerCase();
    const groups = new Map();
    state.models.forEach((model) => {
      if (needle && !`${model.name} ${model.providerName} ${model.id}`.toLowerCase().includes(needle)) return;
      if (!groups.has(model.providerName)) groups.set(model.providerName, []);
      groups.get(model.providerName).push(model);
    });
    els.modelPickerEmpty.hidden = groups.size > 0;
    els.modelPickerGroups.innerHTML = [...groups.entries()].map(([provider, models]) => {
      const hasSelected = models.some((model) => model.value === state.selectedModel);
      return `<details class="model-provider-group"${needle || hasSelected ? " open" : ""}><summary><span>${escapeHTML(provider)}</span><small>${models.length}</small><svg viewBox="0 0 16 16" aria-hidden="true"><path d="m4 6 4 4 4-4"/></svg></summary><div class="model-provider-options">${models.map((model) => `<button type="button" class="model-picker-option${model.value === state.selectedModel ? " selected" : ""}" data-model-value="${escapeHTML(model.value)}" role="option" aria-selected="${model.value === state.selectedModel}"><span>${escapeHTML(model.name)}</span><small>${escapeHTML(model.id)}</small></button>`).join("")}</div></details>`;
    }).join("");
  }

  function closeModelPicker() {
    els.modelPickerMenu.hidden = true;
    els.modelPickerButton.setAttribute("aria-expanded", "false");
  }

  function bindAresAvailability() {
    const explain = () => {
      if (window.SeneschalAres) return;
      const feedback = $('#aresAvailability');
      if (feedback) { feedback.textContent = 'Seneschal is not loaded by this Seneschal host. Finish active tasks, restart Seneschal only, then reload this page.'; feedback.hidden = false; }
      const checkbox = $('#aresEnabled'); if (checkbox) checkbox.checked = false;
    };
    $('#aresToggle')?.addEventListener('click', explain);
    $('#aresEnabled')?.addEventListener('change', explain);
  }

  function bindComposerOptions() {
    const options = $("#composerOptions"), summary = $("#composerOptionsSummary"), media = matchMedia("(max-width: 680px)");
    const close = (restoreFocus = false) => {
      options.open = false;
      if (restoreFocus) summary.focus({ preventScroll: true });
    };
    const position = () => {
      const panel = $("#composerOptionsPanel"), rect = options.getBoundingClientRect(), trigger = summary.getBoundingClientRect();
      const width = Math.min(300, innerWidth - 32);
      panel.style.width = `${width}px`;
      panel.style.left = `${Math.max(8, Math.min(trigger.left, innerWidth - width - 8)) - rect.left}px`;
      panel.style.maxHeight = `${Math.max(80, Math.min(280, trigger.top - 16))}px`;
    };
    const sync = () => {
      const hadFocus = options.contains(document.activeElement);
      close(hadFocus);
      updateConversationClearance();
    };
    summary.addEventListener("click", () => { if (!options.open) position(); });
    options.addEventListener("toggle", () => { if (options.open) position(); updateConversationClearance(); });
    options.addEventListener("keydown", event => {
      if (event.key === "Escape" && options.open && !$("dialog[open]") && !$("#voiceOptionsPanel").matches(":popover-open")) {
        event.preventDefault(); event.stopPropagation(); close(true);
      }
    });
    document.addEventListener("click", event => {
      if (options.open && !options.contains(event.target) && !event.target.closest("dialog")) close();
    });
    $("#attachFilesButton").addEventListener("click", () => els.fileInput.click());
    media.addEventListener("change", sync);
    window.addEventListener("resize", () => { if (options.open) position(); });
    sync();
  }

  function bindModelPicker() {
    els.modelPickerButton.addEventListener("click", () => {
      const opening = els.modelPickerMenu.hidden;
      els.modelPickerMenu.hidden = !opening;
      els.modelPickerButton.setAttribute("aria-expanded", String(opening));
      if (opening) {
        if (innerWidth <= 1120) els.inspector.classList.remove("open");
        els.modelSearch.value = ""; renderModelPicker();
        requestAnimationFrame(() => { if (!els.modelPickerMenu.hidden) els.modelSearch.focus({ preventScroll: true }); });
      }
    });
    $("#closeModelPickerButton").addEventListener("click", () => { closeModelPicker(); els.modelPickerButton.focus(); });
    els.modelSearch.addEventListener("input", () => renderModelPicker(els.modelSearch.value));
    els.modelPickerGroups.addEventListener("click", (event) => { const option = event.target.closest("[data-model-value]"); if (option) { selectModel(option.dataset.modelValue); els.modelPickerButton.focus(); } });
    document.addEventListener("click", (event) => { if (!els.modelPicker.contains(event.target)) closeModelPicker(); });
    document.addEventListener("keydown", (event) => { if (event.key === "Escape" && !els.modelPickerMenu.hidden) { closeModelPicker(); els.modelPickerButton.focus(); } });
  }

  function bindContextDrawer() {
    const trigger = $("#openInspectorButton"), close = $("#closeInspectorButton"), media = matchMedia("(max-width: 1120px)");
    let wasOpen = false;
    const sync = () => {
      // The remote client installs its own drawer focus/navigation controller.
      if (document.body.classList.contains("remote-client")) return;
      const open = media.matches && els.inspector.classList.contains("open");
      const hadFocus = els.inspector.contains(document.activeElement);
      els.inspector.inert = media.matches && !open;
      trigger.hidden = open;
      trigger.setAttribute("aria-controls", els.inspector.id);
      trigger.setAttribute("aria-expanded", String(open));
      if (open && !wasOpen) close.focus({ preventScroll: true });
      if (!open && wasOpen && hadFocus && media.matches) trigger.focus({ preventScroll: true });
      wasOpen = open;
    };
    trigger.addEventListener("click", () => { closeModelPicker(); $(".sidebar").classList.remove("open"); els.inspector.classList.add("open"); sync(); });
    close.addEventListener("click", () => { els.inspector.classList.remove("open"); sync(); });
    document.addEventListener("click", event => {
      if (!media.matches || document.body.classList.contains("remote-client") || !els.inspector.classList.contains("open") || event.target.closest("dialog")) return;
      if (!els.inspector.contains(event.target) && !trigger.contains(event.target)) { els.inspector.classList.remove("open"); sync(); }
    });
    document.addEventListener("keydown", event => {
      if (event.key === "Escape" && media.matches && !document.body.classList.contains("remote-client") && !document.querySelector("dialog[open]")) { els.inspector.classList.remove("open"); sync(); }
    });
    media.addEventListener("change", () => { if (!media.matches) els.inspector.classList.remove("open"); sync(); });
    new MutationObserver(sync).observe(els.inspector, { attributes: true, attributeFilter: ["class"] });
    sync();
  }

  function selectModel(value) {
    if (!state.models.some((model) => model.value === value)) return;
    state.selectedModel = value;
    els.model.value = value;
    if (selectedSession()) rememberSessionModel(); else storage.set("atelier-model", value);
    renderModelPicker(); renderModelCapability(); renderModelVariants(); renderUsage(); closeModelPicker();
    const model = selectedModel();
    if (model?.providerID === "opencode" && model.id === "deepseek-v4-flash-free") toast("DeepSeek V4 Flash Free is currently returning provider outages. Seneschal will stop repeated 503 retries.", "warn");
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
    const colors = { openai: "var(--forest)", bonsai: "var(--ochre)", google: "var(--cobalt)", anthropic: "var(--clay)", "hpc-ai": "var(--ochre)" };
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
    const repairing = Boolean(state.browserRuntime?.repairing);
    els.browserState.textContent = connected ? "READY" : status.toUpperCase();
    els.browserState.style.color = connected ? "var(--forest)" : "var(--danger)";
    els.browserCard.className = `browser-card ${connected ? "connected" : "error"}`;
    els.browserDetail.textContent = repairing ? "Legacy hidden launcher detected · Show will repair it" : connected ? "Navigate, click, type, inspect, screenshot" : "Browser bridge is not available";
    $("#browserTryButton").disabled = !connected;
    $("#browserButton").disabled = !connected;
    [els.browserWindow, els.browserWindowCard].forEach((button) => {
      if (!button) return;
      button.disabled = !runtimeAvailable || Boolean(state.browserRuntime?.restarting);
      button.setAttribute("aria-pressed", String(visible));
      const label = visible ? "Hide" : repairing ? "Repair & show" : "Show";
      const span = $("span", button);
      if (span) span.textContent = button === els.browserWindowCard ? `${label} window` : label;
      button.setAttribute("aria-label", `${label} the agent-controlled Brave window`);
      button.setAttribute("title", `${label} the agent-controlled Brave window`);
    });
    $("#settingsBrowser").textContent = !runtimeAvailable ? "Unavailable" : visible ? "Visible Brave" : repairing ? "Repair required" : connected ? "Connected · hidden" : "Hidden mode";
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
    workspace("/workspace/vscode").then((runtime) => { state.vscodeRuntime = runtime; renderVsCode(); }).catch(() => renderVsCode());
    workspace("/workspace/agent-board").then((board) => { state.agentBoard = normalizeAgentBoard(board); renderAgentBoard(); startAgentBoardMonitor(); }).catch(() => renderAgentBoard());
    workspace("/workspace/agent-board/history").then((history) => { state.agentBoardHistory = history.boards || []; renderAgentBoardHistory(); }).catch(() => renderAgentBoardHistory());
  }

  function renderVsCode() {
    const available = Boolean(state.vscodeRuntime?.available);
    els.vscodeState.textContent = available ? "READY" : "OFFLINE";
    els.vscodeState.style.color = available ? "var(--forest)" : "var(--danger)";
    els.vscodeCard.className = `integration-card vscode-card ${available ? "online" : ""}`;
    els.vscodeDetail.textContent = available ? `Open WSL projects through ${state.vscodeRuntime.remote || "VS Code"}` : "Visual Studio Code was not found";
    $("#openVsCodeButton").disabled = !available;
    $("#openSessionVsCodeButton").disabled = !available || !state.currentDirectory;
    $("#installVsCodeCompanionButton").disabled = !available || !state.vscodeRuntime?.companionAvailable;
    $("#settingsVsCode").textContent = available ? "Ready" : "Unavailable";
  }

  function openVsCodeDialog() {
    if (!state.vscodeRuntime?.available) { toast("Visual Studio Code is not available on this PC.", "warn"); return; }
    if (els.settingsDialog.open) els.settingsDialog.close();
    els.vscodeError.hidden = true;
    els.vscodePath.value = "";
    els.vscodeLine.value = "1";
    els.vscodeColumn.value = "1";
    els.vscodeDialog.showModal();
    setTimeout(() => els.vscodePath.focus(), 30);
  }

  async function openVsCode(resource = "") {
    try {
      const result = await workspace("/workspace/vscode/open", { method: "POST", body: { directory: state.currentDirectory, resource, line: els.vscodeLine?.value || 1, column: els.vscodeColumn?.value || 1, newWindow: true } });
      if (els.vscodeDialog.open) els.vscodeDialog.close();
      toast(resource ? `Opening ${basename(resource)} in VS Code.` : `Opening ${basename(state.currentDirectory)} in VS Code.`);
      return result;
    } catch (error) {
      if (els.vscodeDialog.open) { els.vscodeError.textContent = error.message; els.vscodeError.hidden = false; }
      else toast(`Could not open VS Code: ${error.message}`, "error");
      return null;
    }
  }

  async function installVsCodeCompanion() {
    try {
      await workspace("/workspace/vscode/install-companion", { method: "POST", body: {} });
      toast("Installing the Seneschal button in VS Code. Reload VS Code once, then use the Seneschal status-bar button.");
    } catch (error) {
      els.vscodeError.textContent = error.message; els.vscodeError.hidden = false;
    }
  }

  function normalizeAgentBoard(board = {}) {
    const agents = Array.isArray(board.agents) ? board.agents.filter((agent) => agent && agent.id).map((agent) => ({
      id: String(agent.id), name: String(agent.name || "Agent").slice(0, 48), role: ["source", "plan", "build", "review", "supervisor"].includes(agent.role) ? agent.role : "build",
      prompt: String(agent.prompt || ""), model: String(agent.model || ""), dependencies: Array.isArray(agent.dependencies) ? agent.dependencies.map(String).filter(Boolean) : [],
      access: ["observe", "read", "browser", "build"].includes(agent.access) ? agent.access : agent.role === "build" ? "build" : "read",
      imported: Boolean(agent.imported), activity: String(agent.activity || ""), activityType: String(agent.activityType || ""), activityAt: Number(agent.activityAt || 0),
      sessionID: String(agent.sessionID || ""), status: ["ready", "waiting", "running", "complete", "failed"].includes(agent.status) ? agent.status : "ready",
      error: String(agent.error || ""), startedAt: Number(agent.startedAt || 0), completedAt: Number(agent.completedAt || 0), sourceText: String(agent.sourceText || ""), sourceMessageID: String(agent.sourceMessageID || ""), sourceSessionID: String(agent.sourceSessionID || ""),
      inbox: Array.isArray(agent.inbox) ? agent.inbox.slice(-20).map((item) => ({ id: String(item.id || crypto.randomUUID()), fromID: String(item.fromID || ""), fromName: String(item.fromName || "Agent"), text: String(item.text || "").slice(0, 4000), createdAt: Number(item.createdAt || Date.now()), delivered: Boolean(item.delivered) })) : [],
      waitingFor: Array.isArray(agent.waitingFor) ? agent.waitingFor.map(String).filter(Boolean) : [], iteration: Math.max(0, Number(agent.iteration) || 0), processedRequests: Array.isArray(agent.processedRequests) ? agent.processedRequests.map(String).slice(-30) : []
    })) : [];
    const ids = new Set(agents.map((agent) => agent.id));
    agents.forEach((agent) => { agent.dependencies = agent.dependencies.filter((id) => ids.has(id) && id !== agent.id); agent.waitingFor = agent.waitingFor.filter((id) => ids.has(id) && id !== agent.id); });
    return {
      version: 3, id: String(board.id || ""), title: String(board.title || ""), directory: String(board.directory || ""), objective: String(board.objective || ""), concurrency: Math.min(8, Math.max(1, Number(board.concurrency) || 2)),
      active: Boolean(board.active), paused: Boolean(board.paused), createdAt: Number(board.createdAt || 0), updatedAt: Number(board.updatedAt || 0), planText: String(board.planText || ""), planMessageID: String(board.planMessageID || ""), sourceSessionID: String(board.sourceSessionID || ""), architectSessionID: String(board.architectSessionID || ""),
      communications: Array.isArray(board.communications) ? board.communications.slice(-100).map((item) => ({ id: String(item.id || crypto.randomUUID()), fromID: String(item.fromID || ""), toID: String(item.toID || ""), text: String(item.text || "").slice(0, 4000), createdAt: Number(item.createdAt || Date.now()), status: String(item.status || "requested") })) : [], agents
    };
  }

  function boardAgent(id) { return state.agentBoard.agents.find((agent) => agent.id === id); }
  function boardRoleLabel(role) { return ({ source: "Source session", plan: "Planner", build: "Builder", review: "Reviewer", supervisor: "Supervisor" })[role] || "Agent"; }
  function boardRoleMark(role) { return ({ source: "IN", plan: "PL", build: "BU", review: "RV", supervisor: "SV" })[role] || "AG"; }
  function boardAccessLabel(access) { return ({ observe: "Conversation only", read: "Read project", browser: "Browser research", build: "Build tools" })[access] || "Read project"; }
  function boardColumnStatus(agent) {
    if (["complete", "failed"].includes(agent.status)) return "done";
    if (agent.status === "running") return "running";
    if (agent.status === "waiting" || agent.waitingFor?.some((id) => boardAgent(id)?.status !== "complete")) return "waiting";
    const dependencies = agent.dependencies.map(boardAgent).filter(Boolean);
    return dependencies.length && dependencies.some((item) => item.status !== "complete") ? "waiting" : "ready";
  }

  function boardCounts() {
    return state.agentBoard.agents.reduce((counts, agent) => { counts[boardColumnStatus(agent)] += 1; return counts; }, { ready: 0, waiting: 0, running: 0, done: 0 });
  }

  function scheduleAgentBoardSave() {
    clearTimeout(state.agentBoardSaving);
    state.agentBoardSaving = setTimeout(async () => {
      try {
        const saved = await workspace("/workspace/agent-board", { method: "POST", body: state.agentBoard });
        state.agentBoard.id = saved.id || state.agentBoard.id; state.agentBoard.createdAt = saved.createdAt || state.agentBoard.createdAt; state.agentBoard.updatedAt = saved.updatedAt || state.agentBoard.updatedAt;
      } catch (error) { toast(`Agent Board could not be saved: ${error.message}`, "error"); }
    }, 180);
  }

  function renderAgentBoard() {
    const board = state.agentBoard;
    const counts = boardCounts();
    $("#agentBoardRailCount").textContent = String(board.agents.length);
    $("#agentBoardHistoryRailCount").textContent = String(state.agentBoardHistory.length);
    $("#settingsAgentBoard").textContent = board.active ? `${counts.running} running` : board.agents.length ? `${board.agents.length} agents` : "Ready";
    if (!els.agentBoardColumns) return;
    $("#agentBoardGuide").hidden = board.agents.length > 0;
    if (document.activeElement !== els.agentBoardObjective) els.agentBoardObjective.value = board.objective;
    els.agentBoardConcurrency.value = String(board.concurrency);
    els.agentBoardState.className = `board-state ${state.agentBoardDesigning ? "running" : board.active ? board.paused ? "paused" : "running" : ""}`;
    els.agentBoardState.innerHTML = `<i></i>${state.agentBoardDesigning ? "Designing team" : board.active ? board.paused ? "Paused" : "Running" : "Idle"}`;
    $("#boardSelectedPlan").hidden = !board.planText;
    $("#boardSelectedPlanText").textContent = board.planText || "";
    const columnDefinitions = [
      ["ready", "Ready", "Agents whose dependencies are complete."], ["waiting", "Waiting", "Blocked until another agent finishes."],
      ["running", "Running", "Independent OpenCode sessions working now."], ["done", "Done", "Completed or failed agents with retained sessions."]
    ];
    els.agentBoardColumns.innerHTML = columnDefinitions.map(([key, title, empty]) => {
      const agents = board.agents.filter((agent) => boardColumnStatus(agent) === key);
      return `<section class="board-column"><header><span>${title}</span><b>${agents.length}</b></header><div class="board-column-list">${agents.length ? agents.map(renderBoardAgentCard).join("") : `<div class="board-empty">${empty}</div>`}</div></section>`;
    }).join("");
    const complete = board.agents.filter((agent) => agent.status === "complete").length;
    const failed = board.agents.filter((agent) => agent.status === "failed").length;
    const requestCount = board.communications?.length || 0;
    els.agentBoardSummary.textContent = state.agentBoardDesigning ? "The Board Architect is reading the selected plan and assigning the team…" : board.agents.length ? `${complete} completed · ${counts.running} running · ${counts.waiting} waiting${failed ? ` · ${failed} failed` : ""}${requestCount ? ` · ${requestCount} agent request${requestCount === 1 ? "" : "s"}` : ""}` : "No agents yet. Send a plan response here or use Starter team.";
    $("#agentBoardRunButton").disabled = state.agentBoardDesigning || !board.agents.length || !state.currentDirectory;
    $("#agentBoardImportButton").disabled = !selectedSession();
    $("#agentBoardPauseButton").disabled = !board.active;
    $("#agentBoardPauseButton").textContent = board.paused ? "Resume queue" : "Pause queue";
    $("#agentBoardStopButton").disabled = !counts.running;
    $$('[data-board-open]', els.agentBoardColumns).forEach((button) => button.addEventListener("click", () => openBoardSession(button.dataset.boardOpen)));
    $$('[data-board-activity]', els.agentBoardColumns).forEach((button) => button.addEventListener("click", event => window.SeneschalActivity?.openSession(button.dataset.boardActivity, event.currentTarget)));
    $$('[data-board-run]', els.agentBoardColumns).forEach((button) => button.addEventListener("click", () => runBoardAgent(button.dataset.boardRun, true)));
    $$('[data-board-edit]', els.agentBoardColumns).forEach((button) => button.addEventListener("click", () => openAgentEditor(button.dataset.boardEdit)));
    $$('[data-board-delete]', els.agentBoardColumns).forEach((button) => button.addEventListener("click", () => deleteBoardAgent(button.dataset.boardDelete)));
    $$('[data-board-stop]', els.agentBoardColumns).forEach((button) => button.addEventListener("click", () => stopBoardAgent(button.dataset.boardStop)));
  }

  function renderBoardAgentCard(agent) {
    const dependencyNames = agent.dependencies.map((id) => boardAgent(id)?.name).filter(Boolean);
    const columnStatus = boardColumnStatus(agent);
    const sessionStatusText = agent.status === "failed" ? "Failed" : agent.status === "complete" ? "Complete" : columnStatus === "waiting" ? "Waiting" : agent.status === "running" ? "Working" : "Ready";
    const sessionButton = agent.sessionID ? `<button type="button" data-board-open="${escapeHTML(agent.id)}">Open session</button><button type="button" data-board-activity="${escapeHTML(agent.sessionID)}">Activity</button>` : "";
    const runButton = agent.imported ? "" : `<button type="button" data-board-run="${escapeHTML(agent.id)}"${agent.status === "running" || columnStatus === "waiting" ? " disabled" : ""}>${["complete", "failed"].includes(agent.status) ? "Run again" : "Run"}</button>`;
    const stopButton = agent.status === "running" ? `<button type="button" class="board-stop-button" data-board-stop="${escapeHTML(agent.id)}">Stop</button>` : "";
    const activity = agent.activity ? `<div class="board-agent-activity"><strong>${escapeHTML(agent.activityType || "Live activity")}</strong><span title="${escapeHTML(agent.activity)}">${escapeHTML(agent.activity)}</span></div>` : "";
    const requests = (agent.inbox || []).filter((item) => !item.delivered).length;
    return `<article class="board-agent-card ${escapeHTML(agent.status === "ready" ? columnStatus : agent.status)}"><div class="board-agent-head"><span class="board-agent-role">${boardRoleMark(agent.role)}</span><div class="board-agent-title"><strong>${escapeHTML(agent.name)}</strong><small>${escapeHTML(boardRoleLabel(agent.role))} · ${escapeHTML(state.models.find((model) => model.value === agent.model)?.name || (agent.imported ? "Imported model" : "Current model"))}</small></div><div class="board-agent-menu"><button type="button" data-board-edit="${escapeHTML(agent.id)}" title="${agent.status === "running" ? "Stop this agent before editing" : "Edit agent"}"${agent.status === "running" || agent.imported ? " disabled" : ""}>✎</button><button type="button" class="danger" data-board-delete="${escapeHTML(agent.id)}" title="Delete card"${agent.status === "running" ? " disabled" : ""}>×</button></div></div><div class="board-agent-meta"><span>${escapeHTML(boardAccessLabel(agent.access))}</span>${agent.imported ? "<span>Selected plan</span>" : ""}${agent.iteration ? `<span>Pass ${agent.iteration + 1}</span>` : ""}${requests ? `<span>${requests} request${requests === 1 ? "" : "s"}</span>` : ""}</div><p>${escapeHTML(agent.error || agent.prompt || "No task written yet.")}</p>${activity}${dependencyNames.length ? `<div class="board-dependency">Waits for: ${escapeHTML(dependencyNames.join(", "))}</div>` : ""}<div class="board-agent-actions"><span>${sessionStatusText}</span><div>${sessionButton}${stopButton}${runButton}</div></div></article>`;
  }

  async function openAgentBoard() {
    if (els.settingsDialog.open) els.settingsDialog.close();
    if (!state.agentBoard.directory && state.currentDirectory) state.agentBoard.directory = state.currentDirectory;
    if (state.agentBoard.directory && state.agentBoard.directory !== state.currentDirectory) await switchDirectory(state.agentBoard.directory);
    renderAgentBoard();
    els.agentBoardDialog.showModal();
  }

  function renderAgentBoardHistory() {
    const boards = state.agentBoardHistory || [];
    $("#agentBoardHistoryRailCount").textContent = String(boards.length);
    els.agentBoardHistoryList.innerHTML = boards.length ? boards.map((board) => `<article class="board-history-item${board.id === state.agentBoard.id ? " current" : ""}"><div><strong>${escapeHTML(board.title || "Untitled board")}</strong><span>${escapeHTML(board.objective || board.directory || "Saved Agent Board")}</span><small>${board.agentCount} agents · ${board.updatedAt ? new Date(board.updatedAt).toLocaleString() : "Saved locally"}${board.id === state.agentBoard.id ? " · Open now" : ""}</small></div><div class="board-history-actions"><button type="button" class="secondary-button" data-board-open-history="${escapeHTML(board.id)}">Open board</button><button type="button" class="danger-text-button" data-board-history-delete="${escapeHTML(board.id)}">Delete</button></div></article>`).join("") : '<div class="board-history-empty">No saved boards yet. Send one plan response to the Agent Board to create the first saved board.</div>';
    $$('[data-board-open-history]', els.agentBoardHistoryList).forEach((button) => button.addEventListener("click", () => openSavedAgentBoard(button.dataset.boardOpenHistory)));
    $$('[data-board-history-delete]', els.agentBoardHistoryList).forEach((button) => button.addEventListener("click", () => deleteAgentBoardHistory(button.dataset.boardHistoryDelete)));
  }

  async function openAgentBoardHistory() {
    if (state.agentBoard.agents.length) await workspace("/workspace/agent-board", { method: "POST", body: state.agentBoard }).catch(() => null);
    try { state.agentBoardHistory = (await workspace("/workspace/agent-board/history")).boards || []; }
    catch (error) { toast(`Board history could not be loaded: ${error.message}`, "error"); return; }
    renderAgentBoardHistory();
    if (!els.agentBoardHistoryDialog.open) els.agentBoardHistoryDialog.showModal();
  }

  async function openSavedAgentBoard(id) {
    if (state.agentBoard.agents.some((agent) => agent.status === "running") && id !== state.agentBoard.id) { toast("Stop the running board before opening another one.", "warn"); return; }
    try {
      if (id !== state.agentBoard.id) state.agentBoard = normalizeAgentBoard(await workspace("/workspace/agent-board/history/restore", { method: "POST", body: { id } }));
      els.agentBoardHistoryDialog.close(); renderAgentBoard();
      if (state.agentBoard.directory && state.agentBoard.directory !== state.currentDirectory) await switchDirectory(state.agentBoard.directory);
      if (!els.agentBoardDialog.open) els.agentBoardDialog.showModal();
      toast("Saved board opened exactly as stored. The plan was not resent or redesigned.");
    } catch (error) { toast(`Board could not be opened: ${error.message}`, "error"); }
  }

  async function deleteAgentBoardHistory(id) {
    if (id === state.agentBoard.id) { toast("Reset or restore another board before deleting the current board's history.", "warn"); return; }
    if (!confirm("Delete this saved board record? Its OpenCode sessions and project files will not be deleted.")) return;
    try { await workspace(`/workspace/agent-board/history?id=${encodeURIComponent(id)}`, { method: "DELETE" }); state.agentBoardHistory = state.agentBoardHistory.filter((board) => board.id !== id); renderAgentBoardHistory(); }
    catch (error) { toast(`Saved board could not be deleted: ${error.message}`, "error"); }
  }

  function boardModelOptions(selected = "") {
    return state.models.map((model) => `<option value="${escapeHTML(model.value)}"${model.value === selected ? " selected" : ""}>${escapeHTML(model.name)} · ${escapeHTML(model.providerName)}</option>`).join("");
  }

  function openAgentEditor(agentID = "") {
    const agent = agentID ? boardAgent(agentID) : null;
    if (agent?.imported) return;
    els.agentEditorError.hidden = true;
    els.agentEditingID.value = agent?.id || "";
    $("#agentEditorTitle").textContent = agent ? "Edit agent" : "Add an agent";
    els.agentName.value = agent?.name || "";
    els.agentRole.value = agent?.role || "build";
    els.agentModel.innerHTML = boardModelOptions(agent?.model || state.selectedModel);
    els.agentAccess.value = agent?.access || (agent?.role === "build" ? "build" : "read");
    const dependencies = state.agentBoard.agents.filter((item) => item.id !== agentID);
    els.agentDependency.innerHTML = dependencies.length ? dependencies.map((item) => `<label><input type="checkbox" value="${escapeHTML(item.id)}"${agent?.dependencies?.includes(item.id) ? " checked" : ""}/><span>${escapeHTML(item.name)} · ${escapeHTML(boardRoleLabel(item.role))}</span></label>`).join("") : "<span>No other agents yet.</span>";
    els.agentPrompt.value = agent?.prompt || "";
    els.agentEditorDialog.showModal();
    setTimeout(() => els.agentName.focus(), 30);
  }

  function saveAgentEditor(event) {
    event.preventDefault();
    const name = els.agentName.value.trim();
    const prompt = els.agentPrompt.value.trim();
    if (!name || !prompt) { els.agentEditorError.textContent = "Give the agent a name and a clear task."; els.agentEditorError.hidden = false; return; }
    const existing = boardAgent(els.agentEditingID.value);
    const agent = existing || { id: `agent-${crypto.randomUUID()}`, sessionID: "", status: "ready", error: "", startedAt: 0, completedAt: 0 };
    const dependencies = $$('input[type="checkbox"]:checked', els.agentDependency).map((input) => input.value);
    Object.assign(agent, { name, role: els.agentRole.value, model: els.agentModel.value || state.selectedModel, access: els.agentAccess.value, prompt, dependencies });
    if (!existing) state.agentBoard.agents.push(agent);
    else if (["complete", "failed"].includes(agent.status)) { agent.status = "ready"; agent.error = ""; }
    state.agentBoard.directory ||= state.currentDirectory;
    scheduleAgentBoardSave();
    els.agentEditorDialog.close();
    renderAgentBoard();
  }

  function createStarterBoard() {
    const imported = state.agentBoard.agents.filter((agent) => agent.imported);
    const existingWorkers = state.agentBoard.agents.filter((agent) => !agent.imported);
    if (existingWorkers.length && !confirm("Replace the current worker agents with the starter team? Imported source sessions and all linked sessions will remain.")) return;
    const planner = `agent-${crypto.randomUUID()}`, builder = `agent-${crypto.randomUUID()}`, reviewer = `agent-${crypto.randomUUID()}`, supervisor = `agent-${crypto.randomUUID()}`;
    const model = state.selectedModel || state.models[0]?.value || "";
    state.agentBoard = normalizeAgentBoard({ version: 2, directory: state.currentDirectory, objective: state.agentBoard.objective, concurrency: 2, active: false, paused: false, agents: [
      ...imported,
      { id: planner, name: "Planner", role: "plan", model, access: "read", prompt: "Analyze the objective, imported brief, and project. Produce a concrete implementation plan, risks, acceptance criteria, and the exact handoff the Builder needs.", dependencies: imported.map((agent) => agent.id), status: "ready" },
      { id: builder, name: "Builder", role: "build", model, access: "build", prompt: "Implement the approved objective using the Planner handoff. Preserve existing work, run relevant tests, and report exact files changed and remaining risks.", dependencies: [planner], status: "ready" },
      { id: reviewer, name: "Reviewer", role: "review", model, access: "read", prompt: "Review the Builder result against the objective and acceptance criteria. Inspect the actual project, run focused verification, and report concrete defects without changing files.", dependencies: [builder], status: "ready" },
      { id: supervisor, name: "Supervisor", role: "supervisor", model, access: "read", prompt: "Supervise the complete workflow. Review every supplied handoff, reconcile disagreements, verify whether the objective is genuinely complete, and give the user one concise final report with blockers or required follow-up.", dependencies: [planner, builder, reviewer], status: "ready" }
    ] });
    scheduleAgentBoardSave();
    renderAgentBoard();
  }

  async function importCurrentSessionToBoard() {
    const session = selectedSession();
    if (!session) { toast("Open the planning session you want to import first.", "warn"); return; }
    if (state.agentBoard.agents.some((agent) => agent.sessionID === session.id)) { toast("This session is already on the Agent Board."); await openAgentBoard(); return; }
    if (state.agentBoard.agents.length && state.agentBoard.directory && state.agentBoard.directory !== session.directory) {
      toast("This board belongs to another project. Reset it before importing a session from this project.", "warn"); return;
    }
    const liveStatus = state.statuses[session.id]?.type || state.statuses[session.id]?.status;
    const running = liveStatus === "busy" || liveStatus === "running";
    const source = normalizeAgentBoard({ agents: [{
      id: `agent-${crypto.randomUUID()}`, name: session.title || "Imported planning session", role: "source", access: "read", imported: true,
      model: state.sessionModels[session.id] || modelReference(session) || state.selectedModel, prompt: "Imported conversation used as the verified project brief and planning context.",
      dependencies: [], sessionID: session.id, status: running ? "running" : "complete", activity: running ? "The imported session is still working." : "Conversation ready as a handoff.", activityType: running ? "Live session" : "Imported brief", completedAt: running ? 0 : Date.now()
    }] }).agents[0];
    state.agentBoard.directory = session.directory;
    state.agentBoard.agents.push(source);
    state.agentBoard.objective ||= session.title || "Complete the planned project.";
    if (running) { state.agentBoard.active = true; startAgentBoardMonitor(); }
    scheduleAgentBoardSave(); renderAgentBoard();
    if (!els.agentBoardDialog.open) await openAgentBoard();
    toast("Current session added as the board's project brief. Add the Starter team, choose each model and access level, then Run board.");
  }

  function messagePlainText(message) {
    return (message?.parts || []).filter((part) => part.type === "text" && part.text).map((part) => part.text).join("\n\n").trim();
  }

  async function waitForArchitectResult(sessionID, directory) {
    const started = Date.now(); let lastText = "";
    while (Date.now() - started < 150000) {
      await new Promise((resolve) => setTimeout(resolve, 1400));
      const [statuses, messages] = await Promise.all([
        api("/session/status", { noDirectory: true }).catch(() => ({})),
        api(`/session/${encodeURIComponent(sessionID)}/message`, { directory }).catch(() => [])
      ]);
      const assistant = [...messages].reverse().find((item) => item.info?.role === "assistant");
      if (assistant?.info?.error) throw new Error(assistant.info.error.data?.message || assistant.info.error.message || "The architect's model failed.");
      lastText = messagePlainText(assistant) || lastText;
      const entry = statuses[sessionID]; const status = typeof entry === "string" ? entry : entry?.type || entry?.status;
      if (lastText && status === "idle") return lastText;
      if (lastText && assistant?.info?.time?.completed) return lastText;
    }
    throw new Error("The Board Architect took too long. Its session was kept so you can inspect or retry it.");
  }

  function parseBoardArchitecture(text) {
    const cleaned = String(text || "").replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "");
    const start = cleaned.indexOf("{"); const end = cleaned.lastIndexOf("}");
    if (start < 0 || end <= start) throw new Error("The Board Architect did not return a usable team design.");
    const design = JSON.parse(cleaned.slice(start, end + 1));
    if (!Array.isArray(design.agents) || design.agents.length < 2) throw new Error("The generated board needs at least two agents.");
    return design;
  }

  function boardFromArchitecture(design, planText, messageID, originSessionID, architectSessionID, originDirectory) {
    const selected = selectedModel() || state.models[0]; const fallbackModel = selected?.value || "";
    const rawAgents = design.agents.slice(0, 8); const keyMap = new Map(); const keyIndexes = new Map();
    const normalizedKeys = rawAgents.map((raw, index) => {
      const base = String(raw.key || raw.name || `agent-${index}`).toLowerCase(); let key = base;
      let suffix = index + 1;
      while (keyMap.has(key)) key = `${base}-${suffix++}`;
      keyMap.set(key, `agent-${crypto.randomUUID()}`); if (!keyIndexes.has(base)) { keyMap.set(base, keyMap.get(key)); keyIndexes.set(base, index); } keyIndexes.set(key, index); return key;
    });
    const sourceID = `agent-${crypto.randomUUID()}`;
    const agents = rawAgents.map((raw, index) => {
      const key = normalizedKeys[index];
      const role = ["plan", "build", "review", "supervisor"].includes(raw.role) ? raw.role : "build";
      const namedModel = state.models.find((model) => model.value === raw.model || model.name.toLowerCase() === String(raw.model || "").toLowerCase());
      const dependencies = Array.isArray(raw.dependsOn) ? raw.dependsOn.map((item) => String(item).toLowerCase()).filter((item) => keyIndexes.has(item) && keyIndexes.get(item) < index).map((item) => keyMap.get(item)).filter(Boolean) : [];
      return { id: keyMap.get(key), name: String(raw.name || boardRoleLabel(role)).slice(0, 48), role, model: namedModel?.value || fallbackModel, access: ["observe", "read", "browser", "build"].includes(raw.access) ? raw.access : role === "build" ? "build" : "read", prompt: String(raw.task || raw.prompt || "Complete the assigned part of the project.").slice(0, 12000), dependencies: [...new Set([sourceID, ...dependencies])], status: "ready", inbox: [], waitingFor: [], iteration: 0 };
    });
    let supervisors = agents.filter((agent) => agent.role === "supervisor");
    if (!supervisors.length) {
      const supervisor = { id: `agent-${crypto.randomUUID()}`, name: "Project Supervisor", role: "supervisor", model: fallbackModel, access: "read", prompt: "Own the final project outcome. Inspect all handoffs, verify the real result against the plan, request rework where needed, and deliver the final acceptance report.", dependencies: [sourceID, ...agents.map((agent) => agent.id)], status: "ready", inbox: [], waitingFor: [], iteration: 0 };
      agents.push(supervisor); supervisors = [supervisor];
    }
    supervisors.slice(1).forEach((agent) => { agent.role = "review"; });
    const supervisor = supervisors[0];
    agents.filter((agent) => agent.id !== supervisor.id).forEach((agent) => { agent.dependencies = agent.dependencies.filter((id) => id !== supervisor.id); });
    supervisor.dependencies = [...new Set([sourceID, ...agents.filter((agent) => agent.id !== supervisor.id).map((agent) => agent.id)])];
    const source = { id: sourceID, name: "Selected plan", role: "source", access: "read", imported: true, model: fallbackModel, prompt: "The exact plan response selected by the user.", sourceText: planText, sourceMessageID: messageID, sourceSessionID: originSessionID, dependencies: [], status: "complete", activity: "Chosen plan is ready as the project brief.", activityType: "Selected message", completedAt: Date.now(), inbox: [], waitingFor: [], iteration: 0 };
    const objective = String(design.objective || design.title || planText.split(/\n/).find(Boolean) || "Complete the selected plan.").slice(0, 8000);
    return normalizeAgentBoard({ version: 3, title: String(design.title || objective).slice(0, 120), directory: originDirectory || state.currentDirectory, objective, concurrency: Math.min(8, Math.max(1, Number(design.concurrency) || Math.min(4, agents.length))), planText, planMessageID: messageID, sourceSessionID: originSessionID, architectSessionID, active: false, paused: false, communications: [], agents: [source, ...agents] });
  }

  async function createBoardFromMessage(messageID) {
    if (state.agentBoardDesigning) return;
    const message = state.messages.find((item) => item.info?.id === messageID);
    const planText = messagePlainText(message);
    const origin = selectedSession();
    if (!origin || !planText) { toast("This response has no plan text to send.", "warn"); return; }
    if (planText.length > 50000) { toast("This plan is too long for a reliable handoff. Select a plan summary under 50,000 characters.", "warn"); return; }
    if (state.agentBoard.agents.some((agent) => agent.status === "running")) { toast("Stop the running board before replacing it with a new plan.", "warn"); return; }
    if (state.agentBoard.agents.length && !confirm("Create a new board from this response? The current board stays available in History.")) return;
    state.agentBoardDesigning = true; renderMessages(); renderAgentBoard();
    if (!els.agentBoardDialog.open) await openAgentBoard();
    try {
      if (state.agentBoard.agents.length) await workspace("/workspace/agent-board", { method: "POST", body: state.agentBoard });
      const draftDesign = { title: origin.title || "Selected plan", objective: planText.slice(0, 8000), concurrency: 2, agents: [
        { key: "implement", name: "Implementation", role: "build", access: "build", task: "Read the complete selected plan in the project brief. Implement its deliverables in the stated order; report changed files and unresolved requirements.", dependsOn: [] },
        { key: "acceptance", name: "Acceptance criteria", role: "review", access: "read", task: "Read the complete selected plan. Independently produce a concrete acceptance checklist and test cases for every requirement. Do not modify project files.", dependsOn: [] },
        { key: "supervisor", name: "Project Supervisor", role: "supervisor", access: "read", task: "Compare the implementation against the plan and acceptance checklist. Inspect actual deliverables, request rework when necessary, and report accepted and outstanding requirements.", dependsOn: ["implement", "acceptance"] }
      ] };
      state.agentBoard = boardFromArchitecture(draftDesign, planText, messageID, origin.id, "", origin.directory);
      state.agentBoard = normalizeAgentBoard(await workspace("/workspace/agent-board", { method: "POST", body: state.agentBoard }));
      renderAgentBoard();
      const model = selectedModel() || state.models[0];
      if (!model) throw new Error("Choose a connected model before designing the team.");
      const architect = await api("/session", { directory: origin.directory, method: "POST", body: { title: `[Board Architect] ${origin.title || "Plan"}` } });
      state.sessions.unshift(architect);
      state.agentBoard.architectSessionID = architect.id;
      const catalog = state.models.slice(0, 40).map((item) => ({ value: item.value, name: item.name, provider: item.providerName }));
      const prompt = `You are Seneschal's Board Architect. Read only the plan below and design the smallest effective multi-agent workflow for it. Independent work should run in parallel. Include exactly one supervisor who owns acceptance and can request rework. Give each agent one concrete role, task, system access, and dependencies. Use 2-8 agents. Access must be observe, read, browser, or build. Roles must be plan, build, review, or supervisor. Keys must be unique and dependsOn may reference only agents listed earlier. Choose model values only from the supplied catalog; otherwise omit model. Return JSON only, with this shape: {"title":"...","objective":"...","concurrency":3,"agents":[{"key":"unique-key","name":"...","role":"plan","access":"read","model":"optional catalog value","task":"...","dependsOn":["earlier-key"]}]}.\n\n# Available models\n${JSON.stringify(catalog)}\n\n# Selected plan\n${planText.slice(0, 50000)}`;
      const tools = promptToolRestrictions("observe");
      await submitSessionInput(architect.id, origin.directory, { model: { providerID: model.providerID, modelID: model.id }, variant: state.selectedVariants[model.value] || undefined, tools, agent: "plan", parts: [{ type: "text", text: prompt }] });
      const design = parseBoardArchitecture(await waitForArchitectResult(architect.id, origin.directory));
      state.agentBoard = boardFromArchitecture(design, planText, messageID, origin.id, architect.id, origin.directory);
      state.agentBoard = normalizeAgentBoard(await workspace("/workspace/agent-board", { method: "POST", body: state.agentBoard }));
      renderAgentBoard(); renderSessions(); toast(`${state.agentBoard.agents.length - 1} agents were designed from the selected plan. Review their cards, then run the board.`);
    } catch (error) {
      const retained = state.agentBoard.planMessageID === messageID && state.agentBoard.agents.length;
      toast(retained ? `Your plan and default team are saved. AI customization failed: ${error.message}. Review the team, then Run board.` : `The board could not be generated: ${error.message}`, retained ? "warn" : "error");
    }
    finally { state.agentBoardDesigning = false; renderMessages(); renderAgentBoard(); }
  }

  async function boardAgentResult(agent) {
    if (agent?.sourceText) return agent.sourceText;
    if (!agent?.sessionID) return "No session output was available.";
    try {
      const messages = await api(`/session/${encodeURIComponent(agent.sessionID)}/message`, { directory: state.agentBoard.directory || state.currentDirectory });
      if (agent.imported) {
        const transcript = messages.map((message) => {
          const text = (message.parts || []).filter((part) => part.type === "text").map((part) => part.text || "").join("\n").trim();
          return text ? `### ${message.info?.role === "user" ? "User" : "Assistant"}\n${text}` : "";
        }).filter(Boolean).join("\n\n");
        return transcript.slice(-30000) || "The imported session contains no textual conversation yet.";
      }
      const assistant = [...messages].reverse().find((message) => message.info?.role === "assistant");
      const text = (assistant?.parts || []).filter((part) => part.type === "text").map((part) => part.text || "").join("\n").trim();
      return text.slice(-18000) || "The dependency finished without a textual summary. Inspect its linked session if needed.";
    } catch { return "The dependency session could not be read. Inspect its linked session manually."; }
  }

  async function boardPrompt(agent) {
    const handoffs = [];
    for (const dependencyID of agent.dependencies) {
      const dependency = boardAgent(dependencyID);
      if (!dependency) continue;
      handoffs.push(`## Handoff from ${dependency.name} (${boardRoleLabel(dependency.role)})\n${await boardAgentResult(dependency)}`);
    }
    const inbox = (agent.inbox || []).filter((item) => !item.delivered);
    const requests = inbox.length ? `# Requests from other agents\n${inbox.map((item) => `## ${item.fromName}\n${item.text}`).join("\n\n")}` : "# Requests from other agents\nNone.";
    const supervisorRule = agent.role === "supervisor" ? "As Supervisor, you own the final project outcome. Do not declare success unless the real result meets the objective. Return inadequate work to the responsible agent with the request tag below." : "You may request clarification or rework from another board agent when their output is genuinely insufficient.";
    return `You are the ${boardRoleLabel(agent.role)} named ${agent.name} on a Seneschal Agent Board.\n\n# Shared objective\n${state.agentBoard.objective || "Complete the assigned project task."}\n\n# Your responsibility\n${agent.prompt}\n\n${handoffs.length ? `# Verified dependency handoffs\n${handoffs.join("\n\n")}` : "# Dependencies\nNone. Begin from the project state and objective."}\n\n${requests}\n\n${supervisorRule}\n\nWork only within your responsibility. Inspect the real project state, respect approvals, and finish with a clear handoff containing results, changed files, verification, blockers, and what the next agent needs. If another agent must do more work, add exactly one visible line for each request in this form: <board-request target="Exact agent name">Specific correction or follow-up needed</board-request>. Do not use this tag for optional suggestions.`;
  }

  async function processBoardRequests(agent, resultText = "") {
    const pattern = /<board-request\s+target=["']([^"']+)["']\s*>([\s\S]*?)<\/board-request>/gi;
    let match; let changed = false;
    while ((match = pattern.exec(String(resultText))) !== null) {
      const targetName = match[1].trim(); const requestText = match[2].replace(/<[^>]+>/g, "").trim().slice(0, 4000);
      const signature = `${targetName.toLowerCase()}:${requestText.toLowerCase()}`;
      if (!requestText || agent.processedRequests.includes(signature)) continue;
      agent.processedRequests.push(signature); agent.processedRequests = agent.processedRequests.slice(-30);
      const target = state.agentBoard.agents.find((item) => item.id !== agent.id && item.name.toLowerCase() === targetName.toLowerCase());
      if (!target || target.imported || target.status === "running") continue;
      if (agent.iteration >= 3 || target.iteration >= 3) {
        state.agentBoard.communications.push({ id: `request-${crypto.randomUUID()}`, fromID: agent.id, toID: target.id, text: requestText, createdAt: Date.now(), status: "iteration-limit" });
        continue;
      }
      const request = { id: `request-${crypto.randomUUID()}`, fromID: agent.id, fromName: agent.name, text: requestText, createdAt: Date.now(), delivered: false };
      target.inbox.push(request); target.status = "ready"; target.error = ""; target.completedAt = 0; target.iteration += 1;
      agent.status = "waiting"; agent.waitingFor = [...new Set([...(agent.waitingFor || []), target.id])]; agent.activity = `Requested another pass from ${target.name}.`; agent.activityType = "Waiting for rework";
      state.agentBoard.communications.push({ id: request.id, fromID: agent.id, toID: target.id, text: requestText, createdAt: request.createdAt, status: "requested" });
      changed = true;
    }
    state.agentBoard.communications = state.agentBoard.communications.slice(-100);
    return changed;
  }

  function releaseWaitingBoardAgents(completedID) {
    state.agentBoard.agents.forEach((agent) => {
      if (agent.status !== "waiting" || !agent.waitingFor?.includes(completedID)) return;
      agent.waitingFor = agent.waitingFor.filter((id) => id !== completedID && boardAgent(id)?.status !== "complete");
      if (!agent.waitingFor.length) { agent.status = "ready"; agent.activity = "Requested rework returned. Ready to verify again."; agent.activityType = "Rechecking"; agent.iteration += 1; }
    });
  }

  async function runBoardAgent(agentID, manual = false) {
    if (state.agentBoardDesigning) return false;
    const agent = boardAgent(agentID);
    if (!agent || agent.status === "running") return false;
    const unmet = agent.dependencies.map(boardAgent).filter((item) => !item || item.status !== "complete");
    if (unmet.length) { if (manual) toast(`${agent.name} is waiting for ${unmet.map((item) => item?.name || "a dependency").join(", ")}.`, "warn"); return false; }
    const directory = state.agentBoard.directory || state.currentDirectory;
    const model = state.models.find((item) => item.value === agent.model);
    if (!model) { agent.status = "failed"; agent.error = "The selected model is unavailable. Edit this agent and select a connected model."; scheduleAgentBoardSave(); renderAgentBoard(); return false; }
    if (!directory || !model) { toast("Choose a project and connected model before running the board.", "warn"); return false; }
    agent.status = "running"; agent.error = ""; agent.activity = "Creating or reconnecting the worker session…"; agent.activityType = "Starting"; agent.activityAt = Date.now(); agent.startedAt = Date.now(); agent.completedAt = 0;
    state.agentBoard.active = true; state.agentBoard.paused = false;
    renderAgentBoard(); scheduleAgentBoardSave(); startAgentBoardMonitor();
    try {
      if (!agent.sessionID || !state.sessions.some((session) => session.id === agent.sessionID)) {
        const session = await api("/session", { directory, method: "POST", body: { title: `[Board] ${agent.name}` } });
        agent.sessionID = session.id;
        state.sessions.unshift(session);
      }
      const text = await boardPrompt(agent);
      if (agent.status !== "running") return false;
      const requestAgent = agent.access === "build" ? "build" : "plan";
      const toolOverrides = promptToolRestrictions(agent.access);
      state.statuses[agent.sessionID] = { type: "busy" };
      await submitSessionInput(agent.sessionID, directory, { model: { providerID: model.providerID, modelID: model.id }, variant: state.selectedVariants[model.value] || undefined, tools: toolOverrides, agent: requestAgent, parts: [{ type: "text", text }] });
      (agent.inbox || []).forEach((item) => { item.delivered = true; });
      agent.activity = "Prompt accepted. Waiting for the first model step…"; agent.activityType = "Working"; agent.activityAt = Date.now();
      scheduleAgentBoardSave(); renderSessions(); renderAgentBoard();
      return true;
    } catch (error) {
      agent.status = "failed"; agent.error = error.message; agent.completedAt = Date.now();
      scheduleAgentBoardSave(); renderAgentBoard(); toast(`${agent.name} failed to start: ${error.message}`, "error");
      return false;
    }
  }

  async function runAgentBoard() {
    state.agentBoard.objective = els.agentBoardObjective.value.trim();
    state.agentBoard.directory ||= state.currentDirectory;
    state.agentBoard.concurrency = Number(els.agentBoardConcurrency.value) || 2;
    state.agentBoard.active = true; state.agentBoard.paused = false;
    scheduleAgentBoardSave(); renderAgentBoard(); startAgentBoardMonitor();
    await scheduleReadyBoardAgents();
  }

  async function scheduleReadyBoardAgents() {
    if (!state.agentBoard.active || state.agentBoard.paused || state.boardScheduling || state.agentBoardDesigning) return;
    state.boardScheduling = true;
    try {
    const running = state.agentBoard.agents.filter((agent) => agent.status === "running").length;
    const capacity = Math.max(0, state.agentBoard.concurrency - running);
    const ready = state.agentBoard.agents.filter((agent) => agent.status === "ready" && agent.dependencies.every((id) => boardAgent(id)?.status === "complete")).slice(0, capacity);
    for (const agent of ready) {
      if (state.agentBoard.paused || !state.agentBoard.active) break;
      if (state.agentBoard.agents.filter((item) => item.status === "running").length >= state.agentBoard.concurrency) break;
      await runBoardAgent(agent.id);
    }
    const stillRunning = state.agentBoard.agents.some((agent) => agent.status === "running");
    const runnable = state.agentBoard.agents.some((agent) => agent.status === "ready" && agent.dependencies.every((id) => boardAgent(id)?.status === "complete"));
    if (!stillRunning && !runnable) { state.agentBoard.active = false; state.agentBoard.paused = false; scheduleAgentBoardSave(); renderAgentBoard(); stopAgentBoardMonitor(); }
    } finally { state.boardScheduling = false; }
  }

  async function reconcileAgentBoardStatuses(statuses = state.statuses) {
    let changed = false;
    for (const agent of state.agentBoard.agents.filter((item) => item.status === "running" && item.sessionID)) {
      const entry = statuses[agent.sessionID];
      const status = typeof entry === "string" ? entry : entry?.type || entry?.status;
      let completed = false;
      if ((status === "idle" || !status) && Date.now() - agent.startedAt > 1200) {
        try {
          const messages = await api(`/session/${encodeURIComponent(agent.sessionID)}/message`, { directory: state.agentBoard.directory || state.currentDirectory });
          const latest = [...messages].reverse().find((message) => message.info?.role === "assistant" && Number(message.info?.time?.created) >= agent.startedAt);
          if (latest?.info?.error) { agent.status = "failed"; agent.error = latest.info.error.data?.message || latest.info.error.message || "The model returned an error."; agent.completedAt = Date.now(); changed = true; }
          completed = Boolean(latest?.info?.time?.completed) && !latest?.info?.error;
        } catch {
          if (!state.sessions.some((session) => session.id === agent.sessionID)) { agent.status = "failed"; agent.error = "The linked session no longer exists."; agent.completedAt = Date.now(); changed = true; }
        }
      }
      if (completed && agent.status === "running") {
        agent.status = "complete"; agent.activity = "Final handoff is ready in the linked session."; agent.activityType = "Completed"; agent.activityAt = Date.now(); agent.completedAt = Date.now(); changed = true;
        const result = await boardAgentResult(agent);
        await processBoardRequests(agent, result);
        releaseWaitingBoardAgents(agent.id);
      }
    }
    if (changed) { scheduleAgentBoardSave(); renderAgentBoard(); await scheduleReadyBoardAgents(); }
  }

  function startAgentBoardMonitor() {
    if (!state.agentBoard.active || state.agentBoardTimer) return;
    state.agentBoardTimer = setInterval(async () => {
      try { const statuses = await api("/session/status", { noDirectory: true }); state.statuses = { ...state.statuses, ...statuses }; await reconcileAgentBoardStatuses(statuses); renderSessions(); }
      catch { /* Live events remain the primary status path. */ }
    }, 2500);
  }

  function stopAgentBoardMonitor() { clearInterval(state.agentBoardTimer); state.agentBoardTimer = null; }

  function toggleAgentBoardPause() {
    if (!state.agentBoard.active) return;
    state.agentBoard.paused = !state.agentBoard.paused;
    scheduleAgentBoardSave(); renderAgentBoard();
    if (!state.agentBoard.paused) scheduleReadyBoardAgents();
  }

  async function stopAgentBoard() {
    const running = state.agentBoard.agents.filter((agent) => agent.status === "running");
    running.forEach((agent) => { agent.status = "failed"; agent.error = "Stopped by user."; agent.completedAt = Date.now(); });
    state.agentBoard.active = false; state.agentBoard.paused = false;
    await Promise.all(running.filter((agent) => agent.sessionID).map((agent) => api(`/session/${encodeURIComponent(agent.sessionID)}/abort`, { directory: state.agentBoard.directory || state.currentDirectory, method: "POST" }).catch(() => null)));
    stopAgentBoardMonitor(); scheduleAgentBoardSave(); renderAgentBoard(); renderSessions();
    toast("Running board agents were stopped.");
  }

  async function stopBoardAgent(agentID) {
    const agent = boardAgent(agentID);
    if (!agent || agent.status !== "running") return;
    agent.status = "failed"; agent.error = "Stopped by user."; agent.activity = "Stopped. Edit the card or run it again when ready."; agent.activityType = "Stopped"; agent.completedAt = Date.now();
    try { if (agent.sessionID) await api(`/session/${encodeURIComponent(agent.sessionID)}/abort`, { directory: state.agentBoard.directory || state.currentDirectory, method: "POST" }); } catch {}
    scheduleAgentBoardSave(); renderAgentBoard(); renderSessions(); await scheduleReadyBoardAgents();
  }

  function resetAgentBoard() {
    if (state.agentBoard.agents.some((agent) => agent.status === "running")) { toast("Stop running agents before resetting the board.", "warn"); return; }
    if (!confirm("Reset the Agent Board? Linked OpenCode sessions will remain available in Sessions.")) return;
    state.agentBoard = normalizeAgentBoard({ directory: state.currentDirectory, concurrency: 2, agents: [] });
    scheduleAgentBoardSave(); renderAgentBoard();
  }

  function deleteBoardAgent(agentID) {
    const agent = boardAgent(agentID);
    if (!agent || agent.status === "running") return;
    state.agentBoard.agents = state.agentBoard.agents.filter((item) => item.id !== agentID);
    state.agentBoard.agents.forEach((item) => { item.dependencies = item.dependencies.filter((id) => id !== agentID); });
    scheduleAgentBoardSave(); renderAgentBoard();
  }

  async function openBoardSession(agentID) {
    const agent = boardAgent(agentID);
    if (!agent?.sessionID) return;
    els.agentBoardDialog.close();
    await refreshSessions();
    await selectSession(agent.sessionID);
  }

  async function toggleBrowserWindow() {
    if (!state.browserRuntime?.available || state.browserRuntime?.restarting) return;
    const visible = !state.browserRuntime.visible;
    state.browserRuntime.restarting = true;
    renderBrowser();
    try {
      state.browserRuntime = await workspace("/workspace/browser-mode", { method: "POST", body: { visible, directory: state.currentDirectory } });
      renderBrowser();
      if (visible) focusBrowserWindowSoon();
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

  function focusBrowserWindowSoon() {
    [900, 2200, 4800, 8500].forEach((delay) => setTimeout(() => workspace("/workspace/browser-focus", { method: "POST", body: {} }).catch(() => null), delay));
  }

  async function openBlender() {
    try {
      await workspace("/workspace/blender/open", { method: "POST" });
      toast("Opening Blender. Its MCP bridge starts automatically.");
      setTimeout(() => refreshWorkspaceMeta(), 3500);
    } catch (error) { toast(`Could not open Blender: ${error.message}`, "error"); }
  }

  let backupRequestPending = false, backupStatusTimer = null, backupStatusChecking = false, backupStatusSerial = 0;
  function renderBackupStatus(value) {
    const remote = document.body.classList.contains('remote-client');
    const busy = backupRequestPending || value?.phase === 'running';
    $("#backupStatus").textContent = remote ? 'Create and manage private backups on your PC. This phone cannot start or download backups.' : value?.message || 'No verified backup recorded.';
    $("#backupStatus").setAttribute('aria-busy', String(busy || backupStatusChecking));
    for (const selector of ['#backupNowButton', '#settingsBackupsButton']) $(selector).disabled = remote || busy || backupStatusChecking;
    $("#backupNowButton").textContent = busy ? 'Creating backup…' : 'Back up now';
    $("#backupStatusButton").disabled = remote || backupStatusChecking;
    $("#backupStatusButton").textContent = backupStatusChecking ? 'Checking…' : 'Check backup status';
    clearTimeout(backupStatusTimer);
    if (!remote && value?.phase === 'running' && els.settingsDialog.open) backupStatusTimer = setTimeout(refreshBackupStatus, 2000);
  }
  async function refreshBackupStatus() {
    if (document.body.classList.contains('remote-client')) { renderBackupStatus(); return; }
    const serial = ++backupStatusSerial;
    backupStatusChecking = true;
    renderBackupStatus({ phase: backupRequestPending ? 'running' : 'checking', message: 'Checking backup status…' });
    let value;
    try { value = await workspace('/workspace/backup/status', { signal: AbortSignal.timeout(12000) }); }
    catch { value = { message: 'Backup status is unavailable. Use Check backup status before starting another backup. No success has been confirmed.' }; }
    if (serial !== backupStatusSerial) return;
    backupStatusChecking = false;
    renderBackupStatus({ ...value, message: `${value.message} Last checked ${new Date().toLocaleTimeString()}.` });
  }
  async function backupNow() {
    if (backupRequestPending || document.body.classList.contains('remote-client')) return;
    ++backupStatusSerial; backupStatusChecking = false;
    backupRequestPending = true;
    renderBackupStatus({ phase: 'running', message: 'Starting a private backup…' });
    try {
      await workspace('/workspace/backup', { method: 'POST', body: {}, signal: AbortSignal.timeout(12000) });
    } catch {
      // Lost responses never automatically re-submit the backup request.
    } finally { backupRequestPending = false; await refreshBackupStatus(); }
  }

  function instructionEndpoint() {
    const url = new URL("/workspace/instructions", location.origin);
    if (workingDirectory()) url.searchParams.set("directory", workingDirectory());
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
      ["Project instructions", workingDirectory() ? basename(workingDirectory()) : "inactive", els.projectEditor.value],
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
    $("span", projectStatus).textContent = data.project?.available ? `Editing rules for ${workingDirectory()}.` : "Select a project to edit its instructions.";
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
    if (state.instructionsDirty && !confirm("Close without saving your latest instruction edits?")) return;
    state.instructionsDirty = false;
    els.instructionDialog.close();
  }

  async function saveInstruction(kind) {
    const editor = instructionKindEditor(kind);
    if (!editor || (kind === "project" && !state.currentDirectory)) return;
    setInstructionState("Saving", "saving");
    instructionFailure();
    try {
      const result = await workspace("/workspace/instructions/save", { method: "POST", body: { kind, content: editor.value, directory: workingDirectory() } });
      state.instructionData = result.snapshot;
      populateInstructionEditors();
      toast(`${kind.replace("agent-", "")} instructions saved and backed up.`);
    } catch (error) { instructionFailure(error.message); toast(`Could not save instructions: ${error.message}`, "error"); }
  }

  async function undoInstruction(kind) {
    setInstructionState("Restoring", "saving");
    instructionFailure();
    try {
      const result = await workspace("/workspace/instructions/undo", { method: "POST", body: { kind, directory: workingDirectory() } });
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
    $("#sendSessionToBoardButton").disabled = !session;
    if (!session) { els.composerStop.hidden = true; els.send.hidden = false; return; }
    els.sessionTitle.textContent = session.title || "Untitled session";
    els.projectEyebrow.textContent = sessionProject(session) === session.directory ? projectLabel(session.directory).toUpperCase() : `${projectLabel(sessionProject(session))} · tools: ${session.directory}`;
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
    const key = part.id || `${part.tool || "tool"}:${title}`;
    const remembered = state.toolDetails?.get(key);
    const toolName = String(part.tool || "tool").toLowerCase();
    const expanded = typeof remembered === "boolean" ? remembered : status !== "completed" || (innerWidth > 680 && toolName !== "bash");
    return `<details class="tool-part ${escapeHTML(status)}" data-tool-key="${escapeHTML(key)}" data-tool-name="${escapeHTML(toolName)}"${expanded ? " open" : ""}><summary class="tool-summary"><strong>${escapeHTML(part.tool || "tool")}</strong><span class="tool-status">${escapeHTML(status)}</span><span class="tool-chevron" aria-hidden="true">⌄</span></summary><div class="tool-detail-title">${escapeHTML(title)}</div>${output ? `<pre tabindex="0" aria-label="${escapeHTML(part.tool || "Tool")} output">${escapeHTML(output)}</pre>` : ""}</details>`;
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

  function openDeleteMessage(messageID) {
    const message = state.messages.find((item) => item.info?.id === messageID);
    if (!message) return;
    state.pendingDeleteMessageID = messageID;
    const role = message.info?.role === "user" ? "Your message" : "Seneschal response";
    els.deleteMessageTitle.textContent = `${role}: ${messagePreview(message, 0)}`;
    els.deleteMessageDialog.showModal();
  }

  function deleteMessage() {
    const messageID = state.pendingDeleteMessageID;
    if (!messageID || !state.currentSessionID) return;
    const deleted = storedMessageIDs(state.deletedMessages);
    const pinned = storedMessageIDs(state.pinnedMessages);
    const archived = storedMessageIDs(state.archivedMessages);
    deleted.add(messageID);
    pinned.delete(messageID);
    archived.delete(messageID);
    saveMessageIDs(state.deletedMessages, "seneschal-deleted-messages", deleted);
    saveMessageIDs(state.pinnedMessages, "seneschal-pinned-messages", pinned);
    saveMessageIDs(state.archivedMessages, "seneschal-archived-messages", archived);
    state.collapsedMessageIDs.delete(messageID);
    if (state.maximizedMessageID === messageID) state.maximizedMessageID = "";
    state.pendingDeleteMessageID = "";
    els.deleteMessageDialog.close();
    renderMessages();
    toast("Message deleted from this Seneschal view. OpenCode source data is unchanged.");
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

  function renderPinnedMessages(pinned, archived, deleted) {
    const messages = state.messages.filter((message) => pinned.has(message.info?.id) && !archived.has(message.info?.id) && !deleted.has(message.info?.id));
    els.pinnedShelf.hidden = !messages.length;
    els.pinnedCount.textContent = String(messages.length);
    els.pinnedList.innerHTML = messages.map((message, index) => {
      const role = message.info?.role === "user" ? "You" : "Seneschal";
      return `<button type="button" class="pinned-message-item" data-pinned-message="${escapeHTML(message.info?.id || "")}" title="Jump to pinned message"><strong>${escapeHTML(role)}</strong><span>${escapeHTML(messagePreview(message, index))}</span></button>`;
    }).join("");
    $$('[data-pinned-message]', els.pinnedList).forEach((button) => button.addEventListener("click", () => locateMessage(button.dataset.pinnedMessage)));
    syncRailSections();
  }

  function bindToolDisclosures() {
    state.toolDetails ||= new Map();
    const media = matchMedia("(max-width: 680px)");
    els.messageList.addEventListener("click", event => {
      const summary = event.target.closest(".tool-summary");
      if (!summary || !els.messageList.contains(summary)) return;
      const tool = summary.parentElement;
      state.toolDetails.set(tool.dataset.toolKey, !tool.open);
      if (state.toolDetails.size > 256) state.toolDetails.delete(state.toolDetails.keys().next().value);
    });
    media.addEventListener("change", () => $$(".tool-part[data-tool-key]", els.messageList).forEach(tool => {
      const remembered = state.toolDetails.get(tool.dataset.toolKey);
      tool.open = typeof remembered === "boolean" ? remembered : !tool.classList.contains("completed") || (!media.matches && tool.dataset.toolName !== "bash");
    }));
  }

  function bindMessageActionMenus() {
    const media = matchMedia("(max-width: 680px)");
    media.addEventListener("change", () => $$(".message-actions-menu", els.messageList).forEach(menu => { menu.open = !media.matches; }));
    els.messageList.addEventListener("keydown", event => {
      const menu = event.target.closest(".message-actions-menu[open]");
      if (event.key === "Escape" && media.matches && menu) {
        event.preventDefault(); menu.open = false; $("summary", menu).focus({ preventScroll: true });
      }
    });
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
    const deleted = storedMessageIDs(state.deletedMessages, session.id);
    const visibleMessages = state.messages.filter((message) => !deleted.has(message.info?.id) && (state.showArchivedMessages || !archived.has(message.info?.id)));
    if (state.maximizedMessageID && !state.messages.some((message) => message.info?.id === state.maximizedMessageID)) state.maximizedMessageID = "";
    $("#appShell").classList.toggle("message-maximized", Boolean(state.maximizedMessageID));
    els.archivedMessagesButton.hidden = !archived.size;
    els.archivedMessagesButton.setAttribute("aria-pressed", String(state.showArchivedMessages));
    els.archivedMessagesButton.setAttribute("aria-label", `${state.showArchivedMessages ? "Hide" : "Show"} ${archived.size} archived message${archived.size === 1 ? "" : "s"}`);
    els.archivedMessagesButton.setAttribute("title", `${state.showArchivedMessages ? "Hide" : "Show"} archived messages`);
    els.archivedMessagesCount.textContent = String(archived.size);
    renderPinnedMessages(pinned, archived, deleted);
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
      const boardAction = role === "assistant" && messagePlainText(message) ? `<button type="button" class="message-board-button" aria-label="Create an Agent Board from this response" title="Send only this response to the Agent Board"${state.agentBoardDesigning ? " disabled" : ""}>To board</button>` : "";
      const isPinned = pinned.has(info.id);
      const isArchived = archived.has(info.id);
      const controls = `<span class="message-view-controls">${userActions}${boardAction}<button type="button" class="message-pin-button${isPinned ? " active" : ""}" aria-label="${isPinned ? "Unpin" : "Pin"} this message" title="${isPinned ? "Unpin" : "Pin"} this message">${isPinned ? "Unpin" : "Pin"}</button><button type="button" class="message-archive-button" aria-label="${isArchived ? "Restore" : "Archive"} this message" title="${isArchived ? "Restore" : "Archive"} this message locally">${isArchived ? "Restore" : "Archive"}</button><button type="button" class="message-delete-button" aria-label="Delete this message" title="Delete from this Seneschal view">Delete</button><button type="button" class="message-size-button" aria-label="Minimize ${kind}" title="Minimize or expand ${kind}">Minimize</button><button type="button" class="message-maximize-button" aria-label="Maximize ${kind}" title="Maximize ${kind}">Maximize</button><button type="button" class="message-copy-button" aria-label="Copy ${kind}" title="Copy ${kind}"><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="8" y="8" width="11" height="11" rx="2"/><path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3"/></svg><span>Copy</span></button></span>`;
      const collapsed = state.collapsedMessageIDs.has(info.id) ? " collapsed" : "";
      const maximized = state.maximizedMessageID === info.id ? " maximized" : "";
      const actionMenu = `<details class="message-actions-menu"${innerWidth > 680 ? " open" : ""}><summary aria-label="Actions for this ${role === "user" ? "message" : "response"}">Actions</summary>${controls}</details>`;
      return `<article class="message ${role}${isPinned ? " pinned" : ""}${isArchived ? " archived" : ""}${collapsed}${maximized}" data-message="${escapeHTML(info.id || "")}"><div class="message-avatar">${avatar}</div><div class="message-body"><div class="message-meta"><strong>${escapeHTML(label)}</strong><span>${info.time?.created ? new Date(info.time.created).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : ""}</span>${actionMenu}</div><div class="message-content">${parts}</div></div></article>`;
    }).join("");
    const busy = sessionStatus(session.id) === "busy";
    const liveActivity = busy ? escapeHTML(liveActivityText()) : "";
    els.messageList.innerHTML = rows + (busy ? `<article class="message assistant live-progress-message"><div class="message-avatar">DS</div><div class="message-body"><div class="live-activity"><span class="live-activity-pulse"><i></i><i></i><i></i></span><strong>Live activity</strong><span>${liveActivity}</span></div></div></article>` : "");
    renderMessageMap(visibleMessages);
    $$(".message-copy-button", els.messageList).forEach((button) => button.addEventListener("click", () => copyRenderedMessage(button)));
    $$(".message-retry-button", els.messageList).forEach((button) => button.addEventListener("click", () => retryUserMessage(button.closest(".message")?.dataset.message)));
    $$(".message-edit-button", els.messageList).forEach((button) => button.addEventListener("click", () => openMessageEditor(button.closest(".message")?.dataset.message)));
    $$(".message-board-button", els.messageList).forEach((button) => button.addEventListener("click", () => createBoardFromMessage(button.closest(".message")?.dataset.message)));
    $$(".message-pin-button", els.messageList).forEach((button) => button.addEventListener("click", () => toggleMessagePin(button.closest(".message")?.dataset.message)));
    $$(".message-archive-button", els.messageList).forEach((button) => button.addEventListener("click", () => toggleMessageArchive(button.closest(".message")?.dataset.message)));
    $$(".message-delete-button", els.messageList).forEach((button) => button.addEventListener("click", () => openDeleteMessage(button.closest(".message")?.dataset.message)));
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
    if (els.resumeFollow) els.resumeFollow.hidden = !state.currentSessionID;
  }

  function jumpToLatest() {
    state.userScrolledAway = false;
    els.resumeFollow.hidden = false;
    els.messageScroll.scrollTo({ top: els.messageScroll.scrollHeight, behavior: "smooth" });
  }

  function updateConversationClearance() {
    if (!els.form || !els.messageScroll) return;
    const footer = $('.composer-footer', els.form), topline = $('.composer-topline', els.form);
    const controls = (footer?.offsetHeight || 0) + (topline?.offsetHeight || 0);
    const compact = innerHeight <= 500 || els.form.classList.contains('minimized');
    const minimum = `${Math.ceil(controls + (compact ? 20 : 56))}px`;
    if (els.form.style.getPropertyValue('--composer-min-height') !== minimum) els.form.style.setProperty('--composer-min-height', minimum);
    // The composer and notices now reserve their own space in normal flow.
    els.messageScroll.style.setProperty("--composer-clearance", "12px");
  }

  function bindConversationLayout() {
    let scheduled = false;
    const update = () => {
      if (scheduled) return; scheduled = true;
      requestAnimationFrame(() => { scheduled = false; updateConversationClearance(); });
    };
    if (window.ResizeObserver) {
      const observer = new ResizeObserver(update);
      for (const node of [els.form, $('.composer-footer', els.form), $('.composer-topline', els.form)]) if (node) observer.observe(node);
    }
    window.addEventListener('resize', update); window.visualViewport?.addEventListener('resize', update);
    update();
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
    if (workingDirectory()) {
      const name = document.createElement('bdi'); name.dataset.noI18n = ''; name.textContent = basename(workingDirectory());
      els.composerProject.replaceChildren(document.createTextNode('Project: '), name);
    } else els.composerProject.textContent = 'No project selected';
    els.send.disabled = !state.currentDirectory || !state.models.length;
  }

  function renderPermissions() {
    const hadFocus = els.permissionDock.contains(document.activeElement);
    const pending = state.permissions.filter(item => state.permissionReplies.get(item.id)?.status !== "resolved");
    if (typeof syncCompactPermissionBadge === "function") syncCompactPermissionBadge(pending);
    const permission = pending.find((item) => !state.currentSessionID || item.sessionID === state.currentSessionID) || pending[0];
    els.permissionDock.hidden = !permission;
    if (!permission) { if (hadFocus) els.prompt.focus({ preventScroll: true }); return; }
    const options = $('#composerOptions'), voiceOptions = $('#voiceOptionsPanel');
    if (options) options.open = false;
    if (voiceOptions?.matches(':popover-open')) voiceOptions.hidePopover();
    const patterns = permission.patterns || permission.pattern;
    const pattern = Array.isArray(patterns) ? patterns.join("\n") : patterns || permission.title || "";
    const title = permission.title || permission.permission || permission.type || "Tool action";
    const action = state.permissionReplies.get(permission.id);
    const locked = action?.status === "pending" || action?.status === "uncertain";
    const busy = action?.status === "pending" || Boolean(action?.checking);
    const message = action?.status === "pending" ? "Sending your decision…" : action?.checking ? "Checking approval status… No decision is being sent." : action?.status === "uncertain" ? (action.message || "Could not confirm your reply. Nothing was resent. Check status before trying again.") : "Choose a decision. No action is approved automatically.";
    els.permissionDock.innerHTML = `<div class="permission-content"><div class="permission-copy"><span class="permission-kicker"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6l8-3Z"/><path d="M12 8v5m0 3h.01"/></svg>Permission required${pending.length > 1 ? ` · ${pending.length} waiting` : ""}</span><h3>${escapeHTML(title)}</h3>${pattern ? `<pre class="permission-pattern" tabindex="0" aria-label="Requested action">${escapeHTML(pattern)}</pre>` : ""}<p>Review this action before it can continue.</p><p id="permissionReplyStatus" role="status" aria-live="polite" aria-atomic="true">${escapeHTML(message)}</p></div><div class="permission-actions" aria-busy="${busy}"><button type="button" class="reject" data-reply="reject" aria-describedby="permissionReplyStatus"${locked ? " disabled" : ""}>Reject</button><button type="button" data-reply="always" title="Remember this approval for this session" aria-describedby="permissionReplyStatus"${locked ? " disabled" : ""}>Always</button><button type="button" class="allow" data-reply="once" aria-describedby="permissionReplyStatus"${locked ? " disabled" : ""}>Allow once</button>${action?.status === "uncertain" ? `<button type="button" data-check-permission aria-describedby="permissionReplyStatus"${busy ? " disabled" : ""}>Check status</button>` : ""}</div></div>`;
    $$('[data-reply]', els.permissionDock).forEach((button) => button.addEventListener("click", () => replyPermission(permission, button.dataset.reply)));
    $('[data-check-permission]', els.permissionDock)?.addEventListener("click", () => checkPermissionReply(permission));
    if (hadFocus) {
      const target = $('[data-check-permission]:not(:disabled), [data-reply="once"]:not(:disabled)', els.permissionDock) || $('#permissionReplyStatus', els.permissionDock);
      if (target.id === "permissionReplyStatus") target.tabIndex = -1;
      target.focus({ preventScroll: true });
    }
  }

  function renderAll() {
    const jumpHeader = $(".composer-top-actions");
    if (els.resumeFollow.parentElement !== jumpHeader) {
      jumpHeader.prepend(els.resumeFollow);
      els.resumeFollow.textContent = "↓ Latest";
      els.resumeFollow.setAttribute("aria-label", "Scroll to the end of this chat");
      els.resumeFollow.title = "Scroll to latest message";
    }
    els.resumeFollow.hidden = !state.currentSessionID;
    window.dispatchEvent(new CustomEvent('seneschal-session-selected', { detail: state.currentSessionID }));
    window.dispatchEvent(new CustomEvent('seneschal-question-context', { detail: {
      sessionID: state.currentSessionID, directory: selectedSession()?.directory || state.currentDirectory
    } }));
    renderProjects(); renderSessions(); renderModels(); renderAgents(); renderInspector(); renderHeader(); renderUsage(); renderMessages(); renderComposer(); renderPermissions(); renderAgentBoard(); renderVsCode();
  }

  async function refreshMessages(scroll = false) {
    const requestID = state.messageRefreshID = (state.messageRefreshID || 0) + 1;
    const session = selectedSession();
    if (!session) { state.messages = []; renderMessages(); return; }
    try {
      const messages = await api(`/session/${encodeURIComponent(session.id)}/message`, { directory: session.directory });
      if (requestID !== state.messageRefreshID || state.currentSessionID !== session.id) return;
      state.messages = messages;
      renderMessages(scroll);
      renderUsage();
    } catch (error) { if (requestID === state.messageRefreshID && state.currentSessionID === session.id) toast(`Could not load messages: ${error.message}`, "error"); }
  }

  async function refreshSessions() {
    try {
      state.sessions = (await api("/session", { noDirectory: true })).map(normalizeSession);
      state.statuses = await api("/session/status", { noDirectory: true }).catch(() => state.statuses);
      renderProjects(); renderSessions(); renderHeader(); renderUsage();
    } catch (error) { toast(`Could not refresh sessions: ${error.message}`, "error"); }
  }

  async function refreshDirectoryData() {
    if (!state.currentDirectory) return;
    const requestID = state.directoryRefreshID = (state.directoryRefreshID || 0) + 1;
    const sessionID = state.currentSessionID;
    const dir = selectedSession()?.directory || state.currentDirectory;
    const results = await Promise.allSettled([
      api("/config", { directory: dir }), api("/agent", { directory: dir }),
      api("/experimental/tool/ids", { directory: dir }), api("/permission", { directory: dir }),
      api("/session/status", { directory: dir }), api("/mcp", { directory: dir }), api("/command", { directory: dir })
    ]);
    if (requestID !== state.directoryRefreshID || sessionID !== state.currentSessionID || dir !== (selectedSession()?.directory || state.currentDirectory)) return;
    if (results[0].status === "fulfilled") state.config = results[0].value;
    if (results[1].status === "fulfilled") state.agents = results[1].value;
    if (results[2].status === "fulfilled") state.tools = results[2].value;
    if (results[3].status === "fulfilled") state.permissions = mergePermissionSnapshot(results[3].value, selectedSession());
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
    const sessions = ordinarySessions().filter((session) => sessionProject(session) === directory && !session.parentID).sort((a,b) => (b.time?.updated || 0) - (a.time?.updated || 0));
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
    if (state.conversationMode) stopConversationMode(false);
    const previous = selectedSession();
    const previousStillRunning = previous && ["busy", "retry"].includes(sessionStatus(previous.id));
    state.currentSessionID = id;
    storage.set("atelier-session", id);
    const session = selectedSession();
    if (session && sessionProject(session) !== state.currentDirectory) {
      state.currentDirectory = sessionProject(session);
      storage.set("atelier-directory", state.currentDirectory);
      connectEvents();
    }
    state.messages = [];
    state.showArchivedMessages = false;
    state.userScrolledAway = false;
    renderAll();
    await refreshMessages(true);
    if (state.currentSessionID === id) await refreshDirectoryData();
    if (previousStillRunning) toast(`${previous.title || "Previous session"} is still running in the background.`);
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

  function promptToolRestrictions(access) {
    if (access === "build" || access === "plan") return undefined;
    if (access === "chat" || access === "observe") return { "*": false };
    const available = [...new Set([...state.tools, "read", "write", "edit", "bash", "task", "webfetch", "websearch", "glob", "grep"].filter(tool => tool && tool !== "invalid"))];
    const permitted = access === "browser"
      ? tool => /^(read|glob|grep|webfetch|websearch)$/.test(tool) || /^(playwright_|seneschal_moli_)/.test(tool)
      : tool => /^(read|glob|grep)$/.test(tool);
    // Legacy `tools: true` is an approval, not just tool availability.
    // Leave permitted tools out so their configured ask/deny rules still apply.
    return Object.fromEntries(available.filter(tool => !permitted(tool)).map(tool => [tool, false]));
  }

  function generatedToolRules(rules) {
    if (!Array.isArray(rules) || !rules.length || rules.some(rule => !rule || rule.pattern !== "*" || !["allow", "deny"].includes(rule.action) || typeof rule.permission !== "string")) return false;
    const names = new Set(rules.map(rule => rule.permission));
    if (names.size !== rules.length) return false;
    return rules.every(rule => rule.action === "deny") || ["read", "write", "edit", "bash", "task", "webfetch", "websearch", "glob", "grep"].every(name => names.has(name));
  }

  function sameToolRules(first, second) {
    // Rule order matters in the engine; never reorder custom permission rules.
    return JSON.stringify(first) === JSON.stringify(second);
  }

  function setPromptDeliveryStatus(message = "") {
    const status = $("#promptDeliveryStatus");
    if (!status) return;
    status.textContent = message;
    status.hidden = !message;
    updateConversationClearance();
  }

  async function submitSessionInput(sessionID, directory, body, onReady = () => {}, route = "prompt_async") {
    if (state.promptSubmissions.has(sessionID)) throw new Error("This conversation is already submitting a request. Wait before sending again.");
    if (Object.values(body.tools || {}).some(value => value !== false)) throw new Error("Tool approvals cannot be granted by a prompt.");
    state.promptSubmissions.add(sessionID);
    const endpoint = `/session/${encodeURIComponent(sessionID)}`;
    const options = { directory };
    async function request(route, input = options) {
      // Only network time is bounded. Reading a native confirmation is not a
      // network operation and must not expire the next request's signal.
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 15000);
      try { return await api(route, { ...input, signal: controller.signal }); }
      catch (error) {
        if (error.name === "AbortError") throw new Error("The PC did not respond in time. Check this conversation before trying again.");
        throw error;
      } finally { clearTimeout(timer); }
    }
    try {
      const session = await request(endpoint);
      const current = session.permission ?? [];
      if (!Array.isArray(current)) throw new Error("Conversation permissions could not be checked. Nothing was sent.");
      const desired = Object.entries(body.tools || {}).map(([permission]) => ({ permission, action: "deny", pattern: "*" }));
      const inheritMarker = "__seneschal_inherit_policy__";
      const alreadyInheriting = !desired.length && current.length === 1 && current[0].permission === inheritMarker && current[0].action === "deny" && current[0].pattern === "*";
      if (current.length && !alreadyInheriting && !sameToolRules(current, desired)) {
        if (generatedToolRules(current)) {
          if (route !== "prompt_async") throw new Error("Send a normal message to restore this conversation's tool permissions before running a command, or use a new session. Nothing was sent.");
          const notice = "This conversation has saved tool overrides from an earlier request. Use the configured permission policy for this message instead? This replaces its earlier tool overrides when the message is submitted, keeps its messages and files, and does not change other conversations. Cancel sends nothing.";
          const agreed = window.confirm(window.SeneschalI18n?.t(notice) || notice);
          if (!agreed) throw new Error("Nothing was sent. Start a new session or restore this conversation's tool permissions when ready.");
          const latest = await request(endpoint);
          const statuses = await request("/session/status");
          if (!sameToolRules(latest.permission ?? [], current) || !statuses || typeof statuses !== "object" || Array.isArray(statuses) || (statuses[sessionID] && statuses[sessionID].type !== "idle")) throw new Error("The conversation changed or is still running. Nothing was reset or sent; check it before retrying.");
          const health = await request("/global/health", { noDirectory: true });
          if (health?.healthy !== true || health.version !== "1.19.0") throw new Error("Permission replacement is not verified for this engine version. Use a new session; nothing was sent.");
          if (state.tools.includes(inheritMarker)) throw new Error("The reserved permission marker conflicts with an installed tool. Use a new session; nothing was sent.");
          // 1.19 PATCH merges rules: [] does NOT clear old grants. Prompt tools
          // replace the session rules before its execution loop. A deny for a
          // reserved, nonexistent tool clears old grants without granting any
          // actual tool permission or freezing a copy of today's agent policy.
          body = { ...body, tools: desired.length ? body.tools : { [inheritMarker]: false } };
        } else if (desired.length) {
          throw new Error("This conversation has custom permission rules. Use a new session for restricted tool mode so those rules are not overwritten.");
        }
      }
      onReady();
      // No retries: an uncertain response must never submit the prompt twice.
      try { return await request(`${endpoint}/${route}`, { ...options, method: "POST", body }); }
      catch (error) { error.inputMayHaveReachedEngine = true; throw error; }
    } finally {
      state.promptSubmissions.delete(sessionID);
    }
  }

  async function sendPrompt(text, options = {}) {
    if (!options.voice && state.voiceTurn) stopConversationMode(false);
    if (state.mediaRecorder) { toast("Finish the recording under Voice before sending.", "warn"); return; }
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
    const browserTaskRequested = /(?:playw(?:right|rite)|browser|https?:\/\/|(?:open|visit|inspect|test)\s+(?:the\s+)?(?:page|site|website))/i.test(clean);
    if (state.browserRuntime?.available && !state.browserRuntime.visible && browserTaskRequested) {
      try {
        state.browserRuntime.restarting = true; renderBrowser();
        state.browserRuntime = await workspace("/workspace/browser-mode", { method: "POST", body: { visible: true, directory: state.currentDirectory } });
        renderBrowser();
        toast("Visible Brave enabled for this browser task. The window will appear when Playwright acts.");
      } catch (error) {
        state.browserRuntime.restarting = false; renderBrowser();
        toast(`The task will continue, but the visible browser could not be enabled: ${error.message}`, "warn");
      }
    }
    if (state.speechRecognition) state.speechRecognition.stop();
    let session = selectedSession();
    if (!session) session = await newSession(false);
    if (!session) return;
    const model = selectedModel();
    if (!model) { toast("Connect a model in OpenCode settings first.", "warn"); return; }
    if (model.providerID === "bonsai" && model.id === "ternary-bonsai-27b") {
      try {
        toast("Starting local Bonsai 27B in Bionic…");
        await workspace("/workspace/local-model/prepare", { method: "POST", body: {} });
      } catch (error) {
        toast(`Bonsai 27B could not start: ${error.message}`, "error");
        return false;
      }
    }
    const parts = [...state.attachments.map((attachment) => {
      const { name, type, data } = normalizedAttachment(attachment);
      return { type: "file", mime: type, filename: name, url: data };
    })];
    if (clean) parts.push({ type: "text", text: clean });
    const voiceMessageID = options.voice ? nextVoiceMessageID() : undefined;
    const optimistic = { info: { id: voiceMessageID || `local-${Date.now()}`, role: "user", time: { created: Date.now() } }, parts };
    const pendingAttachments = [...state.attachments];
    setPromptDeliveryStatus();
    try {
      const toolOverrides = promptToolRestrictions(state.selectedAgent === "chat" ? "chat" : "build");
      const requestAgent = state.selectedAgent === "chat" ? "build" : state.selectedAgent;
      await submitSessionInput(session.id, session.directory, {
        messageID: voiceMessageID, model: { providerID: model.providerID, modelID: model.id }, variant: state.selectedVariants[model.value] || undefined, tools: toolOverrides, agent: requestAgent, system: runtimeInstructionSystem() || undefined, parts
      }, () => {
        if (options.voice) beginConversationTurn(session, voiceMessageID);
        state.messages.push(optimistic);
        state.userScrolledAway = false;
        state.statuses[session.id] = { type: "busy" };
        els.prompt.value = "";
        state.attachments = [];
        renderAttachments(); renderHeader(); renderMessages(true);
        autoSizePrompt(); updateConversationClearance();
        if (window.ResizeObserver && !state.composerObserver) { state.composerObserver = new ResizeObserver(updateConversationClearance); state.composerObserver.observe(els.form); }
      });
      if (browserTaskRequested && state.browserRuntime?.visible) focusBrowserWindowSoon();
      log("prompt.accepted", `${model.providerID}/${model.id}`);
      setTimeout(() => refreshMessages(true), 250);
      return true;
    } catch (error) {
      if (state.messages.includes(optimistic)) {
        if (!els.prompt.value) els.prompt.value = text;
        if (!state.attachments.length) state.attachments = pendingAttachments;
        renderAttachments(); autoSizePrompt();
        state.statuses[session.id] = { type: "idle" };
      }
      state.messages = state.messages.filter((message) => message !== optimistic);
      renderHeader(); renderMessages();
      const notice = error.inputMayHaveReachedEngine ? "Delivery could not be confirmed. Check this conversation before sending again; the engine may already be working." : `Message was not sent: ${error.message}`;
      setPromptDeliveryStatus(notice); toast(notice, "error");
      if (options.voice && state.conversationMode) failConversationVoice(notice);
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
    if (state.selectedAgent === "chat") { toast("Switch to Build or Plan before running workspace commands.", "warn"); return false; }
    let session = selectedSession();
    if (!session) session = await newSession(false);
    const model = selectedModel();
    if (!session || !model) { toast("Choose a project and model first.", "warn"); return false; }
    const draft = els.prompt.value;
    const voiceMessageID = options.voice ? nextVoiceMessageID() : undefined;
    setPromptDeliveryStatus();
    let submitted = false;
    try {
      await submitSessionInput(session.id, session.directory, { messageID: voiceMessageID, command: command.name, arguments: argumentsText, agent: state.selectedAgent, model: `${model.providerID}/${model.id}` }, () => {
        if (options.voice) beginConversationTurn(session, voiceMessageID);
        submitted = true;
        state.statuses[session.id] = { type: "busy" };
        els.prompt.value = ""; autoSizePrompt(); renderHeader(); renderMessages(true);
      }, "command");
      await refreshMessages(true);
      return true;
    } catch (error) {
      if (submitted) { state.statuses[session.id] = { type: "idle" }; if (!els.prompt.value) els.prompt.value = draft; autoSizePrompt(); }
      renderHeader();
      const notice = error.inputMayHaveReachedEngine ? "Command delivery could not be confirmed. Check this conversation before trying again; it may already be running." : `Command /${command.name} failed: ${error.message}`;
      setPromptDeliveryStatus(notice); toast(notice, "error");
      if (options.voice && state.conversationMode) failConversationVoice(notice);
      return false;
    }
  }

  async function abortSession() {
    const session = selectedSession();
    if (!session) return;
    if (state.voiceTurn?.sessionID === session.id) stopConversationMode(false);
    try {
      await api(`/session/${encodeURIComponent(session.id)}/abort`, { directory: session.directory, method: "POST" });
      state.statuses[session.id] = { type: "idle" };
      renderHeader(); renderMessages();
      toast("Generation stopped.");
    } catch (error) { toast(`Could not stop the session: ${error.message}`, "error"); }
  }

  function openDeleteSession(sessionID = state.currentSessionID) {
    const session = state.sessions.find((item) => item.id === sessionID);
    if (!session) return;
    state.pendingDeleteSessionID = session.id;
    els.deleteTitle.textContent = session.title || "Untitled conversation";
    els.deleteDialog.showModal();
  }

  async function deleteSession() {
    const session = state.sessions.find((item) => item.id === state.pendingDeleteSessionID);
    if (!session) return;
    const deletedID = session.id;
    const wasCurrent = state.currentSessionID === deletedID;
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
      delete state.deletedMessages[deletedID];
      storage.set("seneschal-pinned-messages", state.pinnedMessages);
      storage.set("seneschal-archived-messages", state.archivedMessages);
      storage.set("seneschal-deleted-messages", state.deletedMessages);
      state.pendingDeleteSessionID = "";
      if (wasCurrent) {
        const next = ordinarySessions()
          .filter((item) => sessionProject(item) === sessionProject(session) && !item.parentID && !state.archivedSessions.has(item.id))
          .sort((a, b) => (b.time?.updated || 0) - (a.time?.updated || 0))[0];
        state.currentSessionID = next?.id || "";
        state.messages = [];
        storage.set("atelier-session", state.currentSessionID);
      }
      els.deleteDialog.close();
      renderAll();
      if (wasCurrent && state.currentSessionID) await refreshMessages(true);
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

  function renameSession(sessionID = state.currentSessionID) {
    const session = state.sessions.find((item) => item.id === sessionID);
    if (!session) return;
    const dialog = $("#renameSessionDialog");
    dialog.dataset.session = session.id;
    $("#sessionTitleInput").value = session.title || "";
    $("#renameSessionError").hidden = true;
    dialog.showModal();
    $("#sessionTitleInput").focus();
    $("#sessionTitleInput").select();
  }

  async function saveSessionTitle(event) {
    event.preventDefault();
    const dialog = $("#renameSessionDialog");
    const session = state.sessions.find((item) => item.id === dialog.dataset.session);
    const title = $("#sessionTitleInput").value.trim();
    if (!session || !title) return;
    const button = $("#saveSessionTitleButton");
    button.disabled = true;
    try {
      const updated = await api(`/session/${encodeURIComponent(session.id)}`, { directory: session.directory, method: "PATCH", body: { title } });
      Object.assign(session, normalizeSession(updated));
      dialog.close();
      renderSessions(); renderHeader();
      toast("Session renamed.");
    } catch (error) { $("#renameSessionError").textContent = error.message; $("#renameSessionError").hidden = false; }
    finally { button.disabled = false; }
  }

  function openMoveSession() {
    const session = selectedSession();
    if (!session) return;
    if (["busy", "retry"].includes(sessionStatus(session.id))) { toast("Wait for this session to finish before moving it.", "warn"); return; }
    if (state.agentBoard.agents.some((agent) => agent.sessionID === session.id)) { toast("Board agents use their board's project. Move an ordinary session instead.", "warn"); return; }
    const targets = directories().filter((directory) => directory !== sessionProject(session));
    $("#moveSessionWorkingFolder").textContent = session.directory;
    $("#moveSessionProject").innerHTML = targets.map((directory) => `<option value="${escapeHTML(directory)}">${escapeHTML(projectLabel(directory))} — ${escapeHTML(directory)}</option>`).join("");
    $("#moveSessionError").hidden = targets.length > 0;
    $("#moveSessionError").textContent = "Add another project in the sidebar first.";
    $("#confirmMoveSessionButton").disabled = !targets.length;
    $("#moveSessionDialog").dataset.session = session.id;
    $("#moveSessionDialog").showModal();
  }

  async function moveSession(event) {
    event.preventDefault();
    const dialog = $("#moveSessionDialog");
    const session = state.sessions.find((item) => item.id === dialog.dataset.session);
    const directory = $("#moveSessionProject").value;
    if (!session || !directory) return;
    const button = $("#confirmMoveSessionButton"); button.disabled = true;
    try {
      if (["busy", "retry"].includes(sessionStatus(session.id))) throw new Error("The session is running. Wait for it to finish.");
      await api("/path", { directory });
      const assignments = await workspace("/workspace/session-projects", { method: "POST", body: { sessionID: session.id, directory } });
      if (assignments[session.id] !== directory) throw new Error("The destination project was not saved. Please retry after updating Seneschal.");
      state.sessionProjects = assignments;
      state.sessions = state.sessions.map(normalizeSession);
      state.railSections.projects = false; state.railSections.sessions = false;
      storage.set("seneschal-rail-sections-v2", state.railSections);
      state.currentDirectory = directory; state.currentSessionID = session.id;
      storage.set("atelier-directory", directory); storage.set("atelier-session", session.id);
      dialog.close(); renderAll(); connectEvents();
      await refreshDirectoryData(); await refreshInstructionData(false); await refreshMessages();
      toast(`Session moved to ${basename(directory)}.`);
    } catch (error) { $("#moveSessionError").textContent = error.message; $("#moveSessionError").hidden = false; }
    finally { button.disabled = false; }
  }

  function scheduleMessageRefresh(scroll = true) {
    clearTimeout(state.refreshTimer);
    state.refreshTimer = setTimeout(() => refreshMessages(scroll), 140);
  }

  function updateBoardActivityFromPart(part = {}) {
    const agent = state.agentBoard.agents.find((item) => item.sessionID === part.sessionID && item.status === "running");
    if (!agent) return;
    if (part.type === "reasoning" && part.text) {
      agent.activityType = "Thinking summary";
      agent.activity = String(part.text).replace(/\*\*/g, "").trim().slice(0, 220);
    } else if (part.type === "tool") {
      const tool = String(part.tool || "tool").replaceAll("_", " ");
      const status = part.state?.status || "running";
      agent.activityType = status === "completed" ? "Tool completed" : status === "error" ? "Tool error" : "Using tool";
      agent.activity = `${tool}${part.state?.title ? ` · ${part.state.title}` : ""}`.slice(0, 220);
    } else if (part.type === "text" && part.text) {
      agent.activityType = "Writing handoff";
      agent.activity = String(part.text).replace(/\s+/g, " ").trim().slice(-220);
    } else return;
    agent.activityAt = Date.now();
    scheduleAgentBoardSave(); renderAgentBoard();
  }

  function createConnectionRecovery({ read, reconnect, close, status, online, visible, setTimer = setTimeout, clearTimer = clearTimeout }) {
    let timer = null, running = null, controller = null, queued = false, queuedRestart = false;
    let disposed = false, expired = false, attempts = 0, streamReady = false;
    const cancelTimer = () => { if (timer !== null) clearTimer(timer); timer = null; };
    function request(restart = true, delay = 0) {
      if (disposed || expired) return;
      if (!online()) { cancelTimer(); status("offline"); return; }
      if (!visible()) return;
      if (running) { queued = true; queuedRestart ||= restart; return running; }
      cancelTimer();
      timer = setTimer(() => { timer = null; void run(restart); }, delay);
    }
    async function run(restart) {
      if (disposed || expired || running || !online() || !visible()) return;
      const marker = {}; running = marker;
      const abort = controller = new AbortController();
      const timeout = setTimer(() => abort.abort(), 12000);
      let retry = null, retryRestart = false;
      try {
        if (restart) { streamReady = false; status("reconnecting"); reconnect(); }
        else status("syncing");
        const applied = await read(abort.signal);
        if (disposed || expired) return;
        if (abort.signal.aborted) throw new Error("Recovery request timed out.");
        if (applied === false) { retry = Math.min(2000, 250 * 2 ** Math.min(attempts++, 3)); }
        else {
          if (streamReady) attempts = 0;
          status(streamReady ? "live" : "reconnecting");
          if (!streamReady) { retry = Math.min(30000, 1000 * 2 ** Math.min(attempts++, 5)); retryRestart = true; }
        }
      } catch (error) {
        if (disposed || !visible() || !online()) return;
        if (error.status === 401 || error.status === 403) {
          expired = true; queued = false; close(); status("expired"); return;
        }
        status("reconnecting");
        retry = Math.min(30000, 1000 * 2 ** Math.min(attempts++, 5)); retryRestart = true;
      } finally {
        clearTimer(timeout);
        if (controller === abort) controller = null;
        if (running === marker) running = null;
        if (!disposed && !expired && visible() && online()) {
          if (queued) { const restartNext = queuedRestart; queued = queuedRestart = false; request(restartNext); }
          else if (retry !== null) request(retryRestart, retry);
        }
      }
    }
    return {
      request,
      opened() { if (disposed || expired) return; streamReady = true; request(false); },
      failed() { if (disposed || expired) return; streamReady = false; status(online() ? "reconnecting" : "offline"); if (!running) request(true, Math.min(30000, 1000 * 2 ** Math.min(attempts++, 5))); },
      offline() { cancelTimer(); queued = queuedRestart = false; controller?.abort(); streamReady = false; close(); if (!disposed && !expired) status("offline"); },
      pause() { cancelTimer(); queued = queuedRestart = false; controller?.abort(); },
      dispose() { disposed = true; cancelTimer(); queued = false; controller?.abort(); close(); }
    };
  }

  async function recoverConnectionState(signal) {
    const sessionID = state.currentSessionID, directory = selectedSession()?.directory || state.currentDirectory;
    const revision = state.streamRevision || 0;
    const messageID = state.messageRefreshID = (state.messageRefreshID || 0) + 1;
    const directoryID = state.directoryRefreshID = (state.directoryRefreshID || 0) + 1;
    const options = { directory, signal }, global = { noDirectory: true, signal };
    const [health, sessions, statuses, permissions, messages] = await Promise.all([
      api("/global/health", global), api("/session", global), api("/session/status", options), api("/permission", options),
      sessionID ? api(`/session/${encodeURIComponent(sessionID)}/message`, options) : Promise.resolve([])
    ]);
    if (!health?.healthy || !Array.isArray(sessions) || !Array.isArray(permissions) || !Array.isArray(messages) || !statuses || typeof statuses !== "object" || Array.isArray(statuses)) throw new Error("Incomplete recovery snapshot.");
    if (signal.aborted || sessionID !== state.currentSessionID || directory !== (selectedSession()?.directory || state.currentDirectory) || revision !== (state.streamRevision || 0) || messageID !== state.messageRefreshID || directoryID !== state.directoryRefreshID) return false;
    state.health = health;
    state.sessions = sessions.map(normalizeSession);
    state.statuses = statuses;
    state.permissions = mergePermissionSnapshot(permissions, selectedSession());
    state.messages = messages;
    renderProjects(); renderSessions(); renderHeader(); renderUsage(); renderMessages(false); renderPermissions();
    window.dispatchEvent(new CustomEvent("seneschal-question-refresh"));
    return true;
  }

  function bindConnectionRecovery() {
    const close = () => { state.eventSource?.close(); state.eventSource = null; };
    const recovery = state.connectionRecovery = createConnectionRecovery({
      read: recoverConnectionState, reconnect: connectEvents, close, status: setRecoveryStatus,
      online: () => navigator.onLine !== false, visible: () => document.visibilityState !== "hidden"
    });
    const online = () => recovery.request(true);
    const offline = () => recovery.offline();
    const visibility = () => { if (document.visibilityState === "hidden") recovery.pause(); else recovery.request(true); };
    const show = event => { if (event.persisted) recovery.request(true); };
    const hide = event => { if (event.persisted) recovery.pause(); else cleanup(); };
    const watchdog = setInterval(() => {
      if (state.currentDirectory && Date.now() - (state.lastStreamActivity || 0) > 45000) recovery.request(true);
    }, 10000);
    function cleanup() {
      clearInterval(watchdog); recovery.dispose();
      window.removeEventListener("online", online); window.removeEventListener("offline", offline);
      document.removeEventListener("visibilitychange", visibility);
      window.removeEventListener("pageshow", show); window.removeEventListener("pagehide", hide);
    }
    window.addEventListener("online", online); window.addEventListener("offline", offline);
    document.addEventListener("visibilitychange", visibility);
    window.addEventListener("pageshow", show); window.addEventListener("pagehide", hide);
    state.disposeConnectionRecovery = cleanup;
  }

  function connectEvents() {
    state.eventSource?.close();
    if (!state.currentDirectory) return;
    const source = new EventSource(withDirectory("/api/event", selectedSession()?.directory || state.currentDirectory));
    state.eventSource = source;
    source.onopen = () => {
      if (state.eventSource !== source) return;
      state.lastStreamActivity = Date.now();
      if (state.connectionRecovery) state.connectionRecovery.opened();
      else { setConnection("online", "Live"); els.pulseLabel.textContent = "LIVE"; }
      log("stream.open", basename(state.currentDirectory));
    };
    source.onerror = () => {
      if (state.eventSource !== source) return;
      source.close(); state.eventSource = null;
      if (state.connectionRecovery) state.connectionRecovery.failed();
      else { setConnection("", "Reconnecting"); els.pulseLabel.textContent = "RETRY"; }
    };
    source.onmessage = (event) => {
      if (state.eventSource !== source) return;
      state.lastStreamActivity = Date.now();
      let payload;
      try { payload = JSON.parse(event.data); } catch { return; }
      if (/^(session\.|message\.|permission\.)/.test(payload.type || "")) state.streamRevision = (state.streamRevision || 0) + 1;
      recordOpenCodeEvent(payload);
      window.dispatchEvent(new CustomEvent('seneschal-activity', { detail: payload }));
      log(payload.type || "event", payload.properties?.sessionID || payload.id || "");
      const properties = payload.properties || {};
      if (payload.type === "session.status") {
        state.statuses[properties.sessionID] = properties.status;
        renderSessions(); renderHeader(); renderMessages(true);
        const nowIdle = sessionStatus(properties.sessionID) === "idle";
        reconcileAgentBoardStatuses(state.statuses).catch(() => null);
        if (state.conversationMode && state.voiceAwaitingResponse && properties.sessionID === state.voiceTurn?.sessionID && nowIdle) void checkConversationReply();
      } else if (payload.type === "session.created") {
        if (!state.sessions.some((session) => session.id === properties.info?.id)) state.sessions.push(normalizeSession(properties.info));
        renderProjects(); renderSessions();
      } else if (payload.type === "session.updated") {
        const index = state.sessions.findIndex((session) => session.id === properties.info?.id);
        if (index >= 0) state.sessions[index] = normalizeSession(properties.info); else state.sessions.push(normalizeSession(properties.info));
        renderSessions(); renderHeader(); renderUsage();
      } else if (payload.type === "session.deleted") {
        state.sessions = state.sessions.filter((session) => session.id !== properties.info?.id);
        renderSessions();
      } else if (["message.updated", "message.part.updated", "message.part.removed"].includes(payload.type)) {
        const sessionID = properties.info?.sessionID || properties.part?.sessionID || properties.sessionID;
        if (payload.type === "message.part.updated" && properties.part) updateBoardActivityFromPart(properties.part);
        if (!sessionID || sessionID === state.currentSessionID) scheduleMessageRefresh(true);
      } else if (payload.type === "permission.asked" || payload.type === "permission.updated") {
        const permission = properties;
        if (state.permissionReplies.get(permission.id)?.status === "resolved") return;
        state.permissionMisses[permission.id] = 0;
        const index = state.permissions.findIndex((item) => item.id === permission.id);
        if (index >= 0) state.permissions[index] = permission; else state.permissions.push(permission);
        renderPermissions();
        toast("Approval required — review the request above the message box.", "warn");
      } else if (payload.type === "permission.replied") {
        const requestID = properties.requestID || properties.permissionID || properties.id;
        completePermissionReply(requestID);
        renderPermissions();
      } else if (payload.type === "session.error") {
        let detail = properties.error?.data?.message || properties.error?.message || "The active model returned an error.";
        const boardWorker = state.agentBoard.agents.find((agent) => agent.sessionID === properties.sessionID && agent.status === "running");
        if (boardWorker) { boardWorker.status = "failed"; boardWorker.error = detail; boardWorker.completedAt = Date.now(); scheduleAgentBoardSave(); renderAgentBoard(); scheduleReadyBoardAgents(); }
        if (/Model not found:\s*opencode\/x-preview-f-free\b/i.test(detail)) detail = "Ox Alpha is not available in the running PC engine. Choose another model; engine updates are managed on the PC.";
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
      const session = selectedSession();
      const directory = session?.directory || state.currentDirectory;
      const latest = await api("/permission", { directory });
      const merged = mergePermissionSnapshot(latest, session);
      const changed = JSON.stringify(merged) !== JSON.stringify(state.permissions);
      state.permissions = merged;
      if (changed) renderPermissions();
    } catch { /* Event stream remains the primary path. */ }
  }

  async function permissionRequest(path, options) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15000);
    try { return await api(path, { ...options, signal: controller.signal }); }
    finally { clearTimeout(timer); }
  }

  function completePermissionReply(requestID) {
    if (!requestID) return;
    state.permissionReplies.set(requestID, { status: "resolved" });
    delete state.permissionMisses[requestID];
    state.permissions = state.permissions.filter(item => item.id !== requestID);
    // Keep a bounded tombstone cache so late snapshots cannot restore answered prompts.
    if (state.permissionReplies.size > 256) {
      for (const [id, action] of state.permissionReplies) {
        if (state.permissionReplies.size <= 256) break;
        if (id !== requestID && action.status === "resolved") state.permissionReplies.delete(id);
      }
    }
  }

  async function checkPermissionReply(permission) {
    const action = state.permissionReplies.get(permission.id);
    if (action?.status !== "uncertain" || action.checking) return;
    action.checking = true; renderPermissions();
    try {
      const latest = await permissionRequest("/permission", { directory: action.directory });
      if (!Array.isArray(latest)) throw new Error("Invalid approval status response");
      // A newer reply event or another status check wins over this snapshot.
      if (state.permissionReplies.get(permission.id) !== action) return;
      const stillPending = latest.some(item => item.id === permission.id && item.sessionID === permission.sessionID);
      if (stillPending) {
        state.permissionReplies.delete(permission.id);
        toast("The PC still lists this approval. Choose a decision again only if you intend to send it.", "warn");
      } else completePermissionReply(permission.id);
    } catch {
      if (state.permissionReplies.get(permission.id) === action) action.message = "Could not check the PC. Your decision was not resent. Reconnect, then check status again.";
    } finally {
      action.checking = false; renderPermissions();
    }
  }

  async function replyPermission(permission, reply) {
    if (!["once", "always", "reject"].includes(reply) || state.permissionReplies.has(permission.id)) return;
    if (!state.permissions.some(item => item.id === permission.id && item.sessionID === permission.sessionID)) return;
    const permissionDirectory = state.sessions.find((session) => session.id === permission.sessionID)?.directory || state.currentDirectory;
    const action = { status: "pending", directory: permissionDirectory };
    state.permissionReplies.set(permission.id, action);
    renderPermissions();
    try {
      try {
        await permissionRequest(`/permission/${encodeURIComponent(permission.id)}/reply`, { directory: permissionDirectory, method: "POST", body: { reply } });
      } catch (error) {
        if (state.permissionReplies.get(permission.id)?.status === "resolved") return;
        // Only a definitive missing route/method may use the legacy endpoint.
        // Never retry a timeout, lost response, auth failure or server error.
        if (![404, 405].includes(error.status)) throw error;
        await permissionRequest(`/session/${encodeURIComponent(permission.sessionID)}/permissions/${encodeURIComponent(permission.id)}`, { directory: permissionDirectory, method: "POST", body: { response: reply } });
      }
      completePermissionReply(permission.id);
      renderPermissions();
      log("permission.reply", reply);
    } catch {
      if (state.permissionReplies.get(permission.id)?.status === "resolved") return;
      action.status = "uncertain"; renderPermissions();
      toast("Could not confirm the approval reply. Nothing was resent. Use Check status before trying again.", "error");
    }
  }

  function renderAttachments() {
    els.attachmentStrip.hidden = !state.attachments.length;
    els.attachmentStrip.innerHTML = state.attachments.map((file, index) => `<div class="attachment-chip"><span>${escapeHTML(file.name)}</span><button type="button" data-remove="${index}" aria-label="Remove ${escapeHTML(file.name)}">×</button></div>`).join("");
    $$('[data-remove]', els.attachmentStrip).forEach((button) => button.addEventListener("click", () => { state.attachments.splice(Number(button.dataset.remove), 1); renderAttachments(); }));
  }

  function renderVoiceControl() {
    const button = $("#voiceButton");
    const micActive = els.mic.getAttribute("aria-pressed") === "true";
    const stage = state.conversationMode ? els.talk.dataset.stage : micActive ? els.mic.dataset.stage : "";
    const label = stage ? `${state.conversationMode ? "Talk" : "Mic"} · ${stage}` : "Voice";
    $(".voice-label", button).textContent = label;
    button.dataset.active = state.conversationMode ? "talk" : micActive ? "mic" : "none";
    button.setAttribute("aria-pressed", String(state.conversationMode || micActive));
    button.setAttribute("aria-label", state.conversationMode ? "Stop Talk mode" : micActive ? "Stop voice dictation or recording" : "Start Talk mode");
    const voiceStatus = $("#composerVoiceStatus");
    if (voiceStatus) { voiceStatus.hidden = !state.conversationMode && !micActive; voiceStatus.textContent = state.conversationMode ? "Talk active" : micActive ? "Mic active" : ""; }
    button.title = state.conversationMode || micActive ? `${label} — click to stop` : "Start Talk — sends spoken turns and reads replies. Use the arrow for options.";
    if (typeof renderVoiceMuteControls === "function") renderVoiceMuteControls();
  }

  function setListening(active, label = "Listening") {
    els.mic.classList.toggle("listening", active);
    els.mic.setAttribute("aria-pressed", String(active));
    els.mic.setAttribute("aria-label", active ? `Stop ${label.toLowerCase()}` : "Start voice dictation or recording");
    els.mic.dataset.stage = active ? label : "";
    els.mic.title = active ? `Stop ${label.toLowerCase()}` : "Dictate or record a voice message";
    $("span", els.mic).textContent = active ? `Stop ${label.toLowerCase()}` : "Dictate";
    renderVoiceControl();
  }

  function setTalkState(stage = "") {
    if (!els.talk) return;
    const active = state.conversationMode;
    try { if (typeof window !== 'undefined') window.SeneschalAres?.setState(active ? (stage || 'Ready') : 'Idle'); } catch { /* Decorative graphics must never interrupt Talk. */ }
    els.talk.classList.toggle("active", active);
    els.talk.classList.toggle("speaking", active && stage === "Speaking");
    els.talk.setAttribute("aria-pressed", String(active));
    els.talk.setAttribute("aria-label", active ? "Stop Talk mode" : "Start Talk mode");
    els.talk.dataset.stage = active ? (stage || "Ready") : "";
    els.talk.title = active ? "Stop Talk mode" : "Start turn-by-turn voice conversation";
    $("span", els.talk).textContent = active ? "Stop Talk" : "Talk";
    const settingsVoice = $("#settingsVoice");
    if (settingsVoice) settingsVoice.textContent = active ? `On · ${stage || "Ready"}` : "Turn-by-turn · Ready";
    renderVoiceControl();
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
    if (state.voiceMicMuted) { if (!state.voiceSpeaking && !state.voiceAwaitingResponse) setTalkState('Mic muted'); return; }
    state.conversationRestartTimer = setTimeout(startConversationListening, delay);
  }

  function renderVoiceMuteControls() {
    for (const button of document.querySelectorAll('[data-voice-mute]')) {
      const mic = button.dataset.voiceMute === 'mic', muted = Boolean(mic ? state.voiceMicMuted : state.voiceSpeakerMuted);
      const label = `${muted ? 'Unmute' : 'Mute'} ${mic ? 'microphone' : 'speaker'}`;
      button.setAttribute('aria-pressed', String(muted)); button.setAttribute('aria-label', label); button.title = label;
      const copy = button.querySelector('[data-mute-label]');
      if (copy) copy.textContent = `${muted ? 'Unmute' : 'Mute'} ${mic ? 'mic' : 'speaker'}`;
    }
    for (const group of document.querySelectorAll('.voice-live-controls')) group.hidden = !state.conversationMode;
    const status = document.getElementById('voiceMuteStatus');
    if (status) status.textContent = `Mic ${state.voiceMicMuted ? 'muted — no new audio captured' : 'on'} · Speaker ${state.voiceSpeakerMuted ? 'muted — replies stay in chat' : 'on'}`;
  }

  function setVoiceMicMuted(muted) {
    state.voiceMicMuted = Boolean(muted);
    if (state.voiceMicMuted) {
      clearTimeout(state.conversationRestartTimer);
      const recognition = state.conversationRecognition;
      state.conversationRecognition = null; recognition?.abort();
      const dictation = state.speechRecognition;
      state.speechRecognition = null; dictation?.abort();
      state.mediaCaptureEpoch = (state.mediaCaptureEpoch || 0) + 1;
      const recorder = state.mediaRecorder, stream = state.mediaStream;
      state.mediaRecorder = null; state.mediaStream = null; state.mediaChunks = [];
      if (recorder && recorder.state !== 'inactive') recorder.stop();
      stream?.getTracks().forEach(track => track.stop());
      if (typeof setListening === 'function') setListening(false);
    }
    if (state.conversationMode && !state.voiceSpeaking && !state.voiceAwaitingResponse) {
      setTalkState(state.voiceMicMuted ? 'Mic muted' : 'Ready');
      if (!state.voiceMicMuted) scheduleConversationListening(150);
    }
    renderVoiceMuteControls();
  }

  function setVoiceSpeakerMuted(muted) {
    state.voiceSpeakerMuted = Boolean(muted);
    if (state.voiceSpeakerMuted && state.voiceSpeaking) {
      // Invalidate this playback first: cancellation callbacks cannot restart it.
      clearConversationTurn(); state.voiceSpeaking = false;
      window.SeneschalNvidiaVoice?.cancelSpeech?.(); window.speechSynthesis?.cancel();
      if (state.conversationMode) { setTalkState(state.voiceMicMuted ? 'Mic muted' : 'Listening'); scheduleConversationListening(200); }
    }
    renderVoiceMuteControls();
  }

  function nextVoiceMessageID() {
    // Match OpenCode 1.19's ascending message-ID layout, including time ordering.
    const now = Math.max(Date.now(), state.voiceIDTime || 0);
    state.voiceIDCounter = now === state.voiceIDTime ? (state.voiceIDCounter || 0) + 1 : 1;
    state.voiceIDTime = now;
    const time = ((BigInt(now) * 4096n + BigInt(state.voiceIDCounter)) & 0xffffffffffffn).toString(16).padStart(12, '0');
    const alphabet = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
    const random = window.crypto.getRandomValues(new Uint8Array(14));
    return `msg_${time}${Array.from(random, byte => alphabet[byte % alphabet.length]).join('')}`;
  }

  function currentConversationTurn(turn) {
    return Boolean(turn && state.conversationMode && state.voiceTurn === turn && state.currentSessionID === turn.sessionID);
  }

  function clearConversationTurn() {
    const turn = state.voiceTurn;
    state.voiceTurn = null;
    state.voiceAwaitingResponse = false;
    if (turn) { clearTimeout(turn.timer); turn.controller?.abort(); }
  }

  function beginConversationTurn(session, messageID) {
    clearConversationTurn();
    if (!state.conversationMode || state.currentSessionID !== session.id) return;
    const turn = { sessionID: session.id, directory: session.directory, messageID, started: Date.now(), checking: false, spoken: false };
    state.voiceTurn = turn;
    state.voiceAwaitingResponse = true;
    setTalkState('Thinking');
    turn.timer = setTimeout(() => { void checkConversationReply(turn); }, 500);
  }

  function replyForConversationTurn(messages, turn) {
    return [...messages].reverse().find(item => item.info?.role === 'assistant' && item.info.sessionID === turn.sessionID && item.info.parentID === turn.messageID && !item.info.summary && !item.info.error && Number.isFinite(item.info.time?.completed) && item.info.finish && !['tool-calls', 'unknown'].includes(item.info.finish));
  }

  async function checkConversationReply(turn = state.voiceTurn) {
    if (turn && state.voiceTurn === turn && state.currentSessionID !== turn.sessionID) { stopConversationMode(false); return; }
    if (!currentConversationTurn(turn) || turn.checking || turn.spoken) return;
    if (Date.now() - turn.started > 300000) { failConversationVoice('Voice stopped waiting for this reply. The task was not cancelled; check the chat before restarting Talk.'); return; }
    clearTimeout(turn.timer);
    turn.checking = true;
    const control = new AbortController(); turn.controller = control;
    const timeout = setTimeout(() => control.abort(), 8000);
    try {
      const options = { directory: turn.directory, signal: control.signal };
      const revision = state.streamRevision || 0;
      const [messages, statuses] = await Promise.all([api(`/session/${encodeURIComponent(turn.sessionID)}/message`, options), api('/session/status', options)]);
      if (!currentConversationTurn(turn) || !Array.isArray(messages) || !statuses || typeof statuses !== 'object' || Array.isArray(statuses)) return;
      if (revision !== (state.streamRevision || 0)) return;
      const status = statuses[turn.sessionID];
      const kind = typeof status === 'string' ? status : status?.type || status?.status;
      if (status !== undefined && kind !== 'idle') return;
      state.statuses[turn.sessionID] = status || { type: 'idle' };
      if (messages.some(item => item.info?.role === 'assistant' && item.info.sessionID === turn.sessionID && item.info.parentID === turn.messageID && item.info.error)) {
        failConversationVoice('The current reply failed. Check its message in chat; an older answer was not read aloud.'); return;
      }
      speakLatestAssistant(turn, messages);
    } catch {
      // Read-only recovery only: never resend the prompt or read an older answer.
    } finally {
      clearTimeout(timeout); turn.checking = false;
      if (turn.controller === control) turn.controller = null;
      if (currentConversationTurn(turn) && state.voiceAwaitingResponse && !turn.spoken) turn.timer = setTimeout(() => { void checkConversationReply(turn); }, 900);
    }
  }

  function stopConversationMode(showNotice = true) {
    state.conversationMode = false;
    clearConversationTurn();
    storage.set("seneschal-talk-mode", false);
    clearTimeout(state.conversationRestartTimer);
    const recognition = state.conversationRecognition;
    state.conversationRecognition = null;
    recognition?.abort();
    state.voiceAwaitingResponse = false;
    state.voiceSpeaking = false;
    window.SeneschalNvidiaVoice?.stop();
    window.speechSynthesis?.cancel();
    setTalkState();
    if (showNotice) toast("Talk mode stopped.");
  }

  function failConversationVoice(message) {
    stopConversationMode(false);
    const feedback = $("#voiceFeedback");
    if (feedback) feedback.textContent = message;
    toast(message, "warn");
  }

  function voiceServiceAvailable() {
    if ($("#voiceServiceSelect")?.value === "nvidia" && !window.SeneschalNvidiaVoice) {
      failConversationVoice("NVIDIA voice has not loaded. Finish active tasks, restart Seneschal on the PC, then reload this page. Browser speech was not used instead.");
      return false;
    }
    return true;
  }

  function speakLatestAssistant(turn = state.voiceTurn, messages = state.messages) {
    if (!currentConversationTurn(turn) || turn.spoken || state.voiceSpeaking) return;
    if (!voiceServiceAvailable()) return;
    const message = replyForConversationTurn(messages, turn);
    const messageID = message?.info?.id || "";
    if (!message) return;
    const spoken = cleanSpeechText((message.parts || []).filter((part) => part.type === "text").map((part) => part.text || "").join(" "));
    if (!spoken || state.voiceSpeakerMuted) { clearConversationTurn(); setTalkState(state.voiceMicMuted ? 'Mic muted' : 'Listening'); scheduleConversationListening(400); return; }
    if (!window.SeneschalNvidiaVoice?.selected() && !window.speechSynthesis) { failConversationVoice('The selected voice service cannot play this reply. Check Voice before restarting Talk.'); return; }
    turn.spoken = true;
    clearTimeout(turn.timer);
    state.voiceAwaitingResponse = false;
    state.lastSpokenMessageID = messageID;
    const ended = () => { if (!currentConversationTurn(turn)) return; clearConversationTurn(); state.voiceSpeaking = false; setTalkState(state.voiceMicMuted ? 'Mic muted' : 'Listening'); scheduleConversationListening(250); };
    const failed = error => { if (currentConversationTurn(turn)) failConversationVoice(error?.message || 'Voice playback stopped. Check the current reply in chat.'); };
    if (window.SeneschalNvidiaVoice?.selected()) {
      state.voiceSpeaking = true;
      void window.SeneschalNvidiaVoice.speak(spoken, {
        onState: stage => { if (currentConversationTurn(turn)) setTalkState(stage); },
        onEnd: ended,
        onError: failed
      });
      return;
    }
    const utterance = new SpeechSynthesisUtterance(spoken);
    utterance.lang = navigator.language || "en-US";
    utterance.rate = 1.02;
    utterance.pitch = 0.94;
    const voices = window.speechSynthesis.getVoices();
    const language = utterance.lang.split("-")[0].toLowerCase();
    utterance.voice = voices.find((voice) => voice.lang?.toLowerCase().startsWith(language) && /natural|online|aria|guy|ryan/i.test(voice.name)) || voices.find((voice) => voice.lang?.toLowerCase().startsWith(language)) || null;
    state.voiceSpeaking = true;
    utterance.onstart = () => { if (currentConversationTurn(turn)) setTalkState("Speaking"); };
    utterance.onend = ended;
    utterance.onerror = failed;
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(utterance);
  }

  function startConversationListening() {
    if (!state.conversationMode || state.conversationRecognition || state.voiceSpeaking || state.voiceAwaitingResponse) return;
    if (state.voiceMicMuted) { setTalkState('Mic muted'); return; }
    if (els.prompt.value.trim() || state.attachments.length) {
      const feedback = $('#voiceFeedback');
      if (feedback) feedback.textContent = 'Your draft is kept. Send or clear it, then restart Talk to listen again.';
      setTalkState('Ready'); return;
    }
    if (!voiceServiceAvailable()) return;
    const session = selectedSession();
    if (session && ["busy", "retry"].includes(sessionStatus(session.id))) { scheduleConversationListening(500); return; }
    if (window.SeneschalNvidiaVoice?.selected()) {
      const capture = window.SeneschalNvidiaVoice.listen({
        onState: stage => { if (state.conversationMode && !state.voiceMicMuted) setTalkState(stage); },
        onResult: async text => {
          if (state.conversationRecognition !== capture || !state.conversationMode || state.voiceMicMuted) return;
          state.conversationRecognition = null;
          if (!text.trim()) { scheduleConversationListening(700); return; }
          els.prompt.value = text; autoSizePrompt(); setTalkState('Thinking');
          await sendPrompt(text, { voice: true });
        },
        onError: error => { if (state.conversationRecognition === capture && !state.voiceMicMuted) failConversationVoice(error.message); }
      });
      state.conversationRecognition = capture;
      return;
    }
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) { stopConversationMode(false); toast("Talk mode needs current Chrome or Edge speech recognition.", "warn"); return; }
    const recognition = new SpeechRecognition();
    recognition.continuous = false;
    recognition.interimResults = true;
    recognition.lang = navigator.language || "en-US";
    state.conversationRecognition = recognition;
    let transcript = "";
    recognition.onstart = () => { if (state.conversationMode && state.conversationRecognition === recognition) setTalkState("Listening"); };
    recognition.onresult = (event) => {
      if (!state.conversationMode || state.conversationRecognition !== recognition) return;
      transcript = "";
      for (let index = 0; index < event.results.length; index += 1) transcript += event.results[index][0]?.transcript || "";
      els.prompt.value = transcript.trimStart();
      autoSizePrompt();
    };
    recognition.onerror = (event) => {
      if (!state.conversationMode || state.conversationRecognition !== recognition || event.error === "no-speech") return;
      const messages = {
        "network": "Browser speech could not reach its service. Talk stopped. Open Voice and select NVIDIA cloud, accept its notice, then start Talk; no service was switched automatically.",
        "not-allowed": "Microphone access was blocked. Allow it in the browser, then start Talk again.",
        "service-not-allowed": "The browser speech service is unavailable or blocked. Choose a voice service in Voice; no fallback was used.",
        "audio-capture": "No working microphone was found. Check your microphone, then start Talk again."
      };
      failConversationVoice(messages[event.error] || "Browser speech stopped unexpectedly. Check the voice service, then start Talk again.");
    };
    recognition.onend = async () => {
      if (state.conversationRecognition !== recognition) return;
      state.conversationRecognition = null;
      if (!state.conversationMode || state.voiceMicMuted) return;
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
    if (!voiceServiceAvailable()) return;
    if (els.prompt.value.trim() || state.attachments.length) { toast("Send or clear the current draft before starting Talk mode.", "warn"); return; }
    if (!state.currentDirectory || !state.models.length) { toast("Choose a project and connect a model before starting Talk mode.", "warn"); return; }
    if (window.SeneschalNvidiaVoice?.selected()) {
      if (!window.SeneschalNvidiaVoice.ready()) { toast('Accept the NVIDIA cloud-audio notice inside Voice first.', 'warn'); return; }
    } else if (!(window.SpeechRecognition || window.webkitSpeechRecognition) || !window.speechSynthesis) { toast("Talk mode needs current Chrome or Edge with microphone access.", "warn"); return; }
    if (state.speechRecognition) state.speechRecognition.abort();
    if (state.mediaRecorder) stopMediaRecording();
    state.conversationMode = true;
    storage.set("seneschal-talk-mode", true);
    state.voiceAwaitingResponse = false;
    const feedback = $("#voiceFeedback");
    if (feedback) feedback.textContent = window.SeneschalNvidiaVoice?.selected() ? "NVIDIA cloud voice selected. Audio and spoken reply text use the NVIDIA trial." : "Browser voice selected. This does not use NVIDIA speech.";
    setTalkState("Listening");
    toast("Talk mode is on — speak naturally, My Lord. Click Voice again to stop; use its arrow for options.");
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
    const captureEpoch = state.mediaCaptureEpoch = (state.mediaCaptureEpoch || 0) + 1;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
      if (state.voiceMicMuted || state.mediaCaptureEpoch !== captureEpoch) { stream.getTracks().forEach(track => track.stop()); return; }
      const preferred = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"].find((type) => MediaRecorder.isTypeSupported(type));
      const recorder = preferred ? new MediaRecorder(stream, { mimeType: preferred }) : new MediaRecorder(stream);
      state.mediaStream = stream;
      state.mediaRecorder = recorder;
      state.mediaChunks = [];
      recorder.ondataavailable = (event) => { if (!state.voiceMicMuted && state.mediaCaptureEpoch === captureEpoch && event.data?.size) state.mediaChunks.push(event.data); };
      recorder.onerror = () => { if (state.mediaCaptureEpoch === captureEpoch) toast("The voice recording could not be completed.", "error"); };
      recorder.onstop = async () => {
        if (state.voiceMicMuted || state.mediaCaptureEpoch !== captureEpoch) { stream.getTracks().forEach(track => track.stop()); return; }
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
      toast("Recording voice message — open Voice to finish recording.");
    } catch (error) {
      if (state.mediaCaptureEpoch !== captureEpoch) return;
      state.mediaStream?.getTracks().forEach((track) => track.stop());
      state.mediaStream = null; state.mediaRecorder = null; setListening(false);
      toast(error.name === "NotAllowedError" ? "Microphone access was blocked. Allow it in the browser and try again." : `Could not start the microphone: ${error.message}`, "warn");
    }
  }

  async function toggleVoiceDictation() {
    if (state.conversationMode) stopConversationMode(false);
    if (!voiceServiceAvailable()) return;
    if (state.voiceMicMuted) { toast('Microphone is muted. Unmute it in Voice before dictating.', 'warn'); return; }
    if (window.SeneschalNvidiaVoice?.selected()) { toast('NVIDIA speech uses Talk. Choose Browser voice to use Dictate or attach a recording.', 'warn'); return; }
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
    recognition.onstart = () => { if (state.speechRecognition !== recognition || state.voiceMicMuted) return; setListening(true); toast("Listening — open Voice and choose Stop listening when finished."); };
    recognition.onresult = (event) => {
      if (state.speechRecognition !== recognition || state.voiceMicMuted) return;
      let transcript = "";
      for (let index = 0; index < event.results.length; index += 1) transcript += event.results[index][0]?.transcript || "";
      const spacer = state.speechBaseText && !/\s$/.test(state.speechBaseText) ? " " : "";
      els.prompt.value = `${state.speechBaseText}${spacer}${transcript.trimStart()}`;
      autoSizePrompt();
    };
    recognition.onerror = (event) => {
      if (state.speechRecognition !== recognition || state.voiceMicMuted) return;
      const messages = {
        "not-allowed": "Microphone access was blocked. Allow microphone access in the browser and try again.",
        "audio-capture": "No working microphone was found.",
        "network": "Voice recognition could not reach its speech service.",
        "no-speech": "No speech was detected."
      };
      if (event.error !== "aborted") toast(messages[event.error] || `Voice dictation stopped: ${event.error}.`, "warn");
    };
    recognition.onend = () => {
      if (state.speechRecognition !== recognition) return;
      state.speechRecognition = null;
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
      state.excludedProjects.delete(directory);
      storage.set("atelier-projects", state.customDirectories);
      storage.set("seneschal-excluded-projects", [...state.excludedProjects]);
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
    setTalkState(state.voiceSpeaking ? "Speaking" : state.voiceAwaitingResponse ? "Thinking" : state.conversationMode ? state.voiceMicMuted ? "Mic muted" : "Listening" : "");
    renderActiveSkillCount();
    $("#settingsArchives").textContent = `${ordinarySessions().filter((session) => state.archivedSessions.has(session.id)).length} archived`;
    renderAgentBoard(); renderVsCode();
    els.settingsDialog.showModal();
    void refreshBackupStatus();
  }

  function renderArchiveManager() {
    const archived = ordinarySessions()
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

  function openChatGPTUsage() {
    const opened = window.open("https://chatgpt.com/codex/settings/usage", "_blank", "noopener,noreferrer");
    if (!opened) toast("Your browser blocked the usage dashboard. Allow pop-ups for Seneschal and try again.", "warn");
    else toast("Opening OpenAI's official remaining allowance and reset-time dashboard.");
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
      if (!state.browserRuntime?.available) throw new Error("Visible browser control needs one Seneschal restart before this task can run. Close Seneschal, open it again, then retry.");
      if (!state.browserRuntime.visible) {
        state.browserRuntime.restarting = true;
        renderBrowser();
        state.browserRuntime = await workspace("/workspace/browser-mode", { method: "POST", body: { visible: true, directory: state.currentDirectory } });
        renderBrowser();
      }
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
      { icon: "AB", title: "Open Agent Board", subtitle: "Coordinate specialist sessions with dependency handoffs", kind: "Agents", run: openAgentBoard },
      { icon: "<>" , title: "Open project in VS Code", subtitle: basename(state.currentDirectory) || "Current project", kind: "Editor", run: () => openVsCode("") },
      { icon: "VO", title: state.conversationMode ? "Stop Talk mode" : "Start Talk mode", subtitle: "Turn-by-turn listening and spoken replies", kind: "Voice", run: toggleConversationMode },
      { icon: "IN", title: "Instructions Studio", subtitle: "Persona, global and project rules, agents, and skills", kind: "Control", run: () => openInstructionStudio("persona") },
      { icon: "/", title: "OpenCode command guide", subtitle: `${state.openCodeCommands.length} commands currently available`, kind: "Control", run: openCommands },
      { icon: "C", title: "ChatGPT Chat", subtitle: "Open normal ChatGPT with its separate chat allowance", kind: "Companion", run: openChatGPTSpace },
      { icon: "3D", title: "Open Blender", subtitle: "Start Blender and its local MCP bridge", kind: "Creative", run: openBlender },
      { icon: "◐", title: "Switch day / night", subtitle: "Change the matte atelier palette", kind: "Theme", run: toggleTheme },
      { icon: "PX", title: "Atmosphere collection", subtitle: "Nine pixel worlds, customization, preview and rotation", kind: "Theme", run: openAtmospheres },
      { icon: "CL", title: "Citylight", subtitle: "Restored original jade skyline and copper moon", kind: "Motion", run: () => setMotion("citylight") },
      { icon: "A", title: "Orbit Drift", subtitle: "Slow geometric welcome animation", kind: "Motion", run: () => setMotion("orbit") },
      { icon: "PX", title: "City Nocturne", subtitle: "Cinematic architectural pixel background", kind: "Motion", run: () => setMotion("pixel-city") },
      { icon: "LR", title: "Lunar Relay", subtitle: "Cinematic moon installation and tracking array", kind: "Motion", run: () => setMotion("lunar-relay") },
      { icon: "OF", title: "Orbital Foundry", subtitle: "Industrial station above a planetary horizon", kind: "Motion", run: () => setMotion("orbital-foundry") },
      ...Object.entries(motionPresets).filter(([id]) => id.startsWith("afterlight-")).map(([id, preset]) => ({ icon: "AL", title: preset.label, subtitle: "Afterlight pixel world", kind: "Motion", run: () => setMotion(id) })),
      { icon: "—", title: "Still composition", subtitle: "Disable welcome animation", kind: "Motion", run: () => setMotion("still") },
      ...(selectedSession() ? [
        { icon: "↓", title: "Export conversation", subtitle: "Download a portable JSON copy", kind: "Action", run: exportSession },
        { icon: "×", title: "Delete conversation", subtitle: selectedSession().title || "Untitled conversation", kind: "Danger", run: openDeleteSession }
      ] : []),
      { icon: "⚙", title: "Workspace settings", subtitle: "Connections, permissions, and advanced tools", kind: "Action", run: openSettings },
      { icon: "↗", title: "Classic OpenCode", subtitle: "Open the original control surface", kind: "Action", run: openClassic }
    ];
    const engineCommands = state.openCodeCommands.map((command) => ({ icon: "/", title: `/${command.name}`, subtitle: command.description || `${command.source || "OpenCode"} command`, kind: command.source === "skill" ? "Skill" : "Command", search: `${command.name} ${(command.hints || []).join(" ")}`, run: () => chooseOpenCodeCommand(command) }));
    const sessions = ordinarySessions().flatMap((session) => ([
      { icon: "S", title: session.title || "Untitled session", subtitle: `Open · ${basename(session.directory)}`, kind: "Session", run: () => selectSession(session.id) },
      { icon: "@", title: `Reference: ${session.title || "Untitled session"}`, subtitle: "Bring this conversation into the current prompt", kind: "Reference", run: () => insertSessionReference(session) }
    ]));
    const models = state.models.map((model) => ({ icon: "M", title: model.name, subtitle: `${model.providerName} · current session only`, kind: "Model", run: () => selectModel(model.value) }));
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

  function setWorkspaceRefreshState(busy, message) {
    for (const id of ["refreshButton", "workspaceRefreshButton"]) {
      const button = $(`#${id}`);
      if (!button) continue;
      button.disabled = busy;
      button.setAttribute("aria-busy", String(busy));
      button.setAttribute("aria-label", busy ? "Refreshing workspace" : "Refresh workspace");
      button.title = busy ? "Refreshing workspace" : "Refresh workspace";
    }
    const label = $("#workspaceRefreshButton span");
    if (label) label.textContent = busy ? "Refreshing…" : "Refresh workspace";
    const status = $("#workspaceRefreshStatus");
    if (status) status.textContent = message;
  }

  async function refreshAll(showToast = false) {
    if (state.refreshingWorkspace) return;
    state.refreshingWorkspace = true;
    let refreshMessage = "Refreshing workspace… Tasks keep running.";
    setWorkspaceRefreshState(true, refreshMessage);
    setConnection("", "Refreshing");
    try {
      const [health, path, sessions, providers, assignments] = await Promise.all([
        api("/global/health", { noDirectory: true }), api("/path", { noDirectory: true }),
        api("/session", { noDirectory: true }), api("/provider", { noDirectory: true }), workspace("/workspace/session-projects")
      ]);
      state.sessionProjects = assignments;
      sessions.forEach((session, index) => { sessions[index] = normalizeSession(session); });
      state.health = health; state.path = path; state.sessions = sessions; state.providers = providers;
      els.version.textContent = health.version || "—";
      let availableDirectories = directories();
      const requestedDirectory = state.launchSelection?.directory;
      const requestedSessionID = state.launchSelection?.sessionID;
      if (requestedDirectory && !state.customDirectories.includes(requestedDirectory)) { state.customDirectories.push(requestedDirectory); availableDirectories = directories(); }
      if (requestedDirectory) state.currentDirectory = requestedDirectory;
      if (!state.currentDirectory || !availableDirectories.includes(state.currentDirectory)) state.currentDirectory = availableDirectories[0] || "";
      if (requestedSessionID && sessions.some((session) => session.id === requestedSessionID)) state.currentSessionID = requestedSessionID;
      const currentExists = sessions.some((session) => session.id === state.currentSessionID && sessionProject(session) === state.currentDirectory);
      if (!currentExists) state.currentSessionID = ordinarySessions().filter((session) => sessionProject(session) === state.currentDirectory && !session.parentID).sort((a,b) => (b.time?.updated || 0) - (a.time?.updated || 0))[0]?.id || "";
      if (state.launchSelection?.directory || state.launchSelection?.sessionID) {
        state.launchSelection = null;
        storage.set("atelier-projects", state.customDirectories);
        history.replaceState({}, "", location.pathname);
      }
      storage.set("atelier-directory", state.currentDirectory); storage.set("atelier-session", state.currentSessionID);
      await refreshDirectoryData();
      await refreshInstructionData(false);
      await refreshMessages();
      connectEvents();
      refreshWorkspaceMeta();
      setConnection("online", "Live");
      refreshMessage = "Workspace refreshed. Tasks were not interrupted.";
      if (showToast) toast("Workspace refreshed.");
    } catch (error) {
      refreshMessage = `Refresh could not finish: ${error.message}. Try Refresh workspace again.`;
      if (state.health?.healthy || state.health?.version) {
        setConnection("online", "Display error");
        toast(`Refresh could not finish: ${error.message}`, "error");
      } else {
        setConnection("error", "Offline");
        toast(`Connection failed: ${error.message}`, "error");
      }
    } finally {
      state.refreshingWorkspace = false;
      setWorkspaceRefreshState(false, refreshMessage);
    }
  }

  function bindVoiceControls() {
    const voicePanel = $("#voiceOptionsPanel"), voiceButton = $("#voiceButton"), menuButton = $("#voiceMenuButton");
    const positionVoicePanel = () => {
      const rect = menuButton.getBoundingClientRect();
      const width = Math.min(280, innerWidth - 16);
      voicePanel.style.left = `${Math.max(8, Math.min(rect.left, innerWidth - width - 8))}px`;
      voicePanel.style.bottom = `${Math.max(8, innerHeight - rect.top + 8)}px`;
      voicePanel.style.maxHeight = `${Math.max(80, rect.top - 16)}px`;
    };
    voicePanel.addEventListener("beforetoggle", event => { if (event.newState === "open") { $("#composerOptions").open = false; positionVoicePanel(); } });
    voiceButton.addEventListener("click", () => {
      if (voicePanel.matches(":popover-open")) voicePanel.hidePopover();
      if (els.mic.getAttribute("aria-pressed") === "true") els.mic.click();
      else els.talk.click();
    });
    voiceButton.addEventListener("keydown", event => {
      if (event.key !== "ArrowDown") return;
      event.preventDefault(); voicePanel.showPopover(); $("#voiceServiceSelect").focus({ preventScroll: true });
    });
    voicePanel.addEventListener("toggle", () => menuButton.setAttribute("aria-expanded", String(voicePanel.matches(":popover-open"))));
    voicePanel.addEventListener("click", event => { if (event.target.closest("button") && !event.target.closest('#checkNvidiaVoice')) voicePanel.hidePopover(); }, true);
    window.addEventListener("resize", () => { if (voicePanel.matches(":popover-open")) positionVoicePanel(); });
    document.querySelectorAll('[data-voice-mute]').forEach(button => button.addEventListener('click', () => {
      if (button.dataset.voiceMute === 'mic') setVoiceMicMuted(!state.voiceMicMuted);
      else setVoiceSpeakerMuted(!state.voiceSpeakerMuted);
    }));
  }

  function bindEvents() {
    bindConversationLayout();
    bindVoiceControls();
    bindCompactNavigation();
    const toolsPanel = $("#workspaceToolsPanel"), toolsButton = $("#workspaceToolsButton");
    toolsPanel.addEventListener("toggle", () => toolsButton.setAttribute("aria-expanded", String(toolsPanel.matches(":popover-open"))));
    toolsPanel.addEventListener("click", event => { if (!toolsPanel.hasAttribute("data-remote-persistent") && event.target.closest("button")) toolsPanel.hidePopover(); }, true);
    window.addEventListener('seneschal-open-history-session', async event => {
      const { id, directory } = event.detail || {};
      if (!id || !/^[a-zA-Z0-9:\-_.]{1,256}$/.test(id)) return;
      try {
        if (!state.sessions.some(session => session.id === id)) {
          const session = await api(`/session/${encodeURIComponent(id)}`, { directory: directory || state.currentDirectory });
          state.sessions.push(normalizeSession(session));
        }
        await selectSession(id);
      } catch { toast('This historical session is no longer available in the engine.', 'warn'); }
    });
    $("#leftPanelToggle").addEventListener("click", toggleLeftPanel);
    $("#rightPanelToggle").addEventListener("click", toggleRightPanel);
    $("#themeSwitch").addEventListener("click", toggleTheme);
    $("#motionSwitch").setAttribute("aria-label", "Open wallpaper themes");
    $("#motionSwitch").title = "Wallpaper themes — choose and customize your background";
    $("#motionSwitch").setAttribute("aria-haspopup", "dialog");
    $("#motionSwitch").addEventListener("click", openAtmospheres);
    window.addEventListener("seneschal-atmosphere-change", (event) => {
      const id = event.detail?.id;
      if (!motionPresets[id]) return;
      state.motion = id;
      $("#motionLabel").textContent = motionPresets[id].short;
      $("#settingsMotion").textContent = motionPresets[id].label;
    });
    $("#newSessionButton").addEventListener("click", () => newSession());
    $("#addProjectButton").addEventListener("click", openProjectDialog);
    $("#projectsCollapseButton").addEventListener("click", () => toggleRailSection("projects"));
    $("#pinnedSessionsCollapseButton").addEventListener("click", () => toggleRailSection("pinnedSessions"));
    $("#sessionsCollapseButton").addEventListener("click", () => toggleRailSection("sessions"));
    els.archivedSessionsButton.addEventListener("click", () => { state.showArchivedSessions = !state.showArchivedSessions; renderSessions(); });
    $("#pinnedMessagesCollapseButton").addEventListener("click", () => toggleRailSection("pins"));
    $("#refreshButton").addEventListener("click", () => refreshAll(true));
    $("#workspaceRefreshButton").addEventListener("click", () => refreshAll(true));
    $("#commandButton").addEventListener("click", openCommands);
    $("#settingsButton").addEventListener("click", openSettings);
    $("#agentBoardButton").addEventListener("click", openAgentBoard);
    $("#agentBoardRailButton").addEventListener("click", openAgentBoard);
    $("#agentBoardHistoryRailButton").addEventListener("click", openAgentBoardHistory);
    $("#settingsRailButton").addEventListener("click", openSettings);
    $("#instructionsRailButton").addEventListener("click", () => openInstructionStudio("persona"));
    $("#chatGPTRailButton").addEventListener("click", openChatGPTSpace);
    $("#settingsChatGPTButton").addEventListener("click", openChatGPTSpace);
    $("#settingsEngineButton").addEventListener("click", () => openAdvancedSetting("Classic OpenCode opened with the complete engine controls."));
    $("#settingsThemeButton").addEventListener("click", toggleTheme);
    $("#settingsMotionButton").addEventListener("click", openAtmospheres);
    $("#settingsProvidersButton").addEventListener("click", openProviderSettings);
    $("#settingsBrowserButton").addEventListener("click", openBrowserFromSettings);
    $("#settingsAgentBoardButton").addEventListener("click", openAgentBoard);
    $("#settingsVsCodeButton").addEventListener("click", openVsCodeDialog);
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
      $("#composerMinimizeButton").textContent = minimized ? "⌃" : "⌄";
      $("#composerMinimizeButton").title = minimized ? "Restore prompt" : "Collapse prompt for reading";
      $("#composerMinimizeButton").setAttribute("aria-expanded", String(!minimized));
      $("#composerMinimizeButton").setAttribute("aria-label", minimized ? "Restore message input" : "Minimize message input");
      if (minimized) {
        els.form.classList.remove("expanded");
        els.prompt.style.height = "46px";
      }
      $("#composerSizeButton").textContent = "↗";
      $("#composerSizeButton").setAttribute("aria-label", "Maximize message input");
    });
    $("#composerSizeButton").addEventListener("click", () => {
      const expanded = els.form.classList.toggle("expanded");
      $("#composerSizeButton").textContent = expanded ? "↙" : "↗";
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
    $("#backupStatusButton").addEventListener("click", refreshBackupStatus);
    els.settingsDialog.addEventListener('close', () => clearTimeout(backupStatusTimer));
    $("#launchChatGPTButton").addEventListener("click", launchChatGPT);
    $("#skillsButton").addEventListener("click", () => openInstructionStudio("skills"));
    $("#openInstructionsButton").addEventListener("click", () => openInstructionStudio("persona"));
    $("#classicButton").addEventListener("click", openClassic);
    $("#settingsClassicButton").addEventListener("click", openClassic);
    $("#backupNowButton").addEventListener("click", backupNow);
    $("#openBlenderButton").addEventListener("click", openBlender);
    $("#openVsCodeButton").addEventListener("click", openVsCodeDialog);
    $("#openSessionVsCodeButton").addEventListener("click", () => openVsCode(""));
    $("#sendSessionToBoardButton").addEventListener("click", importCurrentSessionToBoard);
    $("#closeAgentBoardButton").addEventListener("click", () => els.agentBoardDialog.close());
    $("#agentBoardImportButton").addEventListener("click", importCurrentSessionToBoard);
    $("#agentBoardHistoryButton").addEventListener("click", openAgentBoardHistory);
    $("#closeAgentBoardHistoryButton").addEventListener("click", () => els.agentBoardHistoryDialog.close());
    $("#agentBoardAddButton").addEventListener("click", () => openAgentEditor());
    $("#agentBoardTemplateButton").addEventListener("click", createStarterBoard);
    $("#agentBoardRunButton").addEventListener("click", runAgentBoard);
    $("#agentBoardPauseButton").addEventListener("click", toggleAgentBoardPause);
    $("#agentBoardStopButton").addEventListener("click", stopAgentBoard);
    $("#agentBoardResetButton").addEventListener("click", resetAgentBoard);
    els.agentBoardObjective.addEventListener("input", () => { state.agentBoard.objective = els.agentBoardObjective.value; scheduleAgentBoardSave(); });
    els.agentBoardConcurrency.addEventListener("change", () => { state.agentBoard.concurrency = Number(els.agentBoardConcurrency.value) || 2; scheduleAgentBoardSave(); renderAgentBoard(); scheduleReadyBoardAgents(); });
    els.agentEditorForm.addEventListener("submit", saveAgentEditor);
    els.agentRole.addEventListener("change", () => { els.agentAccess.value = els.agentRole.value === "build" ? "build" : "read"; });
    $("#cancelAgentEditorButton").addEventListener("click", () => els.agentEditorDialog.close());
    els.vscodeForm.addEventListener("submit", (event) => { event.preventDefault(); const resource = els.vscodePath.value.trim(); if (!resource) { els.vscodeError.textContent = "Enter a file path, or use Open project."; els.vscodeError.hidden = false; return; } openVsCode(resource); });
    $("#openVsCodeProjectButton").addEventListener("click", () => openVsCode(""));
    $("#installVsCodeCompanionButton").addEventListener("click", installVsCodeCompanion);
    $("#cancelVsCodeButton").addEventListener("click", () => els.vscodeDialog.close());
    $("#homeButton").addEventListener("click", () => {
      if (innerWidth <= 680 && !document.body.classList.contains("remote-client")) { $(".sidebar").classList.toggle("open"); return; }
      state.currentSessionID = ""; state.messages = []; storage.set("atelier-session", ""); renderAll();
    });
    els.model.addEventListener("change", () => selectModel(els.model.value));
    bindModelPicker();
    bindMessageActionMenus();
    bindToolDisclosures();
    bindComposerOptions();
    bindAresAvailability();
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
    els.deleteSessionButton.addEventListener("click", () => openDeleteSession());
    $("#exportSessionButton").addEventListener("click", exportSession);
    els.deleteForm.addEventListener("submit", (event) => { if (event.submitter?.id === "confirmDeleteSessionButton") { event.preventDefault(); deleteSession(); } });
    els.deleteMessageForm.addEventListener("submit", (event) => { if (event.submitter?.id === "confirmDeleteMessageButton") { event.preventDefault(); deleteMessage(); } });
    els.deleteProjectForm.addEventListener("submit", (event) => { if (event.submitter?.id === "confirmDeleteProjectButton") { event.preventDefault(); deleteProject(); } });
    els.messageEditForm.addEventListener("submit", submitMessageEdit);
    $("#cancelMessageEditButton").addEventListener("click", () => els.messageEditDialog.close());
    $("#renameSessionButton").addEventListener("click", () => renameSession());
    $("#renameSessionForm").addEventListener("submit", saveSessionTitle);
    $("#cancelSessionRename").addEventListener("click", () => $("#renameSessionDialog").close());
    $("#renameProjectForm").addEventListener("submit", saveProjectName);
    $("#cancelProjectRename").addEventListener("click", () => { state.pendingRenameProject = ""; $("#renameProjectDialog").close(); });
    $("#moveSessionButton").addEventListener("click", openMoveSession);
    $("#moveSessionForm").addEventListener("submit", moveSession);
    $("#cancelSessionMove").addEventListener("click", () => $("#moveSessionDialog").close());
    $("#openChatGPTUsageButton").addEventListener("click", openChatGPTUsage);
    $("#settingsChatGPTUsageButton").addEventListener("click", openChatGPTUsage);
    els.projectForm.addEventListener("submit", addProject);
    bindContextDrawer();
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
    [els.projectDialog, els.settingsDialog, els.archiveDialog, els.providerDialog, els.approvalDialog, els.chatGPTDialog, els.deleteDialog, els.deleteMessageDialog, els.deleteProjectDialog, $("#renameProjectDialog"), els.messageEditDialog, els.browserDialog, els.vscodeDialog, els.agentEditorDialog, els.agentBoardDialog, els.agentBoardHistoryDialog, els.commandDialog, els.protocolDialog].forEach((dialog) => dialog.addEventListener("click", (event) => { if (event.target === dialog) dialog.close(); }));
    els.instructionDialog.addEventListener("click", (event) => { if (event.target === els.instructionDialog) closeInstructionStudio(); });
    document.addEventListener("visibilitychange", syncMotionState);
    document.addEventListener('visibilitychange', () => { if (document.hidden && state.conversationMode && window.SeneschalNvidiaVoice?.selected()) stopConversationMode(false); });
    window.addEventListener('beforeunload', () => window.SeneschalNvidiaVoice?.stop());
    window.addEventListener("beforeunload", () => { state.speechRecognition?.abort(); state.conversationRecognition?.abort(); window.speechSynthesis?.cancel(); state.mediaStream?.getTracks().forEach((track) => track.stop()); state.eventSource?.close(); clearInterval(state.permissionTimer); clearInterval(state.pulseTimer); stopAgentBoardMonitor(); });
  }

  async function init() {
    const savedTheme = storage.get("atelier-theme", null);
    setTheme(savedTheme || (matchMedia("(prefers-color-scheme: dark)").matches ? "night" : "day"));
    setMotion(state.motion);
    syncPanelState();
    syncInspectorSections();
    state.conversationMode = false;
    storage.set("seneschal-talk-mode", false);
    setTalkState();
    syncMotionState();
    bindEvents();
    window.SeneschalNvidiaVoice?.init({ stopVoice: () => { if (state.conversationMode) stopConversationMode(false); if (state.speechRecognition) state.speechRecognition.abort(); if (state.mediaRecorder) stopMediaRecording(); } });
    bindConnectionRecovery();
    autoSizePrompt();
    renderPulse();
    state.pulseTimer = setInterval(renderPulse, 2000);
    if (!window.SeneschalAtmosphere) requestAnimationFrame(pixelCityLoop);
    await refreshAll();
    state.permissionTimer = setInterval(pollPermissions, 1200);
  }

  init();
})();

/* SENESCHAL FEATURE HELP — local copy, no model, audio or network access. */
(function (root) {
  'use strict';
  // Stable control IDs keep these English strings ready for future language packs.
  const groups = [
    ['homeButton', 'Return to the workspace home. On a small screen, open or close the projects sidebar.'],
    ['interfaceLanguage', 'Choose English or Persian for buttons, settings and help on this browser. This does not translate conversations or change voice and model settings.'],
    ['modelPickerButton modelSelect', 'Choose the AI model for your next message. Availability and charges depend on its provider.'],
    ['modelSearchInput', 'Find a model by typing part of its name or provider. This search does not send a message.'],
    ['commandButton commandInput', 'Find conversations, models and workspace actions in one place. Use Ctrl K to open this search.'],
    ['refreshButton workspaceRefreshButton', 'Reload workspace information without restarting Seneschal or stopping your tasks.'],
    ['themeSwitch settingsThemeButton', 'Switch the interface between light and dark colors. Wallpaper scenes are chosen separately.'],
    ['settingsButton settingsRailButton', 'Open app settings, connections, permissions, updates and other workspace controls.'],
    ['newSessionButton compactNewSession', 'Start a separate conversation in the selected project. Your other conversations stay saved.'],
    ['compactProjects', 'Show your project folders in the sidebar. This does not open, move or delete any files.'],
    ['compactSessions', 'Show the saved conversations for your current project. Nothing is sent or restarted.'],
    ['compactPermissions', 'Show permission settings. The amber badge means a decision is waiting; this button never approves an action.'],
    ['compactTools', 'Show tools available to this agent. Opening this section does not run a tool or grant permission.'],
    ['compactProviders', 'Show model-provider connections. Opening this section does not connect an account or enable billing.'],
    ['compactPulse', 'Show recent workspace activity. This is not a remaining-credit or billing meter.'],
    ['leftPanelToggle', 'Hide or restore the projects sidebar to give the conversation more room. Nothing is deleted.'],
    ['rightPanelToggle', 'Hide or restore Agent Context, including the mascot, tools and permission settings.'],
    ['addProjectButton confirmProjectButton', 'Add a working folder to Seneschal. The assistant uses that project folder for its tasks.'],
    ['projectPathInput', 'Enter the folder you want the assistant to work in. Adding it does not copy or move your files.'],
    ['projectNameInput', 'Change the project label shown in Seneschal. The actual folder name stays the same.'],
    ['projectsCollapseButton', 'Fold or show the project list. This does not remove any folders.'],
    ['sessionsCollapseButton', 'Fold or show your conversation list. Saved conversations are kept.'],
    ['pinnedSessionsCollapseButton', 'Fold or show the conversations you pinned for easy access.'],
    ['pinnedMessagesCollapseButton', 'Fold or show the messages pinned above this conversation.'],
    ['archivedSessionsButton settingsArchivesButton', 'Find conversations hidden from the normal list and restore them when needed.'],
    ['archivedMessagesButton', 'Show messages you archived in this conversation. Archiving is different from deletion.'],
    ['motionSwitch settingsMotionButton', 'Choose a wallpaper scene, preview it and adjust its motion or brightness. Wallpaper art runs locally.'],
    ['activityRailButton settingsTrailButton', 'Open recorded conversations, tool activity and usage estimates. History is read from the PC.'],
    ['workspaceToolsButton', 'Open extra workspace tools, such as Agent Board, instructions and the classic engine interface.'],
    ['agentBoardButton agentBoardRailButton settingsAgentBoardButton', 'Plan work with several specialist AI sessions. Review their tasks and access before running the board.'],
    ['agentBoardHistoryRailButton agentBoardHistoryButton', 'Reopen a saved board without automatically rerunning its agents or sending its plan again.'],
    ['instructionsRailButton openInstructionsButton skillsButton', 'Manage the assistant’s style, project rules, agent roles and reusable skills. These cannot override permissions.'],
    ['chatGPTRailButton settingsChatGPTButton launchChatGPTButton', 'Open a separate ChatGPT chat. It does not share Seneschal’s task permissions or automatically receive this conversation.'],
    ['openChatGPTUsageButton settingsChatGPTUsageButton', 'Open the official account-usage page to check remaining allowance. This is separate from provider API billing.'],
    ['classicButton settingsClassicButton settingsEngineButton', 'Open OpenCode’s full interface for advanced engine and provider settings.'],
    ['renameSessionButton sessionTitleInput saveSessionTitleButton', 'Rename this conversation so it is easier to find. Its messages and project files are kept.'],
    ['moveSessionButton moveSessionProject confirmMoveSessionButton', 'Organize this conversation under another project. Its existing working folder and files do not move.'],
    ['exportSessionButton', 'Save a copy of this conversation. Review it before sharing: it may contain private messages and tool output.'],
    ['sendSessionToBoardButton', 'Use this conversation as input for Agent Board planning. Review the resulting team before running it.'],
    ['openSessionVsCodeButton openVsCodeButton settingsVsCodeButton openVsCodeProjectButton', 'Open the current project in Visual Studio Code on the PC.'],
    ['abortButton composerStopButton', 'Ask the engine to stop the current task. Work already completed is not automatically undone.'],
    ['deleteSessionButton', 'Review the confirmation for deleting this conversation. Its project files will not be deleted.'],
    ['confirmDeleteSessionButton', 'Permanently delete this conversation and its message history. Project files are not deleted.'],
    ['confirmDeleteMessageButton', 'Remove this message from Seneschal on this device. The engine’s source transcript remains unchanged.'],
    ['confirmDeleteProjectButton', 'Remove the project from Seneschal’s sidebar. Its folder, files and engine conversations are kept.'],
    ['resumeFollowButton', 'Jump to the newest message. This does not send anything or restart the task.'],
    ['exitMessageMaximizeButton', 'Return from the enlarged message to the normal workspace layout.'],
    ['composerMinimizeButton', 'Fold or restore the message input. Your unsent draft is kept.'],
    ['composerSizeButton', 'Give your draft more writing space, or return the input to its compact size.'],
    ['promptInput', 'Write a request for the assistant. Enter sends it; Shift Enter adds a new line. Typing alone sends nothing.'],
    ['fileInput attachFilesButton', 'Attach files to your draft. Their contents may be sent to the selected AI provider when you send the message.'],
    ['composerOptionsSummary', 'Open extra prompt settings: agent mode, thinking level and skills. This does not send your draft.'],
    ['agentSelect', 'Choose how the assistant should work: conversation, planning or building. Tool use still follows your permission policy.'],
    ['modelVariantSelect', 'Choose the model’s thinking effort, if supported. Higher effort may be slower and use more tokens; it does not reveal private internal thinking.'],
    ['browserButton browserTryButton settingsBrowserButton', 'Prepare a task for the agent’s separate browser. Review the website and instructions before starting.'],
    ['browserWindowButton browserWindowCardButton', 'Show or hide the agent-controlled browser window on the PC. The browser task can continue while hidden.'],
    ['aresToggle aresEnabled', 'Show or hide your animated mascot. This alone does not turn on the microphone or change the AI model.'],
    ['voiceButton talkButton settingsVoiceButton aresTalk', 'Start or stop Talk. Talk sends recognized speech automatically and reads replies using your selected voice service.'],
    ['voiceMenuButton', 'Choose the voice service and review audio settings. This arrow opens settings; it does not start recording.'],
    ['voiceServiceSelect', 'Choose Browser voice or NVIDIA cloud speech. This is separate from your chat model. Cloud speech sends audio and reply text off the PC.'],
    ['nvidiaVoiceConsent', 'Allow audio and reply text to reach NVIDIA’s developer speech service. Trial logging and usage limits may apply; do not use it for secrets.'],
    ['checkNvidiaVoice', 'Check access to NVIDIA voices. This check does not turn on your microphone or promise unlimited free use.'],
    ['micButton', 'Dictate into your draft, or record an audio attachment if dictation is unavailable. Review the draft before sending it.'],
    ['sendButton', 'Send your draft and attachments to the selected AI model. Requests may use provider allowance or incur API charges.'],
    ['openApprovalButton settingsApprovalButton', 'Choose when tools must ask for permission. Changing the policy is separate from approving an individual action.'],
    ['approvalSaveButton', 'Save the selected permission policy. This does not approve a tool request already waiting for your decision.'],
    ['openBlenderButton settingsBlenderButton', 'Open Blender on the PC. Creative actions still follow the assistant’s tool permissions.'],
    ['protocolButton', 'Inspect connection and tool events for troubleshooting. Logs may contain private project information.'],
    ['openInspectorButton', 'Open Agent Context: permissions, available tools, integrations and workspace activity.'],
    ['settingsUpdatesButton', 'Check app and engine updates separately. Reviewing available updates does not install them.'],
    ['settingsProvidersButton settingsDeepSeekButton', 'Connect an AI provider or manage its credentials. Provider availability, charges and limits are separate from Seneschal.'],
    ['settingsBudgetButton', 'Review the spending target and provider-side limits. A displayed target is not a guaranteed billing cap.'],
    ['settingsBackupsButton backupNowButton', 'Create a private backup on the PC. Backups can include sensitive history and should not be shared as ordinary exports.'],
    ['backupStatusButton', 'Check whether the backup finished successfully. This does not create another backup.'],
    ['settingsCommandsButton', 'Browse available commands and session references. Selecting an action may prepare or run its specific command.'],
    ['atmosphereClose', 'Close wallpaper settings and return to the workspace. Your chosen wallpaper is kept.'],
    ['atmospherePreviewButton', 'Explore the chosen wallpaper in a larger view. This is local artwork, not an AI or microphone session.'],
    ['atmospherePreviewClose', 'Return from the large wallpaper preview to the wallpaper collection.'],
    ['atmospherePause atmospherePreviewPause', 'Pause or resume wallpaper motion. This does not pause AI tasks or mute voice.'],
    ['atmosphereNext atmospherePreviewNext', 'Switch to the next wallpaper world. Your chat and unsent draft stay unchanged.'],
    ['atmospherePalette', 'Change the selected wallpaper’s color style, or let it follow the day/night theme.'],
    ['atmosphereWeather', 'Choose the scene’s weather or water movement. Available effects depend on the wallpaper.'],
    ['atmosphereIntensity', 'Adjust the amount of rain, snow, mist or scene particles.'],
    ['atmosphereActivity', 'Adjust movement and activity inside the wallpaper, such as passing traffic or scene details.'],
    ['atmosphereGlow', 'Adjust the wallpaper’s light effects, not your screen’s actual brightness.'],
    ['atmosphereFeature', 'Show or hide the selected world’s extra scene details.'],
    ['atmosphereReset', 'Restore this wallpaper’s scene controls to their defaults. Conversations and files are not changed.'],
    ['atmosphereStrength', 'Set how visible the wallpaper is on the home screen.'],
    ['atmosphereConversationStrength', 'Set how visible the wallpaper is behind messages. A lower value can make text easier to read.'],
    ['atmosphereAnimateConversation atmosphereEnableConversation', 'Allow wallpaper animation while chatting. Leaving it off reduces distraction and local graphics work.'],
    ['atmosphereQuality', 'Limit wallpaper frames per second. A lower setting uses fewer local graphics resources.'],
    ['atmosphereRotation', 'Automatically change wallpaper worlds at the chosen interval. Rotation waits while the app is paused or hidden.'],
    ['atmosphereMinutes', 'Choose how long each wallpaper stays before automatic rotation changes it.'],
    ['atmosphereShuffle', 'Choose wallpaper worlds in a mixed order instead of a fixed sequence.'],
    ['atmosphereShowHotspots', 'Show hints for interactive details in the wallpaper preview. This does not affect AI tools.'],
    ['providerConnectSelect', 'Choose the company or service that supplies your AI model.'],
    ['providerKeyInput', 'Enter the provider’s API key. Keep it secret; this page sends it to the local engine, not into your conversation.'],
    ['providerAdvancedButton', 'Open advanced provider options for services not listed in this simple connection form.'],
    ['providerConnectButton', 'Save the provider connection in the local engine. This does not make the provider free or set a spending limit.'],
    ['personaEditor', 'Set the assistant’s name, tone and style. These instructions do not grant extra tool permissions.'],
    ['generalEditor', 'Write preferences and rules to use across projects. Review and save your edits when ready.'],
    ['projectEditor', 'Write rules for this project, such as conventions, testing steps and files to leave alone.'],
    ['buildAgentEditor planAgentEditor', 'Customize this agent’s instructions. Its allowed tools still depend on the permission policy.'],
    ['installSkillLinkButton skillLinkInput inspectSkillLinkButton', 'Review a skill from a repository link before installing it. A skill can change instructions, so only use sources you trust.'],
    ['newSkillButton', 'Create a new reusable instruction skill. Nothing is saved until you choose Save.'],
    ['skillNameInput', 'Choose a short identifier for this skill so you can find and reuse it.'],
    ['skillScopeSelect', 'Choose whether the skill belongs to the current project or is available across projects.'],
    ['skillEditor', 'Edit the skill’s instructions. Do not include passwords or API keys.'],
    ['archiveSkillButton', 'Archive the selected skill instead of keeping it in the active skill list.'],
    ['saveSkillButton', 'Save the skill instructions in the chosen scope. Review them before using the skill.'],
    ['messageEditInput', 'Revise this earlier request. Saving and retrying returns to that point and runs the revised request.'],
    ['browserUrlInput', 'Enter the website the agent should visit in its separate browser.'],
    ['browserTaskInput', 'Explain what the agent should do on that website. Avoid including passwords or other secrets.'],
    ['runBrowserButton', 'Send these browser-task instructions to the assistant. Browser and other tools still follow your permission policy.'],
    ['agentBoardObjective', 'Describe the result you want the team of agents to deliver.'],
    ['agentBoardConcurrency', 'Limit how many board agents can work at the same time. More agents may use more provider allowance.'],
    ['agentBoardImportButton', 'Bring an existing conversation into the board. Review what information will be used.'],
    ['agentBoardTemplateButton', 'Add a starter team to edit. This alone does not start its agents.'],
    ['agentBoardAddButton', 'Add a specialist agent with its own task, model and access level.'],
    ['agentBoardRunButton', 'Start eligible agents on this board. Review their tasks, models, access and dependencies first.'],
    ['agentBoardPauseButton', 'Pause new agents from starting. Agents already running are stopped separately.'],
    ['agentBoardResetButton', 'Reset the board’s workflow state. Review any confirmation before discarding its setup.'],
    ['agentBoardStopButton', 'Ask running board agents to stop. Changes they already made are not automatically reversed.'],
    ['agentNameInput', 'Give this specialist a name that explains its job, such as Researcher or Reviewer.'],
    ['agentRoleInput', 'Choose this specialist’s role in the team, such as planner, builder or reviewer.'],
    ['agentModelInput', 'Choose the AI model used by this specialist. Its provider’s charges and limits apply.'],
    ['agentAccessInput', 'Choose the tools this specialist may use. Making a tool available is not the same as approving its actions.'],
    ['agentPromptInput', 'Give this specialist one clear responsibility and describe the expected result.'],
    ['vscodePathInput', 'Optionally enter the project file to open in Visual Studio Code.'],
    ['vscodeLineInput vscodeColumnInput', 'Choose where the editor should place the cursor in that file.'],
    ['installVsCodeCompanionButton', 'Install the optional editor companion on the PC. It adds shortcuts between VS Code and Seneschal.'],
    ['aresDrag', 'Move the floating mascot by dragging this handle. Arrow keys also move it; Layout provides position controls.'],
    ['aresMinimize', 'Fold or restore the mascot card. This does not stop Talk or cancel the assistant’s task.'],
    ['aresMaximize', 'Open or leave the full-screen mascot view. Maximizing alone does not turn on the microphone.'],
    ['aresClose', 'Hide the mascot and release its 3D resources. Voice and the AI task remain separate.'],
    ['aresRetry', 'Try loading the local mascot again. This does not resend your message or switch voice services.'],
    ['aresMotion', 'Pause or resume mascot animation. This does not mute speech or stop the AI task.'],
    ['aresLayoutButton', 'Adjust mascot position, size and camera angle, or dock it in the sidebar.'],
    ['aresResize', 'Drag to resize the floating mascot. On narrow cards, use Layout → Larger or Smaller instead.'],
    ['aresCameraHome aresCameraReset', 'Return the camera to the front of the character without moving the mascot card.'],
    ['aresDock', 'Place the mascot in the sidebar so it has its own space above the other sections.'],
    ['aresReset', 'Restore the mascot card’s default position and size. This does not reset your conversation.'],
    ['settingsPhoneAccessButton', 'Manage private phone access on the PC. The PC must remain awake and connected to serve your phone.'],
    ['phoneAccessRefresh', 'Refresh the list of paired browsers and their connection status.'],
    ['phoneAccessCode', 'Enter this one-time pairing code only on your phone. Do not share it or paste it into chat.'],
    ['checkAppUpdate checkEngineUpdate', 'Check for a compatible release. Checking alone does not install the update or restart your tasks.'],
    ['activityQuery', 'Search recorded conversations. Choose whether to search titles or conversation text.'],
    ['activitySearchMode', 'Choose whether the history search checks titles and projects, or the recorded conversation text.'],
    ['activityStatus', 'Filter by the status saved in history. It may differ from a task’s current live state.'],
    ['activitySearchSubmit', 'Search the local history using these filters. This does not ask the AI a question.'],
    ['activityStartup', 'Start the existing history service on future Seneschal launches. This does not enable Windows startup or immediately start the service.']
  ];
  const catalog = Object.freeze(Object.fromEntries(groups.flatMap(([ids, copy]) => ids.split(' ').map(id => [id, copy]))));
  const nativeTitles = new WeakMap();
  const sections = {
    permissions: 'Review when the assistant must ask before using tools. A waiting permission request still needs your explicit decision.',
    tools: 'See which tools the current agent can access. Available does not mean automatically approved.',
    browser: 'Control the agent’s separate browser session. It does not use your normal saved browser profile.',
    creative: 'Connect the assistant to Blender on the PC for 3D work. Creative tool actions follow your permissions.',
    code: 'Open the working project or a file in the PC’s code editor.',
    budget: 'Review your paid-provider spending target. Set real spending limits with the provider too.',
    providers: 'See connected AI services and the models they make available.',
    pulse: 'See recent workspace and engine activity. These activity counts are not your remaining model allowance.'
  };
  const panels = {
    settingsDialog: 'Review app settings, model connections, voice, permissions and PC-only maintenance. Open a specific control to change it.',
    atmosphereDialog: catalog.motionSwitch, atmospherePreview: catalog.atmospherePreviewButton,
    approvalDialog: catalog.openApprovalButton, providerDialog: catalog.settingsProvidersButton,
    projectDialog: catalog.projectPathInput, renameProjectDialog: catalog.projectNameInput,
    renameSessionDialog: catalog.renameSessionButton, moveSessionDialog: catalog.moveSessionButton,
    deleteSessionDialog: catalog.confirmDeleteSessionButton, deleteMessageDialog: catalog.confirmDeleteMessageButton,
    deleteProjectDialog: catalog.confirmDeleteProjectButton, messageEditDialog: catalog.messageEditInput,
    browserDialog: catalog.browserButton, instructionDialog: catalog.instructionsRailButton,
    agentBoardDialog: catalog.agentBoardButton, agentBoardHistoryDialog: catalog.agentBoardHistoryButton,
    agentEditorDialog: 'Set up one specialist’s name, task, model, system access and dependencies before running it.',
    vscodeDialog: catalog.settingsVsCodeButton, commandDialog: catalog.commandButton,
    protocolDialog: catalog.protocolButton, aresStage: catalog.aresMaximize,
    chatGPTDialog: catalog.chatGPTRailButton, archiveDialog: catalog.archivedSessionsButton
  };
  const rules = [
    ['[data-voice-mute="mic"]', node => node.getAttribute('aria-pressed') === 'true' ? 'Unmute the microphone. Talk can then capture and automatically send new spoken turns.' : 'Stop microphone capture without stopping the AI task. Unsent recorded audio is discarded; audio already sent cannot be taken back.'],
    ['[data-voice-mute="speaker"]', node => node.getAttribute('aria-pressed') === 'true' ? 'Let future replies play aloud again. Old muted replies will not be replayed.' : 'Stop spoken playback and keep future replies text-only until you unmute. The microphone and AI task are separate.'],
    ['[data-reply="once"]', 'Allow only this waiting tool request. Check the requested command or action first.'],
    ['[data-reply="always"]', 'Remember approval for matching actions in this conversation. This grants more freedom than Allow once.'],
    ['[data-reply="reject"]', 'Deny this tool request. The tool is not approved; work already completed is not undone.'],
    ['[data-check-permission]', 'Check whether the PC received your earlier decision. This does not send the decision again.'],
    ['input[name="approvalProfile"][value="recommended"]', 'Let safe reads run automatically; ask before edits, commands and external actions. Save to apply this policy.'],
    ['input[name="approvalProfile"][value="strict"]', 'Ask before reading files as well as other tool actions. This is more cautious but interrupts more often. Save to apply.'],
    ['input[name="approvalProfile"][value="trusted"]', 'Let Build edit files and run commands without asking. Use only for projects you trust; external actions still ask. Save to apply.'],
    ['.project-item', 'Open this project’s conversations and use its folder for future work.'],
    ['.project-rename-button', 'Rename the project’s sidebar label, not its folder on disk.'],
    ['.project-delete-button', 'Remove this project from the sidebar. Its folder, files and engine conversations are kept.'],
    ['.session-open-button', 'Open this saved conversation. This does not resend its messages.'],
    ['.session-pin-button', 'Keep this conversation easy to find at the top, or remove that pin.'],
    ['.session-archive-button', 'Hide this conversation from the normal list, or restore it. Archiving does not delete its history.'],
    ['.session-rename-button', 'Rename this saved conversation without changing its messages.'],
    ['.session-delete-button', 'Request permanent deletion of this conversation. Project files are not deleted.'],
    ['.message-edit-button,.message-retry-button', 'Return to this request and generate a new response. Later responses leave the active branch; review before retrying.'],
    ['.message-board-button', 'Use only this selected response to prepare an Agent Board. Review the team before running it.'],
    ['.message-pin-button', 'Pin this message for easy access, or remove its pin.'],
    ['.message-archive-button', 'Hide or restore this message in this device’s Seneschal view. The engine transcript is kept.'],
    ['.message-delete-button', 'Remove this message from Seneschal on this device. The engine’s source transcript stays unchanged.'],
    ['.message-size-button', 'Fold or expand the message without deleting it or running it again.'],
    ['.message-maximize-button', 'Give this message the main viewing area, or return to the normal layout.'],
    ['.message-copy-button,.code-copy-button', 'Copy this text to your clipboard. It does not execute commands or send the text to another service.'],
    ['.pinned-message-item,.message-map-step,[data-jump-message]', 'Jump to the saved message in this conversation. Nothing is sent or run again.'],
    ['.tool-summary', 'Expand or collapse the tool’s command and result. Viewing a completed result does not run the tool again.'],
    ['.reasoning-part > summary', 'Show or hide the brief progress summary supplied by the model. This is not access to private internal thinking.'],
    ['.message-actions-menu > summary', 'Show actions for this message, such as Copy, Pin and Retry. Choose a specific action to use it.'],
    ['.chat-agent-activity > summary', 'Show or hide recent progress and tool events for this conversation.'],
    ['.model-picker-option', 'Use this AI model for future requests. Provider availability, allowance and charges still apply.'],
    ['.quick-card', 'Put this example request in the message input so you can review or edit it before sending.'],
    ['[data-remove]', 'Remove this attachment from the draft. The original file on disk is not deleted.'],
    ['[data-save-instruction]', 'Save these instructions for the chosen scope. Instructions cannot grant extra tool permissions.'],
    ['[data-undo-instruction]', 'Discard unsaved edits in this instruction editor and return to the saved version.'],
    ['[data-default-instruction]', 'Load the suggested default text into this editor. Review it before saving.'],
    ['[data-skill-toggle]', 'Include or exclude this skill’s instructions in future requests. Skills cannot grant extra tool permissions.'],
    ['[data-skill-key]', 'Open this skill to review or edit its instructions before using it.'],
    ['[data-instruction-tab]', 'Open this part of Instructions Studio. Switching tabs alone does not save your edits.'],
    ['[data-restore-session]', 'Return this archived conversation to the normal sidebar list.'],
    ['[data-ares-move]', 'Move the floating mascot a small step in this direction. This does not rotate the character.'],
    ['[data-ares-size]', 'Make the floating mascot card larger or smaller without changing your conversation.'],
    ['[data-ares-orbit]', 'Rotate the camera around the mascot. The card itself stays in place.'],
    ['[data-world]', 'Choose this wallpaper world. Your conversation and unsent draft are not changed.'],
    ['.atmosphere-actions button,.atmosphere-preview .atmosphere-actions button', 'Play this small scene interaction in the local wallpaper. It does not run an AI tool or record audio.'],
    ['.atmosphere-hotspot', 'Play the wallpaper interaction at this highlighted detail. It is a local visual effect, not an AI task.'],
    ['[data-board-edit]', 'Edit this board agent’s task, model and access. Stop a running agent before editing.'],
    ['[data-board-delete]', 'Remove this agent card from the board. Running work must be stopped separately.'],
    ['[data-board-run]', 'Start this specialist’s assigned task with its selected model and access.'],
    ['[data-board-stop]', 'Ask this specialist to stop. Its completed changes are not automatically undone.'],
    ['[data-board-open]', 'Open this specialist’s conversation. This does not run it again.'],
    ['[data-board-activity]', 'Inspect this specialist’s recorded progress and tool activity.'],
    ['[data-board-open-history]', 'Reopen this saved board without rerunning its agents.'],
    ['[data-board-history-delete]', 'Remove this saved board from board history. Review the confirmation before deleting it.'],
    ['.command-result', 'Choose this search result. Models, conversations and actions have different effects, shown in the result’s label.'],
    ['.remote-navigation-toggle', 'Open or close the phone’s projects sidebar.'],
    ['.remote-sidebar-close,.remote-workspace-tools-close', 'Close this navigation panel and return to the conversation.'],
    ['.remote-host-bar button', 'Disconnect this browser from private phone access. This does not stop tasks running on the PC.'],
    ['.tool-chip', 'An available tool for this agent. Tool actions still follow the permission policy.'],
    ['.activity-chat-heading button', 'Open the recorded history for this conversation. This does not resend a message or rerun its tools.'],
    ['.agent-dependency-list input', 'Wait for this selected agent to finish before starting the specialist you are editing.'],
    ['.connection-pill', 'Shows whether this page is connected to the PC’s task engine.'],
    ['.status-chip', 'Shows whether this conversation is idle, working or retrying.'],
    ['.usage-card', 'Shows how much of this conversation’s context window is in use, not your account’s remaining allowance.'],
    ['.permission-kicker', 'A tool is asking for permission. Review the requested action before choosing Allow once, Always or Reject.'],
    ['#questionDock', 'The assistant needs an answer to a question. Answering a question is different from approving a tool action.']
  ];
  function describe(node) {
    if (!node?.matches) return '';
    if (node.matches('label')) { const input = node.control || node.querySelector('input,select,textarea'); return input ? describe(input) : ''; }
    let copy = catalog[node.id] || '';
    if (!copy) for (const [selector, value] of rules) if (node.matches(selector)) { copy = typeof value === 'function' ? value(node) : value; break; }
    const label = (root.SeneschalI18n?.sourceLabel(node) || node.getAttribute('aria-label') || node.textContent || '').replace(/\s+/g, ' ').trim();
    if (!copy && node.matches('button') && (/^(close|cancel|keep\b|×$|back\b)/i.test(label) || /^(close|cancel|maintenanceClose)/i.test(node.id))) copy = 'Close this panel without confirming its pending action. Changes already saved are not undone.';
    if (!copy && node.matches('.inspector-section-toggle,.block-title,.inspector-head')) copy = sections[node.closest('[data-inspector-section]')?.dataset.inspectorSection] || 'Agent Context shows the current assistant, its permissions, tools and connected services.';
    if (!copy && node.matches('.rail-heading')) copy = node.closest('#projectsRailSection') ? 'Choose the folder the assistant should work in. Project files stay on your PC.' : node.closest('#pinnedSessionsRailSection') ? 'Conversations you pinned for quick access. Pinning does not copy or rerun them.' : 'Your saved conversations for this project. Open one to continue where you left off.';
    if (!copy && node.matches('#composerProject,.composer-topline')) copy = 'The working project for this draft, plus controls for the size of the message input.';
    if (!copy && node.matches('#sessionHeader > div:first-child')) copy = 'The current project and conversation name. This is separate from the AI model selected above.';
    if (!copy && node.closest('.phone-access-modal')) {
      const action = node.dataset.action;
      copy = ({ start: 'Start private phone access on the PC. The PC must stay awake and connected; this is not a public internet link.', stop: 'Stop phone access and revoke all paired browsers and unused codes. PC tasks and history stay intact.', pair: 'Create a one-time code to pair your own browser. Keep this code private.' })[action] || (node.matches('button') && /revoke/i.test(label) ? 'Revoke this paired browser’s access. It must pair again before it can reconnect.' : 'Manage which of your browsers may reach this PC through private phone access.');
    }
    if (!copy && node.closest('.activity-workspace,.chat-agent-activity')) {
      const action = node.dataset.action, view = node.dataset.view;
      copy = ({ overview: 'See a summary of recorded conversations and estimated usage.', sessions: 'Find and inspect recorded conversations without rerunning them.', usage: 'Review recorded token usage and cost estimates. Estimates are not your provider’s final bill.', service: 'Manage the local history service and its derived index on the PC.' })[view]
        || ({ refresh: 'Reload recorded history and status without resending messages.', start: 'Start the local history service on the PC so the dashboard can read its records.', stop: 'Stop the history service, not the AI’s current task. Saved conversations are kept.', restart: 'Restart the local history service. This is separate from restarting the task engine.', rebuild: 'Rebuild the history index from original records. The previous index is preserved as a local backup.', 'save-startup': 'Save whether history should start on future Seneschal launches. This does not immediately start it.', 'export-live': 'Save the live events shown in this window. Review the file before sharing it.', pause: 'Pause or resume updates in this history view. The AI task continues.', current: 'Inspect this chat’s recorded activity without sending a new request.', 'check-host': 'Check whether the PC’s history service is ready. This does not start a paid service.', 'open-chat': 'Open the original conversation so you can continue it.', previous: 'Show the previous page of history.', next: 'Show the next page of history.', 'more-turns': 'Load more recorded turns from this conversation.', 'clear-project': 'Remove the project filter from this history search.' })[action]
        || (node.hasAttribute('data-session') ? 'Inspect this recorded conversation. Viewing history does not run its tasks again.' : 'Inspect recorded work and usage from the PC. Original conversation records stay separate from this dashboard.');
    }
    if (!copy && node.closest('.question-dialog,#questionDock')) {
      copy = /Refresh questions/i.test(label) ? 'Check for waiting questions. This does not send an answer or approve a tool.' : /Dismiss question/i.test(label) ? 'Reject this question request without choosing an answer. This is not a tool-permission decision.' : /Send answers/i.test(label) ? 'Send only the answers you selected or wrote for this question.' : /Answer question/i.test(label) ? 'Open the waiting question so you can review its choices.' : 'Choose or write an answer for the assistant. Only Send answers submits it; closing keeps it pending.';
    }
    if (!copy && node.matches('.atmosphere-controls legend')) copy = node.closest('#atmosphereSceneControls') ? 'Adjust this world’s colors, weather, lights and moving details. These are local visual effects.' : /rotation/i.test(label) ? 'Set an automatic wallpaper playlist. It waits when the workspace is hidden, paused or using a quiet conversation background.' : 'Adjust wallpaper visibility and motion so the background stays comfortable while you work.';
    if (!copy && node.matches('.atmosphere-group h3')) copy = 'Choose a wallpaper from this collection. The art runs locally and does not use your AI allowance.';
    if (!copy && node.matches('dialog h2,dialog h3,.modal-kicker,.panel-heading,legend')) copy = panels[node.closest('dialog')?.id] || 'Review this group of settings. Hover or focus a specific control to learn what it changes.';
    if (!copy && node.matches('summary')) copy = 'Expand or fold these details. This alone does not send a message or approve a tool.';
    if (!copy && node.matches('a[href]')) copy = 'Open this link. External websites have their own privacy policies; review private information before sharing it.';
    if (!copy && node.matches('button') && (/^(close|cancel|keep\b|×$|back\b)/i.test(label) || /^(close|cancel|maintenanceClose)/i.test(node.id))) copy = 'Close this panel without confirming its pending action. Changes already saved are not undone.';
    if (!copy && node.matches('button') && node.getAttribute('value') === 'cancel') copy = 'Leave this dialog without confirming its pending action.';
    if (!copy && node.matches('button[type="submit"]')) {
      const form = node.closest('form')?.id;
      copy = ({ messageEditForm: 'Save this revised request and generate a new response from this point. Later responses leave the active branch.', agentEditorForm: 'Save this specialist’s task, model and access. Saving does not run it.', vscodeForm: 'Open the chosen file and position in Visual Studio Code on the PC.', renameProjectForm: 'Save this sidebar label without renaming the actual folder.' })[form] || 'Save the settings in this form. Review the values before confirming.';
    }
    if (!copy && node.closest('.maintenance-modal')) copy = /update/i.test(label) ? 'Install the selected compatible update only after reviewing it. A running task may need to finish first.' : 'Review local app maintenance and compatibility information.';
    if (!copy && node.matches('input,select,textarea')) copy = 'Change this field’s setting. Its label and nearby note explain the expected value; typing alone does not send a chat message.';
    if (!copy && node.matches('button')) copy = node.getAttribute('title') || nativeTitles.get(node) || 'Use this action in the current panel. Review the nearby information before confirming a change.';
    if (copy && node.matches(':disabled,[aria-disabled="true"]')) copy += ' Unavailable right now; check the nearby status.';
    return root.SeneschalI18n?.t(copy) || copy;
  }
  const selector = 'button,summary,input:not([type="hidden"]),select,textarea,a[href],label,.block-title,.rail-heading,.inspector-head,.composer-topline,#composerProject,#sessionHeader > div:first-child,.tool-chip,.status-chip,.connection-pill,.usage-card,.permission-kicker,#questionDock,.modal-kicker,.panel-heading,.activity-view-heading h3,.atmosphere-group h3,dialog h2,dialog h3,legend';
  function install(doc = root.document) {
    if (!doc || doc.documentElement.dataset.featureHelpReady === 'true') return null;
    doc.documentElement.dataset.featureHelpReady = 'true';
    const bubble = doc.createElement('div'); bubble.id = 'seneschalFeatureHelp'; bubble.className = 'feature-help-tooltip'; bubble.setAttribute('role', 'tooltip'); bubble.setAttribute('popover', 'manual'); bubble.hidden = true;
    let current = null, timer = 0, focusTimer = 0, closeTimer = 0, frame = 0, press = null, blocked = null, mode = '', disposed = false, pointerFocus = false, focusRecovery = null;
    const cleanup = [];
    const on = (target, type, fn, options) => { target.addEventListener(type, fn, options); cleanup.push(() => target.removeEventListener(type, fn, options)); };
    const target = event => { const node = event.target?.closest?.(selector); return node && !bubble.contains(node) && describe(node) ? node : null; };
    function unlink() {
      if (!current) return;
      const ids = (current.getAttribute('aria-describedby') || '').split(/\s+/).filter(id => id && id !== bubble.id);
      if (ids.length) current.setAttribute('aria-describedby', ids.join(' ')); else current.removeAttribute('aria-describedby');
    }
    function hide() {
      root.clearTimeout(timer); root.clearTimeout(focusTimer); root.clearTimeout(closeTimer); root.cancelAnimationFrame(frame); timer = focusTimer = closeTimer = frame = 0;
      unlink(); current = null; mode = ''; focusRecovery = null;
      if (bubble.matches(':popover-open')) bubble.hidePopover(); bubble.hidden = true;
    }
    function show(node, nextMode) {
      if (disposed || !node?.isConnected || !node.getClientRects().length) return;
      hide(); current = node; mode = nextMode;
      const copy = describe(node); if (!copy) { hide(); return; }
      if (node.hasAttribute('title')) { nativeTitles.set(node, node.getAttribute('title')); node.removeAttribute('title'); }
      bubble.textContent = copy;
      const layer = node.closest('dialog[open],[popover]:popover-open') || doc.body;
      layer.append(bubble); bubble.hidden = false; bubble.style.visibility = 'hidden';
      bubble.style.maxWidth = `${Math.min(310, Math.max(40, (root.visualViewport?.width || root.innerWidth) - 16))}px`;
      bubble.style.maxHeight = `${Math.min(190, Math.max(40, (root.visualViewport?.height || root.innerHeight) - 16))}px`;
      const ids = new Set((node.getAttribute('aria-describedby') || '').split(/\s+/).filter(Boolean)); ids.add(bubble.id); node.setAttribute('aria-describedby', [...ids].join(' '));
      frame = root.requestAnimationFrame(() => {
        frame = 0; if (!current || bubble.hidden) return;
        // A native dialog/popover may still be opening when it focuses a control.
        // Open our nested, non-focus-taking layer only after that operation ends.
        const readyLayer = current.closest('dialog[open],[popover]:popover-open') || doc.body;
        if (bubble.parentElement !== readyLayer) readyLayer.append(bubble);
        if (typeof bubble.showPopover === 'function' && !bubble.matches(':popover-open')) bubble.showPopover();
        const viewport = root.visualViewport, left = viewport?.offsetLeft || 0, top = viewport?.offsetTop || 0, width = viewport?.width || root.innerWidth, height = viewport?.height || root.innerHeight;
        const anchor = current.getBoundingClientRect(), rect = bubble.getBoundingClientRect();
        let x = Math.max(left + 8, Math.min(anchor.left + anchor.width / 2 - rect.width / 2, left + width - rect.width - 8));
        const below = anchor.bottom + 8;
        let y = below + rect.height <= top + height - 8 ? below : Math.max(top + 8, anchor.top - rect.height - 8);
        const compactToggle = current.matches('.panel-toggle') && current.closest('.left-panel-collapsed > .sidebar, .right-panel-collapsed .inspector');
        const compactRail = compactToggle || current.closest('.compact-nav') || (current.parentElement?.classList.contains('sidebar-footer') && current.closest('.left-panel-collapsed'));
        if (compactRail) {
          const rightRail = current.closest('.compact-context-nav') || (compactToggle && current.closest('.inspector'));
          const beside = rightRail ? anchor.left - rect.width - 10 : anchor.right + 10;
          x = Math.max(left + 8, Math.min(beside, left + width - rect.width - 8));
          y = Math.max(top + 8, Math.min(anchor.top + (anchor.height - rect.height) / 2, top + height - rect.height - 8));
        }
        bubble.style.left = `${Math.round(x)}px`; bubble.style.top = `${Math.round(y)}px`; bubble.style.visibility = 'visible';
      });
    }
    function cancelPress() { if (press) root.clearTimeout(press.timer); press = null; }
    on(doc, 'pointerover', event => {
      if (event.pointerType === 'touch' || event.pointerType === 'pen') return;
      if (bubble.contains(event.target)) { root.clearTimeout(closeTimer); return; }
      const node = target(event); if (!node || node.contains(event.relatedTarget)) return;
      root.clearTimeout(timer); timer = root.setTimeout(() => show(node, 'hover'), 400);
    }, true);
    on(doc, 'pointerout', event => {
      const node = target(event); if (node?.contains(event.relatedTarget) || bubble.contains(event.relatedTarget)) return;
      root.clearTimeout(timer);
      if (mode === 'hover' && (!current || !current.contains(doc.activeElement))) closeTimer = root.setTimeout(hide, 160);
    }, true);
    on(bubble, 'pointerenter', () => root.clearTimeout(closeTimer));
    on(bubble, 'pointerleave', () => { if (mode === 'hover' && !current?.contains(doc.activeElement)) closeTimer = root.setTimeout(hide, 160); });
    on(doc, 'focusin', event => { if (pointerFocus) return; const node = target(event); if (node) show(node, 'focus'); else if (!bubble.contains(event.target)) hide(); }, true);
    on(doc, 'focusout', event => { if (current?.contains(event.target) && !current.contains(event.relatedTarget) && !bubble.contains(event.relatedTarget)) hide(); }, true);
    on(doc, 'pointerdown', event => {
      if (bubble.contains(event.target)) return;
      pointerFocus = true;
      blocked = null;
      hide(); cancelPress();
      if (!['touch', 'pen'].includes(event.pointerType) || event.isPrimary === false || (event.button !== undefined && event.button !== 0)) return;
      const node = target(event);
      // Preserve native text selection, sliders, camera/drag gestures and link menus.
      if (!node || node.matches('input:not([type="checkbox"]):not([type="radio"]),select,textarea,a[href],.ares-drag,.ares-resize') || event.target.closest('[contenteditable="true"],.ares-canvas')) return;
      const pending = press = { node, id: event.pointerId, x: event.clientX, y: event.clientY, shown: false };
      pending.timer = root.setTimeout(() => { if (press !== pending) return; pending.shown = true; show(node, 'hold'); }, 550);
    }, true);
    on(doc, 'pointermove', event => {
      if (!press) return;
      if (event.pointerId !== press.id || Math.hypot(event.clientX - press.x, event.clientY - press.y) > 10) { if (press.shown) hide(); cancelPress(); }
    }, { capture: true, passive: true });
    on(doc, 'pointerup', event => {
      root.setTimeout(() => { pointerFocus = false; }, 0);
      if (!press || event.pointerId !== press.id) return;
      if (press.shown) { blocked = { node: press.node, until: Date.now() + 1200 }; event.preventDefault(); }
      cancelPress();
    }, true);
    on(doc, 'pointercancel', () => { if (press?.shown) blocked = { node: press.node, until: Date.now() + 1200 }; cancelPress(); if (mode === 'hold') hide(); }, true);
    on(doc, 'contextmenu', event => { if (press && press.node.contains(event.target)) event.preventDefault(); }, true);
    on(doc, 'click', event => {
      if (blocked && Date.now() <= blocked.until && blocked.node.contains(event.target) && event.detail !== 0) {
        blocked = null; event.preventDefault(); event.stopImmediatePropagation(); return;
      }
      blocked = null; if (!bubble.contains(event.target)) hide();
    }, true);
    on(doc, 'keydown', event => {
      pointerFocus = false;
      if (event.key === 'Escape' && current) { event.preventDefault(); event.stopImmediatePropagation(); hide(); cancelPress(); }
      else if (['Enter', ' ', 'Tab', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'PageUp', 'PageDown'].includes(event.key)) { cancelPress(); if (event.key !== 'Tab') hide(); }
    }, true);
    on(doc, 'scroll', event => {
      if (bubble.contains(event.target)) return;
      const focused = mode === 'focus' ? current : focusRecovery;
      hide(); cancelPress();
      if (!pointerFocus && focused?.contains(doc.activeElement)) {
        focusRecovery = focused;
        focusTimer = root.setTimeout(() => { if (focused.contains(doc.activeElement)) show(focused, 'focus'); }, 120);
      }
    }, { capture: true, passive: true });
    on(root, 'resize', () => { hide(); cancelPress(); });
    on(root, 'seneschal:languagechange', () => { hide(); cancelPress(); });
    on(root, 'blur', () => { hide(); cancelPress(); });
    on(root.visualViewport || root, 'resize', hide);
    on(doc, 'visibilitychange', () => { if (doc.hidden) { hide(); cancelPress(); } });
    on(doc, 'input', () => { hide(); cancelPress(); }, true);
    const observer = new root.MutationObserver(records => {
      if (current && (!current.isConnected || records.some(record => {
        if (record.target === current && record.attributeName === 'title' && !current.hasAttribute('title')) return false;
        if (record.target === current) return true;
        if (!record.target.contains?.(current)) return false;
        return record.attributeName === 'class' || (record.attributeName === 'hidden' && record.target.hidden) || (record.attributeName === 'open' && !record.target.open);
      }))) hide();
      if (press && !press.node.isConnected) cancelPress();
    });
    observer.observe(doc.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['hidden', 'open', 'class', 'disabled', 'aria-pressed', 'aria-label', 'title'] });
    const dispose = () => { if (disposed) return; disposed = true; hide(); cancelPress(); observer.disconnect(); cleanup.forEach(fn => fn()); bubble.remove(); delete doc.documentElement.dataset.featureHelpReady; };
    on(root, 'pagehide', event => { if (!event.persisted) dispose(); });
    return { hide, dispose, describe, tooltip: bubble };
  }
  root.SeneschalFeatureHelp = { catalog, sections, rules, describe, install };
  if (root.document) install(root.document);
})(typeof window !== 'undefined' ? window : globalThis);

/* SENESCHAL LOCAL LANGUAGES — authored UI only; never translate user content. */
(function (root) {
  'use strict';
  const translations = Object.create(null);
  const folded = Object.create(null);
  function register(rows) {
    for (const row of rows.trim().split('\n')) {
      const separator = row.indexOf('|');
      if (separator > 0) { const key = row.slice(0, separator), copy = row.slice(separator + 1); translations[key] = copy; folded[key.toLowerCase()] = copy; }
    }
  }
  /* LANGUAGE COPY */
  register(`
Your Private AI Atelier|کارگاه خصوصی هوش مصنوعی شما
Select model|انتخاب مدل
No matching models|مدلی پیدا نشد
Connecting|در حال اتصال
Search sessions, models, actions…|جست‌وجوی گفت‌وگو، مدل و ابزار…
Search sessions, models, or actions…|جست‌وجوی گفت‌وگو، مدل یا ابزار…
Night|شب
Day|روز
Normal view|نمای معمولی
New session|گفت‌وگوی جدید
Projects|پروژه‌ها
Pinned sessions|گفت‌وگوهای سنجاق‌شده
Sessions|گفت‌وگوها
Wallpapers|پس‌زمینه‌ها
Orbit|مدار
Activity|فعالیت‌ها
Local|محلی
Workspace tools|ابزارهای فضای کار
Refresh workspace|تازه‌سازی فضای کار
Boards & conversations|تابلوها و گفت‌وگوها
Agent Board|تابلوی عامل‌ها
Board history|تاریخچهٔ تابلوها
Instructions|دستورالعمل‌ها
ChatGPT Chat|گفت‌وگوی ChatGPT
Chat|گفت‌وگو
Account allowance|سهمیهٔ حساب
Plus agent usage|مصرف عامل در Plus
View remaining allowance|مشاهدهٔ سهمیهٔ باقی‌مانده
Official 5-hour and weekly limits|محدودیت رسمی پنج‌ساعته و هفتگی
Classic OpenCode|رابط اصلی OpenCode
Context usage|مصرف ظرفیت گفت‌وگو
Ready for a new session|آمادهٔ گفت‌وگوی جدید
Settings|تنظیمات
Project|پروژه
Idle|آماده
Your private AI Seneschal|Seneschal، دستیار خصوصی شما
Night Studio|کارگاه شبانه
Day Atelier|کارگاه روزانه
At your command, My Lord.|در خدمت شما هستم.
Analyze project|بررسی پروژه
Map structure and identify risks|شناخت ساختار و پیدا کردن خطرها
Summarize|خلاصه‌سازی
Distill docs and references|خلاصهٔ نکته‌های مهم اسناد
Design UI|طراحی رابط کاربری
Craft accessible components|ساخت بخش‌های قابل‌استفاده برای همه
Pinned messages|پیام‌های سنجاق‌شده
Jump to latest|رفتن به آخرین پیام
No project selected|پروژه‌ای انتخاب نشده
Text + tools|متن + ابزارها
Minimize|جمع کردن
Maximize|بزرگ کردن
Restore|بازگرداندن
Expand|باز کردن
Upload|پیوست فایل
Options|گزینه‌ها
Agent|عامل
Thinking|میزان بررسی
Low|کم
Medium|متوسط
High|زیاد
Default|پیش‌فرض
None|هیچ‌کدام
Skills|مهارت‌ها
Browser|مرورگر
Show|نمایش
Hide|پنهان کردن
Mascot|شخصیت
Hidden|پنهان
Voice|صدا
Voice service|سرویس صدا
Browser voice|صدای مرورگر
NVIDIA cloud · developer trial|ابر NVIDIA · نسخهٔ آزمایشی توسعه‌دهندگان
Mute mic|قطع میکروفون
Mute microphone|قطع میکروفون
Unmute mic|وصل میکروفون
Unmute microphone|وصل میکروفون
Mute speaker|قطع صدای خروجی
Unmute speaker|وصل صدای خروجی
Mic on · Speaker on|میکروفون و صدای خروجی روشن
Mic muted · Speaker on|میکروفون قطع؛ صدای خروجی روشن
Mic on · Speaker muted|میکروفون روشن؛ صدای خروجی قطع
Mic muted · Speaker muted|میکروفون و صدای خروجی قطع
Check voice access|بررسی دسترسی صدا
Nothing is recorded until you start Talk.|تا شروع مکالمه، چیزی ضبط نمی‌شود.
Dictate|تبدیل گفتار به متن
Add speech to your draft|افزودن گفتار به پیش‌نویس
Talk|مکالمه
Send spoken turns & hear replies|گفتن درخواست و شنیدن پاسخ
Show Seneschal companion|نمایش شخصیت Seneschal
Stop|توقف
Agent context|وضعیت و دسترسی عامل
Build|اجرا
Plan|برنامه‌ریزی
Workspace pulse|نبض فضای کار
Standby|در انتظار
Work|کار
Ambient|پس‌زمینه
Last 60s|۶۰ ثانیهٔ اخیر
60 seconds ago|۶۰ ثانیه پیش
Now|اکنون
Session work|کارهای این گفت‌وگو
Engine|موتور اجرا
Permissions|اجازه‌ها
Manage|مدیریت
Active tools|ابزارهای در دسترس
Agent browser|مرورگر عامل
Checking|در حال بررسی
Checking…|در حال بررسی…
New browser task|کار جدید در مرورگر
Show window|نمایش پنجره
Hide window|پنهان کردن پنجره
Creative bridge|اتصال ابزارهای سه‌بعدی
Checking the local bridge|بررسی اتصال محلی
Open|باز کردن
Code workspace|فضای کدنویسی
Checking the local editor bridge|بررسی اتصال ویرایشگر محلی
Paid API guard|کنترل هزینهٔ API
Last 30 days · estimate|۳۰ روز اخیر · برآورد
Providers|ارائه‌دهندگان مدل
Inspect protocol log|بررسی گزارش اتصال
Context|وضعیت عامل
Session details|جزئیات گفت‌وگو
Give it a name|انتخاب نام
Session name|نام گفت‌وگو
Cancel|انصراف
Save name|ذخیرهٔ نام
Project organization|سامان‌دهی پروژه
Move this session|انتقال این گفت‌وگو
Tools will continue working in|ابزارها همچنان در این پوشه کار می‌کنند:
Destination project|پروژهٔ مقصد
Move session|انتقال گفت‌وگو
New workspace|فضای کار جدید
Add a project|افزودن پروژه
Project folder|پوشهٔ پروژه
Add project|افزودن پروژه
Project label|برچسب پروژه
Rename project|تغییر نام نمایشی پروژه
Display name|نام نمایشی
Seneschal control|تنظیمات Seneschal
Workspace settings|تنظیمات فضای کار
Interface language|زبان رابط کاربری
Language saved for this browser. Voice and model settings are unchanged.|زبان در این مرورگر ذخیره شد. تنظیمات صدا و مدل تغییری نکرد.
Language changed for this page. This browser could not save your preference.|زبان این صفحه تغییر کرد، اما مرورگر نتوانست انتخاب شما را ذخیره کند.
App and engine updates|به‌روزرسانی برنامه و موتور
Check for updates|بررسی به‌روزرسانی
Agent activity|فعالیت عامل
Activity workspace|فضای بررسی فعالیت‌ها
Instructions Studio|کارگاه دستورالعمل‌ها
Ready|آماده
ChatGPT companion|همراه ChatGPT
Normal Chat|گفت‌وگوی معمولی
Official usage dashboard|داشبورد رسمی مصرف
Theme|رنگ‌بندی
Workspace atmosphere|فضای پس‌زمینه
Orbit Drift|حرکت مداری
Ready for key|آمادهٔ دریافت کلید
Paid API target|هدف هزینهٔ API
Conversation voice|صدای مکالمه
Turn-by-turn · Ready|نوبت‌به‌نوبت · آماده
Approval policy|سیاست اجازه‌ها
Ask before action|پیش از اقدام اجازه بگیر
Private backups · PC only|پشتیبان خصوصی · فقط روی رایانه
Verified history snapshots|نسخهٔ بررسی‌شده از تاریخچه
Commands|فرمان‌ها
Loading…|در حال بارگذاری…
Archived sessions|گفت‌وگوهای بایگانی‌شده
Privacy, honestly:|دربارهٔ حریم خصوصی، صادقانه:
Back up now|پشتیبان‌گیری اکنون
Check backup status|بررسی وضعیت پشتیبان
Close|بستن
Open advanced settings|تنظیمات پیشرفته
Workspace atmospheres / 01—09|پس‌زمینه‌های فضای کار / ۰۱—۰۹
Somewhere worth returning to.|جایی که بازگشت به آن دل‌چسب است.
Your current world|دنیای فعلی شما
Explore full scene ↗|دیدن صحنهٔ کامل ↗
Pause motion|توقف حرکت
Resume motion|ادامهٔ حرکت
Next world →|دنیای بعدی ←
This scene|این صحنه
Color story|رنگ‌های صحنه
Follow day / night|هماهنگ با روز و شب
Nocturne · cool midnight|نوکتورن · نیمه‌شب خنک
Ember · warm dusk|اخگر · غروب گرم
Sakura · violet evening|ساکورا · شامگاه بنفش
Weather|آب‌وهوا
Clear|صاف
Rain|باران
Snow|برف
Mist|مه
Weather strength|شدت آب‌وهوا
World activity|جنب‌وجوش صحنه
Ambient glow|درخشش محیط
Signature scene details|جزئیات ویژهٔ صحنه
Reset this scene|بازنشانی این صحنه
Workspace comfort|آسایش فضای کار
Home visibility|نمایانی در صفحهٔ اصلی
Conversation visibility|نمایانی پشت گفت‌وگو
Animate during conversations|حرکت پس‌زمینه هنگام گفت‌وگو
Enable conversation animation|فعال کردن حرکت هنگام گفت‌وگو
Frame-rate limit|حداکثر نرخ تصویر
15 fps · economical|۱۵ فریم در ثانیه · کم‌مصرف
30 fps · balanced|۳۰ فریم در ثانیه · متعادل
60 fps · smooth|۶۰ فریم در ثانیه · روان
Automatic rotation|تعویض خودکار
Rotate through all nine worlds|گردش بین هر نُه دنیا
Change scene every|تعویض صحنه هر
1 minute|۱ دقیقه
5 minutes|۵ دقیقه
10 minutes|۱۰ دقیقه
15 minutes|۱۵ دقیقه
30 minutes|۳۰ دقیقه
1 hour|۱ ساعت
Shuffle without immediate repeats|ترتیب تصادفی، بدون تکرار پشت‌سرهم
Local rendering|نمایش محلی
Local art · no audio capture · no AI calls|تصویرسازی محلی · بدون ضبط صدا · بدون درخواست هوش مصنوعی
Scene preview|پیش‌نمایش صحنه
Show hotspots|نمایش نقاط تعاملی
Hide hotspots|پنهان کردن نقاط تعاملی
Pause|توقف
Resume|ادامه
Conversation archive|بایگانی گفت‌وگوها
Model connections|اتصال مدل‌ها
Provider|ارائه‌دهنده
API key|کلید API
More providers|ارائه‌دهندگان بیشتر
Connect|اتصال
Permission control|کنترل اجازه‌ها
Ask for approval|دریافت اجازه
Recommended|پیشنهادی
Always ask|همیشه اجازه بگیر
Trusted project|پروژهٔ مورد اعتماد
Save policy|ذخیرهٔ سیاست
Companion space|فضای همراه
Conversation space|فضای گفت‌وگو
Uses normal ChatGPT chat allowance|از سهمیهٔ عادی گفت‌وگوی ChatGPT استفاده می‌کند
Agent workspace|فضای کار عامل
Uses agent / Codex allowance|از سهمیهٔ عامل / Codex استفاده می‌کند
Why it opens separately:|چرا جداگانه باز می‌شود؟
Not now|فعلاً نه
Open ChatGPT Chat|باز کردن گفت‌وگوی ChatGPT
Instruction control|مدیریت دستورالعمل‌ها
All changes saved|همهٔ تغییرها ذخیره شد
Persona|شخصیت دستیار
Identity and address|هویت و شیوهٔ خطاب
General|عمومی
Rules for everything|قوانین مشترک
Current workspace only|فقط فضای کار فعلی
Agent roles|نقش عامل‌ها
Build and Plan|اجرا و برنامه‌ریزی
Reusable expertise|دانش قابل‌استفادهٔ دوباره
Active stack|دستورالعمل‌های فعال
What applies next|آنچه در درخواست بعدی اعمال می‌شود
Global identity|هویت عمومی
Persona instructions|دستورالعمل شخصیت
Stored securely in OpenCode|ذخیره‌شده در OpenCode
Restore recommended|بازگردانی نسخهٔ پیشنهادی
Undo last save|برگرداندن آخرین ذخیره
Save persona|ذخیرهٔ شخصیت
Global behavior|رفتار عمومی
General instructions|دستورالعمل‌های عمومی
Combined automatically with the persona|خودکار با دستورالعمل شخصیت ترکیب می‌شود
Save general rules|ذخیرهٔ قوانین عمومی
Current workspace|فضای کار فعلی
Project instructions|دستورالعمل‌های پروژه
Select a project to edit its instructions.|برای ویرایش دستورالعمل‌ها، پروژه‌ای انتخاب کنید.
Travels with the project|همراه پروژه نگه داشته می‌شود
Start with a template|شروع با الگو
Save project rules|ذخیرهٔ قوانین پروژه
Working modes|حالت‌های کار
Agent-role instructions|دستورالعمل نقش عامل‌ها
Permissions remain protected|اجازه‌ها همچنان مستقل و محفوظ‌اند
Implementation and verification|اجرا و بررسی نتیجه
Undo|برگرداندن
Save Build|ذخیرهٔ حالت اجرا
Read-only analysis and strategy|بررسی و برنامه‌ریزی، بدون تغییر فایل
Save Plan|ذخیرهٔ حالت برنامه‌ریزی
Install from link|نصب از پیوند
+ New skill|+ مهارت جدید
Available skills|مهارت‌های موجود
No skills yet.|هنوز مهارتی وجود ندارد.
Bring a trusted skill into Seneschal|افزودن یک مهارت معتبر به Seneschal
Inspect|بررسی
Skill ID|شناسهٔ مهارت
Scope|محدوده
Every project|همهٔ پروژه‌ها
Current project|پروژهٔ فعلی
Skill instructions|دستورالعمل مهارت
Archive skill|بایگانی مهارت
Save skill|ذخیرهٔ مهارت
Effective context|دستورالعمل‌های مؤثر
Active instruction stack|مجموعهٔ دستورالعمل‌های فعال
Delete conversation|حذف گفت‌وگو
Delete this conversation?|این گفت‌وگو حذف شود؟
This conversation|این گفت‌وگو
Keep conversation|نگه داشتن گفت‌وگو
Delete permanently|حذف همیشگی
Delete message|حذف پیام
Delete this message?|این پیام حذف شود؟
This message|این پیام
Keep message|نگه داشتن پیام
Delete from Seneschal|حذف از Seneschal
Remove project|برداشتن پروژه از فهرست
Remove this project?|پروژه از فهرست برداشته شود؟
This project|این پروژه
Keep project|نگه داشتن پروژه
Edit message|ویرایش پیام
Revise and retry|ویرایش و اجرای دوباره
Your message|پیام شما
Save and retry|ذخیره و اجرای دوباره
Inspect a page|بررسی صفحه
Website address|نشانی وب‌سایت
What should it do?|چه کاری انجام دهد؟
Isolated session|نشست جداگانه
No saved browser profile|بدون نمایهٔ ذخیره‌شدهٔ مرورگر
Run browser task|شروع کار مرورگر
Multi-agent workflow|گردش کار چندعامل
Project objective|هدف پروژه
Parallel agents|عامل‌های هم‌زمان
Import session|افزودن گفت‌وگوی موجود
Starter team|تیم اولیه
Add agent|افزودن عامل
Run board|اجرای تابلو
Pause queue|توقف صف
Read the selected plan|خواندن برنامهٔ انتخاب‌شده
Send one plan|ارسال یک برنامه
Review the generated team|بررسی تیم پیشنهادی
Run and supervise|اجرا و نظارت
No agents yet.|هنوز عاملی وجود ندارد.
Reset board|بازنشانی تابلو
Stop running agents|توقف عامل‌های در حال کار
Saved workflows|گردش کارهای ذخیره‌شده
No saved boards yet.|هنوز تابلویی ذخیره نشده.
Board agent|عامل تابلو
Add an agent|افزودن عامل
Name|نام
Role|نقش
Planner|برنامه‌ریز
Builder|اجراکننده
Reviewer|بازبین
Supervisor|ناظر
Model|مدل
System access|دسترسی به سیستم
Conversation only|فقط گفت‌وگو
Read project|خواندن پروژه
Read + browser research|خواندن پروژه و پژوهش در مرورگر
Build and run tools|اجرا و استفاده از ابزارها
Wait for these agents|منتظر این عامل‌ها بمان
No other agents yet.|هنوز عامل دیگری وجود ندارد.
Task|وظیفه
Save agent|ذخیرهٔ عامل
Local editor bridge|اتصال ویرایشگر محلی
Open in Visual Studio Code|باز کردن در Visual Studio Code
File path (optional)|مسیر فایل (اختیاری)
Line|خط
Column|ستون
Install companion|نصب افزونهٔ همراه
Open project|باز کردن پروژه
Open file|باز کردن فایل
↑↓ Navigate|↑↓ جابه‌جایی
Enter Select|Enter انتخاب
Live connection|اتصال زنده
Protocol log|گزارش اتصال
Retry loading Seneschal|تلاش دوباره برای بارگذاری Seneschal
Layout|چیدمان
Front|روبه‌رو
Start Talk|شروع مکالمه
Stop Talk|پایان مکالمه
Move Seneschal|جابه‌جایی Seneschal
Smaller|کوچک‌تر
Larger|بزرگ‌تر
Dock at bottom right|قرار دادن پایین سمت راست
Front view|نمای روبه‌رو
Reset layout|بازنشانی چیدمان
Interface|رابط کاربری
Allow once|فقط این بار
Always|همیشه
Reject|رد درخواست
Check status|بررسی وضعیت
Permission required|نیاز به اجازه
OpenCode action|اقدام OpenCode
Review this action before it can continue.|پیش از ادامه، این اقدام را بررسی کنید.
Choose a decision. No action is approved automatically.|یک گزینه انتخاب کنید. هیچ اقدامی خودکار تأیید نمی‌شود.
Pending question|پرسش در انتظار پاسخ
Answer question|پاسخ به پرسش
Refresh questions|تازه‌سازی پرسش‌ها
Seneschal needs your answer|Seneschal به پاسخ شما نیاز دارد
Dismiss question|رد درخواست پرسش
Send answers|ارسال پاسخ‌ها
Sending…|در حال ارسال…
Select one or more answers.|یک یا چند پاسخ انتخاب کنید.
Choose one answer.|یک پاسخ انتخاب کنید.
Or write your own answer|یا پاسخ خودتان را بنویسید
Your answer|پاسخ شما
You|شما
Actions|کارهای پیام
To board|به تابلو
Pin|سنجاق کردن
Unpin|برداشتن سنجاق
Archive|بایگانی
Delete|حذف
Edit|ویرایش
Retry|تلاش دوباره
Copy|کپی
Copied|کپی شد
Copied!|کپی شد!
Model thinking summary|خلاصهٔ بررسی مدل
Completed|انجام‌شده
Running|در حال اجرا
Pending|در انتظار
Error|خطا
Failed|ناموفق
Stopped|متوقف
Busy|مشغول
Offline|قطع
Online|متصل
Live|فعال
Unavailable|در دسترس نیست
Listening|در حال شنیدن
Speaking|در حال صحبت
Thinking…|در حال بررسی…
Loading|در حال بارگذاری
Search|جست‌وجو
Previous|قبلی
Next|بعدی
Save|ذخیره
Saving…|در حال ذخیره…
Refresh|تازه‌سازی
Disconnect|قطع اتصال
English|English
`);
  register(`
Changes buttons and help on this browser only. Conversations, code, voice and model settings stay unchanged.|فقط دکمه‌ها و راهنمای همین مرورگر تغییر می‌کند. گفت‌وگوها، کد، صدا و تنظیمات مدل دست‌نخورده می‌مانند.
Reload data without restarting or stopping tasks.|اطلاعات را بدون راه‌اندازی دوباره یا توقف کارها تازه کنید.
Choose a project and begin a conversation. Local tools follow your approval policy; selected context is sent only to the cloud model you choose.|پروژه‌ای انتخاب کنید و گفت‌وگو را شروع کنید. ابزارهای محلی تابع سیاست اجازه‌های شما هستند؛ اطلاعات انتخابی برای مدل ابری منتخب شما ارسال می‌شود.
The chat model and its billing stay unchanged. NVIDIA Talk uses English, up to 20 seconds per turn. Long spoken replies are shortened; full text stays in chat.|مدل گفت‌وگو و هزینهٔ آن تغییر نمی‌کند. مکالمهٔ NVIDIA انگلیسی است و هر نوبت حداکثر ۲۰ ثانیه است. پاسخ صوتی بلند کوتاه می‌شود؛ متن کامل در گفت‌وگو می‌ماند.
Browser voice is separate from NVIDIA speech. Choose your voice service above.|صدای مرورگر از سرویس گفتار NVIDIA جداست. سرویس صدا را از بالا انتخاب کنید.
NVIDIA receives microphone audio and reply text for speech. Trial inputs and outputs may be logged; avoid sensitive content. Free access has limits and is not guaranteed unlimited. No paid fallback is used.|NVIDIA صدای میکروفون و متن پاسخ را برای پردازش گفتار دریافت می‌کند. ورودی و خروجی نسخهٔ آزمایشی ممکن است ثبت شود؛ اطلاعات حساس نفرستید. دسترسی رایگان محدود است و همیشگی یا نامحدود تضمین نمی‌شود. سرویس پولی جایگزین خودکار نمی‌شود.
I agree to send audio and reply text to NVIDIA for this developer trial.|با ارسال صدا و متن پاسخ به NVIDIA برای این آزمایش توسعه‌دهندگان موافقم.
Dictation stays in your draft. Talk sends your spoken turns automatically. If dictation is unavailable, Mic records an audio attachment.|متن دیکته در پیش‌نویس می‌ماند. حالت مکالمه گفتار شما را خودکار ارسال می‌کند. اگر دیکته در دسترس نباشد، میکروفون فایل صوتی پیوست می‌کند.
Your Seneschal mascot animates locally, with its own chest badge. NVIDIA mouth movement reacts to playback volume; browser-voice mouth movement is approximate, not phoneme-accurate lip sync.|شخصیت Seneschal با نشان روی سینه، به‌صورت محلی حرکت می‌کند. حرکت دهان با NVIDIA از بلندی صدا پیروی می‌کند؛ با صدای مرورگر تقریبی است و لب‌خوانی دقیق نیست.
Checking the isolated Brave bridge|بررسی اتصال جداگانهٔ Brave
Organize this conversation under another project. History, pins, and the selected model stay with it. Its working folder and files do not move.|این گفت‌وگو را زیر پروژهٔ دیگری قرار دهید. تاریخچه، سنجاق‌ها و مدل انتخابی حفظ می‌شوند. پوشهٔ کاری و فایل‌ها جابه‌جا نمی‌شوند.
. To work in the destination folder, start a new session there.|. برای کار در پوشهٔ مقصد، گفت‌وگوی تازه‌ای در آن شروع کنید.
Enter a Windows or WSL folder path. OpenCode will work inside that project and keep permissions scoped to it.|مسیر پوشه‌ای در Windows یا WSL را وارد کنید. OpenCode در همان پروژه کار می‌کند و اجازه‌ها را به محدودهٔ آن محدود نگه می‌دارد.
This changes only the name shown in Seneschal. The folder, files, sessions, and tool paths remain unchanged.|فقط نام نمایشی در Seneschal تغییر می‌کند. پوشه، فایل‌ها، گفت‌وگوها و مسیر ابزارها تغییری نمی‌کنند.
Check and update Seneschal and OpenCode separately|بررسی و به‌روزرسانی جداگانهٔ Seneschal و OpenCode
History, tool activity, usage, and local service|تاریخچه، کار ابزارها، مصرف و سرویس محلی
Persona, rules, agent roles, and skills|شخصیت، قوانین، نقش عامل‌ها و مهارت‌ها
Separate ChatGPT allowance · opens securely|سهمیهٔ جداگانهٔ ChatGPT · باز شدن امن
Check remaining 5-hour and weekly Work/Codex allowance|بررسی سهمیهٔ باقی‌ماندهٔ پنج‌ساعته و هفتگی Work/Codex
Open the complete OpenCode controls|باز کردن همهٔ تنظیمات OpenCode
Switch between the day and night palettes|جابه‌جایی بین رنگ‌بندی روز و شب
Nine pixel worlds, including the restored Citylight|نُه دنیای پیکسلی، از جمله Citylight بازسازی‌شده
Connect Zen, Gemini, DeepSeek, and other model providers|اتصال Zen، Gemini، DeepSeek و دیگر ارائه‌دهندگان مدل
Open a browser task|شروع یک کار در مرورگر
Coordinate specialist sessions and handoffs|هماهنگی گفت‌وگوها و تحویل کار بین عامل‌های تخصصی
Open the current project or a file and line|باز کردن پروژهٔ فعلی یا رفتن به فایل و خط
Open Blender with the local bridge|باز کردن Blender با اتصال محلی
Connect or manage the provider key|اتصال یا مدیریت کلید ارائه‌دهنده
Review providers and set provider-side limits|بررسی ارائه‌دهندگان و تعیین سقف هزینه در حساب آن‌ها
Start or stop spoken conversation mode|شروع یا پایان مکالمهٔ صوتی
Review Plan and Build permissions|بررسی اجازه‌های برنامه‌ریزی و اجرا
Weekly when Seneschal launches, or back up now. Private content—not a shareable export.|هفتگی هنگام اجرای Seneschal، یا همین حالا پشتیبان بگیرید. محتوای خصوصی است؛ برای اشتراک‌گذاری عمومی نیست.
Browse OpenCode commands, skills, and session references|مرور فرمان‌ها، مهارت‌ها و ارجاع‌های گفت‌وگوی OpenCode
Review and restore conversations hidden from the sidebar|بررسی و بازگردانی گفت‌وگوهای پنهان‌شده از نوار کناری
this interface runs locally, but your selected cloud model receives prompts and any file, browser, or Blender context needed for the task. Provider sign-in and API keys stay in OpenCode.|این رابط محلی اجرا می‌شود، اما مدل ابری انتخابی شما درخواست‌ها و اطلاعات موردنیاز از فایل، مرورگر یا Blender را دریافت می‌کند. اطلاعات ورود ارائه‌دهنده و کلیدهای API در OpenCode می‌مانند.
Backups include private conversation text. Sign-in stores and pairing tokens are excluded. Projects and browser-only preferences need separate backups.|پشتیبان شامل متن خصوصی گفت‌وگوهاست؛ اطلاعات ورود و توکن‌های اتصال در آن نیست. پروژه‌ها و تنظیمات مخصوص مرورگر، پشتیبان جداگانه می‌خواهند.
Four living Seneschal originals. Five worlds from Afterlight. These gallery images are still thumbnails: explore a full scene to see its motion and six interactions. Changes save automatically in this browser.|چهار صحنهٔ زندهٔ Seneschal و پنج دنیا از Afterlight. تصاویر گالری ثابت‌اند؛ صحنهٔ کامل را باز کنید تا حرکت و شش تعامل آن را ببینید. تغییرها خودکار در همین مرورگر ذخیره می‌شوند.
Conversations use a still frame by default. Home and full-scene previews animate unless motion is paused or system Reduced motion is on.|پشت گفت‌وگو به‌صورت پیش‌فرض ثابت است. صفحهٔ اصلی و پیش‌نمایش کامل متحرک‌اند، مگر اینکه حرکت را متوقف کنید یا کاهش حرکت سیستم روشن باشد.
Rotation waits while hidden, paused, previewing or in a quiet conversation. No catch-up jumps when you return.|وقتی صفحه پنهان، حرکت متوقف، پیش‌نمایش باز یا گفت‌وگو ثابت است، تعویض صحنه منتظر می‌ماند. با بازگشت شما صحنه‌ها ناگهانی جلو نمی‌پرند.
Live animation · click a detail or press 1–6 · Esc to return|صحنهٔ زنده · کلیک روی جزئیات یا کلیدهای ۱ تا ۶ · Esc برای بازگشت
Explore the details, or use the six action buttons below.|جزئیات را امتحان کنید یا از شش دکمهٔ تعاملی پایین استفاده کنید.
Six actions · use the buttons, numbered keys, or scene hotspots.|شش تعامل · با دکمه‌ها، کلیدهای عددی یا نقاط مشخص‌شدهٔ صحنه
Archiving hides a session locally without deleting its OpenCode conversation. Restore any session to return it to the sidebar.|بایگانی، گفت‌وگو را فقط در این رابط پنهان می‌کند و آن را از OpenCode حذف نمی‌کند. با بازگردانی، دوباره در نوار کناری دیده می‌شود.
Connect a provider directly. Your key is sent only to the local OpenCode engine and is never saved by this page.|مستقیم به ارائه‌دهنده متصل شوید. کلید شما فقط به موتور محلی OpenCode فرستاده می‌شود و این صفحه آن را ذخیره نمی‌کند.
Choose how much freedom Build mode receives. Plan mode always remains read-only.|آزادی عمل حالت اجرا را انتخاب کنید. حالت برنامه‌ریزی همیشه فقط‌خواندنی می‌ماند.
Safe reads run automatically; edits, commands, browser, Blender, and external actions ask first.|خواندن امن خودکار انجام می‌شود؛ ویرایش، فرمان‌ها، مرورگر، Blender و اقدامات خارجی ابتدا اجازه می‌خواهند.
Also asks before reading files. Safest, but produces many interruptions.|پیش از خواندن فایل هم اجازه می‌گیرد. محتاطانه‌ترین حالت است، ولی وقفه‌های بیشتری دارد.
Build may edit files and run commands without asking. External, browser, and Blender actions still ask.|حالت اجرا می‌تواند بدون پرسش فایل ویرایش کند و فرمان اجرا کند. اقدامات خارجی، مرورگر و Blender همچنان اجازه می‌خواهند.
“Allow once”, “Always”, and “Reject” still appear whenever an individual approval is requested.|هر بار که اقدامی نیاز به اجازه داشته باشد، «فقط این بار»، «همیشه» و «رد درخواست» نمایش داده می‌شود.
Use your normal ChatGPT experience alongside Seneschal, without mixing their limits or permissions.|از ChatGPT معمولی کنار Seneschal استفاده کنید، بدون مخلوط شدن سهمیه‌ها یا اجازه‌های آن‌ها.
General chat, creativity, images, and the features available on your ChatGPT account.|گفت‌وگوی عمومی، خلاقیت، تصویر و امکانات حساب ChatGPT شما
Projects, files, browser tasks, Blender, skills, and permission-controlled actions.|پروژه‌ها، فایل‌ها، کارهای مرورگر، Blender، مهارت‌ها و اقدامات نیازمند اجازه
ChatGPT account sessions are not a reusable API. Opening the official ChatGPT surface protects your login and keeps the allowance distinction honest.|نشست حساب ChatGPT یک API قابل‌استفادهٔ مجدد نیست. باز کردن رابط رسمی، ورود شما را محفوظ نگه می‌دارد و سهمیه‌ها را جدا نگه می‌دارد.
Edit what Seneschal knows about you, this project, and each working mode.|دانسته‌های Seneschal دربارهٔ خودتان، این پروژه و هر حالت کاری را ویرایش کنید.
Changes stay local and are backed up before every save.|تغییرها محلی می‌مانند و پیش از هر ذخیره از آن‌ها پشتیبان گرفته می‌شود.
How Seneschal identifies itself and addresses you in every project.|اینکه Seneschal در همهٔ پروژه‌ها خود را چگونه معرفی کند و شما را چگونه خطاب کند
Rules that apply to every conversation, model, and project.|قوانینی که برای همهٔ گفت‌وگوها، مدل‌ها و پروژه‌ها اعمال می‌شوند
Architecture, goals, conventions, and boundaries for only the selected project.|ساختار، هدف‌ها، قراردادها و محدودیت‌های مخصوص پروژهٔ انتخاب‌شده
Extra system guidance applied privately when you choose Build or Plan.|راهنمای اضافی سیستم که در حالت اجرا یا برنامه‌ریزی اعمال می‌شود
These notes cannot grant tools or bypass permissions. The permission inspector remains authoritative.|این یادداشت‌ها نمی‌توانند ابزار مجاز کنند یا اجازه‌ها را دور بزنند. تنظیمات بخش اجازه‌ها تعیین‌کننده است.
Create expertise once, then activate one or several skills for upcoming requests.|دانش تخصصی را یک‌بار بنویسید و یک یا چند مهارت را برای درخواست‌های بعدی فعال کنید.
Paste a GitHub repository, SKILL.md link, or skill folder. We inspect it first; nothing is installed until you approve it.|پیوند مخزن GitHub، فایل SKILL.md یا پوشهٔ مهارت را وارد کنید. ابتدا بررسی می‌شود؛ تا تأیید نکنید چیزی نصب نمی‌شود.
Checked skills are requested automatically. The model loads their full instructions only when needed.|مهارت‌های علامت‌خورده خودکار درخواست می‌شوند. مدل فقط در صورت نیاز متن کامل دستورالعمل آن‌ها را می‌خواند.
A readable preview of what influences the next request.|پیش‌نمایش خوانای دستورالعمل‌هایی که بر درخواست بعدی اثر دارند
and its message history will be permanently removed. Project files created by the agent will not be deleted.|و تاریخچهٔ پیام‌هایش برای همیشه حذف می‌شود. فایل‌های پروژه که عامل ساخته، حذف نمی‌شوند.
will disappear permanently from Seneschal on this device. OpenCode does not provide safe single-message deletion, so its source transcript remains unchanged.|برای همیشه از Seneschal در این دستگاه برداشته می‌شود. چون OpenCode حذف امن تک‌پیام ندارد، رونوشت اصلی آن تغییر نمی‌کند.
will be removed from Seneschal’s sidebar. Its folder, files, and OpenCode sessions will not be deleted.|از نوار کناری Seneschal برداشته می‌شود. پوشه، فایل‌ها و گفت‌وگوهای OpenCode حذف نمی‌شوند.
This returns the conversation to this message, removes later responses from the active branch, and runs your corrected request.|گفت‌وگو به این پیام برمی‌گردد، پاسخ‌های بعدی از شاخهٔ فعال کنار می‌روند و درخواست اصلاح‌شده اجرا می‌شود.
The agent can navigate, click, type, inspect page structure, and take screenshots. Browser actions still follow your approval policy.|عامل می‌تواند صفحه باز کند، کلیک و تایپ کند، ساختار صفحه را بررسی کند و تصویر بگیرد. اقدامات مرورگر تابع سیاست اجازه‌های شما هستند.
Inspect the page, test the main interactions, and report any visible problems. Take a screenshot if it helps.|صفحه را بررسی کن، تعامل‌های اصلی را آزمایش کن و مشکل‌های قابل‌مشاهده را گزارش بده. در صورت نیاز تصویر بگیر.
Independent OpenCode sessions share verified handoffs through explicit dependencies.|گفت‌وگوهای مستقل OpenCode، با وابستگی‌های مشخص کار را به هم تحویل می‌دهند.
Each card is a real session. Models and access are chosen per agent. You see provider-supplied summaries and tool activity—not private chain-of-thought.|هر کارت یک گفت‌وگوی واقعی است. مدل و دسترسی هر عامل جدا انتخاب می‌شود. خلاصه‌های ارائه‌شده و کار ابزارها را می‌بینید، نه زنجیرهٔ فکری خصوصی مدل.
Use “To board” on a planning response. Seneschal reads only that chosen message.|روی پاسخ برنامه‌ریزی «به تابلو» را انتخاب کنید. Seneschal فقط همان پیام انتخاب‌شده را می‌خواند.
An architect proposes the roles, tasks, models, access, dependencies, and parallel work.|عامل طراح، نقش‌ها، وظایف، مدل‌ها، دسترسی‌ها، وابستگی‌ها و کارهای هم‌زمان را پیشنهاد می‌کند.
Agents exchange visible requests. The Supervisor can return weak work for another pass.|درخواست‌های ردوبدل‌شده بین عامل‌ها قابل‌دیدن‌اند. ناظر می‌تواند کار ضعیف را برای بازبینی دوباره برگرداند.
Boards are separate from ordinary sessions. Open a saved board exactly as it was—no plan is resent and the Board Architect does not redesign it.|تابلوها از گفت‌وگوهای معمولی جدا هستند. تابلوی ذخیره‌شده همان‌طور که بوده باز می‌شود؛ برنامه دوباره فرستاده یا طراحی نمی‌شود.
All selected agents must finish before this one starts.|همهٔ عامل‌های انتخاب‌شده باید تمام شوند تا این عامل شروع کند.
Open the current WSL project, or jump directly to a file and line. Install the optional companion to add a Seneschal button inside VS Code for opening this project or choosing its session.|پروژهٔ WSL فعلی را باز کنید یا مستقیم به فایل و خط بروید. افزونهٔ اختیاری، دکمهٔ Seneschal را برای باز کردن پروژه یا انتخاب گفت‌وگو به VS Code اضافه می‌کند.
Drag the character to rotate. Drag its header to move.|برای چرخاندن دوربین، شخصیت را بکشید. برای جابه‌جایی کارت، نوار بالای آن را بکشید.
`);
  register(`
Quick navigation|دسترسی سریع
Agent context shortcuts|میان‌برهای وضعیت عامل
Show projects|نمایش پروژه‌ها
Show sessions|نمایش گفت‌وگوها
Show permissions|نمایش مجوزها
Show active tools|نمایش ابزارهای در دسترس
Show providers|نمایش سرویس‌دهندگان
Show workspace pulse|نمایش فعالیت فضای کار
No waiting approvals|هیچ درخواست اجازه‌ای منتظر نیست
`);
  const helpFa = {
    compactProjects: 'پوشه‌های پروژه را در نوار کناری نشان دهید. این کار هیچ فایلی را باز، جابه‌جا یا حذف نمی‌کند.',
    compactSessions: 'گفت‌وگوهای ذخیره‌شدهٔ پروژهٔ فعلی را نشان دهید. چیزی ارسال یا دوباره اجرا نمی‌شود.',
    compactPermissions: 'تنظیمات مجوزها را نشان دهید. نشان کهربایی یعنی تصمیمی منتظر است؛ این دکمه هیچ اقدامی را تأیید نمی‌کند.',
    compactTools: 'ابزارهای در دسترس این عامل را ببینید. باز کردن این بخش ابزاری را اجرا یا مجوزی صادر نمی‌کند.',
    compactProviders: 'اتصال سرویس‌دهندگان مدل را ببینید. باز کردن این بخش حسابی متصل یا پرداختی فعال نمی‌کند.',
    compactPulse: 'فعالیت اخیر فضای کار را ببینید. این بخش اعتبار باقی‌مانده یا هزینه را نشان نمی‌دهد.',
    homeButton: 'به صفحهٔ اصلی فضای کار برگردید. در صفحهٔ کوچک، نوار کناری پروژه‌ها را باز یا بسته کنید.',
    interfaceLanguage: 'زبان دکمه‌ها، تنظیمات و راهنما را در این مرورگر انتخاب کنید. گفت‌وگوها ترجمه نمی‌شوند و مدل یا صدا تغییر نمی‌کند.',
    modelPickerButton: 'مدل هوش مصنوعی درخواست بعدی را انتخاب کنید. دسترسی، سهمیه و هزینه به ارائه‌دهندهٔ آن بستگی دارد.',
    modelSearchInput: 'با نوشتن بخشی از نام مدل یا ارائه‌دهنده آن را پیدا کنید. این جست‌وجو پیام ارسال نمی‌کند.',
    commandButton: 'گفت‌وگوها، مدل‌ها و کارهای فضای کار را یک‌جا پیدا کنید. میان‌بر باز کردن آن Ctrl K است.',
    refreshButton: 'اطلاعات فضای کار را تازه کنید، بدون راه‌اندازی دوبارهٔ Seneschal یا توقف کارها.',
    themeSwitch: 'رنگ رابط را بین روز و شب عوض کنید. تصویر پس‌زمینه جداگانه انتخاب می‌شود.',
    settingsButton: 'تنظیمات برنامه، اتصال‌ها، اجازه‌ها، به‌روزرسانی‌ها و ابزارهای فضای کار را باز کنید.',
    newSessionButton: 'گفت‌وگوی جداگانه‌ای در پروژهٔ انتخاب‌شده شروع کنید. گفت‌وگوهای دیگر محفوظ می‌مانند.',
    leftPanelToggle: 'نوار پروژه‌ها را جمع یا باز کنید تا جا برای گفت‌وگو بیشتر شود. چیزی حذف نمی‌شود.',
    rightPanelToggle: 'نوار وضعیت عامل، شامل شخصیت، ابزارها و اجازه‌ها را جمع یا باز کنید.',
    addProjectButton: 'پوشهٔ کاری را به Seneschal اضافه کنید. دستیار برای کارهای آن پروژه از همین پوشه استفاده می‌کند.',
    projectPathInput: 'پوشه‌ای را وارد کنید که دستیار باید در آن کار کند. افزودن پروژه، فایل‌ها را کپی یا جابه‌جا نمی‌کند.',
    projectNameInput: 'نام نمایشی پروژه در Seneschal را تغییر دهید. نام واقعی پوشه عوض نمی‌شود.',
    projectsCollapseButton: 'فهرست پروژه‌ها را جمع یا باز کنید. پوشه‌ای حذف نمی‌شود.',
    sessionsCollapseButton: 'فهرست گفت‌وگوها را جمع یا باز کنید. گفت‌وگوهای ذخیره‌شده حفظ می‌شوند.',
    pinnedSessionsCollapseButton: 'گفت‌وگوهای سنجاق‌شده را جمع یا باز کنید.',
    pinnedMessagesCollapseButton: 'پیام‌های سنجاق‌شدهٔ بالای این گفت‌وگو را جمع یا باز کنید.',
    archivedSessionsButton: 'گفت‌وگوهای پنهان‌شده از فهرست عادی را پیدا و در صورت نیاز بازگردانی کنید.',
    archivedMessagesButton: 'پیام‌های بایگانی‌شدهٔ این گفت‌وگو را ببینید. بایگانی با حذف فرق دارد.',
    motionSwitch: 'پس‌زمینه را انتخاب و پیش‌نمایش کنید و حرکت یا روشنایی آن را تنظیم کنید. تصویرسازی محلی است.',
    activityRailButton: 'گفت‌وگوهای ثبت‌شده، کار ابزارها و برآورد مصرف را ببینید. تاریخچه از رایانه خوانده می‌شود.',
    workspaceToolsButton: 'ابزارهای بیشتر مانند تابلوی عامل‌ها، دستورالعمل‌ها و رابط اصلی موتور را باز کنید.',
    agentBoardButton: 'با چند عامل تخصصی کار را برنامه‌ریزی کنید. پیش از اجرا، وظایف و دسترسی آن‌ها را بررسی کنید.',
    agentBoardHistoryRailButton: 'تابلوی ذخیره‌شده را دوباره باز کنید، بدون اجرای خودکار عامل‌ها یا ارسال دوبارهٔ برنامه.',
    instructionsRailButton: 'سبک دستیار، قوانین پروژه، نقش عامل‌ها و مهارت‌ها را مدیریت کنید. این‌ها نمی‌توانند اجازه‌ها را دور بزنند.',
    chatGPTRailButton: 'یک گفت‌وگوی جداگانهٔ ChatGPT باز کنید. اجازه‌های Seneschal یا متن این گفت‌وگو خودکار به آن منتقل نمی‌شود.',
    openChatGPTUsageButton: 'صفحهٔ رسمی مصرف حساب را برای بررسی سهمیه باز کنید. این سهمیه از هزینهٔ API ارائه‌دهنده جداست.',
    classicButton: 'رابط کامل OpenCode را برای تنظیمات پیشرفتهٔ موتور و ارائه‌دهندگان باز کنید.',
    renameSessionButton: 'برای پیدا کردن آسان‌تر، نام گفت‌وگو را عوض کنید. پیام‌ها و فایل‌های پروژه حفظ می‌شوند.',
    moveSessionButton: 'گفت‌وگو را زیر پروژهٔ دیگری قرار دهید. پوشهٔ کاری و فایل‌های موجود جابه‌جا نمی‌شوند.',
    exportSessionButton: 'نسخه‌ای از گفت‌وگو ذخیره کنید. پیش از اشتراک‌گذاری بررسی کنید؛ ممکن است پیام و خروجی خصوصی داشته باشد.',
    sendSessionToBoardButton: 'از این گفت‌وگو برای برنامه‌ریزی تابلوی عامل‌ها استفاده کنید. پیش از اجرا تیم پیشنهادی را بررسی کنید.',
    openSessionVsCodeButton: 'پروژهٔ فعلی را در Visual Studio Code روی رایانه باز کنید.',
    abortButton: 'از موتور بخواهید کار فعلی را متوقف کند. کارهای انجام‌شده خودکار برگردانده نمی‌شوند.',
    deleteSessionButton: 'تأیید حذف این گفت‌وگو را بررسی کنید. فایل‌های پروژه حذف نمی‌شوند.',
    confirmDeleteSessionButton: 'این گفت‌وگو و تاریخچهٔ پیام‌هایش را برای همیشه حذف کنید. فایل‌های پروژه حذف نمی‌شوند.',
    confirmDeleteMessageButton: 'پیام را از نمای Seneschal در این دستگاه بردارید. رونوشت اصلی موتور تغییر نمی‌کند.',
    confirmDeleteProjectButton: 'پروژه را از نوار Seneschal بردارید. پوشه، فایل‌ها و گفت‌وگوهای موتور باقی می‌مانند.',
    resumeFollowButton: 'به تازه‌ترین پیام بروید. چیزی ارسال نمی‌شود و کار از نو شروع نمی‌شود.',
    exitMessageMaximizeButton: 'از نمای بزرگ پیام به چیدمان معمولی فضای کار برگردید.',
    composerMinimizeButton: 'کادر پیام را جمع یا باز کنید. پیش‌نویس ارسال‌نشده حفظ می‌شود.',
    composerSizeButton: 'برای نوشتن جای بیشتری باز کنید یا کادر پیام را به اندازهٔ جمع‌وجور برگردانید.',
    promptInput: 'درخواستتان را بنویسید. Enter ارسال می‌کند و Shift Enter خط جدید می‌سازد. تایپ به‌تنهایی چیزی نمی‌فرستد.',
    fileInput: 'فایل به پیش‌نویس پیوست کنید. هنگام ارسال پیام ممکن است محتوای آن برای ارائه‌دهندهٔ مدل فرستاده شود.',
    composerOptionsSummary: 'تنظیمات بیشتر پیام، شامل حالت عامل، میزان بررسی و مهارت‌ها را باز کنید. پیش‌نویس ارسال نمی‌شود.',
    agentSelect: 'شیوهٔ کار دستیار را انتخاب کنید: گفت‌وگو، برنامه‌ریزی یا اجرا. ابزارها همچنان تابع اجازه‌ها هستند.',
    modelVariantSelect: 'در مدل‌های سازگار، میزان بررسی را انتخاب کنید. بررسی بیشتر ممکن است کندتر و پرمصرف‌تر باشد؛ افکار خصوصی مدل را نشان نمی‌دهد.',
    browserButton: 'کاری برای مرورگر جداگانهٔ عامل آماده کنید. پیش از شروع، سایت و دستورها را بررسی کنید.',
    browserWindowButton: 'پنجرهٔ مرورگر عامل را روی رایانه نشان دهید یا پنهان کنید. کار مرورگر می‌تواند در حالت پنهان ادامه یابد.',
    aresToggle: 'شخصیت متحرک را نشان دهید یا پنهان کنید. این کار به‌تنهایی میکروفون را روشن یا مدل را عوض نمی‌کند.',
    voiceButton: 'مکالمه را شروع یا متوقف کنید. گفتار تشخیص‌داده‌شده خودکار ارسال و پاسخ با سرویس انتخابی خوانده می‌شود.',
    voiceMenuButton: 'سرویس صدا و تنظیمات آن را انتخاب کنید. این پیکان فقط تنظیمات را باز می‌کند و ضبط را شروع نمی‌کند.',
    voiceServiceSelect: 'صدای مرورگر یا گفتار ابری NVIDIA را انتخاب کنید؛ جدا از مدل گفت‌وگوست. سرویس ابری، صدا و متن پاسخ را خارج از رایانه پردازش می‌کند.',
    nvidiaVoiceConsent: 'اجازه دهید صدا و متن پاسخ به سرویس آزمایشی NVIDIA برسد. ثبت داده و محدودیت مصرف ممکن است اعمال شود؛ اطلاعات محرمانه نفرستید.',
    checkNvidiaVoice: 'دسترسی به صداهای NVIDIA را بررسی کنید. این کار میکروفون را روشن نمی‌کند و رایگان بودن نامحدود را تضمین نمی‌کند.',
    micButton: 'گفتار را به پیش‌نویس اضافه کنید؛ اگر دیکته موجود نباشد، فایل صوتی ضبط کنید. پیش از ارسال، پیش‌نویس را بررسی کنید.',
    sendButton: 'پیش‌نویس و پیوست‌ها را به مدل انتخابی بفرستید. ممکن است از سهمیه کم شود یا هزینهٔ API داشته باشد.',
    openApprovalButton: 'تعیین کنید ابزارها چه زمانی اجازه بخواهند. تغییر سیاست، درخواست منتظر را تأیید نمی‌کند.',
    approvalSaveButton: 'سیاست انتخابی را ذخیره کنید. درخواست ابزار که منتظر تصمیم است با این کار تأیید نمی‌شود.',
    openBlenderButton: 'Blender را روی رایانه باز کنید. اقدامات آن همچنان تابع اجازه‌های ابزار هستند.',
    protocolButton: 'گزارش اتصال و ابزارها را برای رفع اشکال ببینید. گزارش‌ها ممکن است اطلاعات خصوصی پروژه داشته باشند.',
    openInspectorButton: 'وضعیت عامل، اجازه‌ها، ابزارهای موجود، اتصال‌ها و فعالیت فضای کار را باز کنید.',
    settingsUpdatesButton: 'به‌روزرسانی برنامه و موتور را جدا بررسی کنید. بررسی نسخه‌ها چیزی نصب نمی‌کند.',
    settingsProvidersButton: 'ارائه‌دهندهٔ مدل را متصل یا کلید آن را مدیریت کنید. دسترسی، هزینه و محدودیت آن مستقل از Seneschal است.',
    settingsBudgetButton: 'هدف هزینه و محدودیت حساب ارائه‌دهنده را بررسی کنید. عدد هدف، سقف قطعی صورتحساب نیست.',
    settingsBackupsButton: 'پشتیبان خصوصی روی رایانه بسازید. ممکن است تاریخچهٔ حساس داشته باشد؛ مانند فایل خروجی معمولی به اشتراک نگذارید.',
    backupStatusButton: 'بررسی کنید پشتیبان‌گیری موفق بوده یا نه. این کار پشتیبان جدید نمی‌سازد.',
    settingsCommandsButton: 'فرمان‌ها و ارجاع‌های موجود را مرور کنید. انتخاب یک اقدام ممکن است فرمان همان مورد را آماده یا اجرا کند.',
    atmosphereClose: 'تنظیمات پس‌زمینه را ببندید و برگردید. پس‌زمینهٔ انتخابی حفظ می‌شود.',
    atmospherePreviewButton: 'پس‌زمینه را در نمای بزرگ‌تر ببینید. تصویرسازی محلی است، نه کار هوش مصنوعی یا ضبط صدا.',
    atmospherePreviewClose: 'از پیش‌نمایش بزرگ به مجموعهٔ پس‌زمینه‌ها برگردید.',
    atmospherePause: 'حرکت پس‌زمینه را متوقف یا ادامه دهید. کار هوش مصنوعی و صدا متوقف نمی‌شوند.',
    atmosphereNext: 'به دنیای پس‌زمینهٔ بعدی بروید. گفت‌وگو و پیش‌نویس تغییری نمی‌کنند.',
    atmospherePalette: 'رنگ‌های پس‌زمینه را عوض کنید یا آن را با رنگ‌بندی روز و شب هماهنگ کنید.',
    atmosphereWeather: 'آب‌وهوا یا حرکت آب را انتخاب کنید. جلوه‌های موجود به پس‌زمینه بستگی دارد.',
    atmosphereIntensity: 'شدت باران، برف، مه یا ذره‌های صحنه را تنظیم کنید.',
    atmosphereActivity: 'جنب‌وجوش پس‌زمینه، مانند ترافیک یا جزئیات متحرک را تنظیم کنید.',
    atmosphereGlow: 'درخشش داخل پس‌زمینه را تنظیم کنید، نه روشنایی واقعی نمایشگر.',
    atmosphereFeature: 'جزئیات ویژهٔ این دنیا را نشان دهید یا پنهان کنید.',
    atmosphereReset: 'تنظیمات این صحنه را به پیش‌فرض برگردانید. گفت‌وگوها و فایل‌ها تغییر نمی‌کنند.',
    atmosphereStrength: 'میزان نمایان بودن پس‌زمینه در صفحهٔ اصلی را تنظیم کنید.',
    atmosphereConversationStrength: 'نمایانی پس‌زمینه پشت پیام‌ها را تنظیم کنید. مقدار کمتر می‌تواند خواندن متن را آسان‌تر کند.',
    atmosphereAnimateConversation: 'اجازه دهید پس‌زمینه هنگام گفت‌وگو حرکت کند. خاموش بودن، حواس‌پرتی و مصرف گرافیک را کمتر می‌کند.',
    atmosphereQuality: 'حداکثر فریم‌برثانیه را تعیین کنید. مقدار کمتر، منابع گرافیکی کمتری مصرف می‌کند.',
    atmosphereRotation: 'تعویض خودکار دنیاها را تنظیم کنید. در حالت توقف یا پنهان بودن صفحه، گردش منتظر می‌ماند.',
    atmosphereMinutes: 'مدت ماندن هر پس‌زمینه پیش از تعویض خودکار را انتخاب کنید.',
    atmosphereShuffle: 'پس‌زمینه‌ها را به‌جای ترتیب ثابت، با ترتیب تصادفی عوض کنید.',
    atmosphereShowHotspots: 'نقاط تعاملی پیش‌نمایش را مشخص کنید. این کار روی ابزارهای هوش مصنوعی اثری ندارد.',
    providerConnectSelect: 'شرکت یا سرویسی را انتخاب کنید که مدل هوش مصنوعی را فراهم می‌کند.',
    providerKeyInput: 'کلید API ارائه‌دهنده را وارد کنید. محرمانه نگه دارید؛ به موتور محلی فرستاده می‌شود، نه متن گفت‌وگو.',
    providerAdvancedButton: 'گزینه‌های پیشرفته را برای ارائه‌دهندگانی که در این فرم نیستند باز کنید.',
    providerConnectButton: 'اتصال ارائه‌دهنده را در موتور محلی ذخیره کنید. این کار سرویس را رایگان یا هزینه را محدود نمی‌کند.',
    personaEditor: 'نام، لحن و سبک دستیار را تعیین کنید. این دستورالعمل‌ها اجازهٔ ابزار بیشتری نمی‌دهند.',
    generalEditor: 'ترجیح‌ها و قوانین مشترک پروژه‌ها را بنویسید. پس از بررسی، ویرایش‌ها را ذخیره کنید.',
    projectEditor: 'قوانین مخصوص پروژه، مثل قراردادها، آزمایش‌ها و فایل‌هایی که نباید تغییر کنند را بنویسید.',
    buildAgentEditor: 'دستورالعمل این عامل را تنظیم کنید. ابزارهای مجاز آن همچنان تابع سیاست اجازه‌ها هستند.',
    installSkillLinkButton: 'مهارت را پیش از نصب از پیوند مخزن بررسی کنید. مهارت دستورالعمل را تغییر می‌دهد؛ فقط از منبع معتبر نصب کنید.',
    newSkillButton: 'مهارت قابل‌استفادهٔ دوباره بسازید. تا انتخاب «ذخیره» چیزی ذخیره نمی‌شود.',
    skillNameInput: 'شناسهٔ کوتاهی برای پیدا کردن و استفادهٔ دوبارهٔ مهارت انتخاب کنید.',
    skillScopeSelect: 'تعیین کنید مهارت مخصوص این پروژه باشد یا در همهٔ پروژه‌ها در دسترس باشد.',
    skillEditor: 'دستورالعمل مهارت را ویرایش کنید. رمز و کلید API در آن ننویسید.',
    archiveSkillButton: 'مهارت انتخابی را از فهرست فعال به بایگانی ببرید.',
    saveSkillButton: 'دستورالعمل مهارت را در محدودهٔ انتخابی ذخیره کنید. پیش از استفاده آن را بررسی کنید.',
    messageEditInput: 'درخواست قبلی را اصلاح کنید. ذخیره و تلاش دوباره، گفت‌وگو را به آن نقطه برمی‌گرداند و درخواست اصلاح‌شده را اجرا می‌کند.',
    browserUrlInput: 'نشانی سایتی را وارد کنید که عامل باید در مرورگر جداگانه باز کند.',
    browserTaskInput: 'کار عامل در سایت را توضیح دهید. رمز یا اطلاعات محرمانه وارد نکنید.',
    runBrowserButton: 'دستورهای این کار مرورگر را به دستیار بفرستید. مرورگر و ابزارهای دیگر همچنان تابع اجازه‌ها هستند.',
    agentBoardObjective: 'نتیجه‌ای را که از تیم عامل‌ها می‌خواهید توضیح دهید.',
    agentBoardConcurrency: 'تعداد عامل‌های هم‌زمان را محدود کنید. عامل بیشتر ممکن است سهمیهٔ بیشتری مصرف کند.',
    agentBoardImportButton: 'گفت‌وگوی موجود را وارد تابلو کنید. اطلاعات مورد استفاده را بررسی کنید.',
    agentBoardTemplateButton: 'تیم اولیه‌ای برای ویرایش اضافه کنید. این کار به‌تنهایی عامل‌ها را اجرا نمی‌کند.',
    agentBoardAddButton: 'عامل تخصصی با وظیفه، مدل و دسترسی جداگانه اضافه کنید.',
    agentBoardRunButton: 'عامل‌های آمادهٔ این تابلو را اجرا کنید. ابتدا وظایف، مدل‌ها، دسترسی‌ها و وابستگی‌ها را بررسی کنید.',
    agentBoardPauseButton: 'شروع عامل‌های بعدی را متوقف کنید. عامل‌های مشغول جداگانه متوقف می‌شوند.',
    agentBoardResetButton: 'وضعیت گردش کار تابلو را بازنشانی کنید. پیش از کنار گذاشتن تنظیمات، تأیید را بررسی کنید.',
    agentBoardStopButton: 'از عامل‌های مشغول بخواهید متوقف شوند. تغییرهای انجام‌شده خودکار برنمی‌گردند.',
    agentNameInput: 'نامی روشن برای وظیفهٔ عامل انتخاب کنید، مانند پژوهشگر یا بازبین.',
    agentRoleInput: 'نقش این عامل را در تیم، مانند برنامه‌ریز، اجراکننده یا بازبین انتخاب کنید.',
    agentModelInput: 'مدل این عامل را انتخاب کنید. هزینه و محدودیت ارائه‌دهندهٔ آن اعمال می‌شود.',
    agentAccessInput: 'ابزارهای در دسترس این عامل را انتخاب کنید. در دسترس بودن ابزار به معنی اجازهٔ خودکار اجرای آن نیست.',
    agentPromptInput: 'یک مسئولیت روشن و نتیجهٔ مورد انتظار را برای این عامل بنویسید.',
    vscodePathInput: 'در صورت نیاز، مسیر فایل پروژه را برای باز شدن در Visual Studio Code وارد کنید.',
    vscodeLineInput: 'جای نشانگر ویرایشگر را در فایل انتخاب کنید.',
    installVsCodeCompanionButton: 'افزونهٔ اختیاری ویرایشگر را روی رایانه نصب کنید. میان‌برهایی بین VS Code و Seneschal اضافه می‌کند.',
    aresDrag: 'کارت شناور شخصیت را با این دستگیره بکشید. کلیدهای جهت هم آن را جابه‌جا می‌کنند؛ گزینه‌های جای‌گیری در «چیدمان» هستند.',
    aresMinimize: 'کارت شخصیت را جمع یا باز کنید. مکالمه و کار دستیار متوقف نمی‌شوند.',
    aresMaximize: 'نمای تمام‌صفحهٔ شخصیت را باز کنید یا از آن برگردید. بزرگ کردن، میکروفون را روشن نمی‌کند.',
    aresClose: 'شخصیت را پنهان و منابع سه‌بعدی آن را آزاد کنید. صدا و کار هوش مصنوعی جدا هستند.',
    aresRetry: 'بارگذاری شخصیت محلی را دوباره امتحان کنید. پیام دوباره ارسال یا سرویس صدا عوض نمی‌شود.',
    aresMotion: 'حرکت شخصیت را متوقف یا ادامه دهید. صدا و کار هوش مصنوعی متوقف نمی‌شوند.',
    aresLayoutButton: 'جای کارت، اندازه و زاویهٔ دوربین را تنظیم کنید یا آن را در نوار کناری قرار دهید.',
    aresResize: 'برای تغییر اندازه، کارت شناور را بکشید. در کارت باریک از «چیدمان ← بزرگ‌تر یا کوچک‌تر» استفاده کنید.',
    aresCameraHome: 'دوربین را روبه‌روی شخصیت برگردانید، بدون جابه‌جایی کارت.',
    aresDock: 'شخصیت را در جای مخصوص بالای بخش‌های دیگر نوار کناری قرار دهید.',
    aresReset: 'جای کارت و اندازهٔ آن را به پیش‌فرض برگردانید. گفت‌وگو بازنشانی نمی‌شود.',
    settingsPhoneAccessButton: 'دسترسی خصوصی گوشی را روی رایانه مدیریت کنید. رایانه برای خدمت‌رسانی به گوشی باید بیدار و متصل بماند.',
    phoneAccessRefresh: 'فهرست مرورگرهای متصل و وضعیت اتصال آن‌ها را تازه کنید.',
    phoneAccessCode: 'این کد یک‌بارمصرف را فقط در گوشی خود وارد کنید. آن را به دیگران یا در گفت‌وگو نفرستید.',
    checkAppUpdate: 'نسخهٔ سازگار را بررسی کنید. بررسی به‌تنهایی چیزی نصب نمی‌کند و کارها را از نو راه نمی‌اندازد.',
    activityQuery: 'گفت‌وگوهای ثبت‌شده را جست‌وجو کنید. انتخاب کنید عنوان‌ها جست‌وجو شوند یا متن گفت‌وگو.',
    activitySearchMode: 'انتخاب کنید تاریخچه بر اساس عنوان و پروژه جست‌وجو شود یا متن ثبت‌شدهٔ گفت‌وگو.',
    activityStatus: 'بر اساس وضعیت ثبت‌شده در تاریخچه فیلتر کنید. ممکن است با وضعیت زندهٔ کار فرق داشته باشد.',
    activitySearchSubmit: 'تاریخچهٔ محلی را با این فیلترها جست‌وجو کنید. این کار پرسش از هوش مصنوعی نیست.',
    activityStartup: 'سرویس تاریخچهٔ موجود را در اجرای بعدی Seneschal شروع کنید. این گزینه راه‌اندازی Windows را تغییر نمی‌دهد و سرویس را همین حالا شروع نمی‌کند.'
  };
  for (const [id, copy] of Object.entries(helpFa)) {
    const english = root.SeneschalFeatureHelp?.catalog[id];
    if (english) { translations[english] = copy; folded[english.toLowerCase()] = copy; }
  }
  const ruleFa = [
    null, null,
    'فقط همین درخواست منتظرِ ابزار را مجاز کنید. ابتدا فرمان یا اقدام درخواستی را بررسی کنید.',
    'برای اقدامات مشابه در همین گفت‌وگو اجازه را به خاطر بسپارید. این گزینه آزادی بیشتری از «فقط این بار» می‌دهد.',
    'این درخواست ابزار را رد کنید. ابزار مجاز نمی‌شود؛ کار انجام‌شده به عقب برنمی‌گردد.',
    'بررسی کنید رایانه تصمیم قبلی شما را دریافت کرده یا نه. تصمیم دوباره ارسال نمی‌شود.',
    'خواندن امن خودکار باشد؛ ویرایش، فرمان و اقدامات خارجی اجازه بخواهند. برای اعمال، ذخیره کنید.',
    'پیش از خواندن فایل و دیگر اقدامات ابزار اجازه بگیرد. محتاطانه‌تر است ولی وقفهٔ بیشتری دارد. برای اعمال، ذخیره کنید.',
    'اجرا بتواند بدون پرسش فایل ویرایش و فرمان اجرا کند. فقط برای پروژهٔ مورد اعتماد؛ اقدامات خارجی همچنان اجازه می‌خواهند. برای اعمال، ذخیره کنید.',
    'گفت‌وگوهای این پروژه را باز کنید و پوشهٔ آن را برای کار بعدی به کار ببرید.',
    'نام پروژه در نوار کناری را عوض کنید، نه نام پوشهٔ روی دیسک.',
    'پروژه را از نوار کناری بردارید. پوشه، فایل‌ها و گفت‌وگوهای موتور باقی می‌مانند.',
    'این گفت‌وگوی ذخیره‌شده را باز کنید. پیام‌هایش دوباره ارسال نمی‌شوند.',
    'این گفت‌وگو را برای دسترسی آسان بالا سنجاق کنید یا سنجاقش را بردارید.',
    'گفت‌وگو را از فهرست معمولی پنهان کنید یا برگردانید. بایگانی تاریخچه را حذف نمی‌کند.',
    'نام گفت‌وگوی ذخیره‌شده را عوض کنید، بدون تغییر پیام‌ها.',
    'درخواست حذف همیشگی این گفت‌وگو را باز کنید. فایل‌های پروژه حذف نمی‌شوند.',
    'به این درخواست برگردید و پاسخ تازه بسازید. پاسخ‌های بعدی از شاخهٔ فعال کنار می‌روند؛ پیش از تلاش دوباره بررسی کنید.',
    'فقط از همین پاسخ انتخاب‌شده برای آماده‌سازی تابلو استفاده کنید. پیش از اجرا تیم را بررسی کنید.',
    'پیام را برای دسترسی آسان سنجاق کنید یا سنجاق آن را بردارید.',
    'این پیام را در نمای Seneschal همین دستگاه پنهان کنید یا برگردانید. رونوشت موتور حفظ می‌شود.',
    'پیام را از Seneschal در همین دستگاه بردارید. رونوشت اصلی موتور تغییر نمی‌کند.',
    'پیام را جمع یا باز کنید، بدون حذف یا اجرای دوبارهٔ آن.',
    'این پیام را در فضای اصلی نمایش دهید یا به چیدمان معمولی برگردید.',
    'این متن را کپی کنید. فرمانی اجرا یا متنی به سرویس دیگری ارسال نمی‌شود.',
    'به پیام ذخیره‌شده در این گفت‌وگو بروید. چیزی دوباره ارسال یا اجرا نمی‌شود.',
    'فرمان و نتیجهٔ ابزار را باز یا جمع کنید. دیدن نتیجهٔ تمام‌شده ابزار را دوباره اجرا نمی‌کند.',
    'خلاصهٔ کوتاه پیشرفتِ ارائه‌شده از مدل را باز یا جمع کنید. این دسترسی به افکار خصوصی مدل نیست.',
    'کارهای این پیام، مانند کپی، سنجاق و تلاش دوباره را ببینید. برای استفاده، یک مورد را انتخاب کنید.',
    'پیشرفت و رویدادهای اخیر ابزارهای این گفت‌وگو را نشان دهید یا پنهان کنید.',
    'این مدل را برای درخواست‌های بعدی انتخاب کنید. دسترسی، سهمیه و هزینهٔ ارائه‌دهنده همچنان اعمال می‌شود.',
    'این درخواست نمونه را در کادر پیام بگذارید تا پیش از ارسال آن را بررسی یا ویرایش کنید.',
    'این پیوست را از پیش‌نویس بردارید. فایل اصلی روی دیسک حذف نمی‌شود.',
    'دستورالعمل‌ها را در محدودهٔ انتخابی ذخیره کنید. دستورالعمل اجازهٔ اضافی به ابزارها نمی‌دهد.',
    'تغییرهای ذخیره‌نشدهٔ این ویرایشگر را کنار بگذارید و به نسخهٔ ذخیره‌شده برگردید.',
    'متن پیش‌فرض پیشنهادی را در ویرایشگر بگذارید. پیش از ذخیره بررسی کنید.',
    'دستورالعمل این مهارت را برای درخواست‌های بعدی فعال یا غیرفعال کنید. مهارت اجازهٔ اضافی به ابزار نمی‌دهد.',
    'این مهارت را پیش از استفاده برای بررسی یا ویرایش دستورالعمل باز کنید.',
    'این بخش کارگاه دستورالعمل‌ها را باز کنید. عوض کردن زبانه به‌تنهایی ویرایش‌ها را ذخیره نمی‌کند.',
    'گفت‌وگوی بایگانی‌شده را به فهرست عادی نوار کناری برگردانید.',
    'شخصیت شناور را کمی در این جهت جابه‌جا کنید. این گزینه شخصیت را نمی‌چرخاند.',
    'کارت شناور شخصیت را بزرگ‌تر یا کوچک‌تر کنید، بدون تغییر گفت‌وگو.',
    'دوربین را دور شخصیت بچرخانید. خود کارت جابه‌جا نمی‌شود.',
    'این دنیا را برای پس‌زمینه انتخاب کنید. گفت‌وگو و پیش‌نویس تغییر نمی‌کنند.',
    'این تعامل کوچک را در پس‌زمینهٔ محلی اجرا کنید. ابزار هوش مصنوعی اجرا یا صدا ضبط نمی‌شود.',
    'تعامل پس‌زمینه را در این جزئیات مشخص‌شده اجرا کنید. جلوهٔ محلی است، نه کار هوش مصنوعی.',
    'وظیفه، مدل و دسترسی این عامل را ویرایش کنید. پیش از ویرایش، عامل مشغول را متوقف کنید.',
    'کارت عامل را از تابلو بردارید. کار در حال اجرا باید جداگانه متوقف شود.',
    'وظیفهٔ این عامل را با مدل و دسترسی انتخابی آن اجرا کنید.',
    'از این عامل بخواهید متوقف شود. تغییرهای انجام‌شده خودکار برنمی‌گردند.',
    'گفت‌وگوی این عامل را باز کنید. دوباره اجرا نمی‌شود.',
    'پیشرفت ثبت‌شده و کار ابزارهای این عامل را بررسی کنید.',
    'تابلوی ذخیره‌شده را بدون اجرای دوبارهٔ عامل‌ها باز کنید.',
    'این تابلو را از تاریخچهٔ تابلوها حذف کنید. پیش از حذف، تأیید را بررسی کنید.',
    'این نتیجهٔ جست‌وجو را انتخاب کنید. مدل، گفت‌وگو و اقدام اثرهای متفاوتی دارند که در برچسب آن‌ها مشخص است.',
    'نوار پروژه‌های گوشی را باز یا بسته کنید.',
    'این بخش پیمایش را ببندید و به گفت‌وگو برگردید.',
    'اتصال خصوصی این مرورگر را قطع کنید. کارهای رایانه متوقف نمی‌شوند.',
    'ابزاری در دسترس این عامل است. اجرای آن همچنان تابع سیاست اجازه‌هاست.',
    'تاریخچهٔ ثبت‌شدهٔ این گفت‌وگو را باز کنید. پیام یا ابزار دوباره اجرا نمی‌شود.',
    'پیش از شروع عامل در حال ویرایش، منتظر پایان عامل انتخاب‌شده بمانید.',
    'نشان می‌دهد این صفحه به موتور اجرای رایانه متصل است یا نه.',
    'نشان می‌دهد گفت‌وگو آماده، مشغول کار یا در حال تلاش دوباره است.',
    'مصرف ظرفیت همین گفت‌وگو را نشان می‌دهد، نه سهمیهٔ باقی‌ماندهٔ حساب.',
    'ابزاری اجازه می‌خواهد. پیش از انتخاب «فقط این بار»، «همیشه» یا «رد درخواست»، اقدام را بررسی کنید.',
    'دستیار پاسخ یک پرسش را می‌خواهد. پاسخ به پرسش با اجازهٔ اجرای ابزار فرق دارد.'
  ];
  (root.SeneschalFeatureHelp?.rules || []).forEach(([, english], index) => {
    if (typeof english === 'string' && ruleFa[index]) translations[english] = ruleFa[index];
  });
  const sectionFa = {
    permissions: 'بررسی کنید دستیار چه زمانی برای ابزارها اجازه بگیرد. درخواست منتظر همچنان به تصمیم صریح شما نیاز دارد.',
    tools: 'ابزارهای در دسترس عامل فعلی را ببینید. در دسترس بودن به معنی اجازهٔ خودکار نیست.',
    browser: 'مرورگر جداگانهٔ عامل را کنترل کنید. از نمایهٔ ذخیره‌شدهٔ مرورگر معمولی شما استفاده نمی‌کند.',
    creative: 'دستیار را برای کار سه‌بعدی به Blender روی رایانه متصل کنید. ابزارهای آن تابع اجازه‌های شما هستند.',
    code: 'پروژهٔ کاری را در ویرایشگر روی رایانه باز کنید. فایل و جای نشانگر را می‌توان جدا انتخاب کرد.',
    budget: 'هدف هزینهٔ ارائه‌دهندهٔ پولی را بررسی کنید. سقف واقعی هزینه را در حساب خود ارائه‌دهنده هم تعیین کنید.',
    providers: 'سرویس‌های هوش مصنوعی متصل و مدل‌های در دسترس آن‌ها را ببینید.',
    pulse: 'فعالیت اخیر فضای کار و موتور را ببینید. تعداد فعالیت‌ها، سهمیهٔ باقی‌ماندهٔ مدل نیست.'
  };
  for (const [key, copy] of Object.entries(sectionFa)) { const english = root.SeneschalFeatureHelp?.sections[key]; if (english) translations[english] = copy; }
  register(`
Unmute the microphone. Talk can then capture and automatically send new spoken turns.|میکروفون را وصل کنید. حالت مکالمه می‌تواند گفتار جدید را ضبط و خودکار ارسال کند.
Stop microphone capture without stopping the AI task. Unsent recorded audio is discarded; audio already sent cannot be taken back.|ضبط میکروفون را بدون توقف کار هوش مصنوعی قطع کنید. صدای ارسال‌نشده کنار گذاشته می‌شود؛ صدای قبلاً ارسال‌شده قابل پس گرفتن نیست.
Let future replies play aloud again. Old muted replies will not be replayed.|پخش صوتی پاسخ‌های بعدی را دوباره فعال کنید. پاسخ‌های قبلی که بی‌صدا بودند تکرار نمی‌شوند.
Stop spoken playback and keep future replies text-only until you unmute. The microphone and AI task are separate.|پخش صدا را قطع کنید؛ تا وصل دوباره، پاسخ‌های بعدی فقط متن‌اند. میکروفون و کار هوش مصنوعی جدا هستند.
Close this panel without confirming its pending action. Changes already saved are not undone.|این پنل را بدون تأیید اقدام منتظر ببندید. تغییرهای قبلاً ذخیره‌شده برگردانده نمی‌شوند.
Review app settings, model connections, voice, permissions and PC-only maintenance. Open a specific control to change it.|تنظیمات برنامه، اتصال مدل، صدا، اجازه‌ها و نگهداری مخصوص رایانه را بررسی کنید. برای تغییر، گزینهٔ مربوط را باز کنید.
Set up one specialist’s name, task, model, system access and dependencies before running it.|پیش از اجرا، نام، وظیفه، مدل، دسترسی و وابستگی‌های یک عامل تخصصی را تنظیم کنید.
Agent Context shows the current assistant, its permissions, tools and connected services.|بخش وضعیت عامل، دستیار فعلی، اجازه‌ها، ابزارها و سرویس‌های متصل را نشان می‌دهد.
Choose the folder the assistant should work in. Project files stay on your PC.|پوشهٔ کاری دستیار را انتخاب کنید. فایل‌های پروژه روی رایانه می‌مانند.
Conversations you pinned for quick access. Pinning does not copy or rerun them.|گفت‌وگوهایی که برای دسترسی سریع سنجاق کرده‌اید. سنجاق کردن آن‌ها را کپی یا دوباره اجرا نمی‌کند.
Your saved conversations for this project. Open one to continue where you left off.|گفت‌وگوهای ذخیره‌شدهٔ این پروژه؛ برای ادامه از جای قبلی، یکی را باز کنید.
The working project for this draft, plus controls for the size of the message input.|پروژهٔ کاری این پیش‌نویس و گزینه‌های اندازهٔ کادر پیام
The current project and conversation name. This is separate from the AI model selected above.|نام پروژه و گفت‌وگوی فعلی؛ جدا از مدل هوش مصنوعی انتخاب‌شده در بالاست.
Start private phone access on the PC. The PC must stay awake and connected; this is not a public internet link.|دسترسی خصوصی گوشی را روی رایانه شروع کنید. رایانه باید بیدار و متصل بماند؛ این پیوند عمومی اینترنت نیست.
Stop phone access and revoke all paired browsers and unused codes. PC tasks and history stay intact.|دسترسی گوشی را متوقف و اتصال همهٔ مرورگرها و کدهای استفاده‌نشده را باطل کنید. کارهای رایانه و تاریخچه حفظ می‌شوند.
Create a one-time code to pair your own browser. Keep this code private.|کد یک‌بارمصرف برای اتصال مرورگر خود بسازید. کد را محرمانه نگه دارید.
Revoke this paired browser’s access. It must pair again before it can reconnect.|دسترسی این مرورگر را باطل کنید. برای اتصال دوباره باید کد تازه بگیرد.
Manage which of your browsers may reach this PC through private phone access.|مرورگرهایی را مدیریت کنید که از راه دسترسی خصوصی گوشی به این رایانه می‌رسند.
See a summary of recorded conversations and estimated usage.|خلاصهٔ گفت‌وگوهای ثبت‌شده و برآورد مصرف را ببینید.
Find and inspect recorded conversations without rerunning them.|گفت‌وگوهای ثبت‌شده را بدون اجرای دوباره پیدا و بررسی کنید.
Review recorded token usage and cost estimates. Estimates are not your provider’s final bill.|مصرف توکن و برآورد هزینه را ببینید. این برآورد، صورتحساب نهایی ارائه‌دهنده نیست.
Manage the local history service and its derived index on the PC.|سرویس تاریخچهٔ محلی و فهرست ساخته‌شده از آن را روی رایانه مدیریت کنید.
Reload recorded history and status without resending messages.|تاریخچه و وضعیت ثبت‌شده را بدون ارسال دوبارهٔ پیام‌ها تازه کنید.
Start the local history service on the PC so the dashboard can read its records.|سرویس تاریخچه را روی رایانه شروع کنید تا داشبورد سوابق را بخواند.
Stop the history service, not the AI’s current task. Saved conversations are kept.|سرویس تاریخچه را متوقف کنید، نه کار فعلی هوش مصنوعی. گفت‌وگوهای ذخیره‌شده می‌مانند.
Restart the local history service. This is separate from restarting the task engine.|سرویس تاریخچهٔ محلی را دوباره راه‌اندازی کنید. با راه‌اندازی موتور اجرا فرق دارد.
Rebuild the history index from original records. The previous index is preserved as a local backup.|فهرست تاریخچه را از سوابق اصلی دوباره بسازید. فهرست قبلی به‌صورت پشتیبان محلی حفظ می‌شود.
Save whether history should start on future Seneschal launches. This does not immediately start it.|انتخاب شروع تاریخچه در اجرای بعدی Seneschal را ذخیره کنید. همین حالا شروع نمی‌شود.
Save the live events shown in this window. Review the file before sharing it.|رویدادهای زندهٔ این پنجره را ذخیره کنید. پیش از اشتراک‌گذاری فایل را بررسی کنید.
Pause or resume updates in this history view. The AI task continues.|تازه‌شدن این نمای تاریخچه را متوقف یا ادامه دهید. کار هوش مصنوعی ادامه دارد.
Inspect this chat’s recorded activity without sending a new request.|فعالیت ثبت‌شدهٔ این گفت‌وگو را بدون ارسال درخواست جدید بررسی کنید.
Check whether the PC’s history service is ready. This does not start a paid service.|آماده بودن سرویس تاریخچهٔ رایانه را بررسی کنید. سرویس پولی شروع نمی‌شود.
Open the original conversation so you can continue it.|گفت‌وگوی اصلی را برای ادامه باز کنید.
Show the previous page of history.|صفحهٔ قبلی تاریخچه را ببینید.
Show the next page of history.|صفحهٔ بعدی تاریخچه را ببینید.
Load more recorded turns from this conversation.|نوبت‌های ثبت‌شدهٔ بیشتری از این گفت‌وگو بارگذاری کنید.
Remove the project filter from this history search.|فیلتر پروژه را از جست‌وجوی تاریخچه بردارید.
Inspect this recorded conversation. Viewing history does not run its tasks again.|این گفت‌وگوی ثبت‌شده را بررسی کنید. دیدن تاریخچه کارهایش را دوباره اجرا نمی‌کند.
Inspect recorded work and usage from the PC. Original conversation records stay separate from this dashboard.|کار و مصرف ثبت‌شدهٔ رایانه را ببینید. سوابق اصلی گفت‌وگو از این داشبورد جدا می‌مانند.
Check for waiting questions. This does not send an answer or approve a tool.|پرسش‌های منتظر را بررسی کنید. پاسخ ارسال یا ابزار تأیید نمی‌شود.
Reject this question request without choosing an answer. This is not a tool-permission decision.|درخواست پرسش را بدون انتخاب پاسخ رد کنید. این تصمیم دربارهٔ اجازهٔ ابزار نیست.
Send only the answers you selected or wrote for this question.|فقط پاسخ‌های انتخاب‌شده یا نوشته‌شده برای همین پرسش را بفرستید.
Open the waiting question so you can review its choices.|پرسش منتظر را باز کنید تا گزینه‌هایش را بررسی کنید.
Choose or write an answer for the assistant. Only Send answers submits it; closing keeps it pending.|پاسخ دستیار را انتخاب کنید یا بنویسید. فقط «ارسال پاسخ‌ها» آن را می‌فرستد؛ بستن، پرسش را در انتظار نگه می‌دارد.
Adjust this world’s colors, weather, lights and moving details. These are local visual effects.|رنگ، آب‌وهوا، نور و جزئیات متحرک دنیا را تنظیم کنید. این جلوه‌ها محلی هستند.
Set an automatic wallpaper playlist. It waits when the workspace is hidden, paused or using a quiet conversation background.|گردش خودکار پس‌زمینه‌ها را تنظیم کنید. وقتی صفحه پنهان، حرکت متوقف یا پس‌زمینهٔ گفت‌وگو ثابت است منتظر می‌ماند.
Adjust wallpaper visibility and motion so the background stays comfortable while you work.|نمایانی و حرکت پس‌زمینه را برای کار راحت‌تر تنظیم کنید.
Choose a wallpaper from this collection. The art runs locally and does not use your AI allowance.|پس‌زمینه‌ای از این مجموعه انتخاب کنید. تصویر محلی اجرا می‌شود و سهمیهٔ هوش مصنوعی مصرف نمی‌کند.
Review this group of settings. Hover or focus a specific control to learn what it changes.|این گروه تنظیمات را بررسی کنید. برای آشنایی با هر گزینه، روی آن مکث کنید یا با صفحه‌کلید به آن بروید.
Expand or fold these details. This alone does not send a message or approve a tool.|جزئیات را باز یا جمع کنید. این کار پیام ارسال یا ابزار تأیید نمی‌کند.
Open this link. External websites have their own privacy policies; review private information before sharing it.|پیوند را باز کنید. سایت‌های دیگر سیاست حریم خصوصی خود را دارند؛ پیش از اشتراک‌گذاری، اطلاعات خصوصی را بررسی کنید.
Leave this dialog without confirming its pending action.|بدون تأیید اقدام منتظر از این پنجره خارج شوید.
Save this revised request and generate a new response from this point. Later responses leave the active branch.|درخواست اصلاح‌شده را ذخیره و از این نقطه پاسخ تازه بسازید. پاسخ‌های بعدی از شاخهٔ فعال کنار می‌روند.
Save this specialist’s task, model and access. Saving does not run it.|وظیفه، مدل و دسترسی عامل را ذخیره کنید. ذخیره کردن آن را اجرا نمی‌کند.
Open the chosen file and position in Visual Studio Code on the PC.|فایل و محل انتخاب‌شده را در Visual Studio Code روی رایانه باز کنید.
Save this sidebar label without renaming the actual folder.|برچسب نوار کناری را ذخیره کنید، بدون تغییر نام واقعی پوشه.
Save the settings in this form. Review the values before confirming.|تنظیمات فرم را ذخیره کنید. پیش از تأیید، مقدارها را بررسی کنید.
Install the selected compatible update only after reviewing it. A running task may need to finish first.|پس از بررسی، به‌روزرسانی سازگار را نصب کنید. ممکن است لازم باشد کار در حال اجرا ابتدا تمام شود.
Review local app maintenance and compatibility information.|اطلاعات نگهداری و سازگاری برنامهٔ محلی را بررسی کنید.
Change this field’s setting. Its label and nearby note explain the expected value; typing alone does not send a chat message.|تنظیم این فیلد را تغییر دهید. برچسب و یادداشت کناری مقدار لازم را توضیح می‌دهند؛ تایپ به‌تنهایی پیام نمی‌فرستد.
Use this action in the current panel. Review the nearby information before confirming a change.|این اقدام را در همین بخش به کار ببرید. پیش از تأیید تغییر، اطلاعات کناری را بررسی کنید.
`);
  register(`
Open workspace home|باز کردن صفحهٔ اصلی
Select AI model|انتخاب مدل هوش مصنوعی
Active AI model|مدل هوش مصنوعی فعال
Search models|جست‌وجوی مدل‌ها
Search models…|جست‌وجوی مدل‌ها…
Close model picker|بستن انتخاب مدل
Available AI models|مدل‌های موجود
Search workspace|جست‌وجوی فضای کار
Open Agent Board|باز کردن تابلوی عامل‌ها
Switch color theme|تغییر رنگ‌بندی
Switch day or night theme|تغییر رنگ‌بندی روز و شب
Seneschal settings|تنظیمات Seneschal
Exit maximized message view|خروج از نمای بزرگ پیام
Exit maximized view (Esc)|خروج از نمای بزرگ (Esc)
Minimize left projects and sessions panel|جمع کردن نوار پروژه‌ها و گفت‌وگوها در چپ
Restore left projects and sessions panel|باز کردن نوار پروژه‌ها و گفت‌وگوها در چپ
Minimize left panel|جمع کردن نوار چپ
Restore left panel|باز کردن نوار چپ
Show archived sessions|نمایش گفت‌وگوهای بایگانی‌شده
Hide archived sessions|پنهان کردن گفت‌وگوهای بایگانی‌شده
Open wallpaper themes|باز کردن پس‌زمینه‌ها
Wallpaper themes|پس‌زمینه‌ها
Open the official Work and Codex usage dashboard|باز کردن داشبورد رسمی مصرف Work و Codex
Rename session|تغییر نام گفت‌وگو
Move session to another project|قرار دادن گفت‌وگو زیر پروژهٔ دیگر
Export conversation|ذخیرهٔ خروجی گفت‌وگو
Send current session to Agent Board|فرستادن گفت‌وگوی فعلی به تابلوی عامل‌ها
Send this session to Agent Board|فرستادن این گفت‌وگو به تابلوی عامل‌ها
Open current project in Visual Studio Code|باز کردن پروژهٔ فعلی در Visual Studio Code
Open project in VS Code|باز کردن پروژه در VS Code
Show archived messages|نمایش پیام‌های بایگانی‌شده
Hide archived messages|پنهان کردن پیام‌های بایگانی‌شده
Stop generation|توقف تولید پاسخ
Conversation steps|گام‌های گفت‌وگو
Permissions and questions|اجازه‌ها و پرسش‌ها
Minimize message input|جمع کردن کادر پیام
Maximize message input|بزرگ کردن کادر پیام
Restore message input|بازگردانی کادر پیام
Expand prompt|باز کردن کادر نوشتن
Message Seneschal|پیام به Seneschal
Describe the desired state, ask a question, or use / for commands…|درخواستتان را بنویسید، سؤال بپرسید یا برای فرمان‌ها / بزنید…
Attach files|پیوست فایل‌ها
Prompt options|گزینه‌های پیام
Agent, thinking and skills|عامل، میزان بررسی و مهارت‌ها
Agent mode|حالت عامل
Model thinking level|میزان بررسی مدل
Open Instructions Studio|باز کردن کارگاه دستورالعمل‌ها
Choose instructions and skills|انتخاب دستورالعمل و مهارت
Open agent browser controls|باز کردن تنظیمات مرورگر عامل
Give the agent a browser task|دادن یک کار مرورگری به عامل
Show the agent-controlled Brave window|نمایش پنجرهٔ Brave تحت کنترل عامل
Hide the agent-controlled Brave window|پنهان کردن پنجرهٔ Brave تحت کنترل عامل
Voice and message actions|گزینه‌های صدا و پیام
Show or hide Seneschal companion|نمایش یا پنهان کردن شخصیت Seneschal
Start Talk mode|شروع حالت مکالمه
Stop Talk mode|پایان حالت مکالمه
Start Talk — sends spoken turns and reads replies|شروع مکالمه؛ ارسال خودکار گفتار و خواندن پاسخ
Voice options|گزینه‌های صدا
Talk audio controls|کنترل صدای مکالمه
Audio privacy controls|کنترل حریم خصوصی صدا
Start voice dictation or recording|شروع دیکته یا ضبط صدا
Dictate or record a voice message|نوشتن با گفتار یا ضبط پیام صوتی
Start turn-by-turn voice conversation|شروع مکالمهٔ صوتی نوبت‌به‌نوبت
Send message|ارسال پیام
Send message (Enter); Shift Enter for a new line|ارسال پیام با Enter؛ خط جدید با Shift Enter
Minimize right agent context panel|جمع کردن نوار وضعیت عامل در راست
Restore right agent context panel|باز کردن نوار وضعیت عامل در راست
Minimize right panel|جمع کردن نوار راست
Restore right panel|باز کردن نوار راست
Close inspector|بستن وضعیت عامل
Activity during the last 60 seconds|فعالیت در ۶۰ ثانیهٔ گذشته
OpenCode work and ambient events during the last minute, shown in ten fixed six-second intervals|رویدادهای کاری و پس‌زمینهٔ OpenCode در دقیقهٔ گذشته، در ده بازهٔ شش‌ثانیه‌ای
Open agent context|باز کردن وضعیت عامل
Close atmosphere collection|بستن مجموعهٔ پس‌زمینه‌ها
Atmosphere customization|تنظیم پس‌زمینه
Scene interactions|تعامل‌های صحنه
Return to atmosphere collection|بازگشت به مجموعهٔ پس‌زمینه‌ها
Clickable scene details|جزئیات تعاملی صحنه
Paste the provider API key|کلید API ارائه‌دهنده را وارد کنید
Close Instructions Studio|بستن کارگاه دستورالعمل‌ها
Instruction sections|بخش‌های دستورالعمل
Describe the assistant's identity, tone, and preferred form of address.|هویت، لحن و شیوهٔ خطاب دستیار را توضیح دهید.
Add permanent preferences, safety rules, and communication style.|ترجیح‌های دائمی، قوانین ایمنی و سبک ارتباط را اضافه کنید.
Describe this project's purpose, structure, standards, tests, and forbidden changes.|هدف، ساختار، استانداردها، آزمایش‌ها و تغییرهای ممنوع پروژه را توضیح دهید.
Close Agent Board|بستن تابلوی عامل‌ها
What should this team deliver?|این تیم چه نتیجه‌ای باید تحویل دهد؟
Maximum parallel agents|حداکثر عامل‌های هم‌زمان
Close board history|بستن تاریخچهٔ تابلوها
Researcher|پژوهشگر
Give this agent one clear responsibility and expected output.|یک مسئولیت روشن و خروجی مورد انتظار را برای این عامل بنویسید.
Seneschal voice companion|شخصیت همراه صوتی Seneschal
Move Seneschal; drag or use arrow keys|جابه‌جایی Seneschal؛ بکشید یا از کلیدهای جهت استفاده کنید
Drag to move; arrow keys also move|برای جابه‌جایی بکشید؛ کلیدهای جهت هم کار می‌کنند
Minimize Seneschal|جمع کردن شخصیت Seneschal
Restore Seneschal|بازگردانی شخصیت Seneschal
Maximize Seneschal|تمام‌صفحه کردن شخصیت Seneschal
Hide Seneschal companion|پنهان کردن شخصیت Seneschal
Seneschal 3D view; drag to rotate the camera, or use arrow keys|نمای سه‌بعدی Seneschal؛ برای چرخش دوربین بکشید یا کلید جهت بزنید
Pause Seneschal motion|توقف حرکت Seneschal
Resume Seneschal motion|ادامهٔ حرکت Seneschal
Companion audio controls|کنترل صدای شخصیت
Reset Seneschal camera to front view|بازگردانی دوربین به نمای روبه‌رو
Resize Seneschal; drag or use arrow keys|تغییر اندازهٔ Seneschal؛ بکشید یا کلید جهت بزنید
Drag to resize; arrow keys also resize|برای تغییر اندازه بکشید؛ کلیدهای جهت هم کار می‌کنند
Seneschal position, size and camera|جای کارت، اندازه و دوربین Seneschal
Move Seneschal left|جابه‌جایی Seneschal به چپ
Move Seneschal up|جابه‌جایی Seneschal به بالا
Move Seneschal down|جابه‌جایی Seneschal به پایین
Move Seneschal right|جابه‌جایی Seneschal به راست
Rotate camera left|چرخش دوربین به چپ
Rotate camera up|چرخش دوربین به بالا
Rotate camera down|چرخش دوربین به پایین
Rotate camera right|چرخش دوربین به راست
Full-screen Seneschal voice companion|شخصیت همراه Seneschal در نمای تمام‌صفحه
Sending your decision…|در حال ارسال تصمیم شما…
Checking approval status… No decision is being sent.|در حال بررسی وضعیت اجازه… تصمیمی ارسال نمی‌شود.
Could not confirm your reply. Nothing was resent. Check status before trying again.|پاسخ شما تأیید نشد. چیزی دوباره ارسال نشد. پیش از تلاش دوباره وضعیت را بررسی کنید.
Remember this approval for this session|این اجازه را برای همین گفت‌وگو به خاطر بسپار
Requested action|اقدام درخواستی
↓ Latest|↓ آخرین پیام
Scroll to the end of this chat|رفتن به پایان این گفت‌وگو
Scroll to latest message|رفتن به آخرین پیام
Just now|همین حالا
Untitled session|گفت‌وگوی بدون نام
No sessions yet.|هنوز گفت‌وگویی وجود ندارد.
No pinned sessions.|هنوز گفت‌وگویی سنجاق نشده.
No pinned messages.|هنوز پیامی سنجاق نشده.
No projects yet.|هنوز پروژه‌ای وجود ندارد.
No archived sessions.|گفت‌وگوی بایگانی‌شده‌ای وجود ندارد.
No models found.|مدلی پیدا نشد.
Connect a provider|اتصال ارائه‌دهنده
Text + vision · chat only|متن + تصویر · فقط گفت‌وگو
Text · chat only|متن · فقط گفت‌وگو
Text + reasoning · chat only|متن + بررسی · فقط گفت‌وگو
Text|متن
Vision|تصویر
Reasoning|بررسی
Tools|ابزارها
Connected|متصل
Retrying|تلاش دوباره
Reconnecting|اتصال دوباره
Waiting|در انتظار
Recording|در حال ضبط
Preparing|در حال آماده‌سازی
Paused|متوقف
Mic muted|میکروفون قطع
Speaker muted|صدای خروجی قطع
Talk · Listening|مکالمه · در حال شنیدن
Talk · Thinking|مکالمه · در حال بررسی
Talk · Speaking|مکالمه · در حال صحبت
Talk · Ready|مکالمه · آماده
Talk · Muted|مکالمه · بی‌صدا
Stop recording|توقف ضبط
Stop dictation|توقف دیکته
Hold to record|برای ضبط نگه دارید
Hold to talk|برای صحبت نگه دارید
Release to send|برای ارسال رها کنید
Uses your current conversation and voice service.|از گفت‌وگو و سرویس صدای فعلی شما استفاده می‌کند.
Enter to send · Shift Enter for line|Enter برای ارسال · Shift Enter برای خط جدید
`);
  register(`
Project:|پروژه:
On|روشن
Off|خاموش
Processing|در حال پردازش
Sending|در حال ارسال
Talk active|مکالمه فعال است
Mic active|میکروفون فعال است
Stop listening|توقف شنیدن
Stop voice dictation or recording|توقف دیکته یا ضبط صدا
Start Talk — sends spoken turns and reads replies. Use the arrow for options.|شروع مکالمه؛ گفتار خودکار ارسال و پاسخ خوانده می‌شود. تنظیمات با پیکان باز می‌شود.
Talk mode stopped.|مکالمه متوقف شد.
Send or clear the current draft before starting Talk mode.|پیش از شروع مکالمه، پیش‌نویس فعلی را ارسال یا پاک کنید.
Choose a project and connect a model before starting Talk mode.|پیش از شروع مکالمه، یک پروژه و مدل متصل انتخاب کنید.
Accept the NVIDIA cloud-audio notice inside Voice first.|ابتدا در بخش صدا، اطلاعیهٔ ارسال صدا به ابر NVIDIA را تأیید کنید.
Accept the NVIDIA cloud-audio notice in Voice first.|ابتدا در بخش صدا، اطلاعیهٔ ارسال صدا به ابر NVIDIA را تأیید کنید.
Talk mode needs current Chrome or Edge speech recognition.|حالت مکالمه به تشخیص گفتار نسخهٔ جدید Chrome یا Edge نیاز دارد.
Talk mode needs current Chrome or Edge with microphone access.|مکالمه به Chrome یا Edge جدید با اجازهٔ میکروفون نیاز دارد.
Talk mode is on — speak naturally, My Lord. Click Voice again to stop; use its arrow for options.|مکالمه روشن است؛ طبیعی صحبت کنید. برای پایان، دوباره «صدا» را بزنید؛ تنظیمات با پیکان باز می‌شود.
This browser does not provide microphone recording. Open the workspace in current Chrome or Edge.|این مرورگر ضبط میکروفون ندارد. فضای کار را در Chrome یا Edge جدید باز کنید.
The voice recording could not be completed.|ضبط صدا کامل نشد.
Voice message attached — send it when ready.|پیام صوتی پیوست شد؛ هر وقت آماده بودید ارسال کنید.
Recording voice message — open Voice to finish recording.|پیام صوتی در حال ضبط است؛ برای پایان ضبط بخش صدا را باز کنید.
Microphone access was blocked. Allow it in the browser and try again.|دسترسی میکروفون مسدود است. در مرورگر اجازه دهید و دوباره امتحان کنید.
Microphone is muted. Unmute it in Voice before dictating.|میکروفون قطع است. پیش از دیکته آن را در بخش صدا وصل کنید.
NVIDIA speech uses Talk. Choose Browser voice to use Dictate or attach a recording.|گفتار NVIDIA از حالت مکالمه استفاده می‌کند. برای دیکته یا پیوست ضبط، صدای مرورگر را انتخاب کنید.
Listening — open Voice and choose Stop listening when finished.|در حال شنیدن؛ وقتی تمام شد، بخش صدا را باز و «توقف شنیدن» را انتخاب کنید.
Checking voice access…|در حال بررسی دسترسی صدا…
NVIDIA voice is available. English speech trial; remaining free quota is not reported. Use Talk to begin.|صدای NVIDIA در دسترس است. این آزمایش گفتار انگلیسی است؛ سهمیهٔ رایگان باقی‌مانده گزارش نمی‌شود. با «مکالمه» شروع کنید.
The selected NVIDIA voice is unavailable. Nothing was recorded.|صدای انتخابی NVIDIA در دسترس نیست. چیزی ضبط نشد.
NVIDIA voice could not complete. No fallback was used.|گفتار NVIDIA کامل نشد. سرویس جایگزینی استفاده نشد.
The running Seneschal host has not loaded NVIDIA voice. Finish active tasks, restart Seneschal on the PC, then reload this page. Nothing was switched to another service.|میزبان فعلی صدای NVIDIA را بارگذاری نکرده است. پس از پایان کارها، Seneschal را روی رایانه دوباره اجرا و این صفحه را تازه کنید. سرویس دیگری جایگزین نشده.
This browser does not support NVIDIA microphone capture.|این مرورگر ضبط میکروفون برای NVIDIA را پشتیبانی نمی‌کند.
Loading Seneschal…|در حال بارگذاری Seneschal…
Approval required — review the request above the message box.|اجازه لازم است؛ درخواست بالای کادر پیام را بررسی کنید.
The PC still lists this approval. Choose a decision again only if you intend to send it.|این درخواست هنوز روی رایانه منتظر است. فقط اگر قصد ارسال تصمیم را دارید، دوباره انتخاب کنید.
Could not confirm the approval reply. Nothing was resent. Use Check status before trying again.|پاسخ اجازه تأیید نشد. چیزی دوباره ارسال نشد. پیش از تلاش دوباره «بررسی وضعیت» را بزنید.
Approval policy saved. Close and reopen Seneschal to activate it.|سیاست اجازه‌ها ذخیره شد. برای فعال شدن، Seneschal را ببندید و دوباره باز کنید.
Offline. PC tasks may still be running. Reconnecting when your connection returns…|اتصال قطع است. کارهای رایانه ممکن است ادامه داشته باشند. پس از برگشت ارتباط، اتصال دوباره انجام می‌شود…
Reconnecting to the PC… Your messages will not be resent.|در حال اتصال دوباره به رایانه… پیام‌های شما دوباره ارسال نمی‌شوند.
Connected. Catching up with the latest messages and task status…|متصل شد. در حال دریافت آخرین پیام‌ها و وضعیت کار…
Phone access expired or was revoked. Open the pairing page to reconnect.|دسترسی گوشی منقضی یا باطل شده. برای اتصال دوباره صفحهٔ اتصال را باز کنید.
Access expired. Reopen Seneschal from its PC launcher.|دسترسی منقضی شده. Seneschal را از راه‌انداز روی رایانه دوباره باز کنید.
Sign in again|ورود دوباره
Pair this browser|اتصال این مرورگر
Workspace refreshed.|فضای کار تازه شد.
Session renamed.|نام گفت‌وگو تغییر کرد.
Conversation exported to Downloads.|خروجی گفت‌وگو در پوشهٔ دانلودها ذخیره شد.
Session pinned to the top.|گفت‌وگو در بالا سنجاق شد.
Session unpinned.|سنجاق گفت‌وگو برداشته شد.
Session archived locally.|گفت‌وگو در این رابط بایگانی شد.
Session restored.|گفت‌وگو بازگردانی شد.
Restore this session before pinning it.|پیش از سنجاق کردن، گفت‌وگو را بازگردانی کنید.
Stop this session before archiving it.|پیش از بایگانی، کار این گفت‌وگو را متوقف کنید.
Showing archived messages.|پیام‌های بایگانی‌شده نمایش داده می‌شوند.
Archived messages hidden.|پیام‌های بایگانی‌شده پنهان شدند.
Enter a project name.|نام پروژه را وارد کنید.
Use 80 characters or fewer without control characters.|حداکثر ۸۰ نویسه، بدون نویسه‌های کنترلی وارد کنید.
Unsaved changes|تغییرهای ذخیره‌نشده
Needs attention|نیاز به بررسی
Chat mode enabled. All tools and system actions are off.|حالت گفت‌وگو فعال شد. همهٔ ابزارها و اقدامات سیستم خاموش‌اند.
Close without saving your latest instruction edits?|بدون ذخیرهٔ آخرین تغییرهای دستورالعمل بسته شود؟
Reset the Agent Board? Linked OpenCode sessions will remain available in Sessions.|تابلوی عامل‌ها بازنشانی شود؟ گفت‌وگوهای مرتبط OpenCode در فهرست گفت‌وگوها می‌مانند.
Create a new board from this response? The current board stays available in History.|از این پاسخ تابلوی تازه‌ای ساخته شود؟ تابلوی فعلی در تاریخچه باقی می‌ماند.
Replace the current worker agents with the starter team? Imported source sessions and all linked sessions will remain.|عامل‌های کاری فعلی با تیم اولیه جایگزین شوند؟ گفت‌وگوهای واردشده و همهٔ گفت‌وگوهای مرتبط باقی می‌مانند.
This conversation has saved tool overrides from an earlier request. Use the configured permission policy for this message instead? This replaces its earlier tool overrides when the message is submitted, keeps its messages and files, and does not change other conversations. Cancel sends nothing.|این گفت‌وگو از درخواست قبلی دسترسی‌های ویژهٔ ابزار دارد. برای این پیام از سیاست اجازه‌های تنظیم‌شده استفاده شود؟ هنگام ارسال پیام، آن دسترسی‌های قبلی جایگزین می‌شوند؛ پیام‌ها و فایل‌ها حفظ می‌شوند و گفت‌وگوهای دیگر تغییر نمی‌کنند. با انصراف چیزی ارسال نمی‌شود.
Questions could not load. No answer or approval was sent.|پرسش‌ها بارگذاری نشدند. پاسخ یا اجازه‌ای ارسال نشده است.
Questions could not load. Check the PC connection, then refresh questions. No answer or approval was sent.|پرسش‌ها بارگذاری نشدند. اتصال رایانه را بررسی و سپس پرسش‌ها را تازه کنید. پاسخ یا اجازه‌ای ارسال نشده است.
Questions need a fresh sign-in or phone pairing. Reconnect, then refresh questions. Approvals are separate.|پرسش‌ها به ورود یا اتصال دوبارهٔ گوشی نیاز دارند. دوباره متصل و سپس پرسش‌ها را تازه کنید. اجازهٔ ابزار جداست.
This engine does not expose the question service. Tool approvals are separate and still require your decision.|این موتور سرویس پرسش را ارائه نمی‌کند. اجازه‌های ابزار جدا هستند و همچنان تصمیم شما را می‌خواهند.
The engine returned a question format this app cannot display. Refresh questions or use Classic OpenCode. Tool approvals are separate.|قالب پرسش موتور قابل‌نمایش نیست. پرسش‌ها را تازه یا از رابط اصلی OpenCode استفاده کنید. اجازهٔ ابزار جداست.
The question service is temporarily unavailable. Refresh questions to retry. No answer or approval was sent.|سرویس پرسش موقتاً در دسترس نیست. برای تلاش دوباره تازه‌سازی کنید. پاسخ یا اجازه‌ای ارسال نشده است.
SENESCHAL · LOCAL ACTIVITY|Seneschal · فعالیت‌های محلی
A record of your work|روایتی از کارهای شما
Explore sessions, inspect tools, and understand usage.|گفت‌وگوها و ابزارها را بررسی کنید و مصرف را بهتر بشناسید.
Refresh history|تازه‌سازی تاریخچه
Close Activity|بستن فعالیت‌ها
Activity views|نماهای فعالیت
Overview|نمای کلی
Usage|مصرف
Service|سرویس
Stored on this computer|ذخیره‌شده روی این رایانه
Powered by Agent Trail|با پشتیبانی Agent Trail
Local history|تاریخچهٔ محلی
Inspect current chat|بررسی گفت‌وگوی فعلی
Live agent activity|فعالیت زندهٔ عامل
Latest progress for this chat|آخرین پیشرفت این گفت‌وگو
Inspect history|بررسی تاریخچه
History ready|تاریخچه آماده است
Indexing|در حال فهرست‌سازی
Starting|در حال شروع
History incomplete|تاریخچه ناقص است
Service unavailable|سرویس در دسترس نیست
Stopping|در حال توقف
Checking service|بررسی سرویس
Period|بازه
Today|امروز
Last 7 days|۷ روز اخیر
Last 30 days|۳۰ روز اخیر
All history|همهٔ تاریخچه
Total tokens|کل توکن‌ها
Input tokens|توکن‌های ورودی
Output tokens|توکن‌های خروجی
Cache read|خواندن حافظهٔ موقت
Cache write|نوشتن حافظهٔ موقت
Estimated cost|هزینهٔ برآوردی
Active sessions|گفت‌وگوهای فعال
No ranking records available.|اطلاعات رتبه‌بندی موجود نیست.
No daily usage records available.|مصرف روزانه‌ای ثبت نشده.
Usage and estimates|مصرف و برآوردها
Your recent work|کارهای اخیر شما
Recorded consumption from OpenCode sessions.|مصرف ثبت‌شدهٔ گفت‌وگوهای OpenCode
A local overview of sessions and recorded usage.|نمای کلی محلی از گفت‌وگوها و مصرف ثبت‌شده
Sessions started|گفت‌وگوهای شروع‌شده
Includes worker sessions|شامل گفت‌وگوهای عامل‌های کاری
Recorded tokens|توکن‌های ثبت‌شده
Usage recorded in this period|مصرف ثبت‌شده در این بازه
Recorded token activity|روند مصرف توکن
All indexed days|همهٔ روزهای ثبت‌شده
7 days|۷ روز
30 days|۳۰ روز
Token categories|دسته‌های توکن
Input|ورودی
Output|خروجی
Reasoning tokens|توکن‌های بررسی
Models · session attribution|مدل‌ها · بر اساس گفت‌وگو
Projects · sessions started|پروژه‌ها · گفت‌وگوهای شروع‌شده
Recently updated sessions|گفت‌وگوهای تازه به‌روز‌شده
View all sessions|دیدن همهٔ گفت‌وگوها
No indexed sessions yet.|هنوز گفت‌وگویی فهرست نشده.
Live progress in this window|پیشرفت زنده در این پنجره
Export live events|ذخیرهٔ رویدادهای زنده
Resume view|ادامهٔ تازه‌سازی نما
Pause view|توقف تازه‌سازی نما
Session history|تاریخچهٔ گفت‌وگوها
Search titles and projects, or find text within recorded conversations.|عنوان و پروژه را جست‌وجو کنید، یا متن گفت‌وگوهای ثبت‌شده را پیدا کنید.
Find a session…|پیدا کردن گفت‌وگو…
Search in|جست‌وجو در
Titles and projects|عنوان‌ها و پروژه‌ها
Conversation text|متن گفت‌وگو
Recorded status|وضعیت ثبت‌شده
All statuses|همهٔ وضعیت‌ها
Clear project filter|برداشتن فیلتر پروژه
Conversation search shows up to 50 matching sessions. Refine the text for more specific results.|جست‌وجوی متن حداکثر ۵۰ گفت‌وگوی مرتبط نشان می‌دهد. برای نتیجهٔ دقیق‌تر، متن جست‌وجو را مشخص‌تر کنید.
Includes ordinary chats and worker sessions. Status is recorded history; it may differ from a currently running task.|شامل گفت‌وگوهای عادی و عامل‌های کاری است. وضعیت، مربوط به تاریخچه است و ممکن است با کار زنده فرق کند.
No matching sessions|گفت‌وگویی پیدا نشد
Change your filters or search text.|فیلترها یا متن جست‌وجو را تغییر دهید.
History is still indexing. Refresh shortly.|تاریخچه هنوز فهرست می‌شود. کمی بعد تازه‌سازی کنید.
Refresh history after running an OpenCode session.|پس از اجرای یک گفت‌وگوی OpenCode، تاریخچه را تازه کنید.
Arguments|ورودی ابزار
Recorded output|خروجی ثبت‌شده
No output recorded.|خروجی ثبت نشده.
Inspect child session|بررسی گفت‌وگوی زیرمجموعه
Reasoning record is redacted.|گزارش بررسی پوشانده شده است.
Recorded reasoning summary|خلاصهٔ ثبت‌شدهٔ بررسی
Loading session history|بارگذاری تاریخچهٔ گفت‌وگو
Retrieving the recorded conversation…|دریافت گفت‌وگوی ثبت‌شده…
← Session history|→ تاریخچهٔ گفت‌وگو
Open chat|باز کردن گفت‌وگو
Parent session|گفت‌وگوی والد
This record is incomplete or contains a compaction boundary.|این سابقه ناقص است یا بخشی از گفت‌وگو در آن فشرده شده است.
Latest live progress|آخرین پیشرفت زنده
Captured in this window|ثبت‌شده در این پنجره
Incomplete|ناقص
No turns indexed yet|هنوز نوبتی فهرست نشده
Refresh history to pick up the latest recorded messages.|برای دریافت آخرین پیام‌های ثبت‌شده، تاریخچه را تازه کنید.
Load more turns|بارگذاری نوبت‌های بیشتر
PC history service|سرویس تاریخچهٔ رایانه
Checking the PC…|بررسی رایانه…
History is available|تاریخچه در دسترس است
Use Overview, Sessions or Usage to explore the PC history index.|برای دیدن تاریخچهٔ رایانه از نمای کلی، گفت‌وگوها یا مصرف استفاده کنید.
Waiting for PC history|در انتظار تاریخچهٔ رایانه
On your PC, open Activity → Service and enable “Start Activity with Seneschal”. Prepare local history once on the PC if needed. This phone will load the dashboard when the service is available.|در رایانه بخش فعالیت‌ها ← سرویس را باز و «شروع فعالیت‌ها همراه Seneschal» را فعال کنید. در صورت نیاز تاریخچهٔ محلی را یک‌بار آماده کنید. گوشی پس از آماده شدن سرویس، داشبورد را بارگذاری می‌کند.
Check PC status|بررسی وضعیت رایانه
Available from your phone|در دسترس از گوشی
Start Activity with Seneschal|شروع فعالیت‌ها همراه Seneschal
Save startup preference|ذخیرهٔ تنظیم شروع خودکار
Loading startup preference…|بارگذاری تنظیم شروع خودکار…
Saving startup preference…|ذخیرهٔ تنظیم شروع خودکار…
Not recorded|ثبت نشده
Rebuild the local history index? The previous index will be backed up, and recorded history will be imported again.|فهرست محلی تاریخچه دوباره ساخته شود؟ از فهرست قبلی پشتیبان گرفته و تاریخچهٔ ثبت‌شده دوباره وارد می‌شود.
SENESCHAL · PC CONTROL|Seneschal · کنترل رایانه
Private phone access|دسترسی خصوصی گوشی
Start, stop and pair|شروع، توقف و اتصال
PC-only controls · no automatic startup|فقط روی رایانه · بدون شروع خودکار
Phone access|دسترسی گوشی
Close phone access|بستن دسترسی گوشی
Checking gateway…|بررسی درگاه…
Closing the Seneschal window does|بستن پنجرهٔ Seneschal
not|نمی‌تواند
stop the PC host. Your PC must stay awake and connected. Docker is only needed for verification.|میزبان رایانه را متوقف کند. رایانه باید بیدار و متصل بماند. Docker فقط برای بررسی صحت لازم است.
Start phone access|شروع دسترسی گوشی
Pair a browser|اتصال مرورگر
Stop phone access|توقف دسترسی گوشی
Stop revokes every paired browser and unused code. It does not cancel PC tasks, delete history or remove the private Tailscale mapping.|توقف، اتصال همهٔ مرورگرها و کدهای استفاده‌نشده را باطل می‌کند. کارهای رایانه لغو، تاریخچه حذف یا مسیر خصوصی Tailscale برداشته نمی‌شود.
Open on your phone|در گوشی باز کنید
Keep Tailscale connected on both devices. This control does not create a network mapping.|Tailscale را در هر دو دستگاه متصل نگه دارید. این گزینه مسیر شبکه ایجاد نمی‌کند.
One-time code · enter only on your phone|کد یک‌بارمصرف · فقط در گوشی وارد کنید
Single use. Expires in 10 minutes. Do not paste or screenshot this code into chat.|یک‌بارمصرف؛ پس از ۱۰ دقیقه منقضی می‌شود. کد یا تصویر آن را در گفت‌وگو نفرستید.
Paired browsers|مرورگرهای متصل
Gateway running|درگاه فعال است
Gateway stopped|درگاه متوقف است
Gateway status unknown|وضعیت درگاه نامشخص است
Setup needs review|تنظیمات نیاز به بررسی دارد
Private setup needed|راه‌اندازی خصوصی لازم است
No active paired browsers.|مرورگر متصل فعالی وجود ندارد.
Active browsers can be checked when the gateway is running.|وقتی درگاه فعال باشد، مرورگرهای متصل قابل‌بررسی هستند.
Revoke|لغو دسترسی
Working…|در حال انجام…
The displayed code expired. Request a new code on this PC.|کد نمایش‌داده‌شده منقضی شد. روی همین رایانه کد تازه بخواهید.
New code ready. Any earlier unused code is no longer valid.|کد تازه آماده است. کدهای قبلی استفاده‌نشده دیگر معتبر نیستند.
Browser revoked. PC tasks continue.|دسترسی مرورگر لغو شد. کارهای رایانه ادامه دارند.
Status check timed out. Refresh to check again; no action was retried.|زمان بررسی وضعیت تمام شد. تازه‌سازی کنید؛ اقدامی دوباره اجرا نشد.
Action timed out and may have completed. Refresh the status before trying again; nothing was automatically retried.|مهلت تمام شد و ممکن است اقدام انجام شده باشد. پیش از تلاش دوباره وضعیت را تازه کنید؛ چیزی خودکار تکرار نشده.
Private connection · Runs on|اتصال خصوصی · اجرا روی
Private connection|اتصال خصوصی
`);
  register(`
Waiting for your answer|در انتظار پاسخ شما
Sending your response…|در حال ارسال پاسخ شما…
Only Send answers or Dismiss question replies to the engine. Closing leaves it pending.|فقط «ارسال پاسخ‌ها» یا «رد درخواست پرسش» به موتور پاسخ می‌دهد. با بستن، پرسش در انتظار می‌ماند.
Release to dock in sidebar|برای قرار گرفتن در نوار کناری رها کنید
Seneschal could not load. Voice still works. Check browser 3D support; after an update, restart Seneschal when tasks finish and reload.|Seneschal بارگذاری نشد؛ صدا همچنان کار می‌کند. پشتیبانی سه‌بعدی مرورگر را بررسی کنید؛ پس از به‌روزرسانی، با پایان کارها برنامه را دوباره اجرا و صفحه را تازه کنید.
Seneschal is not loaded by this Seneschal host. Finish active tasks, restart Seneschal only, then reload this page.|این میزبان شخصیت Seneschal را بارگذاری نکرده. پس از پایان کارهای فعال، فقط Seneschal را دوباره اجرا و این صفحه را تازه کنید.
NVIDIA voice has not loaded. Finish active tasks, restart Seneschal on the PC, then reload this page. Browser speech was not used instead.|صدای NVIDIA بارگذاری نشده. پس از پایان کارها، Seneschal را روی رایانه دوباره اجرا و این صفحه را تازه کنید. صدای مرورگر جایگزین نشده.
This running Seneschal service does not support this action yet. Close and reopen Seneschal only; Windows does not need restarting.|سرویس فعلی هنوز این اقدام را پشتیبانی نمی‌کند. فقط Seneschal را ببندید و باز کنید؛ راه‌اندازی دوبارهٔ Windows لازم نیست.
The service returned an unexpected response. Close and reopen Seneschal only, then retry.|سرویس پاسخ نامنتظره داد. فقط Seneschal را ببندید و باز کنید، سپس دوباره امتحان کنید.
Request failed|درخواست ناموفق بود
Seneschal and OpenCode updates|به‌روزرسانی Seneschal و OpenCode
Seneschal application|برنامهٔ Seneschal
Check latest Seneschal release|بررسی آخرین نسخهٔ Seneschal
OpenCode engine|موتور OpenCode
Checked separately from Seneschal. Updates stay on the installed major version; existing sessions and configuration are preserved.|جدا از Seneschal بررسی می‌شود. به‌روزرسانی در نسخهٔ اصلی نصب‌شده می‌ماند؛ گفت‌وگوها و تنظیمات فعلی حفظ می‌شوند.
Check latest OpenCode release|بررسی آخرین نسخهٔ OpenCode
Checking installed version and official releases…|بررسی نسخهٔ نصب‌شده و انتشارهای رسمی…
Update available.|به‌روزرسانی موجود است.
No newer compatible release found.|نسخهٔ سازگار جدیدتری پیدا نشد.
A newer major version exists but is not selected automatically.|نسخهٔ اصلی جدیدتری وجود دارد، ولی خودکار انتخاب نمی‌شود.
Update OpenCode engine|به‌روزرسانی موتور OpenCode
Update Seneschal|به‌روزرسانی Seneschal
Update unavailable|به‌روزرسانی در دسترس نیست
No update available|به‌روزرسانی تازه‌ای نیست
Downloading and installing…|در حال دریافت و نصب…
The running Seneschal service needs restarting to load Activity.|برای بارگذاری فعالیت‌ها، سرویس Seneschal باید دوباره اجرا شود.
Activity could not load this view.|فعالیت‌ها نتوانست این نما را بارگذاری کند.
Startup preferences and service controls are managed on your PC. Your private connection does not expose the history service publicly.|تنظیم شروع خودکار و کنترل سرویس روی رایانه مدیریت می‌شود. اتصال خصوصی شما، سرویس تاریخچه را عمومی نمی‌کند.
Off by default. Applies to future Seneschal host launches, not Windows startup. Uses the installed history runtime only; prepare it once here on the PC if needed. Saving does not start or stop the current service. The PC must stay awake and connected.|پیش‌فرض خاموش است. برای اجرای بعدی میزبان Seneschal است، نه شروع Windows. فقط از برنامهٔ تاریخچهٔ نصب‌شده استفاده می‌کند؛ در صورت نیاز همین‌جا روی رایانه یک‌بار آماده‌اش کنید. ذخیره کردن، سرویس فعلی را شروع یا متوقف نمی‌کند. رایانه باید بیدار و متصل بماند.
Startup preference could not load. If Seneschal was just updated, restart its host once, then reopen Service.|تنظیم شروع خودکار بارگذاری نشد. اگر Seneschal تازه به‌روز شده، میزبان را یک‌بار دوباره اجرا و بخش سرویس را باز کنید.
Saved. Activity will start with future Seneschal host launches. No Windows startup task was added.|ذخیره شد. فعالیت‌ها در اجرای بعدی میزبان Seneschal شروع می‌شود. کاری به شروع Windows اضافه نشد.
Saved. Automatic Activity startup is off; a running history service was not stopped.|ذخیره شد. شروع خودکار فعالیت‌ها خاموش است؛ سرویس تاریخچهٔ در حال کار متوقف نشد.
Startup preference could not be saved.|تنظیم شروع خودکار ذخیره نشد.
Waiting for the history service on your PC. No service was started from this phone.|در انتظار سرویس تاریخچهٔ رایانه. سرویسی از این گوشی شروع نشده است.
Showing the latest index available from the PC.|نمایش آخرین فهرست موجود از رایانه
Manage the history service on your host PC.|سرویس تاریخچه را روی رایانهٔ میزبان مدیریت کنید.
Start the local Activity service before reading history.|پیش از خواندن تاریخچه، سرویس محلی فعالیت‌ها را شروع کنید.
Your work, in perspective|نمایی از کارهای شما
Start the local history service to explore recorded sessions and usage.|برای بررسی گفت‌وگوها و مصرف ثبت‌شده، سرویس تاریخچهٔ محلی را شروع کنید.
Start local history|شروع تاریخچهٔ محلی
Start Activity to load local history.|برای بارگذاری تاریخچهٔ محلی، فعالیت‌ها را شروع کنید.
Prepare local history|آماده‌سازی تاریخچهٔ محلی
Stop history service|توقف سرویس تاریخچه
Restart history service|راه‌اندازی دوبارهٔ سرویس تاریخچه
Rebuild index|بازسازی فهرست
From conversation to insight|از گفت‌وگو تا شناخت
Local history pipeline|مسیر تاریخچهٔ محلی
01 · SOURCE|۰۱ · منبع
Recorded chats|گفت‌وگوهای ثبت‌شده
OpenCode sessions and tool outputs|گفت‌وگوهای OpenCode و خروجی ابزارها
Explore history ↗|بررسی تاریخچه ↗
02 · LOCAL INDEX|۰۲ · فهرست محلی
History service|سرویس تاریخچه
Agent Trail reads and indexes records|Agent Trail سوابق را می‌خواند و فهرست می‌کند
03 · INSIGHTS|۰۳ · شناخت
Usage & estimates|مصرف و برآوردها
Daily consumption, projects and models|مصرف روزانه، پروژه‌ها و مدل‌ها
Explore usage ↗|بررسی مصرف ↗
Original history is the source; the local index powers these views. Live progress below is captured separately in this window.|تاریخچهٔ اصلی منبع است و این نماها از فهرست محلی ساخته می‌شوند. پیشرفت زندهٔ پایین جداگانه در این پنجره ثبت می‌شود.
How recent sessions connect|ارتباط گفت‌وگوهای اخیر
No recorded relationships yet.|هنوز ارتباطی ثبت نشده.
Only the five recently updated records are shown. Lines connect recorded parent and worker sessions; select a node to inspect it.|فقط پنج سابقهٔ تازه به‌روزشده نشان داده می‌شود. خط‌ها گفت‌وگوهای والد و عامل را وصل می‌کنند؛ برای بررسی، یکی را انتخاب کنید.
Worker|عامل کاری
Parent outside this view|والد خارج از این نما
Parent chat|گفت‌وگوی والد
Where tokens go|مصرف توکن‌ها در کجاست؟
Recorded token categories|دسته‌های توکن ثبت‌شده
Partial|بخشی از داده
category tokens|توکن دسته‌ها
Share unavailable|سهم نامشخص
Shares of the four recorded categories.|سهم چهار دستهٔ ثبت‌شده
Category reporting is incomplete; proportions are hidden.|گزارش دسته‌ها ناقص است؛ نسبت‌ها پنهان‌اند.
No project|بدون پروژه
Model not recorded|مدل ثبت نشده
Historical match|نتیجهٔ تاریخچه
Unknown|نامشخص
Aborted|لغوشده
Active|فعال
Complete|تمام‌شده
Run|اجرا
Run again|اجرای دوباره
Open session|باز کردن گفت‌وگو
Open board|باز کردن تابلو
Edit agent|ویرایش عامل
Delete card|حذف کارت
Stop this agent before editing|پیش از ویرایش، این عامل را متوقف کنید
Selected plan|برنامهٔ انتخاب‌شده
No task written yet.|هنوز وظیفه‌ای نوشته نشده.
Imported model|مدل واردشده
Current model|مدل فعلی
Live activity|فعالیت زنده
Per request|در هر درخواست
Global|سراسری
The same paired browser can return for 12 hours without another code, unless disconnected, revoked or its cookie is cleared. Restarting the gateway alone does not revoke it.|همین مرورگر متصل تا ۱۲ ساعت بدون کد تازه برمی‌گردد، مگر اینکه اتصال قطع، دسترسی باطل یا کوکی پاک شود. راه‌اندازی دوبارهٔ درگاه به‌تنهایی دسترسی را باطل نمی‌کند.
`);
  register(`
Minimal|بسیار کم
Extra high|بسیار زیاد
Maximum|بیشترین
Fast|سریع
Standard|معمولی
Seneschal · Build|Seneschal · اجرا
Seneschal · Plan|Seneschal · برنامه‌ریزی
Seneschal · Chat|Seneschal · گفت‌وگو
Pin a session to keep it here.|برای نگه داشتن یک گفت‌وگو در اینجا، آن را سنجاق کنید.
No unpinned sessions in this project.|گفت‌وگوی سنجاق‌نشده‌ای در این پروژه نیست.
Chat mode has no active tools.|حالت گفت‌وگو ابزار فعالی ندارد.
Policy will appear when a project is selected.|با انتخاب پروژه، سیاست اجازه‌ها نمایش داده می‌شود.
No connected providers reported.|ارائه‌دهندهٔ متصلی گزارش نشده.
Connected providers|ارائه‌دهندگان متصل
Navigate, click, type, inspect, screenshot|باز کردن صفحه، کلیک، تایپ، بررسی و تصویر گرفتن
Browser bridge is not available|اتصال مرورگر در دسترس نیست
Blender bridge is live on this PC|اتصال Blender روی این رایانه فعال است
Ready — open Blender when needed|آماده؛ در صورت نیاز Blender را باز کنید
MCP bridge is not connected|اتصال MCP برقرار نیست
Estimate unavailable|برآورد در دسترس نیست
Repair required|نیاز به ترمیم اتصال
Visible Brave|پنجرهٔ Brave نمایان است
Connected · hidden|متصل · پنهان
Hidden mode|حالت پنهان
`);
  /* Wallpaper worlds and Activity service: authored UI, not history content. */
  register(`
Orbit Drift|مدار آرام
Essentials|نماهای ساده
PIXEL WORLD|دنیای پیکسلی
WORKSPACE ATMOSPHERES / 01—09|پس‌زمینه‌های فضای کار / \u2066۰۱—۰۹\u2069
Still|ثابت
Seneschal originals|صحنه‌های اصلی Seneschal
RESTORED · LIVING ORIGINAL|نسخهٔ اصلیِ زنده، بازگردانی‌شده
City|شهر
Lunar|ماه
Foundry|کارگاه مداری
Starlight|نور ستاره
Afterlight collection|مجموعهٔ Afterlight
Sleeper|قطار شبانه
Pelagic|اعماق دریا
Sanctuary|پناهگاه
Still composition|نمای ثابت
Citylight|روشنای شهر
City Nocturne|شب‌آهنگ شهر
Lunar Relay|پایگاه ماه
Orbital Foundry|کارگاه مداری
Canal City|شهر آبراهه‌ها
Northstar|ستارهٔ شمال
The Last Sleeper|آخرین واگن شبانه
Pelagic Archive|آرشیو اعماق
Lantern Sanctuary|پناهگاه فانوس‌ها
The original slow geometric composition.|نمای هندسی اصلی با حرکت آرام.
A quiet workspace without background animation.|فضای کاری آرام، بدون حرکت پس‌زمینه.
The original jade skyline and copper moon, with a living avenue, rooftop lanterns and rain-lit reflections.|خط افق یشمی و ماه مسی، با خیابانی زنده، فانوس‌های پشت‌بام و بازتاب باران.
A working night street: passing traffic, a busy kitchen, rooftop company and reflections in the rain.|خیابانی زنده در شب؛ رفت‌وآمد خودروها، آشپزخانه‌ای شلوغ، همراهان پشت‌بام و بازتاب باران.
A working lunar outpost: rovers, service drones and a survey team move beneath the light of Earth.|پایگاهی فعال روی ماه؛ ماه‌نوردها، پهپادهای خدماتی و گروه نقشه‌برداری زیر نور زمین حرکت می‌کنند.
A living orbital shipyard, with docking traffic, repair operations and a working habitat ring.|کارگاهی زنده در مدار، با رفت‌وآمد سفینه‌ها، عملیات تعمیر و حلقهٔ سکونت فعال.
A sleepless city, passing trains and a warm rooftop studio.|شهری بیدار، قطارهای در حال عبور و کارگاهی گرم روی پشت‌بام.
A timber observatory above a glacial lake. The northern sky keeps watch.|رصدخانه‌ای چوبی بالای دریاچه‌ای یخچالی، زیر آسمان آرام شمال.
The quietest seat on a night train. Snowy valleys slip past your window.|آرام‌ترین صندلی قطار شبانه؛ دره‌های برفی از کنار پنجره می‌گذرند.
A glass research room at the ocean floor. A whale moves through the blue.|اتاق پژوهشی شیشه‌ای در کف اقیانوس؛ نهنگی در آبی دریا شنا می‌کند.
A cedar pavilion, a reflecting pool and a thousand quiet mountain steps.|کوشکی چوبی، حوضی آینه‌گون و پله‌های آرام کوهستان.
Send avenue traffic|حرکت خودروها در خیابان
Release rooftop lanterns|رها کردن فانوس‌های پشت‌بام
Greet the rooftop cat|سلام به گربهٔ پشت‌بام
Sweep the tower signal|فرستادن سیگنال برج
Switch city lights|تغییر چراغ‌های شهر
Ripple the avenue puddles|موج انداختن در چاله‌های آب خیابان
Send street traffic|حرکت خودروهای خیابان
Wake the night kitchen|فعال کردن آشپزخانهٔ شبانه
Greet the street cat|سلام به گربهٔ خیابان
Send the rooftop signal|فرستادن سیگنال پشت‌بام
Switch window lights|تغییر چراغ پنجره‌ها
Ripple the street puddles|موج انداختن در آب خیابان
Dispatch a lunar rover|فرستادن ماه‌نورد
Launch the service drone|پرواز پهپاد خدماتی
Call the lunar surveyor|فراخواندن نقشه‌بردار ماه
Send a relay pulse|فرستادن پالس مخابراتی
Switch base lights|تغییر چراغ‌های پایگاه
Stir a lunar dust trail|بلند کردن غبار ماه
Dispatch a cargo shuttle|فرستادن شاتل باربری
Start a robotic repair|آغاز تعمیر با ربات
Call the maintenance robot|فراخواندن ربات تعمیرکار
Send a dock signal|فرستادن سیگنال اسکله
Switch station lights|تغییر چراغ‌های ایستگاه
Release a coolant vent|تخلیهٔ بخار خنک‌کننده
Send a night train|عبور قطار شبانه
Release a lantern|رها کردن فانوس
Say hello to the cat|سلام به گربه
Make a wish|آرزو کردن
Switch studio lights|تغییر چراغ‌های کارگاه
Ripple the canal|موج انداختن در آبراهه
Sweep the telescope|چرخاندن تلسکوپ
Send a firefly flight|پرواز کرم‌های شب‌تاب
Wake the fox|بیدار کردن روباه
Send a falling star|نمایش شهاب
Switch cabin lights|تغییر چراغ‌های کلبه
Ripple the lake|موج انداختن در دریاچه
Pass a lit village|عبور از روستای روشن
Pour another tea|ریختن یک چای دیگر
Wake the sleeping cat|بیدار کردن گربه
A shooting star outside|نمایش شهاب پشت پنجره
Switch reading lamp|تغییر چراغ مطالعه
Draw / open curtains|باز و بسته کردن پرده‌ها
Launch the submersible|حرکت زیردریایی پژوهشی
Release a jellyfish bloom|رها کردن دستهٔ عروس‌های دریایی
Call the whale|فراخواندن نهنگ
Pulse the sonar|فرستادن پالس سونار
Send a bubble column|فرستادن ستون حباب
Ring the mountain bell|نواختن ناقوس کوهستان
Release floating lanterns|رها کردن فانوس‌های شناور
Visit the koi pond|تماشای حوض ماهی‌ها
Light the hillside path|روشن کردن مسیر کوهستان
Switch pavilion lights|تغییر چراغ‌های کوشک
Ripple the reflecting pool|موج انداختن در حوض
City life & avenue traffic|جنب‌وجوش شهر و رفت‌وآمد خیابان
Window warmth|گرمای نور پنجره‌ها
Rooftop life & skyline details|زندگی پشت‌بام و جزئیات خط افق
Street life & passing traffic|جنب‌وجوش خیابان و خودروهای در حال عبور
Shop & window warmth|گرمای نور مغازه‌ها و پنجره‌ها
Night kitchen & rooftop life|آشپزخانهٔ شبانه و زندگی پشت‌بام
Rovers, drones & survey activity|فعالیت ماه‌نوردها، پهپادها و نقشه‌بردارها
Habitat & relay lights|چراغ‌های سکونتگاه و مخابرات
Surface operations & relay details|عملیات سطح ماه و جزئیات مخابرات
Docking traffic & machinery|رفت‌وآمد سفینه‌ها و دستگاه‌ها
Station & work lights|چراغ‌های ایستگاه و کارگاه
Shipyard operations & ring details|فعالیت کارگاه سفینه‌سازی و جزئیات حلقه
Studio life|جنب‌وجوش کارگاه
City life|جنب‌وجوش شهر
Northern lights|شفق قطبی
Fireflies & stars|کرم‌های شب‌تاب و ستاره‌ها
Cabin warmth|گرمای نور کلبه
Moving landscape|منظرهٔ در حال حرکت
Journey speed|سرعت سفر
Reading-lamp warmth|گرمای چراغ مطالعه
Passing whale|عبور نهنگ
Marine life|زندگی دریایی
Station glow|درخشش ایستگاه
Falling blossoms|ریزش شکوفه‌ها
Petals & fireflies|گلبرگ‌ها و کرم‌های شب‌تاب
Lantern warmth|گرمای نور فانوس‌ها
Water movement|حرکت آب
Water particles|ذرات در آب
Calm|آرام
Current|جریان آب
Drifting particles|ذرات شناور
Suspended haze|مه معلق
This scene could not load. Choose another scene or reload the workspace.|این صحنه بارگیری نشد. صحنهٔ دیگری انتخاب کنید یا صفحه را تازه کنید.
Still frame · system Reduced motion is on. Actions show one frame without starting animation.|نمای ثابت؛ کاهش حرکت در سیستم روشن است. هر دکمه فقط یک تصویر نشان می‌دهد و حرکت را آغاز نمی‌کند.
Still frame · motion is manually paused. Select Resume to animate again.|نمای ثابت؛ حرکت را متوقف کرده‌اید. برای ادامه، «ادامهٔ حرکت» را بزنید.
Motion paused while this window is hidden.|هنگام پنهان بودن این پنجره، حرکت متوقف است.
Still frame · quiet conversation mode. Enable Animate during conversations to keep the background moving.|نمای ثابت در حالت گفت‌وگوی آرام؛ برای حرکت پس‌زمینه، «حرکت هنگام گفت‌وگو» را روشن کنید.
Gallery thumbnails are still images. Explore full scene to see the animation.|تصویرهای گالری ثابت‌اند. برای دیدن حرکت، نمای کامل صحنه را باز کنید.
Still composition · no animation by design.|این نمای ثابت عمداً حرکت ندارد.
Conversation animation is enabled. Manual pause, hidden windows and system Reduced motion still take priority.|حرکت پس‌زمینه هنگام گفت‌وگو روشن است. توقف دستی، پنهان بودن پنجره و کاهش حرکت سیستم همچنان اولویت دارند.
Conversations use a still frame by default. Home and full-scene previews animate unless motion is paused or system Reduced motion is on.|هنگام گفت‌وگو، پس‌زمینه به‌طور پیش‌فرض ثابت است. صفحهٔ اصلی و پیش‌نمایش کامل حرکت دارند، مگر حرکت را متوقف کنید یا کاهش حرکت سیستم روشن باشد.
Local history service|سرویس تاریخچهٔ محلی
Manage the runtime and the derived history index.|سرویس و فهرست ساخته‌شده از تاریخچه را مدیریت کنید.
Local history is ready.|تاریخچهٔ محلی آماده است.
Local history is available.|تاریخچهٔ محلی در دسترس است.
Runtime|برنامهٔ سرویس
History source|منبع تاریخچه
Local index|فهرست محلی
Last refreshed|آخرین به‌روزرسانی
Recorded source sessions|تعداد گفت‌وگوهای ثبت‌شده در منبع
Configured OpenCode database|پایگاه دادهٔ تنظیم‌شدهٔ OpenCode
Created on first start|در نخستین اجرا ساخته می‌شود
Checking local service…|در حال بررسی سرویس محلی…
Restart service|راه‌اندازی دوبارهٔ سرویس
Stop service|توقف سرویس
Rebuild history index|بازسازی فهرست تاریخچه
Rebuilding preserves the previous index as a local backup and reads the original history again.|بازسازی، فهرست قبلی را به‌عنوان نسخهٔ پشتیبان محلی نگه می‌دارد و تاریخچهٔ اصلی را دوباره می‌خواند.
Diagnostics and compatibility|بررسی مشکلات و سازگاری
The tested runtime is Agent Trail 0.1.7. Logs are saved in|نسخهٔ بررسی‌شده، Agent Trail 0.1.7 است. گزارش‌ها در این فایل ذخیره می‌شوند:
Session history is read from OpenCode. Other applications are excluded from this Seneschal index.|تاریخچهٔ گفت‌وگوها از OpenCode خوانده می‌شود. دادهٔ برنامه‌های دیگر وارد این فهرست نمی‌شود.
Open original Agent Trail dashboard ↗|باز کردن داشبورد اصلی Agent Trail ↗
Indexing local history. Available records can already be opened.|تاریخچهٔ محلی در حال فهرست‌شدن است. سوابق آماده را می‌توانید باز کنید.
OpenCode history could not be read. Check the source database in Service.|خواندن تاریخچهٔ OpenCode ممکن نشد. پایگاه دادهٔ منبع را در بخش سرویس بررسی کنید.
History refresh was incomplete. Refresh again or inspect Service.|تازه‌سازی تاریخچه کامل نشد. دوباره تازه کنید یا بخش سرویس را بررسی کنید.
Preparing the local history service…|در حال آماده‌سازی سرویس تاریخچهٔ محلی…
Activity is stopped.|سرویس فعالیت‌ها متوقف است.
Available from your phone|دسترسی از تلفن همراه
Start Activity with Seneschal|اجرای فعالیت‌ها همراه Seneschal
Save startup preference|ذخیرهٔ تنظیم اجرای خودکار
Saving startup preference…|در حال ذخیرهٔ تنظیم اجرای خودکار…
Loading startup preference…|در حال بارگیری تنظیم اجرای خودکار…
Startup preference could not be saved.|ذخیرهٔ تنظیم اجرای خودکار ممکن نشد.
Off by default. Applies to future Seneschal host launches, not Windows startup. Uses the installed history runtime only; prepare it once here on the PC if needed. Saving does not start or stop the current service. The PC must stay awake and connected.|به‌طور پیش‌فرض خاموش است. این گزینه به اجرای بعدی Seneschal مربوط است، نه شروع ویندوز. فقط از سرویس تاریخچهٔ نصب‌شده استفاده می‌کند؛ در صورت نیاز، آن را یک‌بار روی رایانه آماده کنید. ذخیرهٔ این گزینه سرویس فعلی را روشن یا خاموش نمی‌کند. رایانه باید روشن و متصل بماند.
Saved. Activity will start with future Seneschal host launches. No Windows startup task was added.|ذخیره شد. فعالیت‌ها در اجراهای بعدی Seneschal شروع می‌شود. کاری به شروع خودکار ویندوز اضافه نشد.
Saved. Automatic Activity startup is off; a running history service was not stopped.|ذخیره شد. اجرای خودکار فعالیت‌ها خاموش است؛ سرویس فعلی متوقف نشد.
PC history service|سرویس تاریخچهٔ رایانه
History is available|تاریخچه در دسترس است
Use Overview, Sessions or Usage to explore the PC history index.|برای بررسی تاریخچهٔ رایانه، از نمای کلی، گفت‌وگوها یا مصرف استفاده کنید.
Startup preferences and service controls are managed on your PC. Your private connection does not expose the history service publicly.|تنظیم اجرای خودکار و کنترل سرویس روی رایانه مدیریت می‌شود. اتصال خصوصی شما سرویس تاریخچه را عمومی نمی‌کند.
`);
  /* END LANGUAGE COPY */
  const normalize = value => String(value ?? '').replace(/\s+/g, ' ').trim();
  const languages = Object.freeze({ en: { label: 'English', dir: 'ltr', locale: 'en-US' }, fa: { label: 'فارسی', dir: 'rtl', locale: 'fa-IR-u-ca-gregory' } });
  const storageKey = 'seneschal-interface-language-v1';
  let language = 'en';
  const number = (value, options) => new Intl.NumberFormat(languages[language].locale, options).format(value);
  const date = (value, options) => new Intl.DateTimeFormat(languages[language].locale, options).format(new Date(value));
  const patterns = [
    [/^Last indexed (.+?)( · Coverage may be incomplete)?$/, (when, partial) => `آخرین فهرست‌سازی: ${when}${partial ? ' · ممکن است بخشی از سوابق هنوز آماده نباشد' : ''}`],
    [/^([1-6])\. (.+)$/, (n, label) => t(label) === label ? `${n}. ${label}` : `${number(Number(n))}. ${t(label)}`],
    [/^(.+) · (triggered|still-frame result; motion remains paused|click or use the matching number)$/, (label, state) => {
      const translated = t(label);
      return translated === label ? `${label} · ${state}` : translated + ' · ' + ({ triggered: 'اجرا شد', 'still-frame result; motion remains paused': 'نتیجه در نمای ثابت؛ حرکت همچنان متوقف است', 'click or use the matching number': 'کلیک کنید یا کلید عددی مربوط را بزنید' })[state];
    }],
    [/^(\d+(?:\.\d+)?)%$/, n => number(Number(n)) + '٪'],
    [/^Live animation · up to (\d+) fps · rendered locally$/, n => `پویانمایی زنده؛ تا ${number(Number(n))} فریم در ثانیه؛ پردازش روی همین دستگاه`],
    [/^Live animation · (\d+) fps limit · click a detail or press 1–6 · Esc to return$/, n => `پویانمایی زنده؛ حداکثر ${number(Number(n))} فریم در ثانیه؛ روی جزئیات بزنید یا از کلیدهای ۱ تا ۶ استفاده کنید؛ بازگشت با Esc`],
    [/^(.+) · rotation (paused|in (\d+) min)$/, (base, status, minutes) => {
      const translated = t(base);
      return translated === base ? `${base} · rotation ${status}` : `${translated} · ${minutes ? `صحنهٔ بعدی تا ${number(Number(minutes))} دقیقهٔ دیگر` : 'تعویض خودکار متوقف است'}`;
    }],
    [/^(Talk|Mic|On) · (Ready|Listening|Speaking|Thinking|Mic muted|Recording|Processing|Connecting|Sending)( — click to stop)?$/, (type, stage, stop) => `${{Talk:'مکالمه',Mic:'میکروفون',On:'روشن'}[type]} · ${t(stage)}${stop ? ' — برای توقف کلیک کنید' : ''}`],
    [/^(\d+) characters$/, n => `${number(Number(n))} نویسه`],
    [/^(\d+) backups$/, n => `${number(Number(n))} نسخهٔ پشتیبان`],
    [/^(\d+) archived$/, n => `${number(Number(n))} بایگانی‌شده`],
    [/^(\d+) connected$/, n => `${number(Number(n))} متصل`],
    [/^(\d+) LIVE$/, n => `${number(Number(n))} فعال`],
    [/^(\d+) (agents|sessions|turns|tool calls|tokens|matches)$/, (n, unit) => `${number(Number(n))} ${{ agents: 'عامل', sessions: 'گفت‌وگو', turns: 'نوبت', 'tool calls': 'اجرای ابزار', tokens: 'توکن', matches: 'نتیجه' }[unit]}`],
    [/^(\d+)m ago$/, n => `${number(Number(n))} دقیقه پیش`],
    [/^(\d+)h ago$/, n => `${number(Number(n))} ساعت پیش`],
    [/^(\d+)d ago$/, n => `${number(Number(n))} روز پیش`],
    [/^Turn (\d+)$/, n => `نوبت ${number(Number(n))}`],
    [/^Permission required · (\d+) waiting$/, n => `نیاز به اجازه · ${number(Number(n))} درخواست در انتظار`],
    [/^\$(\d+) \/ month$/, n => `${number(Number(n))} دلار در ماه`],
    [/^\$(\d+) TARGET$/, n => `هدف: ${number(Number(n))} دلار`],
    [/^(Expand|Minimize) (projects|pinned sessions|sessions|pinned messages|section)$/, (action, section) => `${action === 'Expand' ? 'باز کردن' : 'جمع کردن'} ${{ projects: 'پروژه‌ها', 'pinned sessions': 'گفت‌وگوهای سنجاق‌شده', sessions: 'گفت‌وگوها', 'pinned messages': 'پیام‌های سنجاق‌شده', section: 'بخش' }[section]}`]
  ];
  function t(value) {
    if (typeof value !== 'string' || language === 'en') return value;
    const key = normalize(value), exact = translations[key] || folded[key.toLowerCase()];
    let translated = exact;
    if (!translated) for (const [pattern, format] of patterns) { const match = key.match(pattern); if (match) { translated = format(...match.slice(1)); break; } }
    const unavailable = ' Unavailable right now; check the nearby status.';
    if (!translated && key.endsWith(unavailable)) { const base = t(key.slice(0, -unavailable.length)); if (base !== key.slice(0, -unavailable.length)) translated = base + ' فعلاً در دسترس نیست؛ وضعیت کنار آن را بررسی کنید.'; }
    if (!translated) return value; // Unknown diagnostics are displayed verbatim, never guessed.
    return value.replace(/\S[\s\S]*\S|\S/, translated);
  }
  const texts = new WeakMap(), attributes = new WeakMap();
  function setText(element, source) {
    const output = t(source);
    if (element.textContent !== output) element.textContent = output;
    if (element.childNodes.length === 1 && element.firstChild.nodeType === 3) texts.set(element.firstChild, { source, output });
  }
  // Names, prompts, transcripts, tool payloads, custom question choices and editor
  // contents are data, even when they happen to equal a translated UI word.
  const protectedSelector = [
    'script,style,svg,pre,code,kbd,textarea,input,bdi,[contenteditable],[data-no-i18n],.feature-help-tooltip',
    '.project-item,.session-copy,.message-meta>strong,#sessionTitle,#deleteSessionTitle,#deleteMessageTitle,#deleteProjectTitle,#renameProjectPath,#moveSessionSource',
    '.archive-manager-item>div,.board-history-item>div,.pinned-message-item>span,.model-picker-option,#modelPickerLabel:not([data-model-name="false"]),#modelSelect,#agentModelInput,.model-provider-group summary,.tool-chip,.provider-row>span,.connected-provider-chips>span',
    '.attachment-name,.attachment-chip,.activity-markdown,.activity-message,.activity-replay-message,.activity-session-title,.activity-session-row>div:first-child,.activity-session-map strong,.activity-session-map small,.activity-ranking [title]',
    '.activity-detail-heading h3,.activity-detail-heading p,.activity-filter-chip,.activity-live-feed,.chat-activity-list,.log-row,.skill-link-result strong,.skill-link-result span,[data-skill-key] strong,[data-skill-key] small',
    '#effectiveStack,.instruction-preview,.stack-card header>span,.question-body legend,.question-option strong,.question-option small',
    '.permission-pattern,.permission-copy h3,.tool-part pre,.tool-part header>strong,.tool-part header>span:not(.tool-status),.reasoning-part>div,.message-content',
    '.board-agent-title,.board-agent-prompt,.board-agent-activity span,.board-agent-card>p,.board-dependency,.agent-dependency-list label>span,.remote-host-bar strong,#phoneAccessUrl,#phoneAccessDevices li>span'
  ].join(',');
  const contentControl = '.message-content :is(.code-copy-button,.tool-status),.message-content .reasoning-part>summary,.message-content .tool-disclosure';
  function eligible(node, attribute) {
    const element = node.nodeType === 1 ? node : node.parentElement;
    if (!element || element.closest('[data-no-i18n],script,style,svg,pre,code,kbd,[contenteditable]')) return false;
    if (attribute && ['title','aria-label','placeholder','aria-valuetext','alt'].includes(attribute)) {
      // Values and links are never read or changed. Accessibility text belongs to controls.
      return !element.matches('.project-item,.session-open-button,.model-picker-option,.message-map-step') && !element.closest('.question-body legend,.question-option strong,.question-option small,.activity-markdown,.activity-message,.activity-ranking [title]');
    }
    return !element.closest(protectedSelector) || element.matches(contentControl) || Boolean(element.closest('.code-copy-button'));
  }
  function translateText(node) {
    if (!eligible(node)) return;
    const previous = texts.get(node), current = node.data;
    const source = previous && current === previous.output ? previous.source : current;
    const output = t(source); texts.set(node, { source, output });
    if (output !== current) {
      // Text-only options otherwise change their submitted value when translated.
      const option = node.parentElement;
      if (option.tagName === 'OPTION' && !option.hasAttribute('value')) option.setAttribute('value', option.value);
      node.data = output;
    }
  }
  function translateAttribute(element, key) {
    if (!element.hasAttribute(key) || !eligible(element, key)) return;
    const current = element.getAttribute(key), records = attributes.get(element) || {};
    const previous = records[key], source = previous && current === previous.output ? previous.source : current;
    let output = t(source);
    if (language === 'fa') {
      if (element.matches('.inspector-section-toggle') && /^(Expand|Minimize) /.test(source)) output = source.replace(/^(Expand|Minimize)/, action => t(action));
      if (element.matches('.project-rename-button,.project-delete-button,.session-pin-button,.session-archive-button,.session-rename-button,.session-delete-button') && /^(Rename|Delete|Unpin|Pin|Restore|Archive) /.test(source)) {
        output = source.replace(/^(Rename|Delete|Unpin|Pin|Restore|Archive)/, action => t(action)).replace(/ in Seneschal$/, ' در Seneschal').replace(/ from Seneschal$/, ' از Seneschal');
      }
      if (element.matches('[data-remove]') && source.startsWith('Remove ')) output = 'برداشتن پیوست: ' + source.slice(7);
    }
    records[key] = { source, output }; attributes.set(element, records);
    if (output !== current) element.setAttribute(key, output);
  }
  function sourceLabel(node) {
    const aria = attributes.get(node)?.['aria-label'];
    if (aria && node.getAttribute('aria-label') === aria.output) return aria.source;
    if (node.getAttribute('aria-label')) return node.getAttribute('aria-label');
    let source = '';
    for (const child of node.childNodes || []) source += child.nodeType === 3 ? texts.get(child)?.source || child.data : child.nodeType === 1 ? sourceLabel(child) : '';
    return source;
  }
  function scan(node) {
    if (node.nodeType === 3) { translateText(node); return; }
    if (node.nodeType !== 1 && node.nodeType !== 9) return;
    if (node.nodeType === 1) {
      if (node.matches('script,style,svg,pre,code,kbd,[contenteditable],[data-no-i18n],.feature-help-tooltip')) return;
      for (const key of ['aria-label','placeholder','title','aria-valuetext','alt']) translateAttribute(node, key);
      if (node.matches('textarea,input')) { if (node.tagName === 'TEXTAREA' || ['text','search'].includes(node.type)) node.dir = 'auto'; return; }
      if (node.matches('.message-content,.activity-markdown,.question-body legend,.question-option strong,.question-option small')) {
        node.setAttribute('dir', 'auto');
      }
      if (node.matches('.model-picker-option,.session-copy,.project-item span,.activity-session-title,#sessionTitle')) node.setAttribute('dir', 'auto');
    }
    for (const child of node.childNodes) scan(child);
  }
  let document, observer;
  function change(next, persist = true) {
    if (!Object.hasOwn(languages, next)) return false;
    language = next;
    if (!document) return true;
    root.SeneschalFeatureHelp?.hide?.();
    document.documentElement.lang = next; document.documentElement.dir = languages[next].dir;
    const selector = document.getElementById('interfaceLanguage'); if (selector) selector.value = next;
    scan(document.body);
    if (persist) {
      let saved = true;
      try { root.localStorage.setItem(storageKey, next); } catch { saved = false; }
      const status = document.getElementById('interfaceLanguageStatus');
      if (status) status.textContent = t(saved ? 'Language saved for this browser. Voice and model settings are unchanged.' : 'Language changed for this page. This browser could not save your preference.');
    }
    root.dispatchEvent(new root.CustomEvent('seneschal:languagechange', { detail: { language: next } }));
    return true;
  }
  function install(doc) {
    document = doc;
    try { const saved = root.localStorage.getItem(storageKey); if (Object.hasOwn(languages, saved)) language = saved; } catch {}
    observer = new root.MutationObserver(records => {
      const added = new Set();
      for (const record of records) {
        if (record.type === 'characterData') translateText(record.target);
        else if (record.type === 'attributes') translateAttribute(record.target, record.attributeName);
        else for (const node of record.addedNodes) added.add(node);
      }
      for (const node of added) if (node.isConnected) scan(node);
    });
    observer.observe(doc.body, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['aria-label','title','placeholder','aria-valuetext','alt'] });
    doc.getElementById('interfaceLanguage')?.addEventListener('change', event => change(event.target.value));
    root.addEventListener('storage', event => { if (event.key === storageKey && Object.hasOwn(languages, event.newValue)) change(event.newValue, false); });
    root.addEventListener('pagehide', event => { if (!event.persisted) observer.disconnect(); });
    change(language, false);
  }
  root.SeneschalI18n = { t, number, date, change, setText, sourceLabel, languages, translations, scan, get language() { return language; } };
  if (root.document) install(root.document);
})(typeof window !== 'undefined' ? window : globalThis);
