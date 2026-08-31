"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

test("release contains the required portable files", () => {
  for (const file of ["server.js", "app/index.html", "app/app.js", "app/styles.css", "install.ps1", "scripts/start-playwright-mcp.cmd", "config/opencode.template.json", "extensions/seneschal-vscode/package.json", "extensions/seneschal-vscode/extension.js", "extensions/seneschal-vscode/seneschal-vscode.vsix", "docs/images/seneschal-workspace-night.png", "docs/images/seneschal-agent-board-night.png", "assets/social/seneschal-social-preview.png", "assets/social/seneschal-linkedin-launch.png"]) {
    assert.equal(fs.existsSync(path.join(root, file)), true, `${file} is missing`);
  }
});

test("server remains local and generates runtime secrets", () => {
  const server = read("server.js");
  assert.match(server, /const host = "127\.0\.0\.1"/);
  assert.match(server, /crypto\.randomBytes/);
  assert.match(server, /HttpOnly; SameSite=Strict/);
  assert.match(server, /x-frame-options": "DENY/);
});

test("release has no original machine paths or credentials", () => {
  const files = ["server.js", "app/index.html", "app/app.js", "app/styles.css", "install.ps1"];
  const combined = files.map(read).join("\n");
  assert.doesNotMatch(combined, /Users[\\/]Sadeq/i);
  assert.doesNotMatch(combined, /home[\\/]sadeq/i);
  assert.doesNotMatch(combined, /BA72-B89B/);
});

test("machine settings and live providers are discovered instead of rewritten", () => {
  const server = read("server.js");
  assert.match(server, /settings\.json/);
  assert.match(server, /SENESCHAL_WSL_DISTRO/);
  assert.match(server, /never rewrites model availability/);
  assert.doesNotMatch(server, /delete config\.provider/);
});

test("JSON attachments have a text normalization path", () => {
  const app = read("app/app.js");
  assert.match(app, /application\/json/);
  assert.match(app, /JSON\.parse/);
});

test("public-facing identity is Seneschal", () => {
  const visible = ["app/index.html", "config/AGENTS.md", "README.md"].map(read).join("\n");
  assert.match(visible, /Seneschal/);
  assert.doesNotMatch(visible, /Digital Servant/);
  assert.match(read("install.ps1"), /AGENTS\.before-seneschal\.md/);
});

test("workspace pulse uses fixed OpenCode work and ambient event buckets", () => {
  const app = read("app/app.js");
  const styles = read("app/styles.css");
  assert.match(app, /pulseBuckets/);
  assert.match(app, /pulseEventKind/);
  assert.match(app, /advancePulse/);
  assert.match(app, /recordOpenCodeEvent/);
  assert.match(app, /\{ work: 0, ambient: 0 \}/);
  assert.doesNotMatch(app, /count \/ peak/);
  assert.doesNotMatch(styles, /pulse-bars i:nth-child/);
});

test("public launch materials reference privacy-safe visual assets", () => {
  const readme = read("README.md");
  assert.match(readme, /assets\/social\/seneschal-social-preview\.png/);
  assert.match(readme, /docs\/images\/seneschal-workspace-night\.png/);
  assert.match(readme, /docs\/images\/seneschal-agent-board-night\.png/);
  assert.match(readme, /privacy-safe product illustration/);
  assert.ok(fs.existsSync(path.join(root, "assets/social/seneschal-linkedin-launch.png")));
});

