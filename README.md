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
| `/budzie-compress` | Compress one agent memory file in the same language with a `.bak` backup. |
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

## Language-preserving compression

`/budzie-compress` removes filler and hedging without translating the input or
adding an English opening. Built-in rules cover Spanish, Portuguese, and French
across all four intensity levels. Fenced and inline code, CLI commands, URLs,
paths, identifiers, API names, and exact errors stay byte-for-byte unchanged.

Run the deterministic, zero-network fixtures locally:

```bash
node benchmarks/multilingual-compression.mjs
```

## Supported hosts

Budzie ships one thin adapter manifest per host. Each adapter only points at the
shared runtime surfaces in this repo; none of them re-implement a command, skill,
or script. Every adapter is named `budzie` and pins its version to the package
version, and `scripts/check-drift.mjs` fails if an adapter drifts off that
version, references a surface that does not exist, or loses its activation
contract.

| Host | Adapter manifest | Wires up |
| --- | --- | --- |
| Codex / plugin host | `.codex-plugin/plugin.json` | `./agents/`, `./skills/`, `./hooks/codex.json` |
| Claude Code | `.claude-plugin/plugin.json` | `./agents/`, `./commands/`, `./skills/`, `./hooks/hooks.json` |
| Rules-capable agents plugin host | `.agents-plugin/plugin.json` | `./agents/`, `./commands/`, `./skills/`, `./scripts/`, `./rules/` |
| Antigravity / Gemini | `gemini-extension.json` | `./agents/`, `./commands/`, `./skills/`, `./scripts/`, `./hooks/hooks.json` |

Claude Code and Codex activate Budzie through their native `SessionStart`
plugin hooks. The agents adapter uses the
[Open Plugin rules component](https://github.com/vercel-labs/open-plugin-spec#d3-rules):
`rules/budzie.mdc` sets `alwaysApply: true`, so rules-capable hosts inject the
activation instruction from the first message. This does not claim that every
skill-only agent host supports `.mdc` rules.

## Install

`budzie-install` detects the agent hosts on your machine via a data-driven
matrix (CLI probes, config-directory probes, editor extension dirs, and macOS
app bundles) and installs the right adapter format into each host's config dir.

```sh
budzie-install --dry-run     # print the full plan, write nothing
budzie-install               # install for every detected host
budzie-install --host cursor # target one host by id
budzie-install --uninstall   # remove only Budzie-managed files
budzie-install --force       # overwrite existing managed files
```

Each install dir gets a `.budzie-manifest.json` recording exactly which files
Budzie owns. Uninstall reads that manifest and removes only those entries, so
anything you authored is left untouched. Re-runs are idempotent.

## Marker

Use `budzie:` comments for intentional shortcuts:

```js
// budzie: native date input, upgrade to date-picker only when range selection ships
```

Budzie reads those markers into Receipts. No backend. No telemetry.
