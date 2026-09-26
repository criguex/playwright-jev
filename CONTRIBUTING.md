# Contributing

Thanks for helping. This project is small on purpose; please keep changes focused.

## Setup

```sh
npm ci
npx playwright install chromium
```

No Jev key is needed for development. Unit tests use a local mock server, the
integration suite starts the same mock in Playwright's global setup, and the examples
replay committed fixtures.

## Checks

```sh
npm run verify        # typecheck, lint, unit + coverage, build, integration, examples, docs, pack
```

Individually:

| Command | What it does |
| --- | --- |
| `npm run typecheck` | `tsc --noEmit` with strict settings |
| `npm run lint` | ESLint + Prettier check |
| `npm run test:coverage` | Vitest unit tests with coverage thresholds |
| `npm run test:integration` | Playwright against `tests/site` and the mock Jev server |
| `npm run test:examples` | Examples in replay mode (offline) |
| `npm run test:live` | Optional smoke test against the real API (needs a key in `.env`) |

## Re-recording example fixtures

```sh
cp .env.example .env   # add TYPESAFE_API_KEY or AI_GATEWAY_API_KEY
npm run build
npm run record:examples
```

Review the diff in `examples/.jev/fixtures` before committing: fixtures contain an
excerpt of the judged content. Never commit `.env`.

## Style

- TypeScript strict, ESM source, no default exports except the reporter.
- Public API gets TSDoc; avoid other comments unless the code cannot speak for itself.
- Tests before fixes: reproduce a bug with a failing test first.
- Commit messages: conventional prefix (`feat:`, `fix:`, `docs:`, `test:`, `chore:`).

## Design decisions

Architecture decisions live in `docs/adr`. If a change alters one of them, add a new ADR
instead of editing history.
