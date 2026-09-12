import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

export interface Settings {
  enabled: boolean;
  provider: string;
  model: string;
  timeoutMs: number;
  maxInputTokens: number;
  maxOutputTokens: number;
}

export const DEFAULT_SETTINGS: Settings = {
  enabled: true,
  provider: "openai-codex",
  model: "codex-auto-review",
  timeoutMs: 30_000,
  maxInputTokens: 8000,
  maxOutputTokens: 1000,
};

function validate(document: unknown): Settings {
  if (!document || typeof document !== "object" || Array.isArray(document))
    throw new Error("Settings must be a JSON object.");
  const merged = { ...DEFAULT_SETTINGS, ...document } as Settings;
  if (typeof merged.enabled !== "boolean") throw new Error("enabled must be boolean.");
  for (const key of ["provider", "model"] as const)
    if (typeof merged[key] !== "string" || !merged[key].trim()) throw new Error(`${key} must be a non-empty string.`);
  for (const [key, min, max] of [
    ["timeoutMs", 1000, 60_000],
    ["maxInputTokens", 6000, 32_000],
    ["maxOutputTokens", 256, 4000],
  ] as const)
    if (!Number.isInteger(merged[key]) || merged[key] < min || merged[key] > max)
      throw new Error(`${key} must be ${min}..${max}.`);
  return Object.fromEntries(
    Object.keys(DEFAULT_SETTINGS).map((key) => [key, merged[key as keyof Settings]]),
  ) as unknown as Settings;
}

export function loadSettings(path: string): Settings {
  try {
    return validate(JSON.parse(readFileSync(path, "utf8")));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { ...DEFAULT_SETTINGS };
    throw error;
  }
}

export async function saveSettings(path: string, patch: Partial<Settings>): Promise<Settings> {
  let document: Record<string, unknown> = {};
  try {
    document = JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  validate(document);
  const next = { ...document, ...patch };
  const settings = validate(next);
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, `${JSON.stringify(next, null, 2)}\n`, { flag: "wx", mode: 0o600 });
    await rename(temporary, path);
  } finally {
    await unlink(temporary).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== "ENOENT") throw error;
    });
  }
  return settings;
}
