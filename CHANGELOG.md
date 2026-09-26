# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[Semantic Versioning](https://semver.org/).

## [Unreleased]

## [0.1.0] - 2026-09-26

### Added

- Semantic matchers for Playwright Test: `toMean`, `toMeanAll`, `toMeanAny`,
  `toBeScored`, `toChoose`, with `.not` and `expect.soft` support.
- Receivers: `Locator` and `Page` (web-first polling that only re-asks Jev when the
  text changes), strings, API responses and JSON values.
- Three-valued verdicts with an ambiguity band; `onAmbiguous` (`fail` | `annotate`)
  and `onUnverified` (`fail` | `skip`) policies, both failing by default.
- Batching of concurrent assertions on the same content into one request, dedupe of
  identical questions, chunking under `maxQuestionsPerRequest`.
- In-memory cache by content hash and record/replay fixtures (`JEV_MODE`).
- TypeSafe direct and Vercel AI Gateway transports with response normalization,
  retries with backoff and `retry-after`, per-request timeout and key-scrubbed error bodies.
- Redaction hook with built-in redactors for e-mails, card numbers and digit runs.
- Cost and latency tracking; evidence attached to every test as JSON and annotations.
- `playwright-jev/reporter` with a console table and JSON/Markdown output.
- Low-level `createJevClient` and `decide` APIs.

[Unreleased]: https://github.com/criguex/playwright-jev/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/criguex/playwright-jev/releases/tag/v0.1.0
