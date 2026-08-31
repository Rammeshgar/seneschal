"use strict";

const vscode = require("vscode");
const fs = require("fs");
const os = require("os");
const path = require("path");
const http = require("http");

const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

function readConnection() {
  const localAppData = process.env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local");
  const candidates = [
    path.join(localAppData, "Seneschal", "vscode-connection.json"),
    path.join(__dirname, "connection.json")
  ];
  for (const filename of candidates) {
    try {
      const connection = JSON.parse(fs.readFileSync(filename, "utf8"));
      if (/^http:\/\/127\.0\.0\.1:\d+$/.test(String(connection.baseUrl || "")) && connection.token) return connection;
    } catch {}
  }
  throw new Error("Open Seneschal → VS Code → Install companion, then reload VS Code.");
}

function projectDirectory() {
  const folder = vscode.workspace.workspaceFolders?.[0];
  if (!folder) throw new Error("Open a project folder in VS Code first.");
  return folder.uri.scheme === "vscode-remote" ? folder.uri.path : folder.uri.fsPath;
}

function request(connection, method, endpoint, body, timeout = 10000) {
  return new Promise((resolve, reject) => {
    const url = new URL(endpoint, connection.baseUrl);
    const payload = body === undefined ? null : Buffer.from(JSON.stringify(body));
    const req = http.request(url, {
      method,
      headers: {
        Accept: "application/json",
        Cookie: `atelier_session=${connection.token}`,
        ...(payload ? { "Content-Type": "application/json", "Content-Length": payload.length } : {})
      },
      timeout
    }, (response) => {
      let text = "";
      response.setEncoding("utf8");
      response.on("data", (chunk) => { text += chunk; });
      response.on("end", () => {
        if (response.statusCode < 200 || response.statusCode >= 300) {
          let detail = text;
          try { detail = JSON.parse(text)?.message || text; } catch {}
          return reject(new Error(detail || `Seneschal returned ${response.statusCode}.`));
        }
        try { resolve(text ? JSON.parse(text) : null); } catch { resolve(text); }
      });
    });
    req.on("timeout", () => req.destroy(new Error("Seneschal did not respond. Open it from the desktop icon first.")));
    req.on("error", reject);
    if (payload) req.write(payload);
    req.end();
  });
}

async function openSeneschal(connection, directory, sessionID = "") {
  const url = new URL(connection.baseUrl);
  url.searchParams.set("access", connection.token);
  url.searchParams.set("directory", directory);
  if (sessionID) url.searchParams.set("session", sessionID);
  await vscode.env.openExternal(vscode.Uri.parse(url.href));
}

function providerModels(payload) {
  const connected = new Set(Array.isArray(payload?.connected) ? payload.connected : []);
  const models = [];
  for (const provider of Array.isArray(payload?.all) ? payload.all : []) {
    if (connected.size && !connected.has(provider.id)) continue;
    for (const model of Object.values(provider.models || {})) {
      if (model?.capabilities?.input?.text === false) continue;
      models.push({
        value: `${provider.id}/${model.id}`,
        providerID: provider.id,
        modelID: model.id,
        label: model.name || model.id,
        provider: provider.name || provider.id
      });
    }
  }
  return models.sort((a, b) => a.provider.localeCompare(b.provider) || a.label.localeCompare(b.label));
}

function textFromPart(part) {
  if (part?.type === "text") return part.text || "";
  if (part?.type === "reasoning") return part.text ? `Thinking: ${part.text}` : "";
  if (part?.type === "tool") {
    const state = part.state || {};
    return `Tool · ${part.tool || "action"}${state.status ? ` · ${state.status}` : ""}`;
  }
  if (part?.type === "patch") return "Files changed — review them in Source Control.";
  return "";
}

function historyFromMessages(messages) {
  return (Array.isArray(messages) ? messages : []).map((message) => ({
    id: message.info?.id || "",
    role: message.info?.role === "user" ? "user" : "assistant",
    model: message.info?.modelID || "",
    created: message.info?.time?.created || 0,
    blocks: (message.parts || []).map(textFromPart).filter(Boolean)
  })).filter((message) => message.blocks.length).slice(-30);
}

