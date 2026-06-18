---
name: budzie-help
description: "Quick reference for Budzie commands and marker format."
---

# Budzie Help

Commands:

- `/budzie`: budget-first coding mode.
- `/budzie-receipts`: local savings report.
- `/budzie-reap`: audit, cut, verify, report.
- `/budzie-budget`: check or set allowance.
- `/budzie-shrink`: shrink prose-heavy tool descriptions, preserve behavior.
- `/budzie-compress`: compress one agent memory file with a `.bak` backup.
- `/budzie-help`: this card.

Marker:

```js
// budzie: native date input, upgrade to date-picker only when range selection ships
```

Auto-activation (local-only):

- Claude Code uses `hooks/hooks.json`; Codex uses `hooks/codex.json`.
- Their SessionStart hooks run `node scripts/hooks/activate.mjs`, inject the
  Budzie ruleset as hidden context, and record activation locally.
- Rules-capable agents plugin hosts load `rules/budzie.mdc`, whose
  `alwaysApply: true` frontmatter activates the `budzie` skill from message one.
- Statusline runs `hooks/statusline.sh` (POSIX) or `hooks/statusline.ps1`
  (PowerShell), printing `Budzie: on|off | budget <ceiling> <unit> (<mode>)`.
- Activation state lives in a host data dir (`$XDG_DATA_HOME/budzie`,
  `%LOCALAPPDATA%\budzie`, or `$BUDZIE_DATA_DIR`), never in your repo.
- Hooks silent-fail and never block session start. No telemetry.
