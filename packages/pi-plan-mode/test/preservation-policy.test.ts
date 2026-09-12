import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "vitest";
import { classifyPreservingCommand, isScratchPath } from "../src/preservation-policy.js";

test("inspection syntax and investigation writes reach review; protected mutations do not", () => {
  const root = mkdtempSync(join(tmpdir(), "preservation-"));
  try {
    const classify = (command: string) => classifyPreservingCommand("powershell", command, root, join(root, "scratch"));
    for (const command of [
      "Get-Command godot* | Select-Object Name",
      'Get-ChildItem "$env:APPDATA/Godot"',
      "& 'C:/Tools/godot.exe' --version",
      "npm run check",
      "python scratch/probe.py",
      "New-Item scratch/cache -ItemType Directory",
    ])
      assert.equal(classify(command), "review", command);
    for (const command of [
      "git reset --hard",
      "Remove-Item src/main.ts",
      "Set-Content src/main.ts changed",
      "echo changed > src/main.ts",
      "npm run lint -- --fix",
    ])
      assert.equal(classify(command), "deny", command);
    assert.equal(classify("git status --short"), "allow");
    assert.equal(isScratchPath(root, "scratch/probe.py", join(root, "scratch")), true);
    assert.equal(isScratchPath(root, "scratch/../main.ts", join(root, "scratch")), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
