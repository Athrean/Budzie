---
name: budzie-receipts
description: >
  Report local Budzie savings from `budzie:` markers, dependency avoidance, and
  optional labelled estimates. Use for /budzie-receipts, receipts, savings report,
  marker ledger, saved tokens, saved dollars, or README badge.
---

# Budzie Receipts

Read-only savings report.

## Scan

Find markers:

```bash
grep -rnE '(#|//|<!--) ?budzie:' . \
  --exclude-dir=.git --exclude-dir=node_modules --exclude-dir=dist --exclude-dir=build
```

Count:

- total `budzie:` markers
- markers without an upgrade trigger
- markers naming `stdlib`, `native`, or a replaced dependency

## Score

After the scan, get the real counts from the shared scanner:

```bash
node src/receipts.mjs           # terminal card with the three counts
node src/receipts.mjs --badge   # shields.io badge string for a README
node src/receipts.mjs --json    # { markers, noUpgradeTrigger, depsAvoided }
node src/receipts.mjs --ledger  # rows: file, line, marker, cut tag, tier, dep flag, trigger flag
```

Real local counts only — no baseline, no estimate.

## Live meter (real session tokens)

To read what the *current* session actually cost — real counted tokens, not an
estimate — run the meter. It auto-discovers the live Claude Code transcript (or
pass `--session <path>`):

```bash
node src/meter.mjs           # counted input/output/total for this session
node src/meter.mjs --badge   # one-line statusline segment, e.g. "session 3.2k out / 18k in"
node src/meter.mjs --json    # { transcript, usage }
```

Counted figures only; if no usage fields are present it says so rather than
inventing a number. Set `BUDZIE_STATUSLINE_SESSION=1` to also show the live
session segment in the statusline.

## Record (lifetime ledger)

After scoring, append this run to the local lifetime ledger so the statusline
badge can show cumulative savings. Local-only, zero network:

```bash
node src/ledger.mjs append --tokens <N> --lines <N> --deps <N> --cost <N>
```

Pass the real counts you measured (tokens saved, lines avoided, deps avoided)
and any labelled cost estimate; omit a flag to record 0. The command prints the
updated `[BUDZIE] <total>` badge. The ledger lives at `~/.config/budzie/ledger.json`
(honoring `$XDG_CONFIG_HOME`) and is created on first run.

## Output

Show real local counts first. If estimating lines, tokens, or dollars, prefix the
line with `ESTIMATE` and name the source.

Use `--ledger` when reviewing marker hygiene. It prints `MISSING` for rows
without an upgrade trigger.

End with a badge string:

```md
![budzie](https://img.shields.io/badge/budzie-<N>_shortcuts-111111)
```

No writes unless user asks.
