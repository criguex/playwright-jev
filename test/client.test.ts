import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  confidenceFrom,
  createJevClient,
  DIRECT_ENDPOINT,
  GATEWAY_ENDPOINT,
  JevError,
  normalizeAnswer,
  selectTransport,
} from '../src/client.js';
import { claimQuestion } from '../src/questions.js';
import { startMockJev, type MockJev } from './support/mock-jev.js';
import { cleanEnv } from './support/env.js';

let mock: MockJev;
beforeAll(async () => {
  mock = await startMockJev();
});
afterAll(() => mock.close());
beforeEach(() => {
  cleanEnv();
  mock.handler = undefined;
  mock.gatewayShape = false;
  mock.requests.length = 0;
});

const logs: string[] = [];
const client = (extra: Parameters<typeof createJevClient>[0] = {}) =>
  createJevClient({
    baseUrl: mock.url,
    apiKey: 'secret-key-123',
    maxRetryDelayMs: 20,
    logger: (m) => logs.push(m),
    ...extra,
  });

describe('selectTransport', () => {
  it('prefers baseUrl, then TypeSafe, then the gateway', () => {
    expect(selectTransport({ baseUrl: 'http://x', apiKey: undefined, gatewayApiKey: 'g' })).toEqual(
      { url: 'http://x', key: 'g', name: 'custom' },
    );
    expect(selectTransport({ baseUrl: undefined, apiKey: 'a', gatewayApiKey: 'g' })).toEqual({
      url: DIRECT_ENDPOINT,
      key: 'a',
      name: 'typesafe',
    });
    expect(selectTransport({ baseUrl: undefined, apiKey: undefined, gatewayApiKey: 'g' })).toEqual({
      url: GATEWAY_ENDPOINT,
      key: 'g',
      name: 'vercel-gateway',
    });
    expect(
      selectTransport({ baseUrl: undefined, apiKey: undefined, gatewayApiKey: undefined }),
    ).toBeUndefined();
    expect(
      selectTransport({ baseUrl: 'http://x', apiKey: undefined, gatewayApiKey: undefined })?.key,
    ).toBe('');
  });

  it('reads keys from the environment', () => {
    process.env.AI_GATEWAY_API_KEY = 'from-env';
    expect(createJevClient().transport?.name).toBe('vercel-gateway');
  });
});

describe('normalizeAnswer', () => {
  it('accepts native noul and gateway boolean shapes', () => {
    expect(normalizeAnswer({ type: 'noul', noul: 0.9 }, 'noul')).toEqual({
      type: 'noul',
      probability: 0.9,
    });
    expect(normalizeAnswer({ type: 'boolean', probability: 0.2 }, 'noul')).toEqual({
      type: 'noul',
      probability: 0.2,
    });
    expect(normalizeAnswer({ value: 0.4 }, 'noul')).toEqual({ type: 'noul', probability: 0.4 });
  });

  it('normalizes choice and derives missing fields', () => {
    expect(
      normalizeAnswer({ type: 'choice', probabilities: { a: 0.8, b: 0.2 } }, 'choice'),
    ).toEqual({
      type: 'choice',
      choice: 'a',
      probabilities: { a: 0.8, b: 0.2 },
      confidence: expect.closeTo(0.6, 5),
    });
  });

  it('normalizes score with legend and derives the score when absent', () => {
    const answer = normalizeAnswer(
      { type: 'score', probabilities: { '0': 0.5, '1': 0.5 }, legend: { '0': 'a', '1': 'b' } },
      'score',
    );
    expect(answer).toMatchObject({
      type: 'score',
      score: 0.5,
      legend: { '0': 'a', '1': 'b' },
      confidence: 0,
    });
    expect(
      normalizeAnswer(
        { type: 'score', score: 1.2, probabilities: { '0': 0, '1': 1 }, confidence: 0.9 },
        'score',
      ),
    ).toMatchObject({ score: 1.2, confidence: 0.9 });
  });

  it('rejects malformed answers', () => {
    expect(() => normalizeAnswer(null, 'noul')).toThrow(JevError);
    expect(() => normalizeAnswer({ type: 'noul', noul: 1.5 }, 'noul')).toThrow(/\[0, 1\]/);
    expect(() => normalizeAnswer({ type: 'choice', probabilities: 'x' }, 'choice')).toThrow(
      /object/,
    );
    expect(() => normalizeAnswer({ type: 'choice', probabilities: {} }, 'choice')).toThrow(/empty/);
    expect(() => normalizeAnswer({ type: 'weird' }, 'noul')).toThrow(/unknown type/);
  });
});

describe('confidenceFrom', () => {
  it('is 1 for a single option, 0 for uniform, scaled otherwise', () => {
    expect(confidenceFrom({ a: 1 })).toBe(1);
    expect(confidenceFrom({ a: 0.5, b: 0.5 })).toBe(0);
    expect(confidenceFrom({ a: 0.9, b: 0.06, c: 0.04 })).toBeCloseTo(0.85, 5);
  });
});

