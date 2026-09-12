# Tool review protocol v2

This is a documented in-process protocol over Pi public events, not an OS security boundary. Participants ignore sessions they do not own. Event emission is synchronous, not awaitable.

`tool-review:policy:v2` carries `{ session, cwd, toolName, input, answers }`. Owners synchronously append `{ mode, readOnly, inspection, scratchRoot?, revision? }`. `mode` is `normal` or `plan-preserving`; `readOnly` is only the legacy strict ceiling. Any deny/strict ceiling wins. Plan's revision includes workflow generation and command settings; scratchRoot is an unpredictable per-workflow temporary path. Reviewers query v1 only if there are no v2 responses. The Plan provider also supplies its original strict v1 response for old reviewers.

`tool-review:request:v2` carries `{ event, ctx, replies }`. A compatible reviewer synchronously appends one promise resolving to `{ allowed, reason, source }`. Plan requires exactly one reply; no v1 fallback can grant a new exception. It retains the original static inspection behavior when the reviewer is absent. File mutations require v2 approval even if selected in tool settings.

`tool-review:capabilities:v2` carries `{ session, answers }`. An enabled reviewer appends `{ planPreserving: true }`. Plan advertises its scratch directory only when exactly one compatible reviewer is present. This denotes integration capability, not model entitlement or a successful model call.

A review binds exact frozen tool input, session, cancellation, current mode, scratch root, and policy revision. A WeakMap deduplicates the same tool event between the Plan hook and reviewer hook. Session or policy changes invalidate pending approval. Unrelated extension denials still win.

The model receives a separately labeled host context and untrusted exact action/local evidence/transcript. In preserving mode, automatic approval requires `plan_compatible=true`, not `read_only=true`. The former means planning investigation plus preservation of existing work. Explicit incompatibility blocks; missing compatibility requires user approval. Critical risk and explicit denials remain blocking in all modes.
