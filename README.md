# Budzie

Code less. Spend less. Watch the meter.

Budzie is a budget-first agent plugin. It makes agent savings measurable on your
repo, then uses that signal to guard spend and remove existing bloat.

## Powers

- **Receipts**: scan `budzie:` markers and local diffs, then report real savings.
- **Reaper**: audit bloat, plan cuts, apply each cut in a worktree, keep only
  cuts that pass tests.
- **Budget guard**: set an allowance and stop tasks that would blow it.

## Commands

| Command | What it does |
| --- | --- |
| `/budzie` | Activate Budzie mode. |
| `/budzie-receipts` | Report local savings and badge text. |
| `/budzie-reap` | Audit, cut, verify, and report deleted bloat. |
| `/budzie-budget` | Check or set the spend ceiling. |
| `/budzie-help` | Show quick reference. |

## Marker

Use `budzie:` comments for intentional shortcuts:

```js
// budzie: native date input, upgrade to date-picker only when range selection ships
```

Budzie reads those markers into Receipts. No backend. No telemetry.
