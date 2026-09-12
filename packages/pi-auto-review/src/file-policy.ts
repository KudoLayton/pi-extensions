import { lstatSync } from "node:fs";
import { basename, dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const extensionRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

export function isOrdinaryWorkspacePath(cwd: string, input: unknown, readOnly = false): boolean {
  if (typeof input !== "string" || !input || input.includes("\0") || input.startsWith("~")) return false;
  const target = resolve(cwd, input);
  const ownSource = relative(extensionRoot, target);
  if (!isAbsolute(ownSource) && ownSource !== ".." && !ownSource.startsWith(`..${sep}`)) return false;
  const local = relative(resolve(cwd), target);
  if ((!local && !readOnly) || isAbsolute(local) || local === ".." || local.startsWith(`..${sep}`)) return false;
  const skillDocument = readOnly && /^\.pi[\\/]skills[\\/].*\.(md|txt|rst)$/i.test(local);
  if (
    local
      .split(/[\\/]/)
      .some(
        (part, index) =>
          /^(\.git|\.pi|\.codex|\.agents|\.ssh|\.aws|\.azure|\.gnupg)$/i.test(part) && !(skillDocument && index === 0),
      )
  )
    return false;
  if (
    /^(agents\.md|auth\.json|credentials(?:\..*)?|\.env(?:\..*)?|\.npmrc|\.netrc|\.gitconfig|id_(?:rsa|ed25519)|.*\.(?:pem|key|pfx|p12))$/i.test(
      basename(target),
    )
  )
    return false;
  if (
    process.platform === "win32" &&
    (/:/.test(local) ||
      local
        .split(/[\\/]/)
        .some((part) => /[. ]$/.test(part) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part)))
  )
    return false;
  let path = target;
  while (true) {
    try {
      const info = lstatSync(path);
      if (
        info.isSymbolicLink() ||
        (!info.isFile() && !info.isDirectory()) ||
        (info.isFile() && (path !== target || info.nlink > 1))
      )
        return false;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") return false;
    }
    const parent = dirname(path);
    if (parent === path) break;
    path = parent;
  }
  return true;
}
