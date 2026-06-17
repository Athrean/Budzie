# Budzie savings benchmark

Real, reproducible savings: how much less code and spend the Budzie arm produces versus a generic terse prompt and an unguided baseline.

## Headline delta (budzie - terse)

The honest delta isolates budget discipline from generic brevity. Negative = Budzie spent less. Each value is the median of 10 runs.

| task | model | Δ code_lines | Δ output_tokens | Δ cost_usd | budzie pass | terse pass |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| csv-sum | openai/gpt-3.5-turbo | +1.5 | +17.5 | +0.0002 | 0.40 | 0.20 |
| csv-sum | openai/gpt-4 | +9.5 | +341.5 | +0.0280 | 0.90 | 0.00 |
| debounce | openai/gpt-3.5-turbo | -0.5000 | -6.0 | +0.0001 | 0.00 | 0.10 |
| debounce | openai/gpt-4 | +5.0 | +215.0 | +0.0204 | 0.70 | 0.10 |
| email-validator | openai/gpt-3.5-turbo | 0.0000 | +7.5 | +0.0001 | 0.10 | 0.00 |
| email-validator | openai/gpt-4 | +2.0 | +218.0 | +0.0205 | 0.20 | 0.50 |
| rate-limiter | openai/gpt-3.5-turbo | +0.5000 | +9.0 | +0.0001 | 0.00 | 0.00 |
| rate-limiter | openai/gpt-4 | +4.0 | +192.0 | +0.0190 | 0.30 | 0.20 |
| retry-with-backoff | openai/gpt-3.5-turbo | 0.0000 | +83.5 | +0.0003 | 0.40 | 0.00 |
| retry-with-backoff | openai/gpt-4 | +12.5 | +333.5 | +0.0275 | 0.60 | 0.90 |
| slugify | openai/gpt-3.5-turbo | 0.0000 | 0.0000 | +0.0001 | 0.20 | 0.10 |
| slugify | openai/gpt-4 | +4.0 | +166.0 | +0.0174 | 0.70 | 0.30 |

## Per-arm medians

| task | model | arm | code_lines | output_tokens | cost_usd | latency_ms | pass | n |
| --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| csv-sum | openai/gpt-3.5-turbo | baseline | 23 | 247 | 0.0004 | 2300 | 0.00 | 10 |
| csv-sum | openai/gpt-3.5-turbo | terse | 13 | 107 | 0.0002 | 1489 | 0.20 | 10 |
| csv-sum | openai/gpt-3.5-turbo | budzie | 15 | 124 | 0.0003 | 1485 | 0.40 | 10 |
| csv-sum | openai/gpt-4 | baseline | 32 | 479 | 0.0302 | 5046 | 0.30 | 10 |
| csv-sum | openai/gpt-4 | terse | 14 | 116 | 0.0087 | 3420 | 0.00 | 10 |
| csv-sum | openai/gpt-4 | budzie | 23 | 458 | 0.0366 | 4104 | 0.90 | 10 |
| debounce | openai/gpt-3.5-turbo | baseline | 12 | 62 | 0.0001 | 1229 | 0.00 | 10 |
| debounce | openai/gpt-3.5-turbo | terse | 11 | 59 | 0.0001 | 984 | 0.10 | 10 |
| debounce | openai/gpt-3.5-turbo | budzie | 10 | 53 | 0.0002 | 1321 | 0.00 | 10 |
| debounce | openai/gpt-4 | baseline | 14 | 258 | 0.0170 | 6950 | 0.10 | 10 |
| debounce | openai/gpt-4 | terse | 8 | 63 | 0.0056 | 2178 | 0.10 | 10 |
| debounce | openai/gpt-4 | budzie | 13 | 278 | 0.0260 | 2775 | 0.70 | 10 |
| email-validator | openai/gpt-3.5-turbo | baseline | 6 | 91 | 0.0002 | 1864 | 0.00 | 10 |
| email-validator | openai/gpt-3.5-turbo | terse | 5 | 48 | 0.0001 | 1282 | 0.00 | 10 |
| email-validator | openai/gpt-3.5-turbo | budzie | 5 | 56 | 0.0002 | 1200 | 0.10 | 10 |
| email-validator | openai/gpt-4 | baseline | 10 | 333 | 0.0216 | 5165 | 0.10 | 10 |
| email-validator | openai/gpt-4 | terse | 6 | 69 | 0.0060 | 1933 | 0.50 | 10 |
| email-validator | openai/gpt-4 | budzie | 8 | 287 | 0.0265 | 3329 | 0.20 | 10 |
| rate-limiter | openai/gpt-3.5-turbo | baseline | 14 | 92 | 0.0002 | 1315 | 0.00 | 10 |
| rate-limiter | openai/gpt-3.5-turbo | terse | 13 | 87 | 0.0002 | 1210 | 0.00 | 10 |
| rate-limiter | openai/gpt-3.5-turbo | budzie | 14 | 96 | 0.0003 | 1286 | 0.00 | 10 |
| rate-limiter | openai/gpt-4 | baseline | 22 | 359 | 0.0236 | 6703 | 0.20 | 10 |
| rate-limiter | openai/gpt-4 | terse | 15 | 98 | 0.0082 | 1939 | 0.20 | 10 |
| rate-limiter | openai/gpt-4 | budzie | 19 | 290 | 0.0272 | 7583 | 0.30 | 10 |
| retry-with-backoff | openai/gpt-3.5-turbo | baseline | 26 | 247 | 0.0004 | 2618 | 0.00 | 10 |
| retry-with-backoff | openai/gpt-3.5-turbo | terse | 13 | 82 | 0.0002 | 1192 | 0.00 | 10 |
| retry-with-backoff | openai/gpt-3.5-turbo | budzie | 13 | 166 | 0.0004 | 1751 | 0.40 | 10 |
| retry-with-backoff | openai/gpt-4 | baseline | 21 | 360 | 0.0240 | 5486 | 0.30 | 10 |
| retry-with-backoff | openai/gpt-4 | terse | 11 | 98 | 0.0085 | 2736 | 0.90 | 10 |
| retry-with-backoff | openai/gpt-4 | budzie | 24 | 432 | 0.0359 | 4115 | 0.60 | 10 |
| slugify | openai/gpt-3.5-turbo | baseline | 4 | 48 | 0.0001 | 1243 | 0.00 | 10 |
| slugify | openai/gpt-3.5-turbo | terse | 4 | 47 | 0.0001 | 953 | 0.10 | 10 |
| slugify | openai/gpt-3.5-turbo | budzie | 4 | 47 | 0.0002 | 954 | 0.20 | 10 |
| slugify | openai/gpt-4 | baseline | 14 | 323 | 0.0209 | 5145 | 0.20 | 10 |
| slugify | openai/gpt-4 | terse | 4 | 64 | 0.0055 | 2154 | 0.30 | 10 |
| slugify | openai/gpt-4 | budzie | 8 | 230 | 0.0230 | 2908 | 0.70 | 10 |

## Disclosure

- Snapshot: `2026-06-17` (schema_version 1)
- Token source: API usage field (exact)
- Cost source: committed RATES table (model -> $/Mtok input+output)
- Models: openai/gpt-3.5-turbo, openai/gpt-4
