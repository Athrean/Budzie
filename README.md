# Budzie

Code less. Spend less. Watch the meter.

![Budzie demo](https://raw.githubusercontent.com/Athrean/Budzie/main/assets/demo.gif)

*Budzie in action.*

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
| `/budzie-shrink` | Compress MCP tool descriptions through a stdio proxy. |
| `/budzie-compress` | Compress one agent memory file with a `.bak` backup. |
| `/budzie-help` | Show quick reference. |

## MCP middleware

Wrap a local stdio MCP server:

```bash
budzie-shrink --upstream "node ./path/to/server.mjs"
```

Budzie forwards MCP traffic and compresses top-level tool descriptions with the
current intensity setting. Schemas and other protocol fields stay unchanged.
The first catalog's UTF-8 byte savings are written to stderr; stdout remains
protocol-only.

For a saved catalog, `node scripts/tool-reducer.mjs --fields description
catalog.json` runs the same reducer in read-only inspection mode.

## Supported hosts

Budzie ships one thin adapter manifest per host. Each adapter only points at the
shared runtime surfaces in this repo; none of them re-implement a command, skill,
or script. Every adapter is named `budzie` and pins its version to the package
version, and `scripts/check-drift.mjs` fails if an adapter drifts off that
version or references a surface that does not exist.

| Host | Adapter manifest | Wires up |
| --- | --- | --- |
| Codex / plugin host | `.codex-plugin/plugin.json` | `./agents/`, `./skills/`, `./hooks/hooks.json` |
| Claude Code | `.claude-plugin/plugin.json` | `./agents/`, `./commands/`, `./skills/`, `./hooks/hooks.json` |
| Generic agents host | `.agents-plugin/plugin.json` | `./agents/`, `./commands/`, `./skills/`, `./scripts/`, `./hooks/hooks.json` |

## Marker

Use `budzie:` comments for intentional shortcuts:

```js
// budzie: native date input, upgrade to date-picker only when range selection ships
```

Budzie reads those markers into Receipts. No backend. No telemetry.
