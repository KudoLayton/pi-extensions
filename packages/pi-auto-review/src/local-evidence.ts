import { readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { isOrdinaryWorkspacePath } from "./file-policy.js";
import type { ReviewRequest } from "./gate.js";

export function collectLocalEvidence(request: ReviewRequest): {
  files: { path: string; content: string }[];
  incomplete: boolean;
} {
  const result = { files: [] as { path: string; content: string }[], incomplete: false };
  if (request.mode !== "plan-preserving") return result;
  const fused = request.input.then_run as { command?: unknown } | undefined;
  const command = String(request.input.command ?? fused?.command ?? "");
  const candidates: string[] = [];
  const references = (text: string) =>
    [...text.matchAll(/(?:^|[\s"'=])([\w./\\:-]+\.(?:[cm]?js|ts|py|ps1|sh))(?=[\s"';]|$)/g)].map((match) => match[1]);
  if (/\b(?:npm|npx|pnpm|yarn)(?:\.cmd)?\b/.test(command)) candidates.push("package.json");
  candidates.push(...references(command));
  const seen = new Set<string>();
  let bytes = 0;
  for (let i = 0; i < candidates.length; i++) {
    const path = resolve(request.cwd, candidates[i]);
    if (seen.has(path)) continue;
    seen.add(path);
    if (
      request.toolName === "write" &&
      typeof request.input.content === "string" &&
      typeof request.input.path === "string" &&
      resolve(request.cwd, request.input.path) === path
    )
      continue;
    if (
      result.files.length >= 4 ||
      ![request.cwd, request.scratchRoot].some((root) => root && isOrdinaryWorkspacePath(root, path))
    ) {
      result.incomplete = true;
      continue;
    }
    try {
      const stat = statSync(path);
      if (!stat.isFile() || stat.size + bytes > 4500) {
        result.incomplete = true;
        continue;
      }
      const content = readFileSync(path, "utf8");
      bytes += Buffer.byteLength(content);
      if (bytes > 4500) {
        result.incomplete = true;
        continue;
      }
      result.files.push({ path, content });
      candidates.push(...references(content));
    } catch {
      result.incomplete = true;
    }
  }
  return result;
}
