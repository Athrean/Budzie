# Budzie savings benchmark

Real, reproducible savings: how much less code and spend the Budzie arm produces versus a generic terse prompt and an unguided baseline.

## Headline delta (budzie - terse)

The honest delta isolates budget discipline from generic brevity. Negative = Budzie spent less. Each value is the median of 10 runs.

| task | model | Δ code_lines | Δ output_tokens | Δ cost_usd | budzie pass | terse pass |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| csv-sum | claude-haiku-4-5 | -3.5 | -42.5 | +0.0003 | 0.90 | 1.00 |
| csv-sum | claude-opus-4-8 | -2.5 | -59.0 | +0.0009 | 0.90 | 1.00 |
| csv-sum | claude-sonnet-4-6 | -4.0 | -44.0 | +0.0008 | 1.00 | 1.00 |
| debounce | claude-haiku-4-5 | -1.5 | -49.0 | +0.0002 | 1.00 | 1.00 |
| debounce | claude-opus-4-8 | -1.5 | -51.0 | +0.0011 | 0.90 | 0.90 |
| debounce | claude-sonnet-4-6 | -1.0 | -58.5 | +0.0005 | 1.00 | 0.90 |
| email-validator | claude-haiku-4-5 | -2.0 | -48.5 | +0.0002 | 1.00 | 1.00 |
| email-validator | claude-opus-4-8 | -1.0 | -49.5 | +0.0011 | 1.00 | 1.00 |
| email-validator | claude-sonnet-4-6 | -2.5 | -32.5 | +0.0009 | 1.00 | 1.00 |
| rate-limiter | claude-haiku-4-5 | -2.0 | -44.0 | +0.0003 | 1.00 | 1.00 |
| rate-limiter | claude-opus-4-8 | -3.0 | -33.0 | +0.0016 | 0.90 | 1.00 |
| rate-limiter | claude-sonnet-4-6 | -1.0 | -41.0 | +0.0008 | 1.00 | 0.90 |
| retry-with-backoff | claude-haiku-4-5 | -4.0 | -70.0 | +0.0001 | 0.90 | 1.00 |
| retry-with-backoff | claude-opus-4-8 | -2.5 | -40.5 | +0.0013 | 0.90 | 1.00 |
| retry-with-backoff | claude-sonnet-4-6 | -3.5 | -49.0 | +0.0007 | 1.00 | 1.00 |
| slugify | claude-haiku-4-5 | -2.5 | -37.0 | +0.0003 | 0.90 | 1.00 |
| slugify | claude-opus-4-8 | -1.5 | -51.5 | +0.0010 | 1.00 | 1.00 |
| slugify | claude-sonnet-4-6 | -1.0 | -73.0 | +0.0003 | 0.90 | 1.00 |

## Per-arm medians

