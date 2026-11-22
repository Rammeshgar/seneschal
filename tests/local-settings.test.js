"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { readLocalSettings } = require("../scripts/local-settings.cjs");

test("reads Windows PowerShell 5.1 BOM settings without losing a distinct WSL user", t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "seneschal-local-settings-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, "settings.json");
  const original = { wslDistribution: "Ubuntu", wslLinuxHome: "/home/testuser", launchDirectory: "/home/testuser/projects" };
  const bytes = Buffer.concat([Buffer.from([239, 187, 191]), Buffer.from(JSON.stringify(original))]);
  fs.writeFileSync(file, bytes);
  assert.deepEqual(readLocalSettings(file), original);
  assert.deepEqual(fs.readFileSync(file), bytes, "reading must not alter the existing settings");
  fs.writeFileSync(file, JSON.stringify(original));
  assert.deepEqual(readLocalSettings(file), original);
  for (const invalid of ["{broken", "null", "[]"]) {
    fs.writeFileSync(file, invalid);
    assert.deepEqual(readLocalSettings(file), {});
  }
  assert.deepEqual(readLocalSettings(path.join(dir, "missing.json")), {});
});
