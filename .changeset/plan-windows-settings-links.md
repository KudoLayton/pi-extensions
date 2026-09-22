---
"@narumitw/pi-plan-mode": patch
---

Reject settings symlinks on Windows, including dangling canonical links that previously triggered legacy-file fallback. Preserve existing files when a settings save encounters a link.
