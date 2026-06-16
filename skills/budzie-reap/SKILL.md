---
name: budzie-reap
description: >
  Audit existing bloat, plan safe cuts, apply one cut per worktree, run tests,
  keep green cuts, discard red cuts, and report savings. Use for /budzie-reap,
  reaper, delete bloat, clean up repo, or safe deletion.
---

# Budzie Reaper

Advisor to operator.

## Loop

1. Audit for cuts: `delete`, `stdlib`, `native`, `yagni`, `shrink`.
2. Plan exact path, line range, replacement, and verification command.
3. Apply one cut per worktree.
4. Run detected tests.
5. Keep green cuts, discard red cuts.
6. Report receipt: lines removed, deps removed, cuts kept, cuts discarded.

## Defaults

Auto-apply only high-confidence `delete` and `stdlib` cuts. `native` and `yagni`
need `--aggressive`. `shrink` is suggest-only unless user explicitly asks.

Never auto-merge. Never delete security, trust-boundary validation, data-loss
handling, or accessibility basics.
