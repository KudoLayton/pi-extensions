import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "vitest";
import { evaluateReview, parseAssessment, type ReviewRequest } from "../src/gate.js";
import { collectLocalEvidence } from "../src/local-evidence.js";
import { buildPrompt } from "../src/reviewer.js";
import { DEFAULT_SETTINGS } from "../src/settings.js";

const request = {
  toolName: "powershell",
  toolCallId: "cache",
  cwd: process.cwd(),
  input: { command: "npm run check" },
  readOnly: false,
  mode: "plan-preserving",
  inspection: "review",
  ordinaryFile: false,
} as ReviewRequest;
test("Plan allows reviewed investigation writes but never treats ordinary file writes as a fast path", async () => {
  let calls = 0;
  const result = await evaluateReview(
    { ...request, ordinaryFile: true },
    {
      review: async () => {
        calls++;
        return {
          outcome: "allow",
          risk: "low",
          readOnly: false,
          planCompatible: true,
          reason: "Only generated cache changes",
        };
      },
      ask: async () => false,
      isCurrent: () => true,
    },
  );
  assert.equal(result.allowed, true);
  assert.equal(calls, 1);
});
test("Plan compatibility denial cannot be manually overridden", async () => {
  const result = await evaluateReview(request, {
    review: async () => ({
      outcome: "allow",
      risk: "low",
      readOnly: false,
      planCompatible: false,
      reason: "Changes source",
    }),
    ask: async () => {
      throw new Error("Must not ask");
    },
    isCurrent: () => true,
  });
  assert.equal(result.allowed, false);
});
test("Plan compatibility is parsed explicitly and invalid values are rejected", () => {
  assert.equal(parseAssessment('{"outcome":"allow","read_only":false,"plan_compatible":true}').planCompatible, true);
  assert.throws(() => parseAssessment('{"outcome":"allow","plan_compatible":"true"}'));
});

test("review evidence reads current scripts with bounded size and separates current mode from history", () => {
  const root = mkdtempSync(join(tmpdir(), "review-evidence-"));
  try {
    writeFileSync(join(root, "package.json"), JSON.stringify({ scripts: { check: "node check.mjs" } }));
    writeFileSync(join(root, "check.mjs"), "// only inspection\nconsole.log('ok');");
    const input = { ...request, cwd: root };
    const evidence = collectLocalEvidence(input);
    assert.equal(evidence.files.length, 2);
    assert.equal(evidence.incomplete, false);
    writeFileSync(join(root, "check.mjs"), "x".repeat(5000));
    assert.equal(collectLocalEvidence(input).incomplete, true);
    const prompt = buildPrompt({ ...input, mode: "normal" }, [], DEFAULT_SETTINGS);
    assert(prompt.user.includes('"mode":"normal","requiresReadOnly":false'));
    assert(!prompt.user.includes('"readOnly":false'));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
