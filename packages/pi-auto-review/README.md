# 🛡️ Pi Auto Review

[![Pi extension](https://img.shields.io/badge/Pi-extension-blue)](https://pi.dev)
[![npm](https://img.shields.io/badge/npm-not%20published-lightgrey)](#-install)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

Review selected Pi tool actions before execution, with native PowerShell, optional Plan integration, and Action Fusion support. This is a local package in the KudoLayton fork; its internal npm name follows the monorepo convention and does not imply an upstream npm release.

## ✨ Features

- Ordinary workspace file operations bypass model review; other covered actions use a bounded reviewer.
- Plan investigations may write verified caches or scratch experiments after review. Existing source, configuration, and user work remain protected.
- A fused `edit`/`write` and `then_run` are reviewed together before the file changes.
- Uncertain or failed reviews ask for one-time user approval in TUI/RPC. No UI, cancellation, explicit denials, and critical assessments block execution.
- Direct user input is retained independently of model context compaction. Agent-generated Goal continuations are not new authorization.

## 📦 Install

Install the local package directory from a trusted checkout:

```powershell
pi install D:/Git/better_pi/pi-extensions/packages/pi-auto-review --approve
```

For temporary loading, use `pi -e D:/Git/better_pi/pi-extensions/packages/pi-auto-review`. Do not install the entire monorepo just to enable this package. No npm publication is available for this local implementation. The optional Plan integration requires the patched Plan package from the same checkout; neither package imports the other.

Extensions run with Pi's OS permissions. This package is an application-level gate, not an OS sandbox. Trust all loaded extensions. The reviewer receives the proposed action and selected session evidence through Pi's configured provider authentication.

## 🚀 Quick start

Restart Pi in your project, open `/auto-review`, and inspect Status. The default reviewer is `openai-codex/codex-auto-review`, with low reasoning when supported. Test its availability before relying on automatic approvals; there is no silent fallback to another model.

Start a new task with a direct user message so authorization has a recorded source. Older sessions without provenance markers may need a fresh statement of intent. No model request is made merely by loading this extension.

## 💬 Commands

`/auto-review` opens Settings, Status, and Help in TUI. `/auto-review status` and `/auto-review help` also work through RPC notifications. Print/JSON command invocation is rejected explicitly. Tool gating remains active in those modes; an action needing manual approval is blocked.

Settings changes apply immediately after successful persistence. Closing the screen does not undo earlier saves. Provider and model are edited in the settings file, then loaded with `/reload`.

## ⚙️ Settings

The user settings file is `<getAgentDir()>/pi-auto-review.json`. Project overrides are deliberately unsupported so agent-writable project settings cannot weaken this gate. Missing settings use the defaults without creating a file. Invalid settings are preserved and cause manual review; save operations refuse to overwrite invalid JSON.

```json
{
  "enabled": true,
  "provider": "openai-codex",
  "model": "codex-auto-review",
  "timeoutMs": 30000,
  "maxInputTokens": 8000,
  "maxOutputTokens": 1000
}
```

`timeoutMs` accepts 1,000–60,000; `maxInputTokens` 6,000–32,000; `maxOutputTokens` 256–4,000. Input accounting estimates one token per three UTF-8 bytes plus a framing reserve, not an exact model tokenizer or billing limit. Exact action input is never truncated to obtain approval; if it cannot fit, manual review is required. Policy text remains a stable prefix. There are no automatic provider retries, background reviewer agents, or reusable command-prefix grants.

Settings saves preserve unknown keys, use temporary-file-plus-rename publication, and are ordered within one extension instance. Separate Pi processes are not coordinated. Settings are reloaded on session start and `/reload`.

## 🔒 Security and privacy

The gate covers agent calls to `bash`, `powershell`, `read`, `grep`, `find`, `ls`, `edit`, and `write`, including a nested `then_run`. It does not intercept arbitrary subprocesses launched privately by other extensions or user-entered shell commands.

Workspace file fast paths exclude protected directories, credential-like filenames, outside paths, alternate data streams, symlinks/junctions, and multiply-linked files. With the patched Plan extension installed, its known inspection commands also bypass model review. Without an inspection provider, shell commands receive model review. Root directory queries and `.pi/skills` Markdown/text documentation reads bypass model review after the same link and credential checks; writes and scripts do not get this exception.

The reviewer has no tools. It sees the exact action and selected evidence, including the proposed content of a fused file mutation. In preserving Plan mode, bounded current local evidence includes referenced scripts and package manifests (up to four files and 4,500 bytes). Missing or oversized evidence is marked incomplete, never silently treated as safe. It must ask when local state needed for a decision is missing. Explicit model denials return a reason to the agent; they are not silently turned into manual overrides. In Plan mode a manual approval affirms an investigation that preserves existing work. It cannot override a known protected mutation or an explicit incompatible assessment. `read_only=false` alone is not a denial.

Approved input is frozen before it can reach a later tool-call handler. These checks do not provide atomic filesystem isolation from other processes or protection against malicious fully privileged extensions.

Decision entries store action hashes, provenance, timing, and outcomes rather than raw commands or rationales. Direct input provenance necessarily retains user text in the existing Pi session. Status reports provider usage when returned, distinguishing model calls from static and manual decisions. No credentials are stored by this package.

## Plan preservation policy

The v2 protocol distinguishes `normal` from `plan-preserving`. A Plan approval requires `plan_compatible=true`: an investigation rather than implementation, preserving existing source, configuration, and user work whether tracked or untracked. `read_only` describes the action, not the mode. Unknown compatibility asks the user; explicit incompatibility blocks.

Plan selects a fresh temporary investigation directory per workflow generation and advertises it at the context tail. `write/edit` are restricted to files beneath that directory, with link and path checks, and always require review in Plan. Existing generated caches/build artifacts may be updated by reviewed checks only when evidence identifies them as generated output; gitignore status alone is insufficient. Scratch directories are not automatically deleted.

An absent/disabled or v1-only reviewer cannot grant new Plan exceptions. The older strict policy remains the compatibility fallback. Mode, invocation ID, and failure-stage metadata accompany new decisions; no raw commands or authentication data are added to the decision log.


## 🚧 Limitations

- The model's classification can be wrong; this is not filesystem isolation or a guarantee that existing work will be preserved.
- `codex-auto-review` may be absent from Pi's model list. For this explicitly selected ID only, the extension uses the provider's existing Codex transport metadata to attempt the request. An authentication or entitlement error asks the user instead of selecting another model.
- Existing user-role history without direct-input provenance is evidence, not authorization. Extension-generated user messages, summaries, and TODO text cannot grant new permission.
- A denied fused call changes nothing. A permitted fused call whose follow-up fails retains the edit, following SoL-Pi's original behavior.
- Unknown extension tools are outside this package's gate. Reusable approvals and OS sandbox adapters are not provided.

## 🗂️ Package layout

`src/` contains the gate, reviewer, provenance rendering, settings, and optional event integration. `test/` contains deterministic checks; the repository's `test/auto-review-plan.test.ts` verifies Plan coexistence. [Protocol documentation](docs/protocol.md) describes the extension-neutral integration.

## 🔎 Keywords

Pi, automatic permission review, Windows, PowerShell, Plan, Action Fusion.

## 📄 License

[MIT](LICENSE). See [third-party notices](THIRD_PARTY_NOTICES.md) for adapted code and pinned source versions.
