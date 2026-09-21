export interface ReviewDiagnostic {
  kind: "provider" | "incomplete" | "output-limit" | "cancelled" | "timeout" | "json-parse" | "schema";
  code: string;
  stopReason?: string;
  rawStopReason?: string;
}

// Persist only host-owned labels: provider errors can echo secrets, prompts or headers.
export function providerCode(message: unknown): string {
  const text = typeof message === "string" ? message.slice(0, 16_384) : "";
  if (/model_not_found|model.*(?:does not exist|not supported|not available)/i.test(text)) return "model-unavailable";
  if (/unauthorized|invalid_api_key|authentication|token.*expired|\b401\b/i.test(text)) return "authentication";
  if (/permission.denied|forbidden|\b403\b/i.test(text)) return "access-denied";
  if (/rate.limit|quota|\b429\b/i.test(text)) return "rate-limit";
  if (/unsupported.*(?:parameter|value)|invalid.*(?:parameter|value)/i.test(text)) return "invalid-request";
  if (/ECONN|ENOTFOUND|fetch failed|network/i.test(text)) return "transport";
  if (/\b50[0234]\b|server.error|internal.error/i.test(text)) return "server";
  return "unknown-provider-error";
}

export class ReviewFailure extends Error {
  constructor(
    message: string,
    readonly diagnostic: ReviewDiagnostic,
  ) {
    super(message);
    this.name = "ReviewFailure";
  }
}

export function responseFailure(response: {
  stopReason: string;
  rawStopReason?: string;
  errorMessage?: string;
}): ReviewFailure {
  const stopReason = ["stop", "length", "error", "aborted", "toolUse"].includes(response.stopReason)
    ? response.stopReason
    : "unknown";
  const rawStopReason = [
    "completed",
    "incomplete",
    "failed",
    "cancelled",
    "max_output_tokens",
    "content_filter",
  ].includes(response.rawStopReason ?? "")
    ? response.rawStopReason
    : undefined;
  const kind =
    stopReason === "error"
      ? "provider"
      : stopReason === "aborted"
        ? "cancelled"
        : stopReason === "length"
          ? "output-limit"
          : "incomplete";
  return new ReviewFailure("Reviewer did not produce a complete decision", {
    kind,
    code: kind === "provider" ? providerCode(response.errorMessage) : kind,
    stopReason,
    rawStopReason,
  });
}

export function errorDiagnostic(error: unknown, timedOut = false, cancelled = false): ReviewDiagnostic {
  if (timedOut) return { kind: "timeout", code: "deadline" };
  if (cancelled) return { kind: "cancelled", code: "cancelled" };
  // Jiti may load more than one copy of this class. Validate structurally, never
  // persist a foreign diagnostic object or rely on cross-loader instanceof.
  if (
    error &&
    typeof error === "object" &&
    "name" in error &&
    error.name === "ReviewFailure" &&
    "diagnostic" in error
  ) {
    const value = error.diagnostic;
    if (value && typeof value === "object" && "kind" in value && "code" in value) {
      const kinds = ["provider", "incomplete", "output-limit", "cancelled", "timeout", "json-parse", "schema"];
      const codes = [
        "model-unavailable",
        "authentication",
        "access-denied",
        "rate-limit",
        "invalid-request",
        "transport",
        "server",
        "unknown-provider-error",
        "incomplete",
        "output-limit",
        "cancelled",
        "deadline",
        "invalid-json",
        "invalid-assessment",
      ];
      if (
        typeof value.kind === "string" &&
        kinds.includes(value.kind) &&
        typeof value.code === "string" &&
        codes.includes(value.code)
      ) {
        const reasons = responseFailure({
          stopReason: "stopReason" in value && typeof value.stopReason === "string" ? value.stopReason : "unknown",
          rawStopReason:
            "rawStopReason" in value && typeof value.rawStopReason === "string" ? value.rawStopReason : undefined,
        }).diagnostic;
        return {
          kind: value.kind as ReviewDiagnostic["kind"],
          code: value.code,
          stopReason: reasons.stopReason,
          rawStopReason: reasons.rawStopReason,
        };
      }
    }
  }
  return { kind: "provider", code: providerCode(error instanceof Error ? error.message : undefined) };
}
