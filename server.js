"use strict";

const http = require("http");
const https = require("https");
const net = require("net");
const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");
const { spawn } = require("child_process");

const host = "127.0.0.1";
const publicPort = Number(process.env.SENESCHAL_PORT) || 4196;
const upstreamPort = 4097;
const classicPort = Number(process.env.SENESCHAL_CLASSIC_PORT) || 4198;
const blenderPort = 9876;
const testedOpenCodeVersion = "1.18.21";
const installDirectory = __dirname;
const appDirectory = path.join(installDirectory, "app");
const dataDirectory = path.join(installDirectory, "data");
fs.mkdirSync(dataDirectory, { recursive: true });
const settingsFile = path.join(dataDirectory, "settings.json");
let localSettings = {};
try { localSettings = JSON.parse(fs.readFileSync(settingsFile, "utf8")); } catch { localSettings = {}; }
const wslDistribution = process.env.SENESCHAL_WSL_DISTRO || process.env.DIGITAL_SERVANT_WSL_DISTRO || localSettings.wslDistribution || "Ubuntu";
const inferredLinuxUser = String(process.env.USERNAME || "user").toLowerCase();
const wslLinuxHome = process.env.SENESCHAL_WSL_HOME || process.env.DIGITAL_SERVANT_WSL_HOME || localSettings.wslLinuxHome || `/home/${inferredLinuxUser}`;
const launchDirectory = process.env.SENESCHAL_PROJECTS || process.env.DIGITAL_SERVANT_PROJECTS || localSettings.launchDirectory || `${wslLinuxHome}/projects`;
const backupScript = path.join(installDirectory, "scripts", "backup-opencode.ps1");
const blenderRoot = "C:\\Program Files\\Blender Foundation";
const detectedBlender = fs.existsSync(blenderRoot)
  ? fs.readdirSync(blenderRoot).filter((name) => /^Blender \d/.test(name)).sort().reverse().map((name) => path.join(blenderRoot, name, "blender.exe")).find(fs.existsSync)
  : null;
const blenderExecutable = process.env.SENESCHAL_BLENDER || process.env.DIGITAL_SERVANT_BLENDER || localSettings.blenderExecutable || detectedBlender || "";
const wslHome = path.win32.join(`\\\\wsl.localhost\\${wslDistribution}`, ...wslLinuxHome.split("/").filter(Boolean));
const openCodeConfigDirectory = path.win32.join(wslHome, ".config", "opencode");
const openCodeConfigFile = path.win32.join(openCodeConfigDirectory, "opencode.json");
const personaFile = path.win32.join(openCodeConfigDirectory, "AGENTS.md");
const generalInstructionsFile = path.win32.join(openCodeConfigDirectory, "GENERAL.md");
const instructionDataDirectory = path.join(dataDirectory, "instructions");
const instructionBackupDirectory = path.join(dataDirectory, "instruction-backups");
const instructionJournalFile = path.join(instructionBackupDirectory, "journal.json");
const agentBoardFile = path.join(dataDirectory, "agent-board.json");
const agentBoardHistoryDirectory = path.join(dataDirectory, "agent-board-history");
const maximumInstructionBytes = 256 * 1024;

fs.mkdirSync(instructionDataDirectory, { recursive: true });
fs.mkdirSync(instructionBackupDirectory, { recursive: true });
fs.mkdirSync(agentBoardHistoryDirectory, { recursive: true });

for (const role of ["build", "plan"]) {
  const destination = path.join(instructionDataDirectory, `${role}.md`);
  const seed = path.join(installDirectory, "config", `agent-${role}.md`);
  if (!fs.existsSync(destination) && fs.existsSync(seed)) fs.copyFileSync(seed, destination);
}

function localSecret(filename, bytes = 32) {
  const secretPath = path.join(dataDirectory, filename);
  if (fs.existsSync(secretPath)) return fs.readFileSync(secretPath, "utf8").trim();
  const value = crypto.randomBytes(bytes).toString("base64url");
  fs.writeFileSync(secretPath, value, { encoding: "utf8", mode: 0o600 });
  return value;
}

const workspaceToken = localSecret("workspace-token.txt");
const upstreamPassword = localSecret("server-password.txt", 24);
const upstreamUsername = "opencode";
const upstreamAuthorization = `Basic ${Buffer.from(`${upstreamUsername}:${upstreamPassword}`).toString("base64")}`;

function refreshVsCodeConnection() {
  const localAppData = process.env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local");
  const connectionDirectory = path.join(localAppData, "Seneschal");
  const connectionFile = path.join(connectionDirectory, "vscode-connection.json");
  fs.mkdirSync(connectionDirectory, { recursive: true });
  fs.writeFileSync(connectionFile, `${JSON.stringify({ baseUrl: `http://${host}:${publicPort}`, token: workspaceToken }, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  return connectionFile;
}

const staticFiles = new Map([
  ["/", ["index.html", "text/html; charset=utf-8"]],
  ["/index.html", ["index.html", "text/html; charset=utf-8"]],
  ["/workspace/styles.css", ["styles.css", "text/css; charset=utf-8"]],
  ["/workspace/app.js", ["app.js", "application/javascript; charset=utf-8"]],
  ["/workspace/favicon.svg", ["favicon.svg", "image/svg+xml"]],
  ["/workspace/favicon.ico", ["favicon.ico", "image/x-icon"]],
  ["/workspace/favicon.png", ["favicon.png", "image/png"]],
  ["/workspace/favicon-32.png", ["favicon-32.png", "image/png"]],
  ["/workspace/icon-192.png", ["icon-192.png", "image/png"]]
]);

const securityHeaders = {
  "cache-control": "no-store",
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY",
  "referrer-policy": "no-referrer",
  "permissions-policy": "camera=(), geolocation=(), microphone=(self)",
  "content-security-policy": "default-src 'self'; connect-src 'self'; img-src 'self' data: blob:; media-src 'self' blob:; style-src 'self'; script-src 'self'; font-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'"
};

let upstream = null;
let proxy = null;
let classicProxy = null;
let serversStarting = false;
let shuttingDown = false;
const instanceLockFile = path.join(dataDirectory, "seneschal-instance.lock");
let ownsInstanceLock = false;

function processIsRunning(processId) {
  if (!Number.isInteger(processId) || processId <= 0) return false;
  try { process.kill(processId, 0); return true; } catch { return false; }
}

function lockPredatesCurrentBoot() {
  try {
    const bootTime = Date.now() - (os.uptime() * 1000);
    return fs.statSync(instanceLockFile).mtimeMs < bootTime - 5000;
  } catch {
    return false;
  }
}

function acquireInstanceLock() {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const descriptor = fs.openSync(instanceLockFile, "wx");
      fs.writeFileSync(descriptor, String(process.pid), "utf8");
      fs.closeSync(descriptor);
      ownsInstanceLock = true;
      return true;
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
      if (lockPredatesCurrentBoot()) {
        try { fs.unlinkSync(instanceLockFile); } catch {}
        continue;
      }
      let existingProcessId = 0;
      try { existingProcessId = Number.parseInt(fs.readFileSync(instanceLockFile, "utf8").trim(), 10); } catch {}
      if (processIsRunning(existingProcessId)) return false;
      try { fs.unlinkSync(instanceLockFile); } catch {}
    }
  }
  return false;
}

