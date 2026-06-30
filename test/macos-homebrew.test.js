// Copyright (c) Tailscale Inc, & Contributors
// SPDX-License-Identifier: BSD-3-Clause

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const repoRoot = path.resolve(__dirname, "..");
const source = fs.readFileSync(path.join(repoRoot, "src/main.ts"), "utf8");
const bundled = fs.readFileSync(path.join(repoRoot, "dist/index.js"), "utf8");

test("macOS install flow checks Homebrew without failing the action", () => {
  assert.match(source, /async function isHomebrewAvailable\(\)/);
  assert.match(source, /exec\.getExecOutput\("brew", \["--version"\]/);
  assert.match(source, /ignoreReturnCode: true/);
  assert.match(source, /Homebrew availability check failed/);
  assert.match(source, /return false/);
  assert.match(
    source,
    /Homebrew not found on macOS runner; installing Tailscale from source\./
  );
});

test("macOS Homebrew path preserves exact requested version semantics", () => {
  assert.match(source, /brew",\s*\["info", "--json=v2", "--formula"/);
  assert.match(source, /formulaVersion === config\.resolvedVersion/);
  assert.match(source, /brew",\s*\[\s*"install",\s*"--formula"/);
  assert.match(source, /async function installTailscaleWithHomebrew/);
  assert.match(source, /async function getHomebrewInstalledTailscaleVersion/);
  assert.match(source, /brew",\s*\[\s*"upgrade",\s*"--formula"/);
  assert.match(source, /Homebrew installed tailscale version/);
  assert.match(
    source,
    /Homebrew tailscale formula version \$\{formulaVersion\} does not match requested version/
  );
});

test("Homebrew-owned installs are not saved to the action cache", () => {
  assert.match(
    source,
    /config\.useCache && cacheKey && installedWith !== "brew"/
  );
});

test("Homebrew installs start tailscaled with the manual daemon path", () => {
  assert.match(
    source,
    /Starting Homebrew-installed tailscaled daemon manually/
  );
  assert.match(source, /spawn\("sudo", \["-E", cmdTailscaled, \.\.\.args\]/);
  assert.doesNotMatch(source, /"brew",\s*\[\s*"services",\s*"start"/);
});

test("bundled action includes the macOS Homebrew smoke path", () => {
  assert.match(
    bundled,
    /Homebrew not found on macOS runner; installing Tailscale from source\./
  );
  assert.match(
    bundled,
    /Installing Tailscale \$\{config\.resolvedVersion\} via Homebrew/
  );
  assert.match(
    bundled,
    /Starting Homebrew-installed tailscaled daemon manually/
  );
});
