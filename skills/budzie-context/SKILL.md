---
name: budzie-context
description: >
  Read-only context-size receipts for agent memory files. Estimates the
  recurring context an agent loads from natural-language instruction files
  (CLAUDE.md, AGENTS.md, GEMINI.md, *.md memory/todo/preference files) and
  reports real bytes plus labelled ESTIMATE tokens. Use for /budzie-context,
  context receipts, context size, memory file size, tokens loaded, or trimming
  an agent's standing context.
---

# Budzie Context Receipts

Read-only by default. Scans natural-language agent memory/instruction files
only — never code, config, secrets, or binaries.

## Scan

```bash
node scripts/context-receipts.mjs           # terminal report: files, bytes, ESTIMATE tokens
node scripts/context-receipts.mjs --json     # raw scan result as JSON
node scripts/context-receipts.mjs <root>     # scan a specific directory
```

The scanner counts only memory/instruction files: `CLAUDE.md`, `AGENTS.md`,
`GEMINI.md`, and other markdown memory/todo/preference files. It refuses
sensitive paths by default: `.env*`, lockfiles, key/credential files, anything
under `.git/`, and binaries.

## Estimates

Token figures are always an `ESTIMATE`. The tokenizer assumption is the
~4 chars/token heuristic (`tokens ~= ceil(chars / 4)`). Real bytes are a true
local count; tokens are never claimed as exact. Report bytes first, then the
labelled token estimate.

## Rewrite (explicit opt-in)

Rewriting is off by default and must be requested explicitly. It writes a
`.original` backup before touching the file, then tightens redundant prose
whitespace while preserving code blocks, inline code, URLs, paths, and headings.

```bash
node scripts/context-receipts.mjs --rewrite CLAUDE.md   # writes CLAUDE.md.original first
```

Never rewrite without the user asking. Never rewrite a file the scanner would
refuse.

## Output

Show real bytes first. Prefix every token figure with `ESTIMATE` and state the
~4 chars/token assumption. No writes unless the user opts in with `--rewrite`.
