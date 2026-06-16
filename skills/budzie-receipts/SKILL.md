---
name: budzie-receipts
description: >
  Report local Budzie savings from `budzie:` markers, dependency avoidance, and
  optional labelled estimates. Use for /budzie-receipts, receipts, savings report,
  saved tokens, saved dollars, or README badge.
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

## Output

Show real local counts first. If estimating lines, tokens, or dollars, prefix the
line with `ESTIMATE` and name the source.

End with a badge string:

```md
![budzie](https://img.shields.io/badge/budzie-<N>_shortcuts-111111)
```

No writes unless user asks.
