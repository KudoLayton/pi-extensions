import { createHash } from "node:crypto";
import { join } from "node:path";
import { stripVTControlCharacters } from "node:util";
import {
  type ExtensionAPI,
  type ExtensionContext,
  getAgentDir,
  type ToolCallEvent,
} from "@earendil-works/pi-coding-agent";
import { errorDiagnostic, type ReviewDiagnostic } from "./diagnostics.js";
import { isOrdinaryWorkspacePath } from "./file-policy.js";
import { type Assessment, evaluateReview, type ReviewRequest, type Verdict } from "./gate.js";
import { lockReviewedToolInput } from "./input-lock.js";
import { POLICY_REVISION } from "./policy.js";
import { REVIEW_CHANNEL, type ReviewQuery, readPolicy } from "./protocol.js";
import { abortable, buildPrompt, type ReviewUsage, reviewWithProvider } from "./reviewer.js";
import { DEFAULT_SETTINGS, loadSettings, type Settings, saveSettings } from "./settings.js";

const TOOLS = new Set(["bash", "powershell", "read", "grep", "find", "ls", "edit", "write"]);
const FILE_TOOLS = new Set(["read", "grep", "find", "ls", "edit", "write"]);
const READ_TOOLS = new Set(["read", "grep", "find", "ls"]);
const cancelled = (): Verdict => ({
  allowed: false,
  reason: "Automatic review cancelled or session changed.",
  source: "cancelled",
});

export interface ExtensionDependencies {
  settingsPath?: string;
  review?: (
    request: ReviewRequest,
    ctx: ExtensionContext,
    settings: Settings,
    signal: AbortSignal,
  ) => Promise<{ assessment: Assessment; usage: ReviewUsage }>;
}

