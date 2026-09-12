import { lstatSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { classifyInspectionCommand, type SafeSubcommands } from "./tool-policy.js";

export function isScratchPath(cwd: string, input: unknown, scratchRoot: string): boolean {
  if (typeof input !== "string" || !input || /[\0$`*?]/.test(input)) return false;
  const target = resolve(cwd, input);
  const local = relative(scratchRoot, target);
  if (!local || isAbsolute(local) || local === ".." || local.startsWith(`..${sep}`)) return false;
  if (
    process.platform === "win32" &&
    local
      .split(/[\\/]/)
      .some((part) => /[:]|[. ]$/.test(part) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part))
  )
    return false;
  for (let path = target; ; path = dirname(path)) {
    try {
      const stat = lstatSync(path);
      if (stat.isSymbolicLink() || (stat.isFile() && stat.nlink > 1) || (!stat.isFile() && !stat.isDirectory()))
        return false;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") return false;
    }
    if (dirname(path) === path) break;
  }
  return true;
}

export function classifyPreservingCommand(
  shell: "bash" | "powershell",
  command: string,
  cwd: string,
  scratchRoot: string,
  safe: SafeSubcommands = {},
): "allow" | "deny" | "review" {
  if (!command.trim() || command.includes("\0")) return "deny";
  if (
    /\bgit(?:\.exe)?\b[^;|\r\n]*(?:\b(?:reset|restore|clean|checkout|switch|rebase|merge|commit|push|cherry-pick|worktree)\b|--output(?:[=\s]|$))/i.test(
      command,
    )
  )
    return "deny";
  if (/(?:^|\s)(?:--fix|--write|--in-place)(?:[=\s]|$)/i.test(command)) return "deny";
  const mutations = command.matchAll(
    /(?:^|[;|(&])\s*(?:&\s*)?(?:Remove-Item|Set-Content|Add-Content|Clear-Content|Out-File|Move-Item|Rename-Item|rm|rmdir|mv|del)(?:\.exe)?\s+([^;|\r\n]+)/gi,
  );
  for (const mutation of mutations) {
    const tokens = mutation[1].match(/'[^']*'|"[^"]*"|[^\s]+/g) ?? [];
    const candidates = tokens.filter((token) => !token.startsWith("-"));
    if (candidates.length !== 1 || !isScratchPath(cwd, candidates[0].replace(/^(['"])(.*)\1$/, "$2"), scratchRoot))
      return "deny";
  }
  for (const output of command.matchAll(/(?:^|\s)(?:\d*>>?|\*>)\s*('([^']*)'|"([^"]*)"|[^\s;|]+)/g)) {
    if (!isScratchPath(cwd, output[2] ?? output[3] ?? output[1], scratchRoot)) return "deny";
  }
  const inspection = classifyInspectionCommand(shell, command, safe, cwd);
  const executesCode =
    /\b(?:npm|npx|pnpm|yarn|node|python\d*|cargo|dotnet|make|pytest|vitest|jest|go|tsc)(?:\.exe)?\b/i.test(command);
  return inspection === "allow" && !executesCode ? "allow" : "review";
}
