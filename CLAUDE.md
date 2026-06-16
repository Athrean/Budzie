# CLAUDE.md

Budzie repo rules. Follow these before local defaults.

## Product

Budzie is a public agent plugin for budget-constrained developers.

One-liner: **Code less. Spend less. Watch the meter.**

Budzie makes agent savings visible, enforces a budget ceiling, and turns safe
deletion into measured recurring savings.

Core powers:

- **Receipts**: local report of lines avoided, deps avoided, shortcut markers,
  and optional token or dollar estimates. Real local counts first. Estimates must
  be labelled.
- **Reaper**: audit existing bloat, plan safe cuts, apply one cut per worktree,
  verify with project tests, keep green cuts, discard red cuts, report savings.
- **Budget guard**: warn or stop when estimated task spend exceeds the configured
  allowance.

Everything user-facing is named Budzie: package, plugin, commands, skills,
markers, README, and examples.

## Local-Only Material

Private source material exists on this machine but must never enter commits,
remote history, PR titles, PR bodies, or commit messages.

Rules:

- Do not stage paths matched by `.git/info/exclude`.
- Do not write private source names into tracked files.
- Do not compare Budzie to private source projects in tracked files.
- Do not mention private source names in commits or PR text.

## Build Rules

- Use the smallest correct implementation: YAGNI, stdlib first, native platform
  first, existing dependency before new dependency, fewest files.
- Use terse communication unless user asks for full prose.
- Use installed skills when relevant. For public prose, run a de-slop pass before
  shipping.
- No telemetry, hosted backend, or phone-home unless the user explicitly asks.
- Local-first by default. Read-only by default. Writes must be opt-in when they
  affect a user's repo.
- Mark deliberate shortcuts with `budzie:` comments and name the ceiling plus
  upgrade trigger.
- Never simplify away security, trust-boundary validation, data-loss handling,
  accessibility basics, or explicit user requirements.
- Runtime code is JavaScript annotated with JSDoc and a `// @ts-check` header.
  Type-checking runs as `tsc --noEmit` from dev-only dependencies. No build step,
  no `dist/`, no shipped TypeScript.

## Git Workflow

- Do not work on `main` directly after first repo bootstrap.
- Use small branches, small commits, and PRs.
- Open an issue once scope is known and the refs exist; one issue per unit of work.
- Every PR has a clear description and tags `Closes #<issue>` so the issue closes
  automatically on merge.
- Every PR contains at least 3–5 atomic commits.
- Never bypass hooks with `--no-verify`.
- Never force push, hard reset, clean, or delete branches unless the user
  explicitly asks and confirms.
- Never mention AI, Claude, Codex, or assistants in commit messages, PR titles,
  or PR bodies.

## Public Repo Gate

Budzie uses a strict contribution gate:

- New issues auto-close unless the author is approved for `issue` or `pr`.
- New PRs auto-close unless the author is a collaborator or approved for `pr`.
- Maintainers approve contributors by replying `lgtmi` or `lgtm` on an issue.

Keep `.github/APPROVED_CONTRIBUTORS` small and intentional.
