---
name: budzie-reap
description: >
  Audit existing bloat, plan safe cuts, apply one cut per worktree, run tests,
  keep green cuts, discard red cuts, and report savings. Use for /budzie-reap,
  reaper, delete bloat, clean up repo, or safe deletion.
---

# Budzie Reaper

Advisor to operator.

## Operator Contracts

Before locating, cutting, or reviewing a cut, read
`skills/budzie-reap/references/operator-contracts.md`.

- Locate is read-only and returns file/line evidence.
- Cut applies one cut per worktree and refuses broad or destructive edits.
- Review reports findings only and does not apply fixes.

## Loop

1. Build the ranked plan: `node scripts/reap.mjs plan`.
2. Use `node scripts/reap.mjs plan --aggressive` only when the user asks for
   `native` or `yagni` cuts.
3. Apply one cut per worktree.
4. Run detected tests.
5. Keep green cuts, discard red cuts.
6. Render the PR receipt with `node scripts/reap.mjs receipt`, reading results
   JSON on stdin: `{ kept, discarded, linesRemoved, depsRemoved }`.

## Defaults

Auto-apply only high-confidence `delete` and `stdlib` cuts. `native` and `yagni`
need `--aggressive`. `shrink` is suggest-only unless user explicitly asks.

Never auto-merge. Never delete security, trust-boundary validation, data-loss
handling, or accessibility basics.
