import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "vitest";
import { isOrdinaryWorkspacePath } from "../src/file-policy.js";
import { loadSettings, saveSettings } from "../src/settings.js";

test("settings loads do not write; saves preserve unknown keys and invalid documents", async () => {
  const root = mkdtempSync(join(tmpdir(), "review-settings-"));
  const file = join(root, "settings.json");
  try {
    assert.equal(loadSettings(file).model, "codex-auto-review");
    assert.equal(existsSync(file), false);
    writeFileSync(file, JSON.stringify({ future: 7 }));
    await saveSettings(file, { timeoutMs: 5000 });
    assert.equal(JSON.parse(readFileSync(file, "utf8")).future, 7);
    writeFileSync(file, "broken");
    await assert.rejects(saveSettings(file, { timeoutMs: 6000 }));
    assert.equal(readFileSync(file, "utf8"), "broken");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("ordinary file policy excludes protected, external, and junction targets", () => {
  const root = mkdtempSync(join(tmpdir(), "review-paths-"));
  const outside = mkdtempSync(join(tmpdir(), "review-outside-"));
  try {
    assert.equal(isOrdinaryWorkspacePath(root, "한글 file.ts"), true);
    assert.equal(isOrdinaryWorkspacePath(root, root, true), true);
    assert.equal(isOrdinaryWorkspacePath(root, ".pi/skills/example/SKILL.md", true), true);
    assert.equal(isOrdinaryWorkspacePath(root, ".pi/skills/example/SKILL.md", false), false);
    assert.equal(isOrdinaryWorkspacePath(root, ".pi/skills/example/.env.md", true), false);
    assert.equal(isOrdinaryWorkspacePath(root, ".pi/skills/example/run.py", true), false);
    for (const path of [
      "../outside.ts",
      "AGENTS.md",
      ".git/config",
      ".pi/agent.ts",
      ".env.local",
      ".codex/config.toml",
      "auth.json",
    ])
      assert.equal(isOrdinaryWorkspacePath(root, path), false, path);
    symlinkSync(outside, join(root, "link"), process.platform === "win32" ? "junction" : "dir");
    assert.equal(isOrdinaryWorkspacePath(root, "link/escape.ts"), false);
    assert.equal(isOrdinaryWorkspacePath(root, "link", true), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  }
});