function releaseInstanceLock() {
  if (!ownsInstanceLock) return;
  ownsInstanceLock = false;
  try { fs.unlinkSync(instanceLockFile); } catch {}
}

if (!acquireInstanceLock()) {
  console.log("Seneschal is already starting or running; opening the workspace.");
  openRunningWorkspace();
} else {
  process.on("exit", releaseInstanceLock);
}

function parseCookies(request) {
  return Object.fromEntries(String(request.headers.cookie || "").split(";").map((part) => part.trim().split("=")).filter((pair) => pair.length === 2));
}

function sameSecret(left, right) {
  const a = Buffer.from(String(left || ""));
  const b = Buffer.from(String(right || ""));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function isAuthorized(request) {
  return sameSecret(parseCookies(request).atelier_session, workspaceToken);
}

function authorizeFromQuery(request, response) {
  const url = new URL(request.url, `http://${request.headers.host || `${host}:${publicPort}`}`);
  if (!sameSecret(url.searchParams.get("access"), workspaceToken)) return false;
  url.searchParams.delete("access");
  const redirectLocation = `${url.pathname || "/"}${url.search}`;
  response.writeHead(302, {
    ...securityHeaders,
    location: redirectLocation,
    "set-cookie": `atelier_session=${workspaceToken}; HttpOnly; SameSite=Strict; Path=/; Max-Age=2592000`
  });
  response.end();
  return true;
}

function rejectUnauthorized(response) {
  response.writeHead(401, { ...securityHeaders, "content-type": "text/html; charset=utf-8" });
  response.end("<!doctype html><meta charset=utf-8><title>Seneschal</title><style>body{font:16px system-ui;background:#171a18;color:#e8e7e0;display:grid;place-items:center;height:100vh;margin:0}main{max-width:34rem;padding:2rem;border:1px solid #3d4942;border-radius:18px;background:#202521}h1{font-size:1.25rem}p{color:#aab5ad;line-height:1.6}</style><main><h1>Seneschal is locked</h1><p>Open it from the desktop icon so the local secure session can be restored.</p></main>");
}

function checkUpstream(callback) {
  const request = http.get({ hostname: host, port: upstreamPort, path: "/global/health", timeout: 900, headers: { authorization: upstreamAuthorization } }, (response) => {
    response.resume();
    callback(response.statusCode === 200);
  });
  request.on("error", () => callback(false));
  request.on("timeout", () => { request.destroy(); callback(false); });
}

function startUpstream() {
  const inherited = process.env.WSLENV ? `${process.env.WSLENV}:` : "";
  upstream = spawn(
    "wsl.exe",
    ["-d", wslDistribution, "--", "bash", "-ic", `mkdir -p '${launchDirectory}' && cd '${launchDirectory}' && exec opencode serve --hostname ${host} --port ${upstreamPort}`],
    {
      stdio: "inherit",
      windowsHide: true,
      env: {
        ...process.env,
        OPENCODE_SERVER_USERNAME: upstreamUsername,
        OPENCODE_SERVER_PASSWORD: upstreamPassword,
        WSLENV: `${inherited}OPENCODE_SERVER_USERNAME/u:OPENCODE_SERVER_PASSWORD/u`
      }
    }
  );
  upstream.on("exit", (code) => {
    if (!shuttingDown && code) console.error(`OpenCode exited with code ${code}.`);
  });
}

function ensureOpenCodeModelCatalog() {
  // OpenCode owns its live provider catalogue. Seneschal reads that
  // catalogue through the local API and never rewrites model availability.
}

function waitForUpstream(attempt = 0) {
  checkUpstream((ready) => {
    if (ready) return startServers();
    if (attempt > 120) {
      console.error("OpenCode did not start in time.");
      return shutdown(1);
    }
    setTimeout(() => waitForUpstream(attempt + 1), 250);
  });
}

function serveStatic(request, response) {
  const pathname = new URL(request.url, `http://${request.headers.host || `${host}:${publicPort}`}`).pathname;
  if (pathname.startsWith("/workspace/assets/")) {
    let relative;
    try { relative = decodeURIComponent(pathname.slice("/workspace/assets/".length)); }
    catch { return false; }
    const assetRoot = path.resolve(appDirectory, "assets");
    const filename = path.resolve(assetRoot, relative);
    if (!filename.startsWith(`${assetRoot}${path.sep}`)) return false;
    const types = { ".avif": "image/avif", ".gif": "image/gif", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".svg": "image/svg+xml", ".webp": "image/webp", ".mp4": "video/mp4", ".webm": "video/webm" };
    const contentType = types[path.extname(filename).toLowerCase()];
    if (!contentType) return false;
    fs.readFile(filename, (error, content) => {
      if (error) return json(response, 404, { error: "Asset not found." });
      response.writeHead(200, { ...securityHeaders, "content-type": contentType, "content-length": content.length });
      response.end(content);
    });
    return true;
  }
  const entry = staticFiles.get(pathname);
  if (!entry) return false;
  const [filename, contentType] = entry;
  fs.readFile(path.join(appDirectory, filename), (error, content) => {
    if (error) {
      response.writeHead(500, { ...securityHeaders, "content-type": "text/plain; charset=utf-8" });
      response.end("The Seneschal interface could not be loaded.");
      return;
    }
    response.writeHead(200, { ...securityHeaders, "content-type": contentType, "content-length": content.length });
    response.end(content);
  });
  return true;
}

function upstreamPath(requestUrl, stripApi) {
  const url = new URL(requestUrl, `http://${host}:${publicPort}`);
  if (!stripApi) return url.pathname + url.search;
  const pathname = url.pathname.startsWith("/api/") ? url.pathname.slice(4) : url.pathname === "/api" ? "/" : url.pathname;
  return pathname + url.search;
}

function upstreamHeaders(request) {
  const headers = { ...request.headers, host: `${host}:${upstreamPort}`, authorization: upstreamAuthorization, "accept-encoding": "identity" };
  delete headers.origin;
  delete headers.referer;
  delete headers.cookie;
  return headers;
}

function proxyRequest(request, response, stripApi = true) {
  const proxied = http.request(
    { hostname: host, port: upstreamPort, path: upstreamPath(request.url, stripApi), method: request.method, headers: upstreamHeaders(request) },
    (upstreamResponse) => {
      const outgoing = { ...upstreamResponse.headers, "cache-control": "no-store", "x-content-type-options": "nosniff" };
      delete outgoing["content-security-policy"];
      delete outgoing["www-authenticate"];
      response.writeHead(upstreamResponse.statusCode || 502, outgoing);
      upstreamResponse.pipe(response);
    }
  );
  proxied.on("error", (error) => {
    if (response.headersSent) return response.destroy(error);
    response.writeHead(502, { ...securityHeaders, "content-type": "application/json; charset=utf-8" });
    response.end(JSON.stringify({ error: `OpenCode connection error: ${error.message}` }));
  });
  request.pipe(proxied);
}

function proxyUpgrade(request, socket, head, stripApi = true) {
  const targetPath = upstreamPath(request.url, stripApi);
  const upstreamSocket = net.connect(upstreamPort, host, () => {
    const lines = [`${request.method} ${targetPath} HTTP/${request.httpVersion}`];
    let hasAuthorization = false;
    for (let index = 0; index < request.rawHeaders.length; index += 2) {
      const name = request.rawHeaders[index];
      const lower = name.toLowerCase();
      if (["cookie", "origin", "referer"].includes(lower)) continue;
      if (lower === "authorization") { hasAuthorization = true; continue; }
      const value = lower === "host" ? `${host}:${upstreamPort}` : request.rawHeaders[index + 1];
      lines.push(`${name}: ${value}`);
    }
    if (!hasAuthorization) lines.push(`Authorization: ${upstreamAuthorization}`);
    else lines.push(`Authorization: ${upstreamAuthorization}`);
    upstreamSocket.write(`${lines.join("\r\n")}\r\n\r\n`);
    if (head.length) upstreamSocket.write(head);
    socket.pipe(upstreamSocket).pipe(socket);
  });
  upstreamSocket.on("error", () => socket.destroy());
}

function json(response, status, payload) {
  const body = JSON.stringify(payload);
  response.writeHead(status, { ...securityHeaders, "content-type": "application/json; charset=utf-8", "content-length": Buffer.byteLength(body) });
  response.end(body);
  return true;
}

function readJsonBody(request, callback) {
  let body = "";
  let size = 0;
  let settled = false;
  const finish = (error, value) => {
    if (settled) return;
    settled = true;
    callback(error, value);
  };
  request.on("data", (chunk) => {
    size += chunk.length;
    if (size > maximumInstructionBytes) {
      request.destroy();
      finish(new Error("The instruction is too large. Keep it below 256 KB."));
      return;
    }
    body += chunk;
  });
  request.on("end", () => {
    try { finish(null, body ? JSON.parse(body) : {}); }
    catch { finish(new Error("The request contains invalid JSON.")); }
  });
  request.on("error", finish);
}

function safeInstructionContent(value) {
  const content = String(value ?? "").replace(/\r\n/g, "\n");
  if (Buffer.byteLength(content, "utf8") > maximumInstructionBytes) throw new Error("Keep each instruction below 256 KB.");
  if (content.includes("\u0000")) throw new Error("Instructions cannot contain null characters.");
  return content.trimEnd() + (content.trim() ? "\n" : "");
}

function projectWindowsDirectory(directory) {
  const value = String(directory || "").replace(/\\/g, "/");
  if (!value.startsWith("/") || value.includes("\u0000") || value.split("/").includes("..")) throw new Error("Select a valid project first.");
  const mounted = value.match(/^\/mnt\/([a-zA-Z])(?:\/(.*))?$/);
  if (mounted) return path.win32.join(`${mounted[1].toUpperCase()}:\\`, ...(mounted[2] || "").split("/").filter(Boolean));
  return path.win32.join(`\\\\wsl.localhost\\${wslDistribution}`, ...value.split("/").filter(Boolean));
}

function projectInstructionFile(directory) {
  const projectDirectory = projectWindowsDirectory(directory);
  if (!fs.existsSync(projectDirectory) || !fs.statSync(projectDirectory).isDirectory()) throw new Error("The selected project folder is not available.");
  return path.win32.join(projectDirectory, "AGENTS.md");
}

function skillRoot(scope, directory) {
  if (scope === "global") return path.win32.join(openCodeConfigDirectory, "skills");
  if (scope === "project") {
    const projectDirectory = projectWindowsDirectory(directory);
    if (!fs.existsSync(projectDirectory) || !fs.statSync(projectDirectory).isDirectory()) throw new Error("The selected project folder is not available.");
    return path.win32.join(projectDirectory, ".opencode", "skills");
  }
  throw new Error("Choose global or project scope.");
}

function managedInstructionTarget(kind, directory) {
  if (kind === "persona") return personaFile;
  if (kind === "general") return generalInstructionsFile;
  if (kind === "project") return projectInstructionFile(directory);
  if (kind === "agent-build") return path.join(instructionDataDirectory, "build.md");
  if (kind === "agent-plan") return path.join(instructionDataDirectory, "plan.md");
  throw new Error("Unknown instruction type.");
}

function readText(filename, fallback = "") {
  try { return fs.readFileSync(filename, "utf8"); }
  catch (error) { if (error.code === "ENOENT") return fallback; throw error; }
}

function readInstructionJournal() {
  try {
    const journal = JSON.parse(fs.readFileSync(instructionJournalFile, "utf8"));
    return Array.isArray(journal) ? journal : [];
  } catch { return []; }
}

function backupManagedFile(kind, filename) {
  if (!fs.existsSync(filename)) return null;
  const id = `${Date.now()}-${crypto.randomBytes(4).toString("hex")}`;
  const backup = path.join(instructionBackupDirectory, `${id}.md`);
  fs.copyFileSync(filename, backup);
  const journal = readInstructionJournal();
  journal.unshift({ id, kind, target: filename, backup, created: new Date().toISOString() });
  fs.writeFileSync(instructionJournalFile, JSON.stringify(journal.slice(0, 120), null, 2), "utf8");
  return id;
}

function writeManagedFile(kind, filename, content, createBackup = true) {
  fs.mkdirSync(path.dirname(filename), { recursive: true });
  const backupID = createBackup ? backupManagedFile(kind, filename) : null;
  fs.writeFileSync(filename, safeInstructionContent(content), "utf8");
  return backupID;
}

function parseSkill(content, id, scope, filename) {
  const header = String(content).match(/^---\s*\n([\s\S]*?)\n---/);
  const field = (name) => header?.[1].match(new RegExp(`^${name}:\\s*["']?(.+?)["']?\\s*$`, "mi"))?.[1]?.trim() || "";
  return { id, scope, name: field("name") || id, description: field("description"), content, filename };
}

function listSkills(root, scope) {
  if (!fs.existsSync(root)) return [];
  return fs.readdirSync(root, { withFileTypes: true }).filter((entry) => entry.isDirectory() && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(entry.name)).flatMap((entry) => {
    const filename = path.win32.join(root, entry.name, "SKILL.md");
    if (!fs.existsSync(filename)) return [];
    return [parseSkill(readText(filename), entry.name, scope, filename)];
  });
}

function validateSkill(id, content) {
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id) || id.length > 64) throw new Error("Skill names use lowercase letters, numbers, and single hyphens only.");
  const parsed = parseSkill(content, id, "", "");
  if (!String(content).startsWith("---") || !parsed.name || !parsed.description) throw new Error("A skill needs YAML frontmatter with both name and description.");
}

