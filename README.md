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
| `/budzie-compress` | Compress one agent memory file with a `.bak` backup. |
| `/budzie-help` | Show quick reference. |

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

Claude Code and Codex activate Budzie through their native `SessionStart`
plugin hooks. The agents adapter uses the
[Open Plugin rules component](https://github.com/vercel-labs/open-plugin-spec#d3-rules):
`rules/budzie.mdc` sets `alwaysApply: true`, so rules-capable hosts inject the
activation instruction from the first message. This does not claim that every
skill-only agent host supports `.mdc` rules.

## Marker

Use `budzie:` comments for intentional shortcuts:

```js
// budzie: native date input, upgrade to date-picker only when range selection ships
```

Budzie reads those markers into Receipts. No backend. No telemetry.
