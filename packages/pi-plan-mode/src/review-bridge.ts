import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI, ExtensionContext, ToolCallEvent } from "@earendil-works/pi-coding-agent";
import { classifyPreservingCommand, isScratchPath } from "./preservation-policy.js";
import { classifyInspectionCommand, readCommand, type SafeSubcommands } from "./tool-policy.js";

interface InspectionState {
  session: object | undefined;
  enabled: boolean;
  safeSubcommands: SafeSubcommands;
  generation?: number;
}

export function registerReviewPolicy(pi: Pick<ExtensionAPI, "events">, getState: () => InspectionState) {
  let session: object | undefined;
  let generation: number | undefined;
  let root = "";
  const scratchRoot = () => {
    const state = getState();
    if (!root || state.session !== session || state.generation !== generation) {
      session = state.session;
      generation = state.generation;
      root = join(tmpdir(), "pi-plan", randomUUID());
    }
    return root;
  };
  pi.events.on("tool-review:policy:v2", (value: unknown) => {
    if (!value || typeof value !== "object") return;
    const query = value as {
      session?: object;
      cwd?: string;
      toolName?: string;
      input?: Record<string, unknown>;
      answers?: unknown[];
    };
    const state = getState();
    if (query.session !== state.session || !Array.isArray(query.answers) || typeof query.cwd !== "string") return;
    const shell = query.toolName;
    const root = scratchRoot();
    let inspection: "allow" | "deny" | "review" = "review";
    if (shell === "bash" || shell === "powershell") {
      inspection = classifyPreservingCommand(shell, readCommand(query.input), query.cwd, root, state.safeSubcommands);
      if (!state.enabled && inspection === "deny") inspection = "review";
    }
    if (state.enabled && ["edit", "write"].includes(shell ?? "") && !isScratchPath(query.cwd, query.input?.path, root))
      inspection = "deny";
    if (state.enabled && shell === "update_plan") inspection = "deny";
    query.answers.push({
      readOnly: false,
      mode: state.enabled ? "plan-preserving" : "normal",
      inspection,
      scratchRoot: state.enabled ? root : undefined,
      revision: JSON.stringify([state.generation, state.safeSubcommands]),
    });
  });
  pi.events.on("tool-review:policy:v1", (value: unknown) => {
    if (!value || typeof value !== "object") return;
    const query = value as { session?: object; cwd?: string; toolName?: string; input?: unknown; answers?: unknown[] };
    const state = getState();
    if (query.session !== state.session || !Array.isArray(query.answers) || typeof query.cwd !== "string") return;
    const shell = query.toolName;
    let inspection: "allow" | "deny" | "review" = "review";
    if (shell === "bash" || shell === "powershell") {
      inspection = classifyInspectionCommand(shell, readCommand(query.input), state.safeSubcommands, query.cwd);
      if (!state.enabled && inspection === "deny") inspection = "review";
    }
    if (state.enabled && ["edit", "write", "update_plan"].includes(shell ?? "")) inspection = "deny";
    query.answers.push({ readOnly: state.enabled, inspection });
  });
  const available = () => {
    const query = { session: getState().session, answers: [] as unknown[] };
    pi.events.emit("tool-review:capabilities:v2", query);
    return query.answers.length === 1;
  };
  return { scratchRoot, available };
}

export async function requestInspectionReview(
  pi: Pick<ExtensionAPI, "events">,
  event: ToolCallEvent,
  ctx: ExtensionContext,
): Promise<{ allowed: boolean; reason: string; kind: "unavailable" | "reviewed" }> {
  const query = { event, ctx, replies: [] as Promise<{ allowed: boolean; reason: string }>[] };
  pi.events.emit("tool-review:request:v2", query);
  if (query.replies.length !== 1)
    return {
      allowed: false,
      reason: "A single compatible v2 reviewer is required for this Plan action.",
      kind: "unavailable",
    };
  try {
    return { ...(await query.replies[0]), kind: "reviewed" };
  } catch {
    return { allowed: false, reason: "Plan review failed.", kind: "reviewed" };
  }
}
