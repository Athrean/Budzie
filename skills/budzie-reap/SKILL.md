---
name: budzie-reap
description: >
  Audit existing bloat and present a ranked cleanup summary before changing
  anything. Apply approved cuts one per worktree, run tests, keep green cuts,
  discard red cuts, and report savings. Use for /budzie-reap, reaper, delete
  bloat, clean up repo, or safe deletion.
---

# Budzie Reaper

Advisor to operator.

## Operator Contracts

Before locating, cutting, or reviewing a cut, read
`skills/budzie-reap/references/operator-contracts.md`.

- Locate is read-only and returns file/line evidence.
- Cut applies one cut per worktree and refuses broad or destructive edits.
- Review reports findings only and does not apply fixes.

## Approval Gate

1. Build the ranked plan: `node src/reap.mjs plan`.
2. Use `node src/reap.mjs plan --aggressive` only when the user asks for
   `native` or `yagni` cuts.
3. Present a compact summary: ranked cuts, evidence, risk, expected savings,
   and verification command.
4. State that no files changed and ask whether to apply the safe cuts.
5. Stop. Do not create worktrees or edit files until the user explicitly
   approves applying cuts after seeing the summary.

## Apply Loop

After explicit approval:

1. Apply one approved cut per worktree.
2. Run detected tests.
3. Keep green cuts, discard red cuts.
4. Render the PR receipt with `node src/reap.mjs receipt`, reading results
   JSON on stdin: `{ kept, discarded, linesRemoved, depsRemoved }`.

## Defaults

The command invocation alone is audit-only. High-confidence `delete` and
`stdlib` cuts are eligible after approval. `native` and `yagni` need
`--aggressive`. `shrink` is suggest-only unless the user explicitly approves it.

Never auto-merge. Never delete security, trust-boundary validation, data-loss
handling, or accessibility basics.
