export interface Assessment {
  outcome: "allow" | "deny" | "ask";
  risk: "low" | "medium" | "high" | "critical";
  readOnly: boolean | undefined;
  planCompatible?: boolean;
  reason: string;
}

export interface ReviewRequest {
  toolCallId: string;
  toolName: string;
  cwd: string;
  input: Record<string, unknown>;
  readOnly: boolean;
  inspection: "allow" | "deny" | "review";
  ordinaryFile: boolean;
  mode?: "normal" | "plan-preserving";
  scratchRoot?: string;
}

export interface Verdict {
  allowed: boolean;
  reason: string;
  source: "static" | "model" | "user" | "cancelled";
}

export interface GateDependencies {
  review(): Promise<Assessment>;
  ask(reason: string): Promise<boolean>;
  isCurrent(): boolean;
}

export async function evaluateReview(request: ReviewRequest, deps: GateDependencies): Promise<Verdict> {
  const stale = (): Verdict => ({ allowed: false, reason: "Review cancelled or action changed.", source: "cancelled" });
  if (!deps.isCurrent()) return stale();
  if (request.inspection === "deny" || (request.readOnly && ["edit", "write"].includes(request.toolName))) {
    return { allowed: false, reason: "The active read-only policy prohibits this action.", source: "static" };
  }
  const preserving = request.mode === "plan-preserving";
  if (
    request.inspection === "allow" ||
    (request.ordinaryFile &&
      request.input.then_run === undefined &&
      (!preserving || !["write", "edit"].includes(request.toolName)) &&
      !["bash", "powershell"].includes(request.toolName))
  ) {
    return { allowed: true, reason: "Within the deterministic inspection or workspace-file policy.", source: "static" };
  }
  let assessment: Assessment;
  try {
    assessment = await deps.review();
  } catch {
    assessment = {
      outcome: "ask",
      risk: "medium",
      readOnly: undefined,
      reason: "Automatic review could not complete. Review the exact action manually.",
    };
  }
  if (!deps.isCurrent()) return stale();
  if (
    assessment.risk === "critical" ||
    assessment.outcome === "deny" ||
    (request.readOnly && assessment.readOnly === false) ||
    (preserving && assessment.planCompatible === false)
  ) {
    return { allowed: false, reason: assessment.reason, source: "model" };
  }
  if (
    assessment.outcome === "allow" &&
    (!request.readOnly || assessment.readOnly === true) &&
    (!preserving || assessment.planCompatible === true)
  ) {
    return { allowed: true, reason: assessment.reason, source: "model" };
  }
  const approved = await deps.ask(assessment.reason);
  if (!deps.isCurrent()) return stale();
  return {
    allowed: approved,
    reason: approved ? "User approved this exact action once." : "User approval was unavailable or declined.",
    source: "user",
  };
}

export function parseAssessment(text: string): Assessment {
  const parsed: unknown = JSON.parse(text.trim());
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("Invalid reviewer object");
  const value = parsed as Record<string, unknown>;
  if (!["allow", "deny", "ask"].includes(String(value.outcome))) throw new Error("Invalid review outcome");
  const risk = value.risk_level ?? (value.outcome === "allow" ? "low" : "high");
  if (!["low", "medium", "high", "critical"].includes(String(risk))) throw new Error("Invalid risk level");
  if (value.read_only !== undefined && typeof value.read_only !== "boolean")
    throw new Error("Invalid read-only assessment");
  if (value.plan_compatible !== undefined && typeof value.plan_compatible !== "boolean")
    throw new Error("Invalid Plan compatibility assessment");
  if (
    value.user_authorization !== undefined &&
    !["unknown", "low", "medium", "high"].includes(String(value.user_authorization))
  )
    throw new Error("Invalid authorization");
  if (value.rationale !== undefined && (typeof value.rationale !== "string" || value.rationale.length > 4000))
    throw new Error("Invalid rationale");
  return {
    outcome: value.outcome as Assessment["outcome"],
    risk: risk as Assessment["risk"],
    readOnly: value.read_only as boolean | undefined,
    planCompatible: value.plan_compatible as boolean | undefined,
    reason: typeof value.rationale === "string" ? value.rationale : "Automatic permission assessment.",
  };
}
