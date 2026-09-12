# Third-party code

This local fork includes adaptations of MIT-licensed code. The combined LICENSE retains the copyright and permission notices.

- `src/policy.ts` and `src/transcript.ts`: `@mzwing/pi-permission-auto-review` 0.3.2, Copyright (c) 2026 Lockinwize Lolite. Source: https://github.com/mzwing/pi-packages/tree/main/packages/pi-permission-auto-review. The source was obtained from the exact npm 0.3.2 tarball's source map. Changes: direct interactive/RPC provenance instead of trusting every user-role message, ES2022 compatibility, `ask` and read-only output fields, and fused-action handling. The bundled policy adapts OpenAI Codex revision `6478a751fde8884b2fdc76486fe23175a8e795d4`; it is not fetched at runtime.
- `src/input-lock.ts`: `pi-approval-guardian` 0.8.0, Copyright (c) 2026 pi-approval-guardian contributors. Source: https://github.com/mics8128/pi-approval-guardian. The source was obtained from the exact npm 0.8.0 tarball. The extension-specific verdict wrapper was removed; JSON validation and input locking are retained.

The new integration, gate, settings, and tests are maintained in the KudoLayton fork. Neither upstream package is loaded or installed as a runtime dependency.
