# GOAL — playwright-jev v0.1.0 is done when every check below passes

Each item is a command with an exact expected outcome. Run from the repo root with no
Jev key in the environment (`env -u TYPESAFE_API_KEY -u AI_GATEWAY_API_KEY`) unless
stated otherwise. The goal is met only when **all** items hold at the same commit.

## Local checks

| # | Check | Command | Must be true |
| - | ----- | ------- | ------------ |
| 1 | Clean install | `npm ci` | exit 0 |
| 2 | Types | `npm run typecheck` | exit 0, zero errors (`strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`) |
| 3 | Lint + format | `npm run lint` | exit 0, zero ESLint warnings or errors, Prettier reports all files formatted |
| 4 | Unit tests | `npm run test:coverage` | exit 0, 0 failed, ≥ 60 tests |
| 5 | Coverage on core | same run | lines ≥ 90 %, branches ≥ 80 %, functions ≥ 90 % on `src/**` (thresholds enforced in `vitest.config.ts`) |
| 6 | Build | `npm run build` | exit 0; `dist/index.js`, `dist/index.cjs`, `dist/index.d.ts`, `dist/index.d.cts`, `dist/reporter.js`, `dist/reporter.cjs` exist |
| 7 | ESM + CJS load | `node scripts/check-pack.mjs` | exit 0 (imports ESM and requires CJS entry points from the packed tarball, checks exported names) |
| 8 | Integration | `npm run test:integration` | exit 0; Playwright runs against the local example page and the local mock Jev server, 0 failed, 0 flaky |
| 9 | Examples offline | `npm run test:examples` | exit 0 with `JEV_MODE=replay` and no key; every semantic assertion is served from committed fixtures (reporter shows `source=fixture`, 0 `unverified`) |
| 10 | Docs | `npm run docs` | exit 0, `docs/api/index.html` exists, zero typedoc warnings |
| 11 | Pack | `npm pack --dry-run` | exit 0; tarball contains `dist/`, `README.md`, `LICENSE`, `CHANGELOG.md` and nothing from `src/`, `test/`, `.env` |
| 12 | No secrets | `git grep -E 'v[c]k_[A-Za-z0-9]{8,}' ; git log -p \| grep -cE 'v[c]k_[A-Za-z0-9]{8,}'` | no match; count 0 (a Vercel AI Gateway key never reaches git) |
| 13 | Fail-closed | unit test `unverified assertions fail by default` and integration test `fails when Jev is unreachable` | present and passing |
| 14 | Aggregate | `npm run verify` | exit 0 (runs 2–11) |

## Repository checks

| # | Check | Must be true |
| - | ----- | ------------ |
| 15 | Public repo | `https://github.com/criguex/playwright-jev` exists and is public |
| 16 | CI green | latest `CI` workflow run on `main` concluded `success` (`gh run list -R criguex/playwright-jev -w CI -L 1 --json conclusion`) |
| 17 | Release workflow | `.github/workflows/release.yml` exists, `workflow_dispatch` only, never ran |
| 18 | Files | `README.md` (English + Spanish section), `README.es.md`, `CHANGELOG.md`, `CONTRIBUTING.md`, `LICENSE` (MIT), `docs/PLAN.md`, `docs/adr/0001…0005` exist |
| 19 | README content | has sections: Why, Quick start, API, Record/replay, Configuration, Reporter, Honest limits, Comparison with LLM-as-judge, Español |
| 20 | Not published | `npm view playwright-jev` returns 404 (the maintainer decides when to publish) |

## Optional live check (needs a key, not part of CI)

| # | Check | Command | Must be true |
| - | ----- | ------- | ------------ |
| 21 | Live smoke | `npm run test:live` with `AI_GATEWAY_API_KEY` or `TYPESAFE_API_KEY` in `.env` | exit 0; real Jev answers a true claim ≥ 0.8 and a false claim ≤ 0.2 |
