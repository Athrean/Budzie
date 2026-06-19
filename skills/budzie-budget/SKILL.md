---
name: budzie-budget
description: >
  Budget guard for local work. Compares a supplied estimate with a user ceiling,
  then returns ok, warn, or stop. Use for /budzie-budget, allowance, spend
  ceiling, token budget, or dollar budget.
---

# Budzie Budget Guard

Guard the user's allowance with local data.

## Commands

- Read status: `node src/budget.mjs status`.
- Write config: `node src/budget.mjs set --ceiling <n> --unit <unit>`.
- Check a task: `node src/budget.mjs check --estimate <n>`.
- Check from a local session log: `node src/budget.mjs check --session <path>`.
- Session usage receipt: `node src/session.mjs report --session <path>`.

`status`, `check`, and `session report` are read-only. `set` writes
`.budzie/budget.json`.

## Session usage

`node src/session.mjs report --session <path>` reads a LOCAL session or
transcript log (JSON or JSONL) and prints a usage receipt: real counted turns
and token fields when present.

- Real counted token fields lead; they are not labelled as estimates.
- `--json` emits the parsed summary; `tokensSource` is `counted`, `estimate`,
  or `missing`.
- `--estimate` opts into a char/token fallback when the log has no token
  fields; the figure is labelled `ESTIMATE (session log)`.
- When usage data is missing, the receipt says so and never invents a number.
- No network, ever. Local file read only.

`node src/budget.mjs check --session <path>` feeds the session log's total
token usage into the same warn/stop check. Missing usage reports
`estimated: unknown` rather than fabricating a stop.

## Config

Local config lives at `.budzie/budget.json`:

```json
{
  "ceiling": 1000,
  "unit": "tokens",
  "warnAt": 0.8,
  "mode": "warn"
}
```

Environment overrides layer over the file:

- `BUDZIE_BUDGET_CEILING`
- `BUDZIE_BUDGET_UNIT`
- `BUDZIE_BUDGET_WARN_AT`
- `BUDZIE_BUDGET_MODE`

## Rules

- Use real usage or estimate input when available.
- If estimate input is missing, report `estimated: unknown`.
- Return `warn` when the estimate reaches `warnAt * ceiling`.
- Return `stop` when the estimate exceeds the ceiling and mode is `stop`.
- No telemetry. No remote accounting.

Output:

```text
budget: <ceiling>
estimated: <cost or unknown>
status: ok | warn | stop
reason: <one line>
```
