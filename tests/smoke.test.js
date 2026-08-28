"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

test("release contains the required portable files", () => {
  for (const file of ["server.js", "app/index.html", "app/app.js", "app/styles.css", "install.ps1", "config/opencode.template.json"]) {
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
  const visible = ["app/index.html", "config/AGENTS.md", "README.md", "install.ps1"].map(read).join("\n");
  assert.match(visible, /Seneschal/);
  assert.doesNotMatch(visible, /Digital Servant/);
});