describe('createJevClient.ask', () => {
  it('sends model, state and questions with a bearer key and normalizes the reply', async () => {
    const res = await client({ model: 'jev-1.13.0' }).ask(
      { content: 'payment confirmed' },
      { a: claimQuestion('payment confirmed') },
    );
    expect(mock.requests[0]?.headers.authorization).toBe('Bearer secret-key-123');
    expect(mock.requests[0]?.body.model).toBe('jev-1.13.0');
    expect(res.answers.a).toEqual({ type: 'noul', probability: 0.96 });
    expect(res.usage).toEqual({ inputTokens: 300, outputTokens: 20 });
    expect(res.transport).toBe('custom');
    expect(res.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it('normalizes the gateway shape', async () => {
    mock.gatewayShape = true;
    const res = await client().ask(
      { content: 'payment confirmed' },
      { a: claimQuestion('payment confirmed') },
    );
    expect(res.answers.a).toEqual({ type: 'noul', probability: 0.96 });
  });

  it('omits the authorization header without a key', async () => {
    await createJevClient({ baseUrl: mock.url }).ask('x', { a: claimQuestion('x') });
    expect(mock.requests[0]?.headers.authorization).toBeUndefined();
  });

  it('retries retryable statuses and honours retry-after', async () => {
    mock.handler = (_req, i) =>
      i === 0
        ? { status: 429, body: { error: 'slow down' }, headers: { 'retry-after': '0' } }
        : i === 1
          ? { status: 529, raw: 'overloaded' }
          : undefined;
    const res = await client().ask('ok', { a: claimQuestion('ok') });
    expect(mock.requests).toHaveLength(3);
    expect(res.answers.a?.type).toBe('noul');
  });

  it('gives up after maxRetries and keeps the status and body', async () => {
    mock.handler = () => ({ status: 503, body: { error: 'down' } });
    const error = await client({ maxRetries: 1 })
      .ask('x', { a: claimQuestion('x') })
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(JevError);
    expect((error as JevError).status).toBe(503);
    expect((error as JevError).body).toContain('down');
    expect(mock.requests).toHaveLength(2);
  });

  it('does not retry 422 and scrubs the key from logged bodies', async () => {
    logs.length = 0;
    mock.handler = () => ({
      status: 422,
      body: { detail: 'bad question', echo: 'secret-key-123' },
    });
    const error = (await client()
      .ask('x', { a: claimQuestion('x') })
      .catch((e: unknown) => e)) as JevError;
    expect(mock.requests).toHaveLength(1);
    expect(error.message).toContain('422');
    expect(error.message).toContain('bad question');
    expect(error.message).not.toContain('secret-key-123');
    expect(logs.join('\n')).toContain('[redacted-key]');
  });

  it('parses retry-after given as an HTTP date', async () => {
    mock.handler = (_req, i) =>
      i === 0
        ? {
            status: 429,
            raw: '',
            headers: { 'retry-after': new Date(Date.now() - 1000).toUTCString() },
          }
        : undefined;
    const res = await client().ask('x', { a: claimQuestion('x') });
    expect(res.answers.a).toBeDefined();
  });

  it('times out slow requests', async () => {
    mock.handler = () => ({ delayMs: 500 });
    const error = (await client({ requestTimeoutMs: 100 })
      .ask('x', { a: claimQuestion('x') })
      .catch((e: unknown) => e)) as JevError;
    expect(error.message).toMatch(/timed out/);
  });

  it('stops retrying when the backoff would exceed the deadline', async () => {
    mock.handler = () => ({ status: 500, raw: '', headers: { 'retry-after': '5' } });
    const error = (await client({ requestTimeoutMs: 300, maxRetryDelayMs: 5000 })
      .ask('x', { a: claimQuestion('x') })
      .catch((e: unknown) => e)) as JevError;
    expect(error.status).toBe(500);
    expect(error.message).toContain('no body');
    expect(mock.requests).toHaveLength(1);
  });

  it('reports non-JSON bodies and missing answers', async () => {
    mock.handler = () => ({ status: 200, raw: '<html>' });
    await expect(client().ask('x', { a: claimQuestion('x') })).rejects.toThrow(/non-JSON/);
    mock.handler = () => ({ body: { model: 'm', answers: {} } });
    await expect(client().ask('x', { a: claimQuestion('x') })).rejects.toThrow(/no answer for "a"/);
    mock.handler = () => ({ body: { nope: true } });
    await expect(client().ask('x', { a: claimQuestion('x') })).rejects.toThrow(/missing answers/);
  });

  it('defaults model and usage when the payload omits them', async () => {
    mock.handler = () => ({ body: { answers: { a: { type: 'noul', noul: 0.5 } } } });
    const res = await client().ask('x', { a: claimQuestion('x') });
    expect(res.model).toBe('unknown');
    expect(res.usage).toEqual({ inputTokens: 0, outputTokens: 0 });
  });

  it('wraps network errors as retryable and eventually fails', async () => {
    const dead = createJevClient({
      baseUrl: 'http://127.0.0.1:9/v1/systemone',
      apiKey: 'k',
      maxRetries: 1,
      maxRetryDelayMs: 10,
      logger: () => {},
    });
    await expect(dead.ask('x', { a: claimQuestion('x') })).rejects.toThrow(/unreachable/);
  });

  it('throws when no key is configured', async () => {
    await expect(
      createJevClient({ logger: () => {} }).ask('x', { a: claimQuestion('x') }),
    ).rejects.toThrow(/No Jev key/);
  });
});
