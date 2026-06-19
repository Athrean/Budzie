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

`budzie-install` auto-detects the agent hosts on your machine via a data-driven
matrix — CLI probes (`command -v`), editor config directories, VS Code extension
directories, and macOS app bundles — and installs the right format into each one.
No host re-implements a command, skill, or script; every adapter is named
`budzie` and pins its version to the package version. `scripts/check-drift.mjs`
fails if an adapter drifts off that version, references a surface that does not
exist, loses its activation contract, or detects a host that is not listed here.

| Host | Detected via | Installs |
| --- | --- | --- |
| Claude Code (CLI) | `claude` on `PATH` | full plugin (`.claude-plugin/`) |
| Codex (CLI) | `codex` on `PATH` | full plugin (`.codex-plugin/`) |
| Gemini (CLI) | `gemini` on `PATH` | agents plugin (`.agents-plugin/`) |
| Aider (CLI) | `aider` on `PATH` | rules file (`rules/budzie.mdc`) |
| Qwen Code (CLI) | `qwen` on `PATH` | agents plugin (`.agents-plugin/`) |
| OpenCode (CLI) | `opencode` on `PATH` or `~/.config/opencode` | agents plugin (`.agents-plugin/`) |
| Crush (CLI) | `crush` on `PATH` or `~/.config/crush` | agents plugin (`.agents-plugin/`) |
| Cursor | `~/.cursor` | rules file (`rules/budzie.mdc`) |
| Windsurf | `~/.codeium/windsurf` | rules file (`rules/budzie.mdc`) |
| Continue | `~/.continue` | agents plugin (`.agents-plugin/`) |
| Cline | `~/.cline` | rules file (`rules/budzie.mdc`) |
| Zed | Zed config dir or app bundle | skills tree (`skills/`) |
| VS Code | `~/.vscode/extensions` | skills tree (`skills/`) |
| VS Code Insiders | `~/.vscode-insiders/extensions` | skills tree (`skills/`) |
| Cursor (extensions) | `~/.cursor/extensions` | skills tree (`skills/`) |
| Claude Desktop (macOS) | `/Applications/Claude.app` | skills tree (`skills/`) |
| ChatGPT Desktop (macOS) | `/Applications/ChatGPT.app` | skills tree (`skills/`) |

Each detected host installs one of these formats:

- **Full plugin** — Claude (`.claude-plugin/`), Codex (`.codex-plugin/`), or the
  generic agents manifest (`.agents-plugin/`), each activating through a native
  `SessionStart` hook.
- **Rules file** — a single `rules/budzie.mdc` that sets `alwaysApply: true`, so
  the activation instruction is injected from the first message.
- **Skills tree** — the `skills/` tree dropped into the host's config or
  extension directory.

Full plugins and the agents plugin use the
[Open Plugin rules component](https://github.com/vercel-labs/open-plugin-spec#d3-rules)
for activation where hooks are unavailable. The repo also ships native plugin
manifests (`.claude-plugin/`, `.codex-plugin/`, `.agents-plugin/`, `.opencode/`,
`gemini-extension.json`) so these hosts can load Budzie directly from a clone or
marketplace. Listing a host here does not claim it supports `.mdc` rules.

## Install

macOS / Linux:

```sh
curl -fsSL https://raw.githubusercontent.com/Athrean/Budzie/main/install.sh | bash
```

Windows PowerShell:

```powershell
irm https://raw.githubusercontent.com/Athrean/Budzie/main/install.ps1 | iex
```

The shell scripts check Node.js, then run the same `budzie-install` CLI used by
local clones. To inspect a remote install without writing:

```sh
curl -fsSL https://raw.githubusercontent.com/Athrean/Budzie/main/install.sh | bash -s -- --dry-run
```

`budzie-install` detects the agent hosts on your machine via a data-driven
matrix (CLI probes, config-directory probes, editor extension dirs, and macOS
app bundles) and installs the right adapter format into each host's config dir.

From a clone:

```sh
./install.sh --dry-run     # print the full plan, write nothing
./install.sh               # install for every detected host
./install.sh --host cursor # target one host by id
./install.sh --uninstall   # remove only Budzie-managed files
./install.sh --force       # overwrite existing managed files
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