function skillLinkTarget(value) {
  let source;
  try { source = new URL(String(value || "").trim()); }
  catch { throw new Error("Paste a valid https link to a SKILL.md file or GitHub skill folder."); }
  if (source.protocol !== "https:") throw new Error("Only secure https skill links can be inspected.");
  const hostname = source.hostname.toLowerCase();
  if (hostname === "raw.githubusercontent.com") {
    if (!/\/SKILL\.md$/i.test(source.pathname)) throw new Error("That raw GitHub link must point directly to SKILL.md.");
    return { source: source.toString(), fetch: source.toString() };
  }
  if (hostname !== "github.com" && hostname !== "www.github.com") throw new Error("For safety, direct install currently accepts GitHub skill links only.");
  const pieces = source.pathname.split("/").filter(Boolean).map(decodeURIComponent);
  const [owner, repository, view, ref, ...rest] = pieces;
  if (!/^[\w.-]+$/.test(owner || "") || !/^[\w.-]+$/.test(repository || "")) {
    throw new Error("Use a valid GitHub repository, SKILL.md file, or skill-folder link.");
  }
  if (!view) return { source: source.toString(), repository: { owner, name: repository.replace(/\.git$/i, "") } };
  if (!["blob", "tree"].includes(view) || !/^[\w.-]+$/.test(ref || "")) {
    throw new Error("Use a GitHub repository, SKILL.md file, or skill-folder link.");
  }
  const relative = view === "blob" ? rest : [...rest, "SKILL.md"];
  if (!relative.length || relative.some((part) => !part || part === "." || part === "..") || !/^SKILL\.md$/i.test(relative.at(-1))) {
    throw new Error("The GitHub link must point to SKILL.md or to its containing folder.");
  }
  const safePath = relative.map(encodeURIComponent).join("/");
  return { source: source.toString(), fetch: `https://raw.githubusercontent.com/${owner}/${repository}/${ref}/${safePath}` };
}

