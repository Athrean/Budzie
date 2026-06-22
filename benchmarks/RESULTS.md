# Budzie savings benchmark

Real, reproducible savings: how much less code and spend the Budzie arm produces versus a generic terse prompt and an unguided baseline.

## Headline delta (budzie - terse)

The honest delta isolates budget discipline from generic brevity. Negative = Budzie spent less. Each value is the median of 10 runs.

| task | model | Δ code_lines | Δ output_tokens | Δ cost_usd | budzie pass | terse pass |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| csv-sum | anthropic/claude-haiku-4.5 | -14.0 | -167.0 | +0.0001 | 1.00 | 1.00 |
| csv-sum | openai/gpt-4o-mini | -11.0 | -39.0 | +0.0001 | 0.90 | 1.00 |
| debounce | anthropic/claude-haiku-4.5 | -22.0 | -249.5 | -0.0003 | 1.00 | 1.00 |
| debounce | openai/gpt-4o-mini | -7.0 | -46.5 | +0.0001 | 1.00 | 1.00 |
| email-validator | anthropic/claude-haiku-4.5 | -28.0 | -248.0 | -0.0003 | 0.50 | 0.00 |
| email-validator | openai/gpt-4o-mini | -3.0 | -59.5 | +0.0001 | 1.00 | 1.00 |
| rate-limiter | anthropic/claude-haiku-4.5 | -17.5 | -192.0 | -0.0000 | 0.90 | 0.80 |
| rate-limiter | openai/gpt-4o-mini | -3.5 | +12.5 | +0.0001 | 1.00 | 0.80 |
| retry-with-backoff | anthropic/claude-haiku-4.5 | -21.0 | -243.5 | -0.0003 | 1.00 | 1.00 |
| retry-with-backoff | openai/gpt-4o-mini | -8.0 | -34.5 | +0.0001 | 0.00 | 0.50 |
| slugify | anthropic/claude-haiku-4.5 | -5.5 | -148.5 | +0.0002 | 0.50 | 1.00 |
| slugify | openai/gpt-4o-mini | -1.0 | -31.0 | +0.0001 | 1.00 | 0.90 |

## Per-arm medians

| task | model | arm | code_lines | output_tokens | cost_usd | latency_ms | pass | n |
| --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| csv-sum | anthropic/claude-haiku-4.5 | baseline | 54 | 756 | 0.0038 | 4856 | 1.00 | 10 |
| csv-sum | anthropic/claude-haiku-4.5 | terse | 24 | 379 | 0.0019 | 2869 | 1.00 | 10 |
| csv-sum | anthropic/claude-haiku-4.5 | budzie | 10 | 212 | 0.0020 | 2468 | 1.00 | 10 |
| csv-sum | openai/gpt-4o-mini | baseline | 33 | 525 | 0.0003 | 6664 | 1.00 | 10 |
| csv-sum | openai/gpt-4o-mini | terse | 21 | 232 | 0.0001 | 3038 | 1.00 | 10 |
| csv-sum | openai/gpt-4o-mini | budzie | 10 | 193 | 0.0002 | 3070 | 0.90 | 10 |
| debounce | anthropic/claude-haiku-4.5 | baseline | 92 | 998 | 0.0050 | 5848 | 1.00 | 10 |
| debounce | anthropic/claude-haiku-4.5 | terse | 31 | 404 | 0.0021 | 3328 | 1.00 | 10 |
| debounce | anthropic/claude-haiku-4.5 | budzie | 9 | 155 | 0.0018 | 2439 | 1.00 | 10 |
| debounce | openai/gpt-4o-mini | baseline | 22 | 442 | 0.0003 | 7186 | 1.00 | 10 |
| debounce | openai/gpt-4o-mini | terse | 15 | 155 | 0.0001 | 3079 | 1.00 | 10 |
| debounce | openai/gpt-4o-mini | budzie | 8 | 109 | 0.0002 | 2350 | 1.00 | 10 |
| email-validator | anthropic/claude-haiku-4.5 | baseline | 44 | 568 | 0.0029 | 3996 | 0.20 | 10 |
| email-validator | anthropic/claude-haiku-4.5 | terse | 34 | 419 | 0.0022 | 3477 | 0.00 | 10 |
| email-validator | anthropic/claude-haiku-4.5 | budzie | 6 | 171 | 0.0018 | 2460 | 0.50 | 10 |
| email-validator | openai/gpt-4o-mini | baseline | 16 | 398 | 0.0002 | 6439 | 0.90 | 10 |
| email-validator | openai/gpt-4o-mini | terse | 7 | 106 | 0.0001 | 2184 | 1.00 | 10 |
| email-validator | openai/gpt-4o-mini | budzie | 4 | 46 | 0.0002 | 1808 | 1.00 | 10 |
| rate-limiter | anthropic/claude-haiku-4.5 | baseline | 43 | 674 | 0.0034 | 5289 | 1.00 | 10 |
| rate-limiter | anthropic/claude-haiku-4.5 | terse | 33 | 421 | 0.0022 | 3763 | 0.80 | 10 |
| rate-limiter | anthropic/claude-haiku-4.5 | budzie | 15 | 229 | 0.0022 | 3148 | 0.90 | 10 |
| rate-limiter | openai/gpt-4o-mini | baseline | 25 | 476 | 0.0003 | 4875 | 0.50 | 10 |
| rate-limiter | openai/gpt-4o-mini | terse | 21 | 210 | 0.0001 | 3096 | 0.80 | 10 |
| rate-limiter | openai/gpt-4o-mini | budzie | 17 | 223 | 0.0003 | 3411 | 1.00 | 10 |
| retry-with-backoff | anthropic/claude-haiku-4.5 | baseline | 72 | 944 | 0.0048 | 6296 | 1.00 | 10 |
| retry-with-backoff | anthropic/claude-haiku-4.5 | terse | 43 | 554 | 0.0029 | 4285 | 1.00 | 10 |
| retry-with-backoff | anthropic/claude-haiku-4.5 | budzie | 22 | 310 | 0.0026 | 3501 | 1.00 | 10 |
| retry-with-backoff | openai/gpt-4o-mini | baseline | 33 | 509 | 0.0003 | 6670 | 0.50 | 10 |
| retry-with-backoff | openai/gpt-4o-mini | terse | 19 | 202 | 0.0001 | 3138 | 0.50 | 10 |
| retry-with-backoff | openai/gpt-4o-mini | budzie | 11 | 168 | 0.0002 | 3044 | 0.00 | 10 |
| slugify | anthropic/claude-haiku-4.5 | baseline | 19 | 427 | 0.0022 | 3257 | 0.90 | 10 |
| slugify | anthropic/claude-haiku-4.5 | terse | 13 | 258 | 0.0013 | 2200 | 1.00 | 10 |
| slugify | anthropic/claude-haiku-4.5 | budzie | 7 | 109 | 0.0015 | 1897 | 0.50 | 10 |
| slugify | openai/gpt-4o-mini | baseline | 13 | 362 | 0.0002 | 3889 | 1.00 | 10 |
| slugify | openai/gpt-4o-mini | terse | 9 | 150 | 0.0001 | 2349 | 0.90 | 10 |
| slugify | openai/gpt-4o-mini | budzie | 8 | 119 | 0.0002 | 1971 | 1.00 | 10 |

## Disclosure

- Snapshot: `2026-06-22` (schema_version 1)
- Token source: API usage field (exact)
- Cost source: committed RATES table (model -> $/Mtok input+output)
- Models: openai/gpt-4o-mini, anthropic/claude-haiku-4.5
