import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "vitest";
import { createMockContext, createMockPi } from "../../../test/support.js";
import { errorDiagnostic, responseFailure } from "../src/diagnostics.js";
import autoReview from "../src/extension.js";
import { reviewWithProvider } from "../src/reviewer.js";
import { DEFAULT_SETTINGS } from "../src/settings.js";

test("decision log and status retain safe details with legacy failure stage and manual fallback", async () => {
  const root = mkdtempSync(join(tmpdir(), "review-diagnostic-"));
  const mock = createMockPi();
  const context = createMockContext({ cwd: root, hasUI: true });
  autoReview(mock.pi, {
    settingsPath: join(root, "settings.json"),
    review: async () => {
      throw responseFailure({ stopReason: "error", errorMessage: "401 Authorization: secret-token" });
    },
  });
  try {
    for (const handler of mock.events.get("session_start") ?? []) await handler({}, context.ctx);
    for (const handler of mock.events.get("tool_call") ?? []) {
      assert.equal(
        await handler(
          { toolName: "powershell", toolCallId: "diagnostic", input: { command: "git status --short" } },
          context.ctx,
        ),
        undefined,
      );
    }
    const record = mock.entries.find((entry) => entry.customType === "auto-review-decision-v1")?.data as Record<
      string,
      unknown
    >;
    assert.equal(record.source, "user");
    assert.equal(record.failureStage, "invalid-response");
    assert.equal((record.failureDetail as { code: string }).code, "authentication");
    await mock.commands.get("auto-review")?.handler("status", context.ctx);
    assert(context.notifications.some((item) => item.message.includes('"code":"authentication"')));
    assert(!JSON.stringify([mock.entries, context.notifications]).includes("secret-token"));
  } finally {
    for (const handler of mock.events.get("session_shutdown") ?? []) await handler({}, context.ctx);
    rmSync(root, { recursive: true, force: true });
  }
});

const usage = { input: 1, output: 1, cacheRead: 0, cacheWrite: 0 };
function context(response: object) {
  return {
    modelRegistry: {
      getProvider: () => ({
        streamSimple: () => {
          throw new Error("Direct provider calls bypass normalization");
        },
      }),
      streamSimple: (
        _model: unknown,
        input: { systemPrompt: string },
        options: { maxRetries: number; reasoning: string },
      ) => {
        assert.equal(input.systemPrompt, "test");
        assert.equal(options.maxRetries, 0);
        assert.equal(options.reasoning, "low");
        return { result: async () => response };
      },
      find: () => ({ reasoning: true }),
      getApiKeyAndHeaders: async () => ({ ok: true }),
    },
  } as unknown as Parameters<typeof reviewWithProvider>[0];
}
const call = (response: object) =>
  reviewWithProvider(
    context(response),
    DEFAULT_SETTINGS,
    { system: "test", user: "test" },
    new AbortController().signal,
  );

test("reviewer distinguishes provider, truncation, cancellation, JSON and schema failures", async () => {
  for (const [response, kind] of [
    [{ stopReason: "error", errorMessage: "model_not_found" }, "provider"],
    [{ stopReason: "length" }, "output-limit"],
    [{ stopReason: "aborted" }, "cancelled"],
    [{ stopReason: "toolUse" }, "incomplete"],
    [{ stopReason: "stop", content: [{ type: "text", text: "```json\n{}\n```" }] }, "json-parse"],
    [{ stopReason: "stop", content: [{ type: "text", text: '{"outcome":"bogus"}' }] }, "schema"],
  ] as const) {
    await assert.rejects(call(response), (error: unknown) => errorDiagnostic(error).kind === kind);
  }
  const result = await call({ stopReason: "stop", content: [{ type: "text", text: '{"outcome":"allow"}' }], usage });
  assert.equal(result.assessment.outcome, "allow");
});

test("older hosts without public streaming fail safely instead of dropping policy", async () => {
  const ctx = context({});
  delete (ctx.modelRegistry as unknown as { streamSimple?: unknown }).streamSimple;
  await assert.rejects(
    reviewWithProvider(ctx, DEFAULT_SETTINGS, { system: "test", user: "test" }, new AbortController().signal),
    /public streaming API unavailable/,
  );
});

test("provider errors and raw reasons never leak arbitrary text", () => {
  const secret = "Bearer secret-token private prompt Authorization: xyz";
  const failure = responseFailure({ stopReason: "error", rawStopReason: secret, errorMessage: `401 ${secret}` });
  assert.equal(failure.diagnostic.code, "authentication");
  assert.equal(JSON.stringify(failure).includes("secret"), false);
  assert.equal(JSON.stringify(errorDiagnostic(new Error(secret))).includes("secret"), false);
  assert.equal(errorDiagnostic({ name: "ReviewFailure", diagnostic: failure.diagnostic }).code, "authentication");
  const foreign = { name: "ReviewFailure", diagnostic: { kind: "provider", code: secret, stopReason: secret } };
  assert.equal(JSON.stringify(errorDiagnostic(foreign)).includes("secret"), false);
  assert.equal(errorDiagnostic(failure, true).kind, "timeout");
  assert.equal(errorDiagnostic(failure, false, true).kind, "cancelled");
});
