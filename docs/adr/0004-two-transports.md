# ADR 0004: Two transports and response normalization

Status: Accepted (2026-09-26)

## Context

Jev is served directly by TypeSafe (`api.typesafe.ai/v1/systemone`) and through the
Vercel AI Gateway (`ai-gateway.vercel.sh/typesafe/v1/systemone`). TypeSafe paused its own
signups shortly after launch; the gateway kept working. The gateway returns noul answers
as `{ type: 'boolean', probability }` instead of `{ type: 'noul', noul }`.

## Decision

- Transport priority: explicit `baseUrl`, then `TYPESAFE_API_KEY`, then
  `AI_GATEWAY_API_KEY`.
- Every answer passes through `normalizeAnswer`, which accepts both shapes, validates
  ranges and derives `choice`/`confidence` when missing.
- Retries on 408/425/429/5xx/529 and network errors, exponential backoff with jitter,
  `retry-after` honoured but capped by `maxRetryDelayMs`; one overall deadline
  (`requestTimeoutMs`) covers all attempts.
- Every failure is logged with the response body (truncated to 1200 chars) and the key
  scrubbed from it.

## Consequences

- Swapping vendor is an environment change.
- The official `@typesafe-ai/sdk` is not a dependency: the HTTP surface is small and the
  gateway shape needs custom handling anyway.
