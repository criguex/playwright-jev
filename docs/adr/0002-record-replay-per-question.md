# ADR 0002: Record/replay fixtures keyed per question

Status: Accepted (2026-09-26)

## Context

CI should not need a key, should not spend money and must be deterministic. Jev's alias
`jev-latest` moves between releases, so live answers can drift.

## Decision

- Cache key = `sha256(model, redacted state, question)`, first 32 hex chars.
- One JSON file per key under `fixturesDir` (default `.jev/fixtures`). Each file keeps the
  question, a 500-char excerpt of the state, the answer, the model and a timestamp.
- Writes are atomic (temp file + rename) so parallel Playwright workers never corrupt
  each other and never contend on a shared file.
- Modes: `auto` (fixture, else live if a key exists, else unverified), `live`, `record`,
  `replay` (never touches the network), `off`.
- Keys are per question, not per request, so how assertions happen to be batched does not
  change which fixture is used.
- While polling a `Locator`, a missing fixture keeps the poll going (the content may still
  change into a recorded state) instead of failing immediately.

## Consequences

- Changing copy on the page changes the state hash, so the fixture is missing and the
  assertion is unverified in replay: re-record intentionally. This is a feature: a replay
  can never approve content that was not judged.
- Fixtures contain page excerpts; redaction runs before hashing, so redacted PII never
  reaches fixture files either.