export default function autoReview(pi: ExtensionAPI, dependencies: ExtensionDependencies = {}): void {
  let currentSession: object | undefined;
  let controller = new AbortController();
  let lifecycle = new AbortController();
  let epoch = 0;
  let settings: Settings = { ...DEFAULT_SETTINGS };
  let settingsError = false;
  let lastFailureStage: string | undefined;
  let lastFailure: ReviewDiagnostic | undefined;
  let pending = new WeakMap<object, Promise<Verdict>>();
  let saves: Promise<unknown> = Promise.resolve();
  let dialogs: Promise<unknown> = Promise.resolve();
  let stats = {
    reviewed: 0,
    static: 0,
    manual: 0,
    denied: 0,
    failures: 0,
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    durationMs: 0,
  };
  const settingsPath = () => dependencies.settingsPath ?? join(getAgentDir(), "pi-auto-review.json");
  const reset = () => {
    controller.abort();
    controller = new AbortController();
    lifecycle.abort();
    lifecycle = new AbortController();
    pending = new WeakMap();
    epoch++;
  };

  pi.on("session_start", async (_event, ctx) => {
    reset();
    currentSession = ctx.sessionManager;
    const generation = epoch;
    await saves;
    if (generation !== epoch || currentSession !== ctx.sessionManager) return;
    try {
      settings = loadSettings(settingsPath());
      settingsError = false;
    } catch {
      settingsError = true;
      if (ctx.hasUI)
        ctx.ui.notify("auto review 설정을 읽을 수 없습니다. 필요한 작업은 수동 승인으로 전환합니다.", "error");
    }
    stats = {
      reviewed: 0,
      static: 0,
      manual: 0,
      denied: 0,
      failures: 0,
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      durationMs: 0,
    };
  });
  pi.on("session_shutdown", async (_event, ctx) => {
    reset();
    currentSession = undefined;
    await saves;
    ctx.ui.setStatus("auto-review", undefined);
  });
  pi.on("session_tree", () => reset());
  pi.on("input", (event, ctx) => {
    if (event.source !== "extension") {
      reset();
      pi.appendEntry("auto-review-user-input-v1", { source: event.source, text: event.text });
    }
    if (currentSession !== ctx.sessionManager) reset();
  });

  async function evaluate(event: ToolCallEvent, ctx: ExtensionContext): Promise<Verdict> {
    if (currentSession !== ctx.sessionManager) return cancelled();
    const generation = epoch;
    const sessionSignal = controller.signal;
    const signal = ctx.signal ? AbortSignal.any([sessionSignal, ctx.signal]) : sessionSignal;
    const policy = readPolicy(pi, event, ctx);
    const fingerprint = JSON.stringify({ input: event.input, policy });
    const isCurrent = () =>
      !signal.aborted &&
      generation === epoch &&
      currentSession === ctx.sessionManager &&
      JSON.stringify({ input: event.input, policy: readPolicy(pi, event, ctx) }) === fingerprint;
    try {
      lockReviewedToolInput(event);
    } catch {
      return { allowed: false, reason: "Tool input cannot be locked safely.", source: "static" };
    }
    const input: Record<string, unknown> = event.input;
    const ordinaryFile =
      FILE_TOOLS.has(event.toolName) &&
      isOrdinaryWorkspacePath(
        ctx.cwd,
        input.path ?? (READ_TOOLS.has(event.toolName) && event.toolName !== "read" ? "." : undefined),
        READ_TOOLS.has(event.toolName),
      );
    const request: ReviewRequest = {
      toolCallId: event.toolCallId,
      toolName: event.toolName,
      cwd: ctx.cwd,
      input: event.input,
      ...policy,
      ordinaryFile,
    };
    const started = Date.now();
    let failureStage: string | undefined = settingsError ? "invalid-settings" : undefined;
    let failureDetail: ReviewDiagnostic | undefined;
    const verdict = await evaluateReview(
      settingsError
        ? { ...request, inspection: policy.inspection === "deny" ? "deny" : "review", ordinaryFile: false }
        : request,
      {
        isCurrent,
        review: async () => {
          if (settingsError) throw new Error("Invalid settings");
          stats.reviewed++;
          const deadline = new AbortController();
          const timer = setTimeout(() => deadline.abort(), settings.timeoutMs);
          const reviewSignal = AbortSignal.any([signal, deadline.signal]);
          if (ctx.hasUI) ctx.ui.setStatus("auto-review", "권한 자동 검토 중…");
          try {
            const result = dependencies.review
              ? await abortable(dependencies.review(request, ctx, settings, reviewSignal), reviewSignal)
              : await reviewWithProvider(
                  ctx,
                  settings,
                  buildPrompt(request, ctx.sessionManager.getBranch(), settings),
                  reviewSignal,
                );
            if (!isCurrent()) throw new Error("Cancelled");
            for (const key of ["input", "output", "cacheRead", "cacheWrite"] as const) stats[key] += result.usage[key];
            return result.assessment;
          } catch (error) {
            if (isCurrent()) {
              stats.failures++;
              const message = error instanceof Error ? error.message : "";
              lastFailureStage = deadline.signal.aborted
                ? "timeout"
                : /budget/i.test(message)
                  ? "input-budget"
                  : /authentication/i.test(message)
                    ? "authentication"
                    : /model unavailable/i.test(message)
                      ? "model-unavailable"
                      : /complete decision|response invalid/i.test(message)
                        ? "invalid-response"
                        : "provider";
              failureStage = lastFailureStage;
              failureDetail = errorDiagnostic(error, deadline.signal.aborted, signal.aborted);
              lastFailure = failureDetail;
            }
            throw error;
          } finally {
            clearTimeout(timer);
            if (generation === epoch && ctx.hasUI) ctx.ui.setStatus("auto-review", undefined);
          }
        },
        ask: async (reason) => {
          if (!ctx.hasUI || !isCurrent()) return false;
          const ask = dialogs.then(async () => {
            if (!isCurrent()) return false;
            stats.manual++;
            const mode =
              request.mode === "plan-preserving"
                ? "Plan: 계획 검증 목적이며 기존 소스·설정·작업물을 보존하는 경우에만 승인하세요. 조사용 캐시·임시 실험 파일은 허용할 수 있습니다.\n"
                : request.readOnly
                  ? "읽기 전용 작업인 경우에만 승인하세요.\n"
                  : "";
            const details = stripVTControlCharacters(
              `${mode}${reason}\n\n${event.toolName}\n${ctx.cwd}\n${JSON.stringify(event.input, null, 2)}`,
            );
            const approved = await ctx.ui.confirm("이번 작업 1회 승인", details, { signal });
            return approved && isCurrent();
          });
          dialogs = ask.catch(() => false);
          return ask;
        },
      },
    );
    if (!isCurrent()) return cancelled();
    stats.durationMs += Date.now() - started;
    if (verdict.source === "static") stats.static++;
    if (!verdict.allowed) stats.denied++;
    pi.appendEntry("auto-review-decision-v1", {
      policy: POLICY_REVISION,
      tool: event.toolName,
      toolCallId: event.toolCallId,
      mode: request.mode ?? (request.readOnly ? "legacy-read-only" : "normal"),
      actionHash: createHash("sha256").update(fingerprint).digest("hex"),
      allowed: verdict.allowed,
      source: verdict.source,
      failureStage,
      failureDetail,
      durationMs: Date.now() - started,
    });
    return verdict;
  }

  function review(event: ToolCallEvent, ctx: ExtensionContext): Promise<Verdict> {
    let result = pending.get(event);
    if (!result) {
      result = evaluate(event, ctx).catch(() => ({
        allowed: false,
        reason: "Automatic review failed safely.",
        source: "static" as const,
      }));
      pending.set(event, result);
    }
    return result;
  }
  pi.events.on(REVIEW_CHANNEL, (value: unknown) => {
    if (!value || typeof value !== "object" || (!settings.enabled && !settingsError)) return;
    const query = value as Partial<ReviewQuery>;
    if (!query.event || !query.ctx || !Array.isArray(query.replies) || !TOOLS.has(query.event.toolName)) return;
    if (query.ctx.sessionManager !== currentSession) return;
    query.replies.push(review(query.event, query.ctx));
  });
  pi.events.on("tool-review:capabilities:v2", (value: unknown) => {
    if (!value || typeof value !== "object" || (!settings.enabled && !settingsError)) return;
    const query = value as { session?: object; answers?: unknown[] };
    if (query.session === currentSession && Array.isArray(query.answers)) query.answers.push({ planPreserving: true });
  });
  pi.on("tool_call", async (event, ctx) => {
    if ((!settings.enabled && !settingsError) || !TOOLS.has(event.toolName)) return;
    const verdict = await review(event, ctx);
    if (!verdict.allowed) return { block: true, reason: `Auto review: ${verdict.reason}`, terminate: true };
  });

  pi.registerCommand("auto-review", {
    description: "권한 자동 검토 설정, 상태, 도움말",
    getArgumentCompletions: (prefix) =>
      ["status", "help"].filter((value) => value.startsWith(prefix)).map((value) => ({ value, label: value })),
    handler: async (args, ctx) => {
      if (!ctx.hasUI)
        throw new Error("auto-review requires TUI or RPC UI. See pi-auto-review.json and the package README.");
      if (args.trim() === "status") {
        ctx.ui.notify(JSON.stringify({ settings, settingsError, lastFailureStage, lastFailure, stats }), "info");
        return;
      }
      if (args.trim() === "help") {
        ctx.ui.notify(
          `설정: ${settingsPath()}\n기본 도구와 Action Fusion을 실행 전에 검사합니다. 불확실하면 1회 승인을 요청합니다. OS 샌드박스는 제공하지 않습니다.`,
          "info",
        );
        return;
      }
      if (args.trim()) throw new Error("Usage: /auto-review [status|help]");
      if (ctx.mode !== "tui") {
        ctx.ui.notify(`설정 파일: ${settingsPath()}; /auto-review status 또는 help를 사용하세요.`, "info");
        return;
      }
      const generation = epoch;
      const ui = await import("./settings-ui.js");
      if (generation !== epoch) return;
      await ui.showMenu(
        ctx,
        () => settings,
        () => JSON.stringify({ settingsError, lastFailureStage, lastFailure, stats }),
        settingsPath(),
        (patch) => {
          const save = saves.then(async () => {
            if (generation !== epoch) throw new Error("Session changed");
            const next = await saveSettings(settingsPath(), patch);
            if (generation !== epoch) return;
            settings = next;
            settingsError = false;
            controller.abort();
            controller = new AbortController();
            pending = new WeakMap();
          });
          saves = save.catch(() => {});
          return save;
        },
        lifecycle.signal,
        () => generation === epoch && currentSession === ctx.sessionManager,
      );
    },
  });
}