function githubText(url, maximumBytes, accept, callback) {
  let settled = false;
  const finish = (error, value) => { if (!settled) { settled = true; callback(error, value); } };
  const request = https.get(url, { headers: { "user-agent": "Seneschal-Skill-Installer/1.1", accept }, timeout: 10000 }, (response) => {
    let bytes = 0;
    let content = "";
    if (response.statusCode !== 200) { response.resume(); finish(new Error(`GitHub returned ${response.statusCode || "an unknown error"} while inspecting this repository.`)); return; }
    response.setEncoding("utf8");
    response.on("data", (chunk) => {
      bytes += Buffer.byteLength(chunk, "utf8");
      if (bytes > maximumBytes) { request.destroy(new Error("The GitHub response is too large to inspect safely.")); return; }
      content += chunk;
    });
    response.on("end", () => finish(null, { content, bytes }));
  });
  request.on("timeout", () => request.destroy(new Error("The skill link took too long to respond.")));
  request.on("error", (error) => finish(error));
}

function resolveRepositorySkill(target, callback) {
  const { owner, name } = target.repository;
  githubText(`https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}`, 512 * 1024, "application/vnd.github+json", (repoError, repoResult) => {
    if (repoError) return callback(repoError);
    let branch;
    try { branch = JSON.parse(repoResult.content).default_branch; } catch { return callback(new Error("GitHub returned invalid repository information.")); }
    if (!/^[\w./-]+$/.test(branch || "")) return callback(new Error("This repository has no readable default branch."));
    githubText(`https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/git/trees/${encodeURIComponent(branch)}?recursive=1`, 4 * 1024 * 1024, "application/vnd.github+json", (treeError, treeResult) => {
      if (treeError) return callback(treeError);
      let files;
      try { files = JSON.parse(treeResult.content).tree.filter((item) => item.type === "blob" && /(^|\/)SKILL\.md$/i.test(item.path)).map((item) => item.path); }
      catch { return callback(new Error("GitHub returned an unreadable file list.")); }
      if (!files.length) return callback(new Error("No SKILL.md file was found in this repository."));
      const expected = name.replace(/-skill$/i, "").toLowerCase();
      const ranked = files.map((file) => ({ file, folder: file.split("/").at(-2)?.toLowerCase() || "" }));
      const exact = ranked.filter((item) => item.file.toLowerCase() === "skill.md" || item.folder === expected);
      const choices = (exact.length ? exact : ranked).sort((a, b) => a.file.length - b.file.length);
      if (!exact.length && choices.length > 1) return callback(new Error(`This repository contains ${choices.length} skills. Paste the GitHub folder link for the one you want.`));
      const file = choices[0].file;
      const safePath = file.split("/").map(encodeURIComponent).join("/");
      callback(null, { ...target, resolvedPath: file, fetch: `https://raw.githubusercontent.com/${owner}/${name}/${encodeURIComponent(branch)}/${safePath}` });
    });
  });
}

function readTrustedSkillLink(value, callback) {
  let initial;
  try { initial = skillLinkTarget(value); }
  catch (error) { callback(error); return; }
  const read = (target) => githubText(target.fetch, maximumInstructionBytes, "text/plain,text/markdown;q=0.9,*/*;q=0.1", (readError, result) => {
    if (readError) return callback(readError);
    try {
      const content = safeInstructionContent(result.content);
      const parsed = parseSkill(content, "remote-skill", "global", "");
      const id = String(parsed.name || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 64);
      validateSkill(id, content);
      callback(null, { source: target.source, fetch: target.fetch, resolvedPath: target.resolvedPath || "", id, name: parsed.name, description: parsed.description, content, bytes: result.bytes });
    } catch (error) { callback(error); }
  });
  if (initial.repository) return resolveRepositorySkill(initial, (error, target) => error ? callback(error) : read(target));
  read(initial);
}

function instructionSnapshot(directory = "") {
  let project = "";
  let projectPath = "";
  if (directory) {
    projectPath = projectInstructionFile(directory);
    project = readText(projectPath);
  }
  const globalSkillsRoot = skillRoot("global", directory);
  const projectSkillsRoot = directory ? skillRoot("project", directory) : "";
  return {
    persona: { content: readText(personaFile), path: personaFile },
    general: { content: readText(generalInstructionsFile), path: generalInstructionsFile },
    project: { content: project, path: projectPath, available: Boolean(directory) },
    roles: {
      build: readText(path.join(instructionDataDirectory, "build.md")),
      plan: readText(path.join(instructionDataDirectory, "plan.md"))
    },
    skills: [...listSkills(globalSkillsRoot, "global"), ...(projectSkillsRoot ? listSkills(projectSkillsRoot, "project") : [])].map(({ filename, ...skill }) => skill),
    backupCount: readInstructionJournal().length
  };
}

function archiveSkill(scope, id, directory) {
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id)) throw new Error("Invalid skill name.");
  const root = skillRoot(scope, directory);
  const source = path.win32.join(root, id);
  if (!fs.existsSync(source)) throw new Error("That skill no longer exists.");
  if (fs.lstatSync(source).isSymbolicLink()) throw new Error("Linked skill folders cannot be archived here.");
  const disabledRoot = scope === "global"
    ? path.win32.join(openCodeConfigDirectory, "disabled-skills")
    : path.win32.join(projectWindowsDirectory(directory), ".opencode", "disabled-skills");
  fs.mkdirSync(disabledRoot, { recursive: true });
  const destination = path.win32.join(disabledRoot, `${id}-${new Date().toISOString().replace(/[:.]/g, "-")}`);
  fs.renameSync(source, destination);
  return destination;
}

