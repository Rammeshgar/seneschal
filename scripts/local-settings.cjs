"use strict";

const fs = require("node:fs");

function readLocalSettings(filename) {
  try {
    // Windows PowerShell 5.1 writes a UTF-8 BOM with Set-Content -Encoding utf8.
    const settings = JSON.parse(fs.readFileSync(filename, "utf8").replace(/^\uFEFF/, ""));
    return settings && typeof settings === "object" && !Array.isArray(settings) ? settings : {};
  } catch {
    return {};
  }
}

module.exports = { readLocalSettings };
