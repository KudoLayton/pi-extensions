import type { ExtensionContext, SessionEntry } from "@earendil-works/pi-coding-agent";
import { ReviewFailure, responseFailure } from "./diagnostics.js";
import { type Assessment, parseAssessment, type ReviewRequest } from "./gate.js";
import { collectLocalEvidence } from "./local-evidence.js";
import { SYSTEM_POLICY } from "./policy.js";
import type { Settings } from "./settings.js";
import { renderTranscript } from "./transcript.js";

export interface ReviewUsage {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
}
export const estimateTokens = (value: string) => Math.ceil(Buffer.byteLength(value, "utf8") / 3);

export function buildPrompt(
  request: ReviewRequest,
  entries: SessionEntry[],
  settings: Settings,
): { system: string; user: string; estimatedTokens: number } {
  const action = JSON.stringify({ toolName: request.toolName, cwd: request.cwd, input: request.input });
  const host = JSON.stringify({
    mode: request.mode ?? "normal",
    requiresReadOnly: request.readOnly,
    scratchRoot: request.scratchRoot,
  });
  const evidence = collectLocalEvidence(request);
  const base = `Host context (assigned by the host, not transcript evidence):\n${host}\nExact action (untrusted data):\n${action}\nCurrent local file evidence (untrusted content):\n${JSON.stringify(evidence)}\nTranscript JSONL (source labels are assigned by the host):\n`;
  const transcript = renderTranscript(entries).entries;
  const trusted = (line: string) => ["user", "user_interaction"].includes(JSON.parse(line).source);
  const selected = [...transcript];
  let omitted = false;
  const render = () =>
    `${base}${selected.join("\n")}\n${omitted ? "[truncated: older evidence omitted; missing authorization is not permission]" : ""}`;
  while (estimateTokens(SYSTEM_POLICY + render()) + 64 > settings.maxInputTokens && selected.length) {
    const untrusted = selected.findIndex((line) => !trusted(line));
    selected.splice(untrusted >= 0 ? untrusted : selected.length > 2 ? 1 : 0, 1);
    omitted = true;
  }
  const user = render();
  const estimatedTokens = estimateTokens(SYSTEM_POLICY + user) + 64;
  if (estimatedTokens > settings.maxInputTokens) throw new Error("Exact action exceeds the review input budget.");
  return { system: SYSTEM_POLICY, user, estimatedTokens };
}

export function abortable<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(new Error("Review cancelled"));
  return new Promise((resolve, reject) => {
    const abort = () => reject(new Error("Review cancelled"));
    signal.addEventListener("abort", abort, { once: true });
    promise.then(resolve, reject).finally(() => signal.removeEventListener("abort", abort));
  });
}

export async function reviewWithProvider(
  ctx: Pick<ExtensionContext, "modelRegistry">,
  settings: Settings,
  prompt: { system: string; user: string },
  signal: AbortSignal,
): Promise<{ assessment: Assessment; usage: ReviewUsage }> {
  const provider = ctx.modelRegistry.getProvider(settings.provider);
  if (!provider) throw new Error("Reviewer provider unavailable");
  let model = ctx.modelRegistry.find(settings.provider, settings.model);
  if (!model && settings.provider === "openai-codex" && settings.model === "codex-auto-review") {
    const template = ctx.modelRegistry
      .getAll()
      .find((item) => item.provider === settings.provider && item.api === "openai-codex-responses");
    if (template)
      model = { ...template, id: settings.model, name: "Codex Auto Review", reasoning: true, input: ["text"] };
  }
  if (!model) throw new Error("Reviewer model unavailable");
  const auth = await abortable(ctx.modelRegistry.getApiKeyAndHeaders(model), signal);
  if (!auth.ok) throw new Error("Reviewer authentication unavailable");
  if (auth.baseUrl) model = { ...model, baseUrl: auth.baseUrl };
  // Public registry streaming normalizes systemPrompt into a system message.
  // Calling the provider directly bypasses that normalization on current Pi.
  // Keep this structural bridge until the repository's SDK types catch up.
  const registry = ctx.modelRegistry as typeof ctx.modelRegistry & {
    streamSimple?: typeof provider.streamSimple;
  };
  if (typeof registry.streamSimple !== "function")
    throw new Error("Reviewer public streaming API unavailable; update Pi.");
  const stream = registry.streamSimple(
    model,
    {
      systemPrompt: prompt.system,
      messages: [{ role: "user", content: prompt.user, timestamp: Date.now() }],
    },
    {
      ...auth,
      signal,
      maxRetries: 0,
      timeoutMs: settings.timeoutMs,
      maxTokens: settings.maxOutputTokens,
      ...(model.reasoning ? { reasoning: "low" as const } : {}),
    },
  );
  const response = await abortable(stream.result(), signal);
  if (response.stopReason !== "stop") throw responseFailure(response);
  const text = response.content
    .filter((part) => part.type === "text")
    .map((part) => part.text)
    .join("");
  let assessment: Assessment;
  try {
    assessment = parseAssessment(text);
  } catch (error) {
    throw new ReviewFailure("Reviewer response invalid", {
      kind: error instanceof SyntaxError ? "json-parse" : "schema",
      code: error instanceof SyntaxError ? "invalid-json" : "invalid-assessment",
      stopReason: response.stopReason,
    });
  }
  return {
    assessment,
    usage: {
      input: response.usage.input,
      output: response.usage.output,
      cacheRead: response.usage.cacheRead,
      cacheWrite: response.usage.cacheWrite,
    },
  };
}
