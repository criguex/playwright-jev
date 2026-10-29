# playwright-jev — Plan

Semantic assertions for Playwright Test, powered by Jev (TypeSafe AI).

```ts
await expect(page.getByRole('alert')).toMean('the payment was confirmed');
await expect(summary).toMeanAll(['shows the total', 'offers a way to cancel']);
await expect.soft(page).not.toMean('an error happened');
```

## 1. Why this library exists

Locator assertions answer "is this exact string on screen?". Acceptance criteria ask
"does the screen tell the user X?". Copy edits, translations and A/B tests break the
first while the second still holds. Jev answers the second kind of question with a
calibrated probability instead of prose, in a few hundred milliseconds, for a fraction
of a cent. That makes it usable as an assertion oracle, provided the library is honest
about uncertainty and about when it could not verify anything.

### Landscape (checked 2026-09-26)

| Project | What it is | Gap this library fills |
| --- | --- | --- |
| `pytest-jev` (Python) | pytest fixtures/assertions over Jev | Not usable from Playwright/TS |
| `jevtest` (npm) | Vitest/Jest matchers (`toSatisfy`) with cache and replay | No Playwright: no locators, no web-first retry, no Playwright reporter/annotations, no choice/score matchers |
| `jev-playwright` (npm) | Selects which Playwright tests to run for a diff | Test selection, not assertions |
| `playjev`, `jev-browser`, `jev-voice-browser` | Browser automation agents driven by Jev | Automation, not assertions |

Differentiators: Playwright-native receivers (`Locator`, `Page`, strings, JSON), web-first
retry that only re-asks Jev when the text changes, three-valued verdicts with an explicit
ambiguity band, `choice` and `score` matchers, per-test evidence attachments and a
reporter, and a fail-closed policy for anything that could not be verified.

## 2. Scope

In scope (v0.1):

- Matchers: `toMean`, `toMeanAll`, `toMeanAny`, `toBeScored`, `toChoose`, all working with
  `.not` and `expect.soft`.
- Receivers: `string`, `Locator`, `Page`, `APIResponse`-like JSON / plain objects / arrays.
- Thresholds: global and per-assertion; ambiguity band between the yes and no thresholds.
- Policies: `onAmbiguous: 'fail' | 'annotate'`, `onUnverified: 'fail' | 'skip'`, default
  `fail` for both. A semantic assertion that could not be verified never passes silently.
- Batching: concurrent assertions on the same state coalesce into one request; multi-claim
  matchers are one request; questions are chunked under a configurable cap.
- Caching by content hash (memory) and record/replay fixtures on disk.
- Transports: TypeSafe direct (`TYPESAFE_API_KEY`) and Vercel AI Gateway
  (`AI_GATEWAY_API_KEY`), response normalization, retries with backoff and `retry-after`,
  per-request timeout, error bodies logged (never the key).
- Redaction hook plus built-in redactors (emails, card numbers, long digit runs).
- Cost and latency tracking per assertion and per run.
- Reporter: console table + JSON/Markdown files with probability, confidence, verdict,
  source (live/cache/fixture), latency and cost.

Out of scope (v0.1): image/visual semantics (Jev is text only), publishing to npm
(workflow prepared, manual trigger), multi-language tuning.

## 3. Public API

```ts
import { expect, configureJev, redactors, createJevClient } from 'playwright-jev';
// reporter: ['playwright-jev/reporter', { outputFile: 'jev-report.json' }]
```

| Matcher | Jev primitive | Passes when |
| --- | --- | --- |
| `toMean(claim, opts?)` | noul | p ≥ threshold (`.not`: p ≤ 1 − threshold) |
| `toMeanAll(claims, opts?)` | noul × N, one request | every claim yes (Kleene AND) |
| `toMeanAny(claims, opts?)` | noul × N, one request | some claim yes (Kleene OR) |
| `toBeScored(rubric, { atLeast, atMost?, minConfidence? })` | score | score in range and confidence ≥ min |
| `toChoose(options, expected, { minConfidence? })` | choice | chosen ∈ expected and confidence ≥ min |

Verdicts are three-valued: `yes`, `no`, `ambiguous`, plus `unverified` when no answer
could be obtained. Only `yes` (or `no` under `.not`) passes.

Configuration precedence: per-assertion options > `configureJev()` > environment
(`JEV_MODE`, `JEV_THRESHOLD`, `JEV_MODEL`, `JEV_FIXTURES_DIR`, `JEV_ON_UNVERIFIED`,
`JEV_ON_AMBIGUOUS`, `JEV_BASE_URL`) > defaults.

## 4. Architecture

```
matchers.ts ──> target.ts (receiver → text/JSON, web-first polling)
     │
     ├──> questions.ts (claim → Jev question, structured instructions)
     ├──> engine.ts ──> store.ts (memory cache + fixture files, sha256 keys)
     │        └──> batcher.ts (coalesce by state, chunk) ──> client.ts (HTTP, retries, normalize)
     ├──> verdict.ts (thresholds, Kleene logic)
     └──> evidence.ts (testInfo attachments + annotations) ──> reporter.ts
```

- One fixture file per question key (`sha256(model, redacted state, question)`), so
  parallel workers never contend on a shared file and batching composition does not
  change keys.
- Modes: `auto` (fixture → live → unverified), `live`, `record` (live + write fixture),
  `replay` (fixture only, else unverified), `off` (always unverified).
- State sent to Jev is always `{ content, context? }` and the claim travels inside
  structured `instructions`, so page text never becomes part of the instruction text.

## 5. Phases

1. Scaffold: tooling, PLAN, GOAL, ADRs.
2. Core: client, normalization, retries, store, batcher, engine (unit tests with mock server).
3. Matchers + verdicts + evidence (unit tests with fake receivers).
4. Reporter (unit tests).
5. Integration: Playwright suite against a local example page and a local mock Jev server.
6. Examples recorded against live Jev, committed fixtures, replayed offline in CI.
7. Docs: README (EN + ES), typedoc, CHANGELOG, CONTRIBUTING, LICENSE.
8. CI (lint, typecheck, unit+coverage, integration, examples, build, pack, docs) and a
   manual release workflow (not run).

## 6. Decisions

See `docs/adr/`:

- 0001 Three-valued verdicts and fail-closed policies
- 0002 Record/replay fixtures keyed per question
- 0003 Batching model: coalesce by state, never merge states
- 0004 Two transports and response normalization
- 0005 Structured instructions to limit prompt injection from page text
