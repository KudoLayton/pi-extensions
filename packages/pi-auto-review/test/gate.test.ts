import assert from "node:assert/strict";
import { test } from "vitest";
import { evaluateReview, type ReviewRequest } from "../src/gate.js";

const request: ReviewRequest = {
  toolName: "powershell",
  toolCallId: "one",
  cwd: process.cwd(),
  input: { command: "Get-CimInstance Win32_OperatingSystem" },
  readOnly: true,
  inspection: "review",
  ordinaryFile: false,
};
const allow = { outcome: "allow", risk: "low", readOnly: true, reason: "Reads operating system metadata." } as const;

test("unknown Plan inspection needs a read-only assessment", async () => {
  let prompts = 0;
  const result = await evaluateReview(request, {
    review: async () => ({ ...allow, readOnly: false }),
    ask: async () => {
      prompts++;
      return true;
    },
    isCurrent: () => true,
  });
  assert.equal(result.allowed, false);
  assert.equal(prompts, 0);
});

test("review errors ask the user; cancellation never authorizes", async () => {
  for (const answer of [true, false]) {
    let prompts = 0;
    const result = await evaluateReview(request, {
      review: async () => {
        throw new Error("offline");
      },
      ask: async () => {
        prompts++;
        return answer;
      },
      isCurrent: () => true,
    });
    assert.equal(result.allowed, answer);
    assert.equal(prompts, 1);
  }
});

test("stale reviewer and stale user answers cannot execute", async () => {
  for (const phase of ["review", "ask"]) {
    let current = true;
    const result = await evaluateReview(request, {
      review: async () => {
        if (phase === "review") current = false;
        return phase === "review" ? allow : { ...allow, outcome: "ask" };
      },
      ask: async () => {
        current = false;
        return true;
      },
      isCurrent: () => current,
    });
    assert.equal(result.allowed, false);
  }
});

test("static denials and ordinary file writes consume no model calls", async () => {
  let calls = 0;
  const deps = {
    review: async () => {
      calls++;
      return allow;
    },
    ask: async () => true,
    isCurrent: () => true,
  };
  assert.equal((await evaluateReview({ ...request, inspection: "deny" }, deps)).allowed, false);
  assert.equal(
    (await evaluateReview({ ...request, toolName: "write", readOnly: false, ordinaryFile: true }, deps)).allowed,
    true,
  );
  assert.equal(calls, 0);
});

test("a fused command cannot inherit the ordinary write fast path", async () => {
  let calls = 0;
  const result = await evaluateReview(
    {
      ...request,
      toolName: "write",
      readOnly: false,
      ordinaryFile: true,
      input: { path: "a.ts", content: "x", then_run: { command: "npm test" } },
    },
    {
      review: async () => {
        calls++;
        return { ...allow, outcome: "deny", reason: "Not authorized" };
      },
      ask: async () => {
        throw new Error("Explicit denial must not prompt");
      },
      isCurrent: () => true,
    },
  );
  assert.equal(result.allowed, false);
  assert.equal(calls, 1);
});

test("critical assessments cannot be approved by the user", async () => {
  const result = await evaluateReview(request, {
    review: async () => ({ ...allow, outcome: "ask", risk: "critical" }),
    ask: async () => {
      throw new Error("Unexpected prompt");
    },
    isCurrent: () => true,
  });
  assert.equal(result.allowed, false);
});