function endpointError(response, error) {
  return json(response, 400, { error: error?.message || "The instruction change could not be completed." });
}

function blenderHealth(callback) {
  const socket = net.connect({ host, port: blenderPort });
  let settled = false;
  const finish = (online) => {
    if (settled) return;
    settled = true;
    socket.destroy();
    callback({ installed: fs.existsSync(blenderExecutable), bridge: online, port: blenderPort });
  };
  socket.setTimeout(700);
  socket.once("connect", () => finish(true));
  socket.once("timeout", () => finish(false));
  socket.once("error", () => finish(false));
}

function runCommand(command, args, callback, options = {}) {
  const child = spawn(command, args, { windowsHide: true, ...options });
  let stdout = "";
  let stderr = "";
  child.stdout?.on("data", (chunk) => { stdout += chunk; });
  child.stderr?.on("data", (chunk) => { stderr += chunk; });
  child.on("error", (error) => callback(error));
  child.on("close", (code) => callback(code === 0 ? null : new Error(stderr || `${command} exited with ${code}`), stdout));
}

function readAgentBoard() {
  try {
    const board = JSON.parse(fs.readFileSync(agentBoardFile, "utf8"));
    return board && typeof board === "object" ? board : {};
  } catch { return {}; }
}

function writeAgentBoard(board) {
  const now = Date.now();
  const safe = board && typeof board === "object" ? { ...board } : {};
  safe.id = /^board-[a-z0-9-]+$/i.test(String(safe.id || "")) ? String(safe.id) : `board-${crypto.randomUUID()}`;
  safe.createdAt = Number(safe.createdAt) || now;
  safe.updatedAt = now;
  const encoded = JSON.stringify(safe, null, 2);
  if (Buffer.byteLength(encoded, "utf8") > 1024 * 1024) throw new Error("The Agent Board is too large to save.");
  const temporary = `${agentBoardFile}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, `${encoded}\n`, "utf8");
  fs.copyFileSync(temporary, agentBoardFile);
  fs.unlinkSync(temporary);
  const historyFile = path.join(agentBoardHistoryDirectory, `${safe.id}.json`);
  fs.writeFileSync(historyFile, `${encoded}\n`, "utf8");
  return safe;
}

function readAgentBoardHistory() {
  return fs.readdirSync(agentBoardHistoryDirectory, { withFileTypes: true })
    .filter((entry) => entry.isFile() && /^board-[a-z0-9-]+\.json$/i.test(entry.name))
    .map((entry) => {
      try {
        const board = JSON.parse(fs.readFileSync(path.join(agentBoardHistoryDirectory, entry.name), "utf8"));
        return {
          id: String(board.id || entry.name.replace(/\.json$/i, "")), title: String(board.title || board.objective || "Untitled board").slice(0, 120),
          objective: String(board.objective || "").slice(0, 300), directory: String(board.directory || ""), agentCount: Array.isArray(board.agents) ? board.agents.length : 0,
          createdAt: Number(board.createdAt || 0), updatedAt: Number(board.updatedAt || 0), active: Boolean(board.active)
        };
      } catch { return null; }
    }).filter(Boolean).sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 100);
}

function readAgentBoardFromHistory(id) {
  if (!/^board-[a-z0-9-]+$/i.test(String(id || ""))) throw new Error("Choose a valid saved board.");
  const filename = path.join(agentBoardHistoryDirectory, `${id}.json`);
  const board = JSON.parse(fs.readFileSync(filename, "utf8"));
  return board && typeof board === "object" ? board : {};
}

function deleteAgentBoardFromHistory(id) {
  if (!/^board-[a-z0-9-]+$/i.test(String(id || ""))) throw new Error("Choose a valid saved board.");
  const filename = path.join(agentBoardHistoryDirectory, `${id}.json`);
  if (fs.existsSync(filename)) fs.unlinkSync(filename);
  return { deleted: true, id };
}

function findVsCodeExecutable() {
  const candidates = [
    process.env.SENESCHAL_VSCODE,
    path.join(process.env.LOCALAPPDATA || "", "Programs", "Microsoft VS Code", "Code.exe"),
    path.join(process.env.ProgramFiles || "C:\\Program Files", "Microsoft VS Code", "Code.exe"),
    path.join(process.env["ProgramFiles(x86)"] || "C:\\Program Files (x86)", "Microsoft VS Code", "Code.exe")
  ].filter(Boolean);
  return candidates.find((candidate) => fs.existsSync(candidate)) || "";
}

function vsCodeRuntimeInfo() {
  const executable = findVsCodeExecutable();
  const companion = path.join(installDirectory, "extensions", "seneschal-vscode", "seneschal-vscode.vsix");
  return { available: Boolean(executable), executable, remote: `wsl+${wslDistribution}`, companion, companionAvailable: fs.existsSync(companion) };
}

function installVsCodeCompanion() {
  const runtime = vsCodeRuntimeInfo();
  if (!runtime.available) throw new Error("Visual Studio Code was not found.");
  if (!runtime.companionAvailable) throw new Error("The Seneschal VS Code companion package is missing from this installation.");
  const connectionFile = refreshVsCodeConnection();
  const child = spawn(runtime.executable, ["--install-extension", runtime.companion, "--force"], { detached: true, stdio: "ignore", windowsHide: true });
  child.unref();
  return { installing: true, connectionFile };
}

function openInVsCode(body = {}) {
  const runtime = vsCodeRuntimeInfo();
  if (!runtime.available) throw new Error("Visual Studio Code was not found. Install it or set SENESCHAL_VSCODE to Code.exe.");
  const directory = String(body.directory || launchDirectory).trim();
  const resource = String(body.resource || "").trim();
  const line = Math.max(1, Number.parseInt(body.line, 10) || 1);
  const column = Math.max(1, Number.parseInt(body.column, 10) || 1);
  const target = resource || directory;
  if (!target || /[\r\n\0]/.test(target)) throw new Error("Choose a valid project or file path.");
  const args = [];
  const isWslPath = /^\//.test(target);
  if (isWslPath) args.push("--remote", runtime.remote);
  if (body.newWindow !== false) args.push("--new-window");
  if (resource) args.push("--goto", `${target}:${line}:${column}`);
  else args.push(target);
  const child = spawn(runtime.executable, args, { detached: true, stdio: "ignore", windowsHide: false });
  child.unref();
  return { opening: true, target, remote: isWslPath ? runtime.remote : "local" };
}

function usageEstimate(callback) {
  runCommand("wsl.exe", ["-d", wslDistribution, "--", "bash", "-ic", "opencode stats --days 30"], (error, stdout = "") => {
    if (error) return callback({ budget: 10, cost: null, percent: null, note: "Usage estimate is temporarily unavailable." });
    const clean = stdout.replace(/\x1b\[[0-9;]*m/g, "");
    const match = clean.match(/Total Cost\s+\$([0-9]+(?:\.[0-9]+)?)/i) || clean.match(/\$([0-9]+(?:\.[0-9]+)?)/);
    const cost = match ? Number(match[1]) : 0;
    callback({ budget: 10, cost, percent: Math.min(100, Math.round(cost * 10)), periodDays: 30, hardCap: false, note: "Local catalog estimate; provider limits remain the hard safety control." });
  });
}

function browserRuntimeInfo() {
  const localAppData = process.env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local");
  let configuredLauncher = "";
  try {
    const config = JSON.parse(fs.readFileSync(openCodeConfigFile, "utf8"));
    const command = config.mcp?.playwright?.command;
    const configured = Array.isArray(command) ? command.findLast((item) => /start-playwright-mcp\.cmd$/i.test(String(item))) : "";
    if (configured) configuredLauncher = String(configured).replace(/^\/mnt\/([a-z])\//i, (_, drive) => `${drive.toUpperCase()}:\\`).replaceAll("/", "\\");
  } catch { configuredLauncher = ""; }
  const launchers = [
    configuredLauncher,
    path.join(localAppData, "Seneschal", "browser-runtime", "start-playwright-mcp.cmd"),
    path.join(installDirectory, "browser-runtime", "start-playwright-mcp.cmd"),
    path.join(localAppData, "OpenCodeAtelier", "browser-runtime", "start-playwright-mcp.cmd")
  ].filter(Boolean);
  const launcher = launchers.find((candidate) => fs.existsSync(candidate) && fs.existsSync(path.join(path.dirname(candidate), "node_modules", ".bin", "playwright-mcp.cmd"))) || "";
  const runtimeRoot = launcher ? path.dirname(path.dirname(launcher)) : installDirectory;
  const flag = path.join(runtimeRoot, "data", "playwright-visible.flag");
  let visibilityAware = false;
  try { visibilityAware = /playwright-visible\.flag/i.test(fs.readFileSync(launcher, "utf8")); } catch {}
  return { available: Boolean(launcher), visible: fs.existsSync(flag), launcher, flag, visibilityAware };
}

function ensureVisibilityAwareBrowserLauncher(runtime) {
  if (!runtime?.launcher || runtime.visibilityAware) return runtime;
  const currentLauncher = path.join(installDirectory, "scripts", "start-playwright-mcp.cmd");
  if (!fs.existsSync(currentLauncher)) throw new Error("The current visibility-aware Playwright launcher is missing. Reinstall Seneschal.");
  const source = fs.readFileSync(currentLauncher, "utf8");
  if (!/playwright-visible\.flag/i.test(source)) throw new Error("The bundled Playwright launcher does not support visible mode.");
  const backup = `${runtime.launcher}.legacy-headless-backup`;
  if (!fs.existsSync(backup)) fs.copyFileSync(runtime.launcher, backup);
  fs.copyFileSync(currentLauncher, runtime.launcher);
  return browserRuntimeInfo();
}

function repairBrowserRuntime() {
  try {
    const runtime = browserRuntimeInfo();
    return runtime.available && !runtime.visibilityAware ? ensureVisibilityAwareBrowserLauncher(runtime) : runtime;
  } catch (error) {
    console.warn(`Playwright visibility launcher could not be repaired: ${error.message}`);
    return browserRuntimeInfo();
  }
}

function focusVisibleBrowser(callback) {
  const script = [
    "$code='using System; using System.Runtime.InteropServices; public static class SeneschalWindow { [DllImport(\"user32.dll\")] public static extern bool ShowWindowAsync(IntPtr hWnd,int nCmdShow); [DllImport(\"user32.dll\")] public static extern bool SetForegroundWindow(IntPtr hWnd); }'",
    "Add-Type -TypeDefinition $code -ErrorAction SilentlyContinue",
    "$p=Get-Process brave,chrome,msedge -ErrorAction SilentlyContinue | Where-Object {$_.MainWindowHandle -ne 0} | Sort-Object StartTime -Descending | Select-Object -First 1",
    "if(-not $p){exit 2}",
    "[SeneschalWindow]::ShowWindowAsync($p.MainWindowHandle,9) | Out-Null",
    "[SeneschalWindow]::SetForegroundWindow($p.MainWindowHandle) | Out-Null"
  ].join("; ");
  runCommand("powershell.exe", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", script], (error) => callback(error));
}

function restartPlaywrightBridge(directory, callback) {
  const query = new URLSearchParams({ directory: directory || launchDirectory }).toString();
  const changeConnection = (action, done) => {
    const request = http.request({
      hostname: host,
      port: upstreamPort,
      path: `/mcp/playwright/${action}?${query}`,
      method: "POST",
      timeout: 10000,
      headers: { authorization: upstreamAuthorization, accept: "application/json" }
    }, (response) => {
      let payload = "";
      response.on("data", (chunk) => { payload += chunk; });
      response.on("end", () => {
        if (response.statusCode >= 200 && response.statusCode < 300) return done(null);
        done(new Error(payload || `OpenCode could not ${action} the Playwright bridge (${response.statusCode}).`));
      });
    });
    request.once("timeout", () => request.destroy(new Error(`OpenCode took too long to ${action} the Playwright bridge.`)));
    request.once("error", done);
    request.end();
  };
  changeConnection("disconnect", (disconnectError) => {
    if (disconnectError) return callback(disconnectError);
    changeConnection("connect", (connectError) => callback(connectError, !connectError));
  });
}

function handleWorkspaceEndpoint(request, response, pathname) {
  const requestUrl = new URL(request.url, `http://${request.headers.host || `${host}:${publicPort}`}`);
  if (pathname === "/workspace/approval-policy" && request.method === "GET") {
    try {
      const config = JSON.parse(fs.readFileSync(openCodeConfigFile, "utf8"));
      const build = config.agent?.build?.permission || {};
      const profile = build.edit === "allow" && build.bash === "allow" ? "trusted" : config.permission?.read === "ask" ? "strict" : "recommended";
      return json(response, 200, { profile });
    } catch (error) { return endpointError(response, error); }
  }
  if (pathname === "/workspace/approval-policy" && request.method === "POST") {
    readJsonBody(request, (error, body) => {
      if (error) return endpointError(response, error);
      try {
        if (!["strict", "recommended", "trusted"].includes(body.profile)) throw new Error("Unknown approval profile.");
        const config = JSON.parse(fs.readFileSync(openCodeConfigFile, "utf8"));
        const sensitive = ["edit", "bash", "task", "external_directory", "webfetch", "websearch", "playwright_*", "blender_*"];
        config.permission ||= {};
        sensitive.forEach((key) => { config.permission[key] = "ask"; });
        config.permission.read = body.profile === "strict" ? "ask" : { "*": "allow", "*.env": "ask", "*.env.*": "ask", "*.env.example": "allow" };
        config.agent ||= {}; config.agent.plan ||= {}; config.agent.plan.permission ||= {};
        Object.assign(config.agent.plan.permission, { edit: "deny", bash: "deny", "blender_*": "deny", "playwright_*": "ask" });
        config.agent.build ||= {}; config.agent.build.permission ||= {};
        const buildAction = body.profile === "trusted" ? "allow" : "ask";
        Object.assign(config.agent.build.permission, { edit: buildAction, bash: buildAction, "blender_*": "ask", "playwright_*": "ask" });
        fs.copyFileSync(openCodeConfigFile, `${openCodeConfigFile}.approval-backup`);
        fs.writeFileSync(openCodeConfigFile, `${JSON.stringify(config, null, 2)}\n`, "utf8");
        return json(response, 200, { saved: true, profile: body.profile, restartRequired: true });
      } catch (saveError) { return endpointError(response, saveError); }
    });
    return true;
  }
  if (pathname === "/workspace/instructions" && request.method === "GET") {
    try { return json(response, 200, instructionSnapshot(requestUrl.searchParams.get("directory") || "")); }
    catch (error) { return endpointError(response, error); }
  }
  if (pathname === "/workspace/instructions/save" && request.method === "POST") {
    readJsonBody(request, (error, body) => {
      if (error) return endpointError(response, error);
      try {
        const target = managedInstructionTarget(body.kind, body.directory || "");
        const backupID = writeManagedFile(body.kind, target, body.content);
        return json(response, 200, { saved: true, backupID, snapshot: instructionSnapshot(body.directory || "") });
      } catch (saveError) { return endpointError(response, saveError); }
    });
    return true;
  }
  if (pathname === "/workspace/instructions/undo" && request.method === "POST") {
    readJsonBody(request, (error, body) => {
      if (error) return endpointError(response, error);
      try {
        const target = managedInstructionTarget(body.kind, body.directory || "");
        const entry = readInstructionJournal().find((item) => item.kind === body.kind && item.target === target && fs.existsSync(item.backup));
        if (!entry) throw new Error("There is no earlier saved version for this instruction yet.");
        backupManagedFile(`${body.kind}-before-undo`, target);
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.copyFileSync(entry.backup, target);
        return json(response, 200, { restored: true, snapshot: instructionSnapshot(body.directory || "") });
      } catch (restoreError) { return endpointError(response, restoreError); }
    });
    return true;
  }
  if (pathname === "/workspace/skills/save" && request.method === "POST") {
    readJsonBody(request, (error, body) => {
      if (error) return endpointError(response, error);
      try {
        const content = safeInstructionContent(body.content);
        validateSkill(String(body.id || ""), content);
        const root = skillRoot(body.scope, body.directory || "");
        const folder = path.win32.join(root, body.id);
        if (fs.existsSync(folder) && fs.lstatSync(folder).isSymbolicLink()) throw new Error("Linked skill folders cannot be edited here.");
        const filename = path.win32.join(folder, "SKILL.md");
        const backupID = writeManagedFile(`skill-${body.scope}-${body.id}`, filename, content);
        return json(response, 200, { saved: true, backupID, snapshot: instructionSnapshot(body.directory || "") });
      } catch (saveError) { return endpointError(response, saveError); }
    });
    return true;
  }
  if (pathname === "/workspace/skills/inspect-link" && request.method === "POST") {
    readJsonBody(request, (error, body) => {
      if (error) return endpointError(response, error);
      readTrustedSkillLink(body.url, (readError, skill) => {
        if (readError) return endpointError(response, readError);
        return json(response, 200, { inspected: true, skill });
      });
    });
    return true;
  }
  if (pathname === "/workspace/skills/archive" && request.method === "POST") {
    readJsonBody(request, (error, body) => {
      if (error) return endpointError(response, error);
      try {
        const destination = archiveSkill(body.scope, String(body.id || ""), body.directory || "");
        return json(response, 200, { archived: true, recoverable: true, destination, snapshot: instructionSnapshot(body.directory || "") });
      } catch (archiveError) { return endpointError(response, archiveError); }
    });
    return true;
  }
  if (pathname === "/workspace/blender-health" && request.method === "GET") {
    blenderHealth((status) => json(response, 200, status));
    return true;
  }
  if (pathname === "/workspace/agent-board" && request.method === "GET") {
    return json(response, 200, readAgentBoard());
  }
  if (pathname === "/workspace/agent-board" && request.method === "POST") {
    readJsonBody(request, (error, body) => {
      if (error) return endpointError(response, error);
      try { return json(response, 200, writeAgentBoard(body)); }
      catch (saveError) { return endpointError(response, saveError); }
    });
    return true;
  }
  if (pathname === "/workspace/agent-board/history" && request.method === "GET") {
    try { return json(response, 200, { boards: readAgentBoardHistory() }); }
    catch (historyError) { return endpointError(response, historyError); }
  }
  if (pathname === "/workspace/agent-board/history/restore" && request.method === "POST") {
    readJsonBody(request, (error, body) => {
      if (error) return endpointError(response, error);
      try { return json(response, 200, writeAgentBoard(readAgentBoardFromHistory(body.id))); }
      catch (restoreError) { return endpointError(response, restoreError); }
    });
    return true;
  }
  if (pathname === "/workspace/agent-board/history" && request.method === "DELETE") {
    try { return json(response, 200, deleteAgentBoardFromHistory(requestUrl.searchParams.get("id"))); }
    catch (deleteError) { return endpointError(response, deleteError); }
  }
  if (pathname === "/workspace/vscode" && request.method === "GET") {
    const runtime = vsCodeRuntimeInfo();
    return json(response, 200, { available: runtime.available, remote: runtime.remote, companionAvailable: runtime.companionAvailable });
  }
  if (pathname === "/workspace/vscode/open" && request.method === "POST") {
    readJsonBody(request, (error, body) => {
      if (error) return endpointError(response, error);
      try { return json(response, 202, openInVsCode(body)); }
      catch (openError) { return endpointError(response, openError); }
    });
    return true;
  }
  if (pathname === "/workspace/vscode/install-companion" && request.method === "POST") {
    try { return json(response, 202, installVsCodeCompanion()); }
    catch (installError) { return endpointError(response, installError); }
  }
  if (pathname === "/workspace/browser-mode" && request.method === "GET") {
    const runtime = browserRuntimeInfo();
    return json(response, 200, { available: runtime.available, visible: runtime.visible, visibilityAware: runtime.visibilityAware, repairing: runtime.available && !runtime.visibilityAware, restarting: false });
  }
  if (pathname === "/workspace/browser-mode" && request.method === "POST") {
    readJsonBody(request, (error, body) => {
      if (error) return endpointError(response, error);
      try {
        let runtime = browserRuntimeInfo();
        if (!runtime.available) return json(response, 404, { error: "The Playwright Brave bridge is not installed yet. Run the Seneschal installer first." });
        if (typeof body.visible !== "boolean") throw new Error("Browser visibility must be true or false.");
        runtime = ensureVisibilityAwareBrowserLauncher(runtime);
        fs.mkdirSync(path.dirname(runtime.flag), { recursive: true });
        if (body.visible) fs.writeFileSync(runtime.flag, "visible\n", "utf8");
        else if (fs.existsSync(runtime.flag)) fs.unlinkSync(runtime.flag);
        restartPlaywrightBridge(body.directory || launchDirectory, (restartError, restarted = false) => {
          if (restartError) return endpointError(response, restartError);
          return json(response, 200, { available: true, visible: body.visible, visibilityAware: true, repairing: false, restarting: false, restarted, takesEffect: "next-browser-action" });
        });
      } catch (modeError) { return endpointError(response, modeError); }
    });
    return true;
  }
  if (pathname === "/workspace/browser-focus" && request.method === "POST") {
    const runtime = browserRuntimeInfo();
    if (!runtime.available || !runtime.visible) return json(response, 409, { error: "Visible browser mode is not enabled." });
    focusVisibleBrowser((error) => {
      if (error) return json(response, 404, { error: "The Playwright browser window has not appeared yet." });
      return json(response, 200, { focused: true });
    });
    return true;
  }
  if (pathname === "/workspace/blender/open" && request.method === "POST") {
    if (!blenderExecutable || !fs.existsSync(blenderExecutable)) return json(response, 404, { error: "Blender was not found. Set its path in data/settings.json." });
    const child = spawn(blenderExecutable, [], { detached: true, stdio: "ignore", windowsHide: false });
    child.unref();
    return json(response, 202, { opening: true, bridgePort: blenderPort });
  }
  if (pathname === "/workspace/usage" && request.method === "GET") {
    usageEstimate((usage) => json(response, 200, usage));
    return true;
  }
  if (pathname === "/workspace/backup" && request.method === "POST") {
    if (!fs.existsSync(backupScript)) return json(response, 404, { error: "Backup script is missing." });
    const child = spawn("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", backupScript], { detached: true, stdio: "ignore", windowsHide: true });
    child.unref();
    return json(response, 202, { started: true });
  }
  return false;
}

