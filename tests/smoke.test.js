"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

test("release contains the required portable files", () => {
  for (const file of ["server.js", "app/index.html", "app/app.js", "app/styles.css", "install.ps1", "scripts/start-playwright-mcp.cmd", "config/opencode.template.json", "docs/images/seneschal-workspace-night.png", "assets/social/seneschal-social-preview.png", "assets/social/seneschal-linkedin-launch.png"]) {
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
  const linkedin = read("docs/linkedin-launch.md");
  assert.match(readme, /assets\/social\/seneschal-social-preview\.png/);
  assert.match(readme, /docs\/images\/seneschal-workspace-night\.png/);
  assert.match(readme, /privacy-safe product illustration/);
  assert.match(linkedin, /assets\/social\/seneschal-linkedin-launch\.png/);
  assert.match(linkedin, /Alt text:/);
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
  assert.match(server, /IndexOf\(\$target/);
  assert.match(app, /toggleBrowserWindow/);
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