| task | model | arm | code_lines | output_tokens | cost_usd | latency_ms | pass | n |
| --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| csv-sum | claude-haiku-4-5 | baseline | 16 | 324 | 0.0017 | 1428 | 0.90 | 10 |
| csv-sum | claude-haiku-4-5 | terse | 13 | 244 | 0.0013 | 1821 | 1.00 | 10 |
| csv-sum | claude-haiku-4-5 | budzie | 10 | 201 | 0.0015 | 1909 | 0.90 | 10 |
| csv-sum | claude-opus-4-8 | baseline | 17 | 291 | 0.0075 | 1290 | 1.00 | 10 |
| csv-sum | claude-opus-4-8 | terse | 12 | 237 | 0.0063 | 1744 | 1.00 | 10 |
| csv-sum | claude-opus-4-8 | budzie | 10 | 178 | 0.0071 | 2027 | 0.90 | 10 |
| csv-sum | claude-sonnet-4-6 | baseline | 16 | 350 | 0.0054 | 1381 | 0.80 | 10 |
| csv-sum | claude-sonnet-4-6 | terse | 14 | 277 | 0.0044 | 1720 | 1.00 | 10 |
| csv-sum | claude-sonnet-4-6 | budzie | 10 | 233 | 0.0051 | 1903 | 1.00 | 10 |
| debounce | claude-haiku-4-5 | baseline | 11 | 316 | 0.0016 | 1361 | 1.00 | 10 |
| debounce | claude-haiku-4-5 | terse | 8 | 242 | 0.0013 | 1694 | 1.00 | 10 |
| debounce | claude-haiku-4-5 | budzie | 7 | 193 | 0.0015 | 1917 | 1.00 | 10 |
| debounce | claude-opus-4-8 | baseline | 11 | 302 | 0.0078 | 1386 | 0.80 | 10 |
| debounce | claude-opus-4-8 | terse | 9 | 241 | 0.0063 | 1690 | 0.90 | 10 |
| debounce | claude-opus-4-8 | budzie | 7 | 190 | 0.0074 | 1947 | 0.90 | 10 |
| debounce | claude-sonnet-4-6 | baseline | 11 | 342 | 0.0053 | 1382 | 0.90 | 10 |
| debounce | claude-sonnet-4-6 | terse | 9 | 275 | 0.0043 | 1746 | 0.90 | 10 |
| debounce | claude-sonnet-4-6 | budzie | 8 | 216 | 0.0048 | 1894 | 1.00 | 10 |
| email-validator | claude-haiku-4-5 | baseline | 12 | 309 | 0.0016 | 1326 | 0.90 | 10 |
| email-validator | claude-haiku-4-5 | terse | 9 | 248 | 0.0013 | 1681 | 1.00 | 10 |
| email-validator | claude-haiku-4-5 | budzie | 7 | 200 | 0.0015 | 1876 | 1.00 | 10 |
| email-validator | claude-opus-4-8 | baseline | 12 | 289 | 0.0075 | 1374 | 0.80 | 10 |
| email-validator | claude-opus-4-8 | terse | 9 | 231 | 0.0061 | 1732 | 1.00 | 10 |
| email-validator | claude-opus-4-8 | budzie | 8 | 181 | 0.0072 | 1958 | 1.00 | 10 |
| email-validator | claude-sonnet-4-6 | baseline | 12 | 360 | 0.0056 | 1348 | 1.00 | 10 |
| email-validator | claude-sonnet-4-6 | terse | 9 | 272 | 0.0043 | 1809 | 1.00 | 10 |
| email-validator | claude-sonnet-4-6 | budzie | 7 | 240 | 0.0052 | 1893 | 1.00 | 10 |
| rate-limiter | claude-haiku-4-5 | baseline | 11 | 329 | 0.0017 | 1398 | 1.00 | 10 |
| rate-limiter | claude-haiku-4-5 | terse | 9 | 250 | 0.0013 | 1677 | 1.00 | 10 |
| rate-limiter | claude-haiku-4-5 | budzie | 7 | 206 | 0.0016 | 1918 | 1.00 | 10 |
| rate-limiter | claude-opus-4-8 | baseline | 11 | 297 | 0.0077 | 1346 | 1.00 | 10 |
| rate-limiter | claude-opus-4-8 | terse | 10 | 219 | 0.0058 | 1791 | 1.00 | 10 |
| rate-limiter | claude-opus-4-8 | budzie | 7 | 186 | 0.0074 | 1922 | 0.90 | 10 |
| rate-limiter | claude-sonnet-4-6 | baseline | 11 | 363 | 0.0056 | 1451 | 0.90 | 10 |
| rate-limiter | claude-sonnet-4-6 | terse | 9 | 278 | 0.0044 | 1770 | 0.90 | 10 |
| rate-limiter | claude-sonnet-4-6 | budzie | 8 | 237 | 0.0052 | 1987 | 1.00 | 10 |
| retry-with-backoff | claude-haiku-4-5 | baseline | 17 | 333 | 0.0017 | 1357 | 0.90 | 10 |
| retry-with-backoff | claude-haiku-4-5 | terse | 15 | 261 | 0.0014 | 1663 | 1.00 | 10 |
| retry-with-backoff | claude-haiku-4-5 | budzie | 11 | 191 | 0.0015 | 1909 | 0.90 | 10 |
| retry-with-backoff | claude-opus-4-8 | baseline | 18 | 302 | 0.0078 | 1407 | 0.90 | 10 |
| retry-with-backoff | claude-opus-4-8 | terse | 14 | 236 | 0.0063 | 1735 | 1.00 | 10 |
| retry-with-backoff | claude-opus-4-8 | budzie | 11 | 195 | 0.0076 | 1963 | 0.90 | 10 |
| retry-with-backoff | claude-sonnet-4-6 | baseline | 19 | 350 | 0.0054 | 1403 | 0.80 | 10 |
| retry-with-backoff | claude-sonnet-4-6 | terse | 14 | 281 | 0.0044 | 1735 | 1.00 | 10 |
| retry-with-backoff | claude-sonnet-4-6 | budzie | 11 | 232 | 0.0051 | 1864 | 1.00 | 10 |
| slugify | claude-haiku-4-5 | baseline | 11 | 308 | 0.0016 | 1402 | 0.90 | 10 |
| slugify | claude-haiku-4-5 | terse | 10 | 244 | 0.0013 | 1749 | 1.00 | 10 |
| slugify | claude-haiku-4-5 | budzie | 7 | 207 | 0.0016 | 1867 | 0.90 | 10 |
| slugify | claude-opus-4-8 | baseline | 12 | 300 | 0.0078 | 1379 | 1.00 | 10 |
| slugify | claude-opus-4-8 | terse | 9 | 240 | 0.0063 | 1679 | 1.00 | 10 |
| slugify | claude-opus-4-8 | budzie | 8 | 189 | 0.0074 | 1871 | 1.00 | 10 |
| slugify | claude-sonnet-4-6 | baseline | 11 | 357 | 0.0055 | 1495 | 0.80 | 10 |
| slugify | claude-sonnet-4-6 | terse | 9 | 295 | 0.0046 | 1749 | 1.00 | 10 |
| slugify | claude-sonnet-4-6 | budzie | 8 | 222 | 0.0050 | 1861 | 0.90 | 10 |

## Disclosure

- Snapshot: `2026-06-16` (schema_version 1)
- Token source: API usage field (exact) — values here are SYNTHETIC SEED, not real API output
- Cost source: committed RATES table (model -> $/Mtok input+output)
- Models: claude-haiku-4-5, claude-sonnet-4-6, claude-opus-4-8
- **SYNTHETIC SEED DATA**: these numbers are illustrative, not real model output. Run `node benchmarks/run.mjs` with an API key to produce a real snapshot.
