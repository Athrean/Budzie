---
name: budzie-shrink
description: >
  Standalone MCP stdio middleware that compresses tool descriptions while
  preserving schemas and protocol traffic. Use for /budzie-shrink,
  budzie-shrink --upstream, MCP catalog compression, or verbose tool help.
---

# Budzie Shrink

Wrap any stdio MCP server:

```bash
budzie-shrink --upstream "node ./path/to/server.mjs"
```

The host connects to `budzie-shrink` as the MCP server. Budzie starts the
upstream command locally and forwards newline-delimited JSON-RPC in both
directions.

## Behavior

- Tracks `tools/list` request IDs.
- Compresses top-level tool `description` strings in successful list responses.
- Uses the current Budzie intensity from `src/intensity.mjs`.
- Keeps a description unchanged when compression would make it larger.
- Preserves tool names, titles, schemas, parameter types, enum values,
  annotations, cursors, request IDs, errors, and tool results.
- Passes notifications, server requests, and every non-list response through.

Nested schema descriptions stay unchanged because they are part of the schema.

## Reporting

After the first successful tool catalog, stderr receives one line:

```text
Budzie Shrink: level medium, descriptions 4000 -> 2500 bytes, saved 1500 (38%)
```

The counts are real UTF-8 bytes from tool description strings. Stdout contains
MCP messages only.

## Catalog inspection

Inspect a saved `tools/list` result without starting a server:

```bash
node src/tool-reducer.mjs --fields description catalog.json
```

Add `--json` to emit the compressed catalog and byte counts. The command reads
the file and writes its report to stdout; it does not edit the file. Catalog
compression is opt-in through `--fields`.

## Boundaries

`--upstream` accepts one command string and runs it through the local shell.
Wrap trusted commands. Budzie adds no network calls or telemetry; the upstream
server keeps its own behavior.
