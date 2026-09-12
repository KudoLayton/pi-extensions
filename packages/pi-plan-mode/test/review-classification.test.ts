import assert from "node:assert/strict";
import { test } from "vitest";
import { classifyInspectionCommand } from "../src/tool-policy.js";

test("separates unclassified PowerShell inspection from explicit unsafe syntax", () => {
  assert.equal(classifyInspectionCommand("powershell", "Get-CimInstance Win32_OperatingSystem"), "review");
  assert.equal(classifyInspectionCommand("powershell", "git status"), "allow");
  for (const command of [
    "Remove-Item a",
    "git reset --hard",
    "git -c core.pager=evil status",
    "Get-Content a > b",
    "Get-CimInstance x; Remove-Item a",
    "pwsh -Command 'Remove-Item a'",
  ])
    assert.equal(classifyInspectionCommand("powershell", command), "deny", command);
});

test("unclassified Bash commands remain reviewable but known invalid commands do not", () => {
  assert.equal(classifyInspectionCommand("bash", "custom-inspect --version"), "review");
  for (const command of [
    "rm file",
    "find . -delete",
    "git checkout main",
    "cat a > b",
    "eval dangerous",
    "python -c dangerous",
    "unknown $(rm file)",
  ])
    assert.equal(classifyInspectionCommand("bash", command), "deny", command);
});