function normalizePermissions(payload, sessionID) {
  const items = Array.isArray(payload) ? payload : Object.values(payload || {});
  return items.filter((item) => !sessionID || !item?.sessionID || item.sessionID === sessionID).length;
}

function editorContext(kind) {
  if (kind === "none") return "";
  const editor = vscode.window.activeTextEditor;
  if (!editor) throw new Error("Open a file in the editor first.");
  const document = editor.document;
  const folder = vscode.workspace.getWorkspaceFolder(document.uri);
  const filename = folder ? path.relative(folder.uri.path || folder.uri.fsPath, document.uri.path || document.uri.fsPath) : document.fileName;
  const selection = editor.selection;
  let content;
  let label;
  if (kind === "selection") {
    if (selection.isEmpty) throw new Error("Select the code or text you want to include first.");
    content = document.getText(selection);
    label = `${filename}, lines ${selection.start.line + 1}-${selection.end.line + 1}`;
  } else {
    content = document.getText();
    label = filename;
  }
  if (content.length > 60000) throw new Error("This context is over 60,000 characters. Select the relevant section instead.");
  return `\n\n<editor-context file="${label.replace(/"/g, "&quot;")}">\n${content}\n</editor-context>`;
}

async function runSafely(action, onError) {
  try { return await action(); }
  catch (error) {
    if (onError) onError(error);
    else vscode.window.showErrorMessage(`Seneschal: ${error.message}`);
    return null;
  }
}

class SeneschalViewProvider {
  constructor(context) {
    this.context = context;
    this.view = null;
    this.directory = "";
    this.sessionID = context.workspaceState.get("seneschal.sessionID", "");
    this.model = context.workspaceState.get("seneschal.model", "");
    this.sessionModels = context.workspaceState.get("seneschal.sessionModels", {});
    this.mode = context.workspaceState.get("seneschal.mode", "build");
    this.contextKind = context.workspaceState.get("seneschal.context", "none");
    this.pollTimer = null;
  }

  resolveWebviewView(view) {
    this.view = view;
    view.webview.options = { enableScripts: true, localResourceRoots: [vscode.Uri.joinPath(this.context.extensionUri, "media")] };
    view.webview.html = this.html(view.webview);
    view.webview.onDidReceiveMessage((message) => this.handle(message));
    view.onDidDispose(() => { if (this.pollTimer) clearTimeout(this.pollTimer); this.view = null; });
    this.refresh();
  }

  post(payload) { this.view?.webview.postMessage(payload); }
  error(error) { this.post({ type: "error", message: error.message || String(error) }); }

  async refresh(silent = false) {
    return runSafely(async () => {
      const connection = readConnection();
      this.directory = projectDirectory();
      const query = `directory=${encodeURIComponent(this.directory)}`;
      const [providers, sessions, statuses, permissions] = await Promise.all([
        request(connection, "GET", "/api/provider"),
        request(connection, "GET", `/api/session?${query}`),
        request(connection, "GET", "/api/session/status"),
        request(connection, "GET", `/api/permission?${query}`).catch(() => [])
      ]);
      const roots = (Array.isArray(sessions) ? sessions : []).filter((session) => !session.parentID);
      if (!roots.some((session) => session.id === this.sessionID)) this.sessionID = roots[0]?.id || "";
      const models = providerModels(providers);
      if (this.sessionModels[this.sessionID]) this.model = this.sessionModels[this.sessionID];
      if (!models.some((model) => model.value === this.model)) this.model = models[0]?.value || "";
      if (this.sessionID && this.model) this.sessionModels[this.sessionID] = this.model;
      await this.context.workspaceState.update("seneschal.sessionID", this.sessionID);
      await this.context.workspaceState.update("seneschal.model", this.model);
      await this.context.workspaceState.update("seneschal.sessionModels", this.sessionModels);
      const selected = roots.find((session) => session.id === this.sessionID);
      const messages = selected ? await request(connection, "GET", `/api/session/${encodeURIComponent(selected.id)}/message?${query}`) : [];
      this.post({
        type: "state",
        project: path.basename(this.directory),
        directory: this.directory,
        models,
        model: this.model,
        sessions: roots.map((session) => ({ id: session.id, title: session.title || "Untitled session" })),
        sessionID: this.sessionID,
        mode: this.mode,
        contextKind: this.contextKind,
        busy: ["busy", "retry"].includes(statuses?.[this.sessionID]?.type),
        approvals: normalizePermissions(permissions, this.sessionID),
        history: historyFromMessages(messages)
      });
      this.schedulePoll();
    }, (error) => { if (!silent) this.error(error); });
  }

