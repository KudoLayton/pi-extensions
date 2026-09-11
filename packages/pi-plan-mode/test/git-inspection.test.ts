import assert from "node:assert/strict";
import { join, resolve } from "node:path";
import { test } from "vitest";
import { isSafeCommand, isSafePowerShellCommand } from "../src/tool-policy.js";

const cwd = process.cwd();
const child = join(cwd, "packages", "한글 directory");
const policy = { git: ["rev-parse", "blame", "cat-file"], gh: ["pr view"] };

for (const [shell, check] of [
  ["bash", isSafeCommand],
  ["powershell", isSafePowerShellCommand],
] as const) {
  test(`${shell}: permits scoped Git inspection options`, () => {
    for (const command of [
      `git -c 'safe.directory=${cwd}' status --short`,
      `git -C '${child}' -c 'safe.directory=${child}' diff --stat`,
      `git -c 'safe.directory=${child}' -C '${child}' rev-parse --show-toplevel`,
      "git -C packages -C '한글 directory' log -1 --oneline",
      "git --no-pager -C packages status",
    ])
      assert.equal(check(command, policy, cwd), true, command);
  });

  test(`${shell}: rejects unscoped Git configuration and directory changes`, () => {
    for (const command of [
      "git -c safe.directory=* status",
      "git -c safe.directory= status",
      "git -c safe.directory=. status",
      `git -c 'safe.directory=${resolve(cwd, "..")}' status`,
      `git -C packages -c 'safe.directory=${cwd}' status`,
      `git -c 'safe.directory=${cwd}' -c 'safe.directory=${cwd}' status`,
      `git -c 'safe.directory=${cwd}' -c core.pager=custom status`,
      `git -c 'safe.directory=${cwd}' checkout main`,
      "git -C .. status",
      "git -C packages -C .. status",
      `git -C '${cwd}-outside' status`,
      "git -C --no-pager status",
      "git -c core.fsmonitor=custom status",
      "git --config-env=safe.directory=HOME status",
    ])
      assert.equal(check(command, policy, cwd), false, command);
  });

  test(`${shell}: configured Git and gh queries retain all safety checks`, () => {
    for (const command of [
      "git rev-parse HEAD; git reset --hard",
      "git rev-parse HEAD > output.txt",
      "git cat-file --filters HEAD:file",
      "git blame --textconv file",
      "gh pr view 1 --json number; git reset --hard",
      "gh pr view 1 --web",
      "git checkout main",
    ])
      assert.equal(check(command, { ...policy, git: [...policy.git, "checkout"] }, cwd), false, command);
    assert.equal(check("git rev-parse HEAD | git status", policy, cwd), true);
  });
}
