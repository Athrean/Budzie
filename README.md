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
| `/budzie-compress` | Compress one agent memory file in the same language with a `.bak` backup. |
| `/budzie-help` | Show quick reference. |

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
