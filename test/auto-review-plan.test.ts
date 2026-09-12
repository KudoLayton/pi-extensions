import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { test } from "vitest";
import autoReview from "../packages/pi-auto-review/src/extension.js";
import type { Assessment } from "../packages/pi-auto-review/src/gate.js";
import planMode from "../packages/pi-plan-mode/src/plan-mode.js";
import { createMockContext, createMockPi } from "../packages/pi-plan-mode/test/support.js";

const usage = { input: 12, output: 5, cacheRead: 0, cacheWrite: 0 };
const allow: Assessment = {
  outcome: "allow",
  risk: "low",
  readOnly: true,
  planCompatible: true,
  reason: "Read-only query",
};

test("Plan scratch writes require review, existing source remains blocked, and exit invalidates approval", async () => {
  const root = mkdtempSync(join(tmpdir(), "plan-preserve-integration-"));
  const config = join(root, "plan.json");
  writeFileSync(config, JSON.stringify({ defaultPlanTools: ["read", "powershell", "write", "edit"] }));
  const mock = createMockPi({ activeTools: ["read", "powershell", "write", "edit"] });
  const context = createMockContext({ cwd: root });
  let calls = 0;
  let pending: ((value: { assessment: Assessment; usage: typeof usage }) => void) | undefined;
  let delayed = false;
  autoReview(mock.pi, {
    settingsPath: join(root, "review.json"),
    review: async () => {
      calls++;
      if (delayed)
        return new Promise((resolve) => {
          pending = resolve;
        });
      return { assessment: { ...allow, readOnly: false }, usage };
    },
  });
  planMode(mock.pi, { settingsPath: config });
  const emit = async (name: string, event: unknown) => {
    for (const handler of mock.events.get(name) ?? []) {
      const result = (await handler(event, context.ctx)) as { block?: boolean } | undefined;
      if (result?.block) return result;
    }
  };
  try {
    await emit("session_start", { reason: "startup" });
    await mock.commands.get("plan")?.handler("start", context.ctx);
    const query = {
      session: (context.ctx as ExtensionContext).sessionManager,
      cwd: root,
      toolName: "write",
      input: {},
      answers: [] as { scratchRoot: string }[],
    };
    (mock.pi as ExtensionAPI).events.emit("tool-review:policy:v2", query);
    const scratch = query.answers[0].scratchRoot;
    assert(scratch);
    assert.equal(
      (
        await emit("tool_call", {
          type: "tool_call",
          toolName: "write",
          toolCallId: "scratch",
          input: { path: join(scratch, "probe.py"), content: "print(1)" },
        })
      )?.block,
      undefined,
    );
    assert.equal(calls, 1);
    assert.equal(
      (
        await emit("tool_call", {
          type: "tool_call",
          toolName: "write",
          toolCallId: "source",
          input: { path: "source.ts", content: "changed" },
        })
      )?.block,
      true,
    );
    assert.equal(calls, 1);
    delayed = true;
    const review = emit("tool_call", {
      type: "tool_call",
      toolName: "powershell",
      toolCallId: "pending",
      input: { command: "npm run check" },
    });
    await Promise.resolve();
    assert(pending);
    await mock.commands.get("plan")?.handler("exit", context.ctx);
    pending({ assessment: { ...allow, readOnly: false }, usage });
    assert.equal((await review)?.block, true);
  } finally {
    await emit("session_shutdown", {});
    rmSync(root, { recursive: true, force: true });
  }
});

for (const order of ["review-first", "plan-first"]) {
  test(`${order}: Plan review is called once and cannot unblock explicit mutation`, async () => {
    const root = mkdtempSync(join(tmpdir(), "auto-plan-"));
    const mock = createMockPi({ activeTools: ["read", "bash", "powershell", "edit", "write"] });
    const context = createMockContext({ cwd: root });
    let calls = 0;
    const registerReview = () =>
      autoReview(mock.pi, {
        settingsPath: join(root, "review.json"),
        review: async () => {
          calls++;
          return { assessment: allow, usage };
        },
      });
    if (order === "review-first") registerReview();
    planMode(mock.pi);
    if (order === "plan-first") registerReview();
    const emit = async (name: string, event: unknown) => {
      for (const handler of mock.events.get(name) ?? []) {
        const result = (await handler(event, context.ctx)) as { block?: boolean } | undefined;
        if (result?.block) return result;
      }
      return undefined;
    };
    try {
      await emit("session_start", { reason: "startup" });
      await mock.commands.get("plan")?.handler("start", context.ctx);
      assert.equal(
        (
          await emit("tool_call", {
            type: "tool_call",
            toolCallId: "inspection",
            toolName: "powershell",
            input: { command: "Get-CimInstance Win32_OperatingSystem" },
          })
        )?.block,
        undefined,
      );
      assert.equal(calls, 1);
      for (const [name, input] of [
        ["powershell", { command: "Remove-Item a" }],
        ["write", { path: "a", content: "b" }],
      ] as const)
        assert.equal(
          (await emit("tool_call", { type: "tool_call", toolCallId: name, toolName: name, input }))?.block,
          true,
        );
      assert.equal(calls, 1);
    } finally {
      await emit("session_shutdown", {});
      rmSync(root, { recursive: true, force: true });
    }
  });
}

test("headless failure blocks, interactive failure prompts once, and new input cancels pending review", async () => {
  const root = mkdtempSync(join(tmpdir(), "auto-fail-"));
  try {
    for (const hasUI of [false, true]) {
      const mock = createMockPi();
      let prompts = 0;
      const context = createMockContext({
        cwd: root,
        hasUI,
        confirm: async () => {
          prompts++;
          return true;
        },
      });
      autoReview(mock.pi, {
        settingsPath: join(root, "settings.json"),
        review: async () => {
          throw new Error("provider unavailable");
        },
      });
      await mock.events.get("session_start")?.[0]?.({}, context.ctx);
      const result = (await mock.events.get("tool_call")?.[0]?.(
        { type: "tool_call", toolCallId: "a", toolName: "powershell", input: { command: "custom-query" } },
        context.ctx,
      )) as { block?: boolean } | undefined;
      assert.equal(result?.block, hasUI ? undefined : true);
      assert.equal(prompts, hasUI ? 1 : 0);
      await mock.events.get("session_shutdown")?.[0]?.({}, context.ctx);
    }
    const mock = createMockPi();
    const context = createMockContext({ cwd: root });
    let started!: () => void;
    const startedPromise = new Promise<void>((resolve) => {
      started = resolve;
    });
    autoReview(mock.pi, {
      settingsPath: join(root, "settings.json"),
      review: async () => {
        started();
        return new Promise(() => {});
      },
    });
    await mock.events.get("session_start")?.[0]?.({}, context.ctx);
    const pending = mock.events.get("tool_call")?.[0]?.(
      { type: "tool_call", toolCallId: "a", toolName: "powershell", input: { command: "custom-query" } },
      context.ctx,
    );
    await startedPromise;
    await mock.events.get("input")?.[0]?.({ source: "interactive", text: "Stop" }, context.ctx);
    assert.equal(((await pending) as { block?: boolean }).block, true);
    await mock.events.get("session_shutdown")?.[0]?.({}, context.ctx);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
