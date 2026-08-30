"use strict";

const vscode = require("vscode");
const fs = require("fs");
const os = require("os");
const path = require("path");
const http = require("http");

function readConnection() {
  const localAppData = process.env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local");
  const filename = path.join(localAppData, "Seneschal", "vscode-connection.json");
  try {
    const connection = JSON.parse(fs.readFileSync(filename, "utf8"));
    if (!/^http:\/\/127\.0\.0\.1:\d+$/.test(String(connection.baseUrl || "")) || !connection.token) throw new Error("invalid");
    return connection;
  } catch {
    throw new Error("Open Seneschal → VS Code → Install companion, then reload VS Code.");
  }
}

function projectDirectory() {
  const folder = vscode.workspace.workspaceFolders?.[0];
  if (!folder) throw new Error("Open a project folder in VS Code first.");
  if (folder.uri.scheme === "vscode-remote") return folder.uri.path;
  return folder.uri.fsPath;
}

function request(connection, method, endpoint, body) {
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
      timeout: 5000
    }, (response) => {
      let text = "";
      response.setEncoding("utf8");
      response.on("data", (chunk) => { text += chunk; });
      response.on("end", () => {
        if (response.statusCode < 200 || response.statusCode >= 300) return reject(new Error(text || `Seneschal returned ${response.statusCode}.`));
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

async function runSafely(action) {
  try { await action(); }
  catch (error) { vscode.window.showErrorMessage(`Seneschal: ${error.message}`); }
}

function activate(context) {
  const openProject = () => runSafely(async () => openSeneschal(readConnection(), projectDirectory()));
  const newSession = () => runSafely(async () => {
    const connection = readConnection();
    const directory = projectDirectory();
    const title = await vscode.window.showInputBox({ prompt: "Name the new Seneschal session", value: `VS Code · ${path.basename(directory)}` });
    if (!title) return;
    const session = await request(connection, "POST", `/api/session?directory=${encodeURIComponent(directory)}`, { title });
    await openSeneschal(connection, directory, session.id);
  });
  const chooseSession = () => runSafely(async () => {
    const connection = readConnection();
    const directory = projectDirectory();
    const sessions = await request(connection, "GET", `/api/session?directory=${encodeURIComponent(directory)}`);
    const choices = (Array.isArray(sessions) ? sessions : []).filter((session) => !session.parentID).map((session) => ({
      label: session.title || "Untitled session",
      description: session.id,
      sessionID: session.id
    }));
    choices.unshift({ label: "$(add) New session for this project", description: "Create and open", sessionID: "" });
    const choice = await vscode.window.showQuickPick(choices, { placeHolder: "Which Seneschal session should use this project?" });
    if (!choice) return;
    if (!choice.sessionID) return newSession();
    await openSeneschal(connection, directory, choice.sessionID);
  });
  const openMenu = () => runSafely(async () => {
    const choice = await vscode.window.showQuickPick([
      { label: "$(window) Open project in Seneschal", command: openProject },
      { label: "$(comment-discussion) Choose a Seneschal session", command: chooseSession },
      { label: "$(add) Start a new Seneschal session", command: newSession }
    ], { placeHolder: "Seneschal and this VS Code project" });
    if (choice) await choice.command();
  });

  context.subscriptions.push(
    vscode.commands.registerCommand("seneschal.openMenu", openMenu),
    vscode.commands.registerCommand("seneschal.openProject", openProject),
    vscode.commands.registerCommand("seneschal.chooseSession", chooseSession),
    vscode.commands.registerCommand("seneschal.newSession", newSession)
  );
  const status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 80);
  status.text = "$(hubot) Seneschal";
  status.tooltip = "Open this project or choose its Seneschal session";
  status.command = "seneschal.openMenu";
  status.show();
  context.subscriptions.push(status);
}

function deactivate() {}

module.exports = { activate, deactivate };