  schedulePoll() {
    if (this.pollTimer) clearTimeout(this.pollTimer);
    if (!this.view?.visible) return;
    this.pollTimer = setTimeout(() => this.refresh(true), 1800);
  }

  async newSession() {
    const connection = readConnection();
    const title = await vscode.window.showInputBox({ prompt: "Name the new Seneschal session", value: `VS Code · ${path.basename(this.directory || projectDirectory())}` });
    if (!title) return;
    const directory = this.directory || projectDirectory();
    const session = await request(connection, "POST", `/api/session?directory=${encodeURIComponent(directory)}`, { title });
    this.sessionID = session.id;
    await this.context.workspaceState.update("seneschal.sessionID", session.id);
    await this.refresh();
  }

  async send(message) {
    const prompt = String(message.text || "").trim();
    if (!prompt) return;
    const connection = readConnection();
    const directory = this.directory || projectDirectory();
    if (!this.sessionID) await this.newSession();
    if (!this.sessionID) return;
    const [providerID, ...modelParts] = String(this.model).split("/");
    const modelID = modelParts.join("/");
    if (!providerID || !modelID) throw new Error("Choose a connected model first.");
    const context = editorContext(this.contextKind);
    const modeNote = this.mode === "plan"
      ? "You are working in Plan mode. Analyze and explain. Do not edit files or run mutating commands."
      : "You are working in Build mode inside VS Code. You may inspect and edit this project, subject to Seneschal approvals.";
    const tools = this.mode === "plan" ? { write: false, edit: false, bash: false } : undefined;
    this.post({ type: "optimistic", text: prompt });
    await request(connection, "POST", `/api/session/${encodeURIComponent(this.sessionID)}/prompt_async?directory=${encodeURIComponent(directory)}`, {
      model: { providerID, modelID },
      agent: this.mode,
      tools,
      system: `${modeNote}\nThe user is working in Visual Studio Code. Keep replies concise and make file changes directly when requested in Build mode.`,
      parts: [{ type: "text", text: prompt + context }]
    });
    await sleep(250);
    await this.refresh();
  }

  async handle(message) {
    return runSafely(async () => {
      if (message.type === "ready" || message.type === "refresh") return this.refresh();
      if (message.type === "send") return this.send(message);
      if (message.type === "newSession") return this.newSession();
      if (message.type === "open") return openSeneschal(readConnection(), this.directory || projectDirectory(), this.sessionID);
      if (message.type === "review") return vscode.commands.executeCommand("workbench.view.scm");
      if (message.type === "chooseSession") {
        this.sessionID = String(message.value || "");
        this.model = this.sessionModels[this.sessionID] || this.model;
        await this.context.workspaceState.update("seneschal.sessionID", this.sessionID);
        return this.refresh();
      }
      if (message.type === "chooseModel") {
        this.model = String(message.value || "");
        if (this.sessionID) this.sessionModels[this.sessionID] = this.model;
        await this.context.workspaceState.update("seneschal.model", this.model);
        await this.context.workspaceState.update("seneschal.sessionModels", this.sessionModels);
        return this.refresh();
      }
      if (message.type === "mode") {
        this.mode = message.value === "plan" ? "plan" : "build";
        await this.context.workspaceState.update("seneschal.mode", this.mode);
        return this.refresh();
      }
      if (message.type === "context") {
        this.contextKind = ["none", "selection", "file"].includes(message.value) ? message.value : "none";
        await this.context.workspaceState.update("seneschal.context", this.contextKind);
        return this.refresh();
      }
      if (message.type === "stop" && this.sessionID) {
        await request(readConnection(), "POST", `/api/session/${encodeURIComponent(this.sessionID)}/abort?directory=${encodeURIComponent(this.directory)}`);
        return this.refresh();
      }
    }, (error) => this.error(error));
  }

