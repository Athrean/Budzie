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

Hooks (opt-in, local-only):

- `hooks/hooks.json`: register to auto-activate Budzie on session start and show
  a local status indicator.
- SessionStart runs `node scripts/hooks/activate.mjs`, which injects the Budzie
  ruleset as hidden context and records activation locally.
- Statusline runs `hooks/statusline.sh` (POSIX) or `hooks/statusline.ps1`
  (PowerShell), printing `Budzie: on|off | budget <ceiling> <unit> (<mode>)`.
- Activation state lives in a host data dir (`$XDG_DATA_HOME/budzie`,
  `%LOCALAPPDATA%\budzie`, or `$BUDZIE_DATA_DIR`), never in your repo.
- Hooks silent-fail and never block session start. No telemetry.
