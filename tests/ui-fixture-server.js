"use strict";

const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const port = Number(process.env.SENESCHAL_UI_TEST_PORT) || 4206;
let sessionCounter = 0;
const sessions = [];
const statuses = {};
const messages = {};
const fixtureBoard = { version: 3, id: "fixture-board", title: "Launch the Seneschal beta", directory: "/home/demo/projects/seneschal", objective: "Prepare, verify, and publish a reliable Seneschal release.", concurrency: 3, active: false, paused: false, createdAt: Date.now() - 7200000, updatedAt: Date.now() - 1800000, agents: [], communications: [] };
const files = new Map([
  ["/", ["app/index.html", "text/html; charset=utf-8"]],
  ["/workspace/app.js", ["app/app.js", "application/javascript; charset=utf-8"]],
  ["/workspace/styles.css", ["app/styles.css", "text/css; charset=utf-8"]],
  ["/workspace/favicon.svg", ["app/favicon.svg", "image/svg+xml"]],
  ["/workspace/favicon.ico", ["app/favicon.ico", "image/x-icon"]],
  ["/workspace/favicon.png", ["app/favicon.png", "image/png"]],
  ["/workspace/favicon-32.png", ["app/favicon-32.png", "image/png"]],
  ["/workspace/icon-192.png", ["app/icon-192.png", "image/png"]]
]);

const json = (response, body, status = 200) => {
  const encoded = JSON.stringify(body);
  response.writeHead(status, { "content-type": "application/json", "content-length": Buffer.byteLength(encoded), "cache-control": "no-store" });
  response.end(encoded);
};

const readBody = (request, callback) => {
  let raw = "";
  request.on("data", (chunk) => { raw += chunk; });
  request.on("end", () => { try { callback(raw ? JSON.parse(raw) : {}); } catch { callback({}); } });
};

const emptyInstructionSnapshot = {
  persona: { content: "", path: "fixture" }, general: { content: "", path: "fixture" }, project: { content: "", path: "fixture" },
  agents: { build: { content: "", path: "fixture" }, plan: { content: "", path: "fixture" } }, skills: [], backups: []
};

const server = http.createServer((request, response) => {
  const url = new URL(request.url, `http://127.0.0.1:${port}`);
  if (files.has(url.pathname)) {
    const [relative, type] = files.get(url.pathname);
    const content = fs.readFileSync(path.join(root, relative));
    response.writeHead(200, { "content-type": type, "content-length": content.length, "cache-control": "no-store" });
    return response.end(content);
  }
  if (["/api/event", "/event"].includes(url.pathname)) {
    response.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-store", connection: "keep-alive" });
    response.write(`data: ${JSON.stringify({ type: "server.connected", properties: {} })}\n\n`);
    return;
  }
  if (url.pathname === "/global/health") return json(response, { healthy: true, version: "1.18.21" });
  if (/^\/mcp\/playwright\/(?:connect|disconnect)$/.test(url.pathname)) return json(response, { connected: url.pathname.endsWith("connect") });
  if (["/api/session", "/session"].includes(url.pathname) && request.method === "POST") return readBody(request, (body) => {
    const id = `fixture-session-${++sessionCounter}`;
    const session = { id, title: body.title || "Fixture session", directory: url.searchParams.get("directory") || "/home/demo/projects/seneschal", time: { created: Date.now(), updated: Date.now() } };
    sessions.unshift(session); statuses[id] = { type: "idle" }; messages[id] = [];
    json(response, session);
  });
  const promptMatch = url.pathname.match(/^(?:\/api)?\/session\/([^/]+)\/prompt_async$/);
  if (promptMatch && request.method === "POST") return readBody(request, (body) => {
    const id = decodeURIComponent(promptMatch[1]);
    statuses[id] = { type: "busy" };
    messages[id] ||= [];
    messages[id].push({ info: { id: `user-${Date.now()}`, sessionID: id, role: "user", time: { created: Date.now() } }, parts: body.parts || [] });
    setTimeout(() => {
      const text = (body.parts || []).find((part) => part.type === "text")?.text || "";
      messages[id].push({ info: { id: `assistant-${Date.now()}`, sessionID: id, role: "assistant", time: { created: Date.now(), completed: Date.now() }, modelID: body.model?.modelID }, parts: [{ type: "text", text: `Fixture handoff completed. Received ${text.length} characters and verified the assigned responsibility.` }] });
      statuses[id] = { type: "idle" };
    }, 350);
    json(response, { accepted: true }, 202);
  });
  const messageMatch = url.pathname.match(/^(?:\/api)?\/session\/([^/]+)\/message$/);
  if (messageMatch) return json(response, messages[decodeURIComponent(messageMatch[1])] || []);
  const apiResponses = new Map([
    ["/api/global/health", { healthy: true, version: "1.18.21" }],
    ["/api/path", { directory: "/home/demo/projects/seneschal", state: "/home/demo/.local/state/opencode", config: "/home/demo/.config/opencode" }],
    ["/api/session", sessions], ["/api/session/status", statuses], ["/api/permission", []], ["/api/command", []],
    ["/api/provider", { all: [{ id: "fixture", name: "Fixture", models: { "test-model": { id: "test-model", name: "Test Model", capabilities: { input: { text: true }, toolcall: true } } } }], connected: ["fixture"], default: { fixture: "test-model" } }],
    ["/api/config", { permission: {}, agent: {} }], ["/api/agent", [{ name: "build", description: "Build", mode: "primary" }, { name: "plan", description: "Plan", mode: "primary" }]],
    ["/api/experimental/tool/ids", ["read", "write", "edit", "bash", "task", "playwright_browser_navigate"]],
    ["/api/mcp", { playwright: { status: "connected" }, blender: { status: "connected" } }]
  ]);
  const mappedPath = url.pathname.startsWith("/api/") ? url.pathname : `/api${url.pathname}`;
  if (apiResponses.has(mappedPath)) return json(response, apiResponses.get(mappedPath));
  if (url.pathname === "/workspace/blender-health") return json(response, { installed: true, bridge: false });
  if (url.pathname === "/workspace/browser-mode") return json(response, { available: true, visible: true, visibilityAware: true, restarting: false });
  if (url.pathname === "/workspace/vscode") return json(response, { available: true, remote: "wsl+Ubuntu", companionAvailable: true });
  if (url.pathname === "/workspace/usage") return json(response, { budget: 10, cost: 0.25, percent: 3 });
  if (url.pathname === "/workspace/agent-board/history/restore" && request.method === "POST") return readBody(request, () => json(response, fixtureBoard));
  if (url.pathname === "/workspace/agent-board/history") return json(response, { boards: [{ id: fixtureBoard.id, title: fixtureBoard.title, objective: fixtureBoard.objective, directory: fixtureBoard.directory, agentCount: 4, createdAt: fixtureBoard.createdAt, updatedAt: fixtureBoard.updatedAt }] });
  if (url.pathname === "/workspace/agent-board") return json(response, fixtureBoard);
  if (url.pathname === "/workspace/instructions") return json(response, emptyInstructionSnapshot);
  return json(response, { ok: true }, 200);
});

server.listen(port, "127.0.0.1", () => console.log(`Seneschal UI fixture: http://127.0.0.1:${port}`));
