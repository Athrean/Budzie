---
name: budzie-compress
description: >
  Opt-in memory-file compressor. Rewrites agent memory files such as CLAUDE.md,
  AGENTS.md, notes, todos, and project context into smaller prose while
  preserving code, URLs, paths, identifiers, API names, and exact error strings.
  Use for /budzie-compress, compress memory files, shrink CLAUDE.md, shrink
  AGENTS.md, or input token compression.
---

# Budzie Compress

Compress one natural-language agent memory file. This is write-capable by
default because the command is explicit; use `--dry-run` to inspect savings
first.

## Commands

```bash
node scripts/compress.mjs --dry-run CLAUDE.md  # read-only savings card
node scripts/compress.mjs CLAUDE.md            # writes CLAUDE.md + CLAUDE.md.bak
node scripts/compress.mjs --json --dry-run AGENTS.md
```

## Rules

- Uses the current Budzie intensity level from `scripts/intensity.mjs`.
- Writes `<file>.bak` before replacing the file.
- `--dry-run` prints before/after ESTIMATE token counts and writes nothing.
- Refuses sensitive files and non-context files.
- Preserves byte-for-byte: fenced code blocks, inline code, URLs, file paths,
  identifiers, API names, and exact error strings.
- Auto-clarity guard keeps destructive/security-sensitive lines in full prose.
- No telemetry. No network.

## Output

Token counts use the same `ceil(chars / 4)` estimate as Budzie context receipts
and are labelled `ESTIMATE`. Bytes are real local UTF-8 counts.
