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

- Read status: `node scripts/budget.mjs status`.
- Write config: `node scripts/budget.mjs set --ceiling <n> --unit <unit>`.
- Check a task: `node scripts/budget.mjs check --estimate <n>`.

`status` and `check` are read-only. `set` writes `.budzie/budget.json`.

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
