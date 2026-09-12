import type { ExtensionAPI, ExtensionContext, ToolCallEvent } from "@earendil-works/pi-coding-agent";
import type { Verdict } from "./gate.js";

export const POLICY_CHANNEL = "tool-review:policy:v2";
export const REVIEW_CHANNEL = "tool-review:request:v2";

export interface PolicyAnswer {
  readOnly: boolean;
  inspection: "allow" | "deny" | "review";
  mode?: "normal" | "plan-preserving";
  scratchRoot?: string;
  revision?: string;
}

export interface PolicyQuery {
  session: object;
  cwd: string;
  toolName: string;
  input: Record<string, unknown>;
  answers: PolicyAnswer[];
}

export interface ReviewQuery {
  event: ToolCallEvent;
  ctx: ExtensionContext;
  replies: Promise<Verdict>[];
}

export function readPolicy(
  pi: Pick<ExtensionAPI, "events">,
  event: ToolCallEvent,
  ctx: ExtensionContext,
): PolicyAnswer {
  const query: PolicyQuery = {
    session: ctx.sessionManager,
    cwd: ctx.cwd,
    toolName: event.toolName,
    input: event.input,
    answers: [],
  };
  pi.events.emit(POLICY_CHANNEL, query);
  if (!query.answers.length) pi.events.emit("tool-review:policy:v1", query);
  const answers = query.answers;
  return {
    readOnly: answers.some((answer) => answer.readOnly),
    mode: answers.some((answer) => answer.mode === "plan-preserving") ? "plan-preserving" : "normal",
    scratchRoot: answers.find((answer) => answer.mode === "plan-preserving")?.scratchRoot,
    revision: JSON.stringify(answers.map((answer) => answer.revision)),
    inspection: answers.some((answer) => answer.inspection === "deny")
      ? "deny"
      : answers.some((answer) => answer.inspection === "allow")
        ? "allow"
        : "review",
  };
}