function scheduleWeeklyBackup() {
  if (!fs.existsSync(backupScript)) return;
  const marker = path.join(dataDirectory, "last-backup-started.txt");
  const last = fs.existsSync(marker) ? Number(fs.readFileSync(marker, "utf8")) : 0;
  if (Date.now() - last < 7 * 86400000) return;
  fs.writeFileSync(marker, String(Date.now()), "utf8");
  const child = spawn("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", backupScript], { detached: true, stdio: "ignore", windowsHide: true });
  child.unref();
}

function listenWithRetry(server, port, label) {
  let retries = 0;
  server.on("error", (error) => {
    if (error.code === "EADDRINUSE" && retries < 40 && !shuttingDown) {
      retries += 1;
      console.log(`${label} port ${port} is busy; retrying (${retries}/40).`);
      setTimeout(() => server.listen(port, host), 250);
      return;
    }
    console.error(error.code === "EADDRINUSE" ? `${label} port ${port} remained busy.` : error.message);
    shutdown(1);
  });
  server.listen(port, host);
}

function startCustomProxy() {
  proxy = http.createServer((request, response) => {
    const pathname = new URL(request.url, `http://${request.headers.host || `${host}:${publicPort}`}`).pathname;
    if (pathname === "/workspace-health") {
      const probe = net.createConnection({ host, port: upstreamPort });
      let settled = false;
      const finish = (engine) => {
        if (settled) return;
        settled = true;
        probe.destroy();
        return json(response, engine ? 200 : 503, { healthy: engine, interface: "atelier", engine, upstream: upstreamPort, classic: classicPort, testedOpenCodeVersion });
      };
      probe.setTimeout(1200);
      probe.once("connect", () => finish(true));
      probe.once("timeout", () => finish(false));
      probe.once("error", () => finish(false));
      return;
    }
    if (authorizeFromQuery(request, response)) return;
    if (!isAuthorized(request)) return rejectUnauthorized(response);
    if (pathname === "/classic") {
      response.writeHead(302, { ...securityHeaders, location: `http://${host}:${classicPort}/?access=${workspaceToken}` });
      return response.end();
    }
    if (handleWorkspaceEndpoint(request, response, pathname)) return;
    if (pathname.startsWith("/api")) return proxyRequest(request, response, true);
    if (serveStatic(request, response)) return;
    response.writeHead(404, { ...securityHeaders, "content-type": "text/plain; charset=utf-8" });
    response.end("Not found");
  });
  proxy.on("upgrade", (request, socket, head) => {
    if (!isAuthorized(request)) return socket.destroy();
    proxyUpgrade(request, socket, head, true);
  });
  proxy.once("listening", () => {
    startClassicProxy();
    openWorkspace();
  });
  listenWithRetry(proxy, publicPort, "Workspace");
}