test("installer handles unavailable WSL and Windows PowerShell safely", () => {
  const installer = read("install.ps1");
  assert.match(installer, /Invoke-WslText/);
  assert.match(installer, /IsNullOrWhiteSpace/);
  assert.doesNotMatch(installer, /ConvertFrom-Json -AsHashtable/);
  assert.doesNotMatch(installer, /\(& wsl\.exe[^\n]+\)\.Trim\(\)/);
  assert.match(installer, /'bash', '-ic', 'command -v opencode \|\| true'/);
  assert.doesNotMatch(installer, /^\s+\.Replace\(/m);
});

test("installer migrates legacy integrations before cleanup", () => {
  const installer = read("install.ps1");
  assert.match(installer, /legacyBrowserRuntime/);
  assert.match(installer, /start-blender-mcp\.cmd/);
  assert.match(installer, /openCodeJson\.before-seneschal/);
  assert.match(installer, /migrationVerified/);
  assert.match(installer, /Remove-Item -Recurse -Force -LiteralPath \$legacyInstall/);
  assert.match(installer, /browserLauncherSource/);
});

test("messages can be pinned, archived, restored, and independently collapsed", () => {
  const html = read("app/index.html");
  const app = read("app/app.js");
  assert.match(html, /pinnedMessageShelf/);
  assert.match(html, /archivedMessagesButton/);
  assert.match(html, /projectsCollapseButton/);
  assert.match(html, /sessionsCollapseButton/);
  assert.match(html, /pinnedSessionsRailSection/);
  assert.match(html, /pinnedSessionsCollapseButton/);
  assert.match(html, /settingsArchivesButton/);
  assert.match(html, /archivedSessionManagerList/);
  assert.match(app, /seneschal-pinned-messages/);
  assert.match(app, /seneschal-archived-messages/);
  assert.match(app, /seneschal-pinned-sessions/);
  assert.match(app, /toggleSessionPin/);
  assert.match(app, /seneschal-archived-sessions/);
  assert.match(app, /toggleSessionArchive/);
  assert.match(app, /toggleMessagePin/);
  assert.match(app, /toggleMessageArchive/);
  assert.match(html, /deleteMessageDialog/);
  assert.match(html, /deleteProjectDialog/);
  assert.match(app, /seneschal-deleted-messages/);
  assert.match(app, /seneschal-excluded-projects/);
  assert.match(app, /session-delete-button/);
  assert.match(app, /message-delete-button/);
  assert.match(app, /project-delete-button/);
  assert.match(app, /OpenCode source data is unchanged/);
  assert.match(app, /toggleRailSection\("pins"\)/);
});

test("Playwright Brave can switch between hidden and visible agent-controlled mode", () => {
  const launcher = read("scripts/start-playwright-mcp.cmd");
  const server = read("server.js");
  const app = read("app/app.js");
  assert.match(launcher, /playwright-visible\.flag/);
  assert.match(launcher, /DISPLAY_MODE=--headless/);
  assert.match(launcher, /%DISPLAY_MODE% --isolated/);
  assert.match(server, /\/workspace\/browser-mode/);
  assert.match(server, /restartPlaywrightBridge/);
  assert.match(server, /\/mcp\/playwright\/\$\{action\}/);
  assert.match(server, /configuredLauncher/);
  assert.match(server, /ensureVisibilityAwareBrowserLauncher/);
  assert.match(server, /legacy-headless-backup/);
  assert.match(server, /repairBrowserRuntime/);
  assert.match(server, /\/workspace\/browser-focus/);
  assert.match(server, /SetForegroundWindow/);
  assert.doesNotMatch(server, /\/instance\/dispose/);
  assert.match(server, /body\.directory \|\| launchDirectory/);
  assert.match(app, /toggleBrowserWindow/);
  assert.match(app, /body: \{ visible: true, directory: state\.currentDirectory \}/);
  assert.match(app, /Visible Brave enabled for this browser task/);
  assert.match(app, /playw\(\?:right\|rite\)\|browser/);
  assert.match(app, /Visible browser control needs one Seneschal restart/);
});

test("model choices are isolated per session and background work survives navigation", () => {
  const app = read("app/app.js");
  assert.match(app, /seneschal-session-models/);
  assert.match(app, /function rememberSessionModel/);
  assert.match(app, /current session only/);
  assert.match(app, /is still running in the background/);
  const selectSession = app.slice(app.indexOf("async function selectSession"), app.indexOf("async function newSession"));
  assert.doesNotMatch(selectSession, /\/abort/);
});

test("Agent Board coordinates real sessions with persistent dependency handoffs", () => {
  const html = read("app/index.html");
  const app = read("app/app.js");
  const server = read("server.js");
  assert.match(html, /agentBoardDialog/);
  assert.match(app, /\["ready", "Ready"/);
  assert.match(app, /\["waiting", "Waiting"/);
  assert.match(app, /\["running", "Running"/);
  assert.match(app, /\["done", "Done"/);
  assert.match(app, /runBoardAgent/);
  assert.match(app, /scheduleReadyBoardAgents/);
  assert.match(app, /boardAgentResult/);
  assert.match(app, /Verified dependency handoffs/);
  assert.match(app, /prompt_async/);
  assert.match(app, /agent\.sessionID/);
  assert.match(html, /agentBoardImportButton/);
  assert.match(html, /agentAccessInput/);
  assert.match(app, /importCurrentSessionToBoard/);
  assert.match(app, /createBoardFromMessage/);
  assert.match(app, /Board Architect/);
  assert.match(app, /message-board-button/);
  assert.match(app, /processBoardRequests/);
  assert.match(app, /board-request/);
  assert.match(app, /releaseWaitingBoardAgents/);
  assert.match(html, /agentBoardHistoryButton/);
  assert.match(html, /agentBoardHistoryRailButton/);
  assert.match(html, /agentBoardHistoryDialog/);
  assert.match(html, /Open a saved board exactly as it was/);
  assert.match(app, /function isBoardSession/);
  assert.match(app, /function ordinarySessions/);
  assert.match(app, /data-board-open-history/);
  assert.match(app, /openSavedAgentBoard/);
  assert.match(app, /The plan was not resent or redesigned/);
  assert.match(server, /agent-board-history/);
  assert.match(server, /\/workspace\/agent-board\/history/);
  assert.match(app, /updateBoardActivityFromPart/);
  assert.match(app, /stopBoardAgent/);
  assert.match(app, /Conversation only/);
  assert.match(app, /Browser research/);
  assert.match(app, /Build tools/);
  assert.match(server, /agent-board\.json/);
  assert.match(server, /\/workspace\/agent-board/);
});

test("sidebars keep their own controls and independently minimized sections", () => {
  const html = read("app/index.html");
  const app = read("app/app.js");
  const styles = read("app/styles.css");
  const topActions = html.slice(html.indexOf('<div class="top-actions">'), html.indexOf('</div>', html.indexOf('<div class="top-actions">')));
  assert.doesNotMatch(topActions, /leftPanelToggle|rightPanelToggle|motionSwitch/);
  assert.match(html, /sidebar-head-controls[\s\S]*leftPanelToggle/);
  assert.match(html, /inspector-head-actions[\s\S]*rightPanelToggle/);
  assert.match(app, /seneschal-rail-sections-v2/);
  assert.match(app, /inspectorSections/);
  assert.match(app, /syncInspectorSections/);
  assert.match(styles, /inspector-block\.collapsed/);
});

test("Visual Studio Code bridge opens WSL projects and provides an in-editor AI workspace", () => {
  const html = read("app/index.html");
  const app = read("app/app.js");
  const server = read("server.js");
  assert.match(html, /openSessionVsCodeButton/);
  assert.match(html, /vscodeDialog/);
  assert.match(app, /\/workspace\/vscode\/open/);
  assert.match(server, /findVsCodeExecutable/);
  assert.match(server, /--remote/);
  assert.match(server, /--goto/);
  assert.match(server, /wsl\+\$\{wslDistribution\}/);
  assert.match(html, /installVsCodeCompanionButton/);
  assert.match(server, /installVsCodeCompanion/);
  assert.match(server, /vscode-connection\.json/);
  assert.match(server, /function refreshVsCodeConnection/);
  assert.match(server, /openWorkspace\(\)[\s\S]*refreshVsCodeConnection/);
  const extension = read("extensions/seneschal-vscode/extension.js");
  const manifest = read("extensions/seneschal-vscode/package.json");
  assert.match(manifest, /seneschal\.workspace/);
  assert.match(manifest, /Seneschal: Open AI Workspace/);
  assert.match(extension, /registerWebviewViewProvider/);
  assert.match(extension, /\/api\/provider/);
  assert.match(extension, /prompt_async/);
  assert.match(extension, /agent: this\.mode/);
  assert.match(extension, /editor-context/);
  assert.match(extension, /sessionModels/);
  assert.match(extension, /path\.join\(__dirname, "connection\.json"\)/);
  assert.match(extension, /atelier_session/);
  for (const file of ["media/panel.js", "media/panel.css", "media/seneschal.svg"]) {
    assert.equal(fs.existsSync(path.join(root, "extensions/seneschal-vscode", file)), true, `${file} is missing`);
  }
});

test("VS Code companion keeps connected text models and readable message activity", () => {
  const Module = require("node:module");
  const originalLoad = Module._load;
  Module._load = function(request, parent, isMain) {
    if (request === "vscode") return {};
    return originalLoad.call(this, request, parent, isMain);
  };
  let companion;
  try { companion = require(path.join(root, "extensions/seneschal-vscode/extension.js")); }
  finally { Module._load = originalLoad; }
  const models = companion.providerModels({
    connected: ["connected"],
    all: [
      { id: "connected", name: "Connected", models: { text: { id: "text", name: "Text", capabilities: { input: { text: true } } } } },
      { id: "offline", name: "Offline", models: { hidden: { id: "hidden", name: "Hidden" } } }
    ]
  });
  assert.deepEqual(models.map((model) => model.value), ["connected/text"]);
  assert.deepEqual(companion.historyFromMessages([{ info: { id: "a", role: "assistant", modelID: "text" }, parts: [{ type: "text", text: "Ready" }, { type: "tool", tool: "edit", state: { status: "completed" } }] }])[0].blocks, ["Ready", "Tool · edit · completed"]);
});

test("hidden launcher leaves a useful failure report", () => {
  const launcher = read("scripts/launch.ps1");
  assert.match(launcher, /launcher\.log/);
  assert.match(launcher, /launcher-\$PID\.log/);
  assert.match(launcher, /Windows\.MessageBox/);
  assert.match(read("install.ps1"), /ExecutionPolicy Bypass -WindowStyle Hidden/);
});

test("server startup is locked against duplicate readiness signals", () => {
  const server = read("server.js");
  assert.match(server, /let serversStarting = false/);
  assert.match(server, /if \(proxy \|\| serversStarting\) return/);
  assert.match(server, /serversStarting = true/);
  assert.match(server, /listenWithRetry\(classicProxy, classicPort/);
});

test("only one Seneschal process can claim the proxy ports", () => {
  const server = read("server.js");
  assert.match(server, /seneschal-instance\.lock/);
  assert.match(server, /fs\.openSync\(instanceLockFile, "wx"\)/);
  assert.match(server, /processIsRunning\(existingProcessId\)/);
  assert.match(server, /lockPredatesCurrentBoot/);
  assert.match(server, /openRunningWorkspace/);
  assert.match(server, /launchWorkspaceBrowser/);
  assert.match(server, /already starting or running; opening the workspace/);
  assert.match(server, /if \(ownsInstanceLock\)/);
  assert.match(server, /process\.on\("exit", releaseInstanceLock\)/);
});

test("temporary port overlap retries instead of crashing", () => {
  const server = read("server.js");
  assert.match(server, /function listenWithRetry/);
  assert.match(server, /retries < 40/);
  assert.match(server, /setTimeout\(\(\) => server\.listen\(port, host\), 250\)/);
  assert.match(server, /proxy\.once\("listening", \(\) => \{\s*startClassicProxy\(\);\s*openWorkspace\(\);/);
});

test("workspace avoids the legacy 4096 and 4098 port conflict", () => {
  const server = read("server.js");
  assert.match(server, /SENESCHAL_PORT\) \|\| 4196/);
  assert.match(server, /SENESCHAL_CLASSIC_PORT\) \|\| 4198/);
  assert.doesNotMatch(server, /const publicPort = 4096/);
  assert.doesNotMatch(server, /const classicPort = 4098/);
});
