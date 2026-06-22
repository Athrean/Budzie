# Budzie

**Code less. Spend less. Watch the meter.**

![Budzie demo](https://raw.githubusercontent.com/Athrean/Budzie/main/assets/demo.gif)

Budget-first agent plugin. It makes savings measurable on your repo, enforces a
spend ceiling, and turns safe deletion into verified, recurring savings.
Local-first, read-only by default, opt-in for any write. No telemetry, no
backend, no phone-home.

## What it does

- **Receipts + meter** — real local counts of lines and dependencies avoided,
  plus the real tokens the current session used, counted from the transcript.
- **Reaper** — audits bloat, then applies each cut in its own git worktree behind
  *your* test suite. Green cuts kept, red cuts discarded, your tree untouched
  until you approve.
- **Budget guard** — set a ceiling; tasks warn or hard-stop before they blow it.

Every shortcut Budzie takes is marked in code with a `budzie:` comment naming its
ceiling and upgrade trigger. Receipts count those markers. Real counts lead;
estimates are always labelled `ESTIMATE`.

## Install

Claude Code:

```
/plugin marketplace add Athrean/Budzie
/plugin install budzie@budzie
```

Codex:

```sh
codex plugin marketplace add Athrean/Budzie --ref main
codex plugin add budzie@budzie
```

Every other host (macOS / Linux):

```sh
curl -fsSL https://raw.githubusercontent.com/Athrean/Budzie/main/install.sh | bash
```

Windows PowerShell:

```powershell
irm https://raw.githubusercontent.com/Athrean/Budzie/main/install.ps1 | iex
```

`budzie-install` detects the agent hosts on your machine and installs the right
format into each. `--dry-run` prints the full plan and writes nothing;
`--uninstall` removes only Budzie-managed files (tracked per-dir in
`.budzie-manifest.json`); `--host <id>` targets one. Full host matrix below.

## Commands

| Command | What it does |
| --- | --- |
| `/budzie [low\|medium\|xhigh\|ultra]` | Activate Budzie mode; set compression intensity. |
| `/budzie-receipts` | Savings report, live session meter, and README badge. |
| `/budzie-reap` | Audit bloat; apply approved cuts test-gated, one per worktree. |
| `/budzie-budget` | Set or check the spend ceiling. |
| `/budzie-shrink` | Compress MCP tool descriptions through a stdio proxy. |
| `/budzie-compress` | Shrink one agent memory file in its own language; keeps a `.bak`. |
| `/budzie-help` | Quick reference. |

`/budzie-context` (read-only context-size receipts for memory files) activates on
its own when you ask about context size — no slash command needed.

## The crew

Budget-aware subagents. Hopper runs the operation; the rest are specialists it
dispatches, each handed only its scoped context and metered against its slice of
the ceiling. In `stop` mode the first stage to hit the ceiling halts the run.

| Agent | Role |
| --- | --- |
| `budzie:hopper` | Orchestrator — runs a metered pipeline, slices the budget, merges results. |
| `budzie:dustin` | Read-only recon — finds bloat, oversized context, budget risk. |
| `budzie:eleven` | Test-gated deletion — one cut per worktree, keep green, discard red. |
| `budzie:steve` | Smallest-correct build under a per-task ceiling. |
| `budzie:nancy` | Budget-aware review — spend, bloat, and receipt risks. |

## Reaper, end to end

```sh
node src/reap.mjs plan \
  | node src/reap.mjs verify --test "npm test" \
  | node src/reap.mjs receipt
# -42 lines, -1 deps, 3 cuts kept, 1 discarded
```

Each cut is applied in an isolated git worktree and verified against your own
test command. A failing test discards the cut; a passing one keeps it. Your
working tree is never touched and every worktree is removed. A green test gate is
necessary but never sufficient: Budzie never cuts a trust boundary, a data-loss
guard, or an accessibility basic, even when tests still pass.

## Watch the meter

```sh
node src/meter.mjs            # real counted tokens used this session
node src/meter.mjs --badge    # session 3.2k out / 18k in
```

Auto-discovers the live transcript. Counted figures only — if usage data is
missing it says so instead of inventing a number. Set
`BUDZIE_STATUSLINE_SESSION=1` to show the live session in the statusline.

## Compression

`/budzie` compresses prose at four intensity levels; code, identifiers, URLs,
paths, and quoted errors are never touched, and the dominant language is kept —
compression never translates the input. `/budzie-compress` does the same for a
memory file, keeping a `.bak`. Built-in filler rules cover English, plus
Spanish, Portuguese, and French. Reproduce the deterministic, zero-network
fixtures:

```sh
node benchmarks/multilingual-compression.mjs
```

Wrap a local stdio MCP server to compress its tool descriptions in flight:

```sh
budzie-shrink --upstream "node ./path/to/server.mjs"
```

Schemas and other protocol fields stay unchanged; the first catalog's byte
savings are written to stderr, stdout stays protocol-only.

## Marker

```js
// budzie: native date input; upgrade to a date-picker when range selection ships
```

`budzie:` comments mark deliberate shortcuts and name the upgrade trigger.
Receipts read them straight off the repo.

## Supported hosts

`budzie-install` auto-detects hosts via CLI probes, config directories, editor
extension dirs, and macOS app bundles, then installs one of: a **full plugin**
(native `SessionStart` hook), an **agents plugin**, a **rules file**
(`alwaysApply: true`), or the **skills tree**. `src/check-drift.mjs` fails if any
adapter drifts off the package version or references a surface that does not
exist.

<details>
<summary>Full host matrix (17)</summary>

| Host | Installs |
| --- | --- |
| Claude Code (CLI) | full plugin (`.claude-plugin/`) |
| Codex (CLI) | full plugin (`.codex-plugin/`) |
| Gemini (CLI) | agents plugin (`.agents-plugin/`) |
| Aider (CLI) | rules file (`rules/budzie.mdc`) |
| Qwen Code (CLI) | agents plugin (`.agents-plugin/`) |
| OpenCode (CLI) | agents plugin (`.agents-plugin/`) |
| Crush (CLI) | agents plugin (`.agents-plugin/`) |
| Cursor | rules file (`rules/budzie.mdc`) |
| Windsurf | rules file (`rules/budzie.mdc`) |
| Continue | agents plugin (`.agents-plugin/`) |
| Cline | rules file (`rules/budzie.mdc`) |
| Zed | skills tree (`skills/`) |
| VS Code | skills tree (`skills/`) |
| VS Code Insiders | skills tree (`skills/`) |
| Cursor (extensions) | skills tree (`skills/`) |
| Claude Desktop (macOS) | skills tree (`skills/`) |
| ChatGPT Desktop (macOS) | skills tree (`skills/`) |

A single-file bundle (`dist/budzie.skill`, regenerated with `npm run pack`)
covers hosts that take one instructions file.

</details>

## License

[MIT](LICENSE).