function startClassicProxy() {
  classicProxy = http.createServer((request, response) => {
    if (authorizeFromQuery(request, response)) return;
    if (!isAuthorized(request)) return rejectUnauthorized(response);
    proxyRequest(request, response, false);
  });
  classicProxy.on("upgrade", (request, socket, head) => {
    if (!isAuthorized(request)) return socket.destroy();
    proxyUpgrade(request, socket, head, false);
  });
  listenWithRetry(classicProxy, classicPort, "Classic OpenCode");
}

function launchWorkspaceBrowser() {
  const url = `http://${host}:${publicPort}/?access=${workspaceToken}`;
  const braveCandidates = [
    "C:\\Program Files\\BraveSoftware\\Brave-Browser\\Application\\brave.exe",
    "C:\\Program Files (x86)\\BraveSoftware\\Brave-Browser\\Application\\brave.exe",
    path.join(process.env.LOCALAPPDATA || "", "BraveSoftware", "Brave-Browser", "Application", "brave.exe")
  ];
  const brave = braveCandidates.find((candidate) => candidate && fs.existsSync(candidate));
  const opener = brave
    ? spawn(brave, [url], { detached: true, stdio: "ignore", windowsHide: true })
    : spawn("cmd.exe", ["/d", "/s", "/c", "start", "", url], { detached: true, stdio: "ignore", windowsHide: true });
  opener.unref();
}