  html(webview) {
    const nonce = String(Date.now());
    const script = webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, "media", "panel.js"));
    const styles = webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, "media", "panel.css"));
    return `<!doctype html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource}; script-src 'nonce-${nonce}';"><link rel="stylesheet" href="${styles}"><title>Seneschal</title></head><body>
      <header><span class="eyebrow">SENESCHAL</span><strong id="project">Connecting…</strong><button id="refresh" title="Refresh">↻</button></header>
      <section class="selectors"><label>SESSION<select id="session"></select></label><button id="newSession" title="New session">＋</button><label>MODEL<select id="model"></select></label></section>
      <section class="modes"><button data-mode="plan">Plan</button><button data-mode="build">Build</button></section>
      <div id="notice" hidden></div><main id="history"><div class="empty">Seneschal responses and tool activity will appear here.</div></main>
      <footer><textarea id="prompt" rows="3" placeholder="Ask, explain, or edit this project…"></textarea><div class="context"><span>Context</span><button data-context="none">None</button><button data-context="selection">Selection</button><button data-context="file">File</button></div><div class="actions"><button id="open">Open full</button><button id="review">Review edits</button><button id="stop" class="danger" hidden>Stop</button><button id="send" class="primary">Send</button></div><small>Ctrl+Enter to send · approvals stay in Seneschal</small></footer>
      <script nonce="${nonce}" src="${script}"></script></body></html>`;
  }
}

function activate(context) {
  const provider = new SeneschalViewProvider(context);
  const openPanel = () => vscode.commands.executeCommand("seneschal.workspace.focus");
  const openProject = () => runSafely(() => openSeneschal(readConnection(), projectDirectory()));
  const newSession = () => runSafely(() => provider.newSession());
  const chooseSession = () => runSafely(async () => {
    const connection = readConnection();
    const directory = projectDirectory();
    const sessions = await request(connection, "GET", `/api/session?directory=${encodeURIComponent(directory)}`);
    const choices = (Array.isArray(sessions) ? sessions : []).filter((session) => !session.parentID).map((session) => ({ label: session.title || "Untitled session", sessionID: session.id }));
    const choice = await vscode.window.showQuickPick(choices, { placeHolder: "Open a project session in Seneschal" });
    if (choice) await openSeneschal(connection, directory, choice.sessionID);
  });
  const openMenu = () => runSafely(async () => {
    const choice = await vscode.window.showQuickPick([
      { label: "$(sparkle) Work with Seneschal inside VS Code", run: openPanel },
      { label: "$(window) Open full Seneschal workspace", run: openProject },
      { label: "$(comment-discussion) Choose a project session", run: chooseSession },
      { label: "$(add) Create a project session", run: newSession }
    ], { placeHolder: "Seneschal and this VS Code project" });
    if (choice) await choice.run();
  });

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider("seneschal.workspace", provider, { webviewOptions: { retainContextWhenHidden: true } }),
    vscode.commands.registerCommand("seneschal.openPanel", openPanel),
    vscode.commands.registerCommand("seneschal.openMenu", openMenu),
    vscode.commands.registerCommand("seneschal.openProject", openProject),
    vscode.commands.registerCommand("seneschal.chooseSession", chooseSession),
    vscode.commands.registerCommand("seneschal.newSession", newSession)
  );
  const status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 80);
  status.text = "$(hubot) Seneschal";
  status.tooltip = "Open the Seneschal AI workspace inside VS Code";
  status.command = "seneschal.openPanel";
  status.show();
  context.subscriptions.push(status);
}

function deactivate() {}

module.exports = { activate, deactivate, providerModels, historyFromMessages };
