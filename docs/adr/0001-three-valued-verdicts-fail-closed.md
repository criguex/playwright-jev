# ADR 0001: Three-valued verdicts and fail-closed policies

Status: Accepted (2026-09-26)

## Context

Jev returns a probability, not a boolean. Turning 0.55 into "pass" or "fail" with a
single cut-off hides the fact that the model is unsure. A test suite that turns
uncertainty into green is worse than no semantic check at all.

The same applies to infrastructure: no key, a 429 after retries, a timeout, a missing
fixture. A semantic assertion that could not be evaluated says nothing about the
product.

## Decision

- Every noul answer maps to `yes` (p ≥ threshold), `no` (p ≤ 1 − threshold) or
  `ambiguous`. Default threshold 0.8.
- Multi-claim matchers combine with Kleene logic: `toMeanAll` is AND, `toMeanAny` is OR.
  An ambiguous claim can only be ignored when another claim already decides the result.
- `toChoose` and `toBeScored` are ambiguous when `confidence < minConfidence` (0.5).
- `.not` requires a confident `no`. Ambiguity fails both `toMean` and `.not.toMean`.
- `onAmbiguous`: `fail` (default) or `annotate` (passes, adds a `jev:ambiguous`
  annotation, listed by the reporter, optional `failOnAmbiguous` at run level).
- `onUnverified`: `fail` (default) or `skip` (skips the test with a warning; optional
  `failOnUnverified` at run level). Nothing unverified ever passes.

## Consequences

- Flaky borderline answers show up as ambiguity instead of random red/green.
- Teams without a key get red tests by default, which is intended: record fixtures once
  or opt into `skip` explicitly.
