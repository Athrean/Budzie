---
name: budzie-budget
description: >
  Budget guard for agent work. Estimates spend, compares it with a user ceiling,
  and warns or stops when a task would exceed allowance. Use for /budzie-budget,
  allowance, spend ceiling, token budget, or dollar budget.
---

# Budzie Budget Guard

Protect the user's allowance.

## Rules

- Use real local usage data when available.
- If usage data is missing, say what is missing. Do not invent precision.
- Warn before a task likely exceeds the ceiling.
- Stop when the user asks for hard budget enforcement.
- No telemetry. No remote accounting.

Output:

```text
budget: <ceiling>
estimated: <cost or unknown>
status: ok | warn | stop
reason: <one line>
```
