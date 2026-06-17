---
name: budzie-shrink
description: >
  Opt-in tool-catalog size reducer. Shrinks prose-heavy MCP tool descriptions
  while preserving protocol behavior exactly. Use for /budzie-shrink, tool
  catalog, tools/list, description compression, or trimming verbose tool help.
---

# Budzie Shrink

Make a verbose MCP tool catalog smaller without changing how any tool behaves.
Think of it as a transparent compressor over a `tools/list`-style result: it
trims filler from configured prose fields and leaves everything that matters
byte-for-byte intact.

## Opt-in only

Off by default. Nothing is touched unless you name fields to compress. With no
`--fields`, the catalog passes through unchanged and savings report as zero.

## Commands

- Card (default): `node scripts/tool-reducer.mjs --fields description catalog.json`
- JSON result: `node scripts/tool-reducer.mjs --json --fields description catalog.json`
- From stdin: `cat catalog.json | node scripts/tool-reducer.mjs --fields description`

`--fields` is a comma-separated list of top-level tool fields to compress, e.g.
`--fields description,longHelp`. Read-only: the script never writes your files.

## What it preserves

The compressor only squashes plain prose (collapsing whitespace, dropping a
small filler-word list). It preserves byte-for-byte:

- URLs (`https://api.example.com/v1/items`)
- file paths (`/etc/hosts`, `./config/settings.json`)
- identifiers: tool names, param names, enum values, snake_case, dotted names
- backtick code spans and fenced code blocks
- the JSON structure: schemas, `enum` arrays, nested objects

Anything that could change protocol behavior is left exactly as-is.

## As a proxy

The same module exports a pure compressor and a passthrough seam so it can wrap
a live server:

- `compressCatalog(catalog, config) -> { catalog, bytesBefore, bytesAfter }`
- `proxyResponse(message, config)` — returns requests and tool-call responses
  unchanged; only `tools/list`-style results are compressed when enabled.

Both are pure functions, unit-tested without a live MCP server.

## Output

```text
Budzie tool reducer
  bytes before  <n>
  bytes after   <n>
  bytes saved   <n> (<pct>%)
(prose fields only; identifiers, URLs, paths, code, schema preserved)
```

## Rules

- Opt-in. No `--fields` means passthrough.
- Compress only the configured prose fields; never grow a field.
- Preserve identifiers, URLs, paths, code, and JSON structure exactly.
- Report real before/after UTF-8 byte counts for what was compressed.
- No telemetry. No remote calls.
