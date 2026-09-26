# ADR 0003: Batching model: coalesce by state, never merge states

Status: Accepted (2026-09-26)

## Context

Jev ingests the `state` once and evaluates every question against it in parallel, so N
questions about the same content cost roughly one request. Rate limits are per request
(the gateway allowed 5 requests per minute on a fresh account while this was written).

## Decision

- Multi-claim matchers (`toMeanAll`, `toMeanAny`) always send one request.
- Independent assertions are queued for `batchWindowMs` (20 ms). Questions whose redacted
  state and model are identical are sent together; identical questions are deduplicated;
  requests over `maxQuestionsPerRequest` (32) are chunked.
- Different states are never merged into one synthetic state. Doing so would change what
  the model sees and would make answers depend on unrelated assertions.
- In-flight requests for the same key are shared.

## Consequences

- `await` in sequence costs one request per distinct content. To batch, run assertions
  concurrently (`Promise.all` with `expect.soft`) or use `toMeanAll`.
- Batching adds at most 20 ms per request.