function openRunningWorkspace(attempt = 0) {
  const request = http.get({ hostname: host, port: publicPort, path: "/", timeout: 700 }, (response) => {
    response.resume();
    launchWorkspaceBrowser();
    setTimeout(() => process.exit(0), 80);
  });
  request.on("error", () => {
    if (attempt >= 120) {
      console.error("The existing Seneschal process did not become ready in time.");
      return process.exit(1);
    }
    setTimeout(() => openRunningWorkspace(attempt + 1), 250);
  });
  request.on("timeout", () => request.destroy());
}

function openWorkspace() {
  console.log(`Seneschal: http://${host}:${publicPort}/`);
  try { refreshVsCodeConnection(); }
  catch (error) { console.warn(`VS Code connection could not be refreshed: ${error.message}`); }
  scheduleWeeklyBackup();
  launchWorkspaceBrowser();
}

function startServers() {
  if (proxy || serversStarting) return;
  serversStarting = true;
  repairBrowserRuntime();
  startCustomProxy();
}

function shutdown(code = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  proxy?.close();
  classicProxy?.close();
  if (upstream && !upstream.killed) upstream.kill();
  setTimeout(() => process.exit(code), 180);
}

process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));

if (ownsInstanceLock) {
  ensureOpenCodeModelCatalog();
  checkUpstream((ready) => {
    if (ready) return startServers();
    startUpstream();
    waitForUpstream();
  });
}
