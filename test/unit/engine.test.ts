import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { resolveConfig } from '../../src/config.js';
import { decide, getJevStats } from '../../src/engine.js';
import { questionKey } from '../../src/hash.js';
import { claimQuestion } from '../../src/questions.js';
import { memoryCache, readFixture, writeFixture } from '../../src/store.js';
import { cleanEnv, tempDir } from '../support/env.js';
import { startMockJev, type MockJev } from '../support/mock-jev.js';

let mock: MockJev;
beforeAll(async () => {
  mock = await startMockJev();
});
afterAll(() => mock.close());
beforeEach(() => {
  cleanEnv();
  mock.handler = undefined;
  mock.requests.length = 0;
});

const cfg = (extra: Parameters<typeof resolveConfig>[0] = {}) =>
  resolveConfig({
    baseUrl: mock.url,
    apiKey: 'k',
    fixturesDir: tempDir(),
    logger: () => {},
    maxRetryDelayMs: 10,
    ...extra,
  });

const state = { content: 'Your payment was confirmed and the order shipped' };

describe('decide', () => {
  it('coalesces concurrent questions on the same state into one request', async () => {
    const config = cfg();
    const [a, b] = await Promise.all([
      decide(state, { x: claimQuestion('payment confirmed') }, config),
      decide(
        state,
        { y: claimQuestion('order shipped'), z: claimQuestion('refund issued') },
        config,
      ),
    ]);
    expect(mock.requests).toHaveLength(1);
    expect(Object.keys(mock.requests[0]!.body.questions)).toHaveLength(3);
    expect(a.x.answer).toEqual({ type: 'noul', probability: 0.96 });
    expect(b.z.answer).toEqual({ type: 'noul', probability: 0.03 });
    expect(a.x.source).toBe('live');
    expect(a.x.costUsd).toBeGreaterThan(0);
    expect(getJevStats()).toMatchObject({ requests: 1, questions: 3, inputTokens: 300 });
  });

  it('never merges different states', async () => {
    const config = cfg();
    await Promise.all([
      decide({ content: 'a' }, { x: claimQuestion('a') }, config),
      decide({ content: 'b' }, { x: claimQuestion('b') }, config),
    ]);
    expect(mock.requests).toHaveLength(2);
  });

  it('deduplicates identical questions and serves repeats from memory', async () => {
    const config = cfg();
    const first = await decide(
      state,
      { a: claimQuestion('payment confirmed'), b: claimQuestion('payment confirmed') },
      config,
    );
    expect(Object.keys(mock.requests[0]!.body.questions)).toHaveLength(1);
    expect(first.a.answer).toEqual(first.b.answer);
    const second = await decide(state, { a: claimQuestion('payment confirmed') }, config);
    expect(second.a.source).toBe('cache');
    expect(mock.requests).toHaveLength(1);
  });

  it('shares in-flight requests', async () => {
    const config = cfg({ batchWindowMs: 0 });
    const p1 = decide(state, { a: claimQuestion('payment confirmed') }, config);
    await new Promise((r) => setTimeout(r, 2));
    const p2 = decide(state, { a: claimQuestion('payment confirmed') }, config);
    await Promise.all([p1, p2]);
    expect(mock.requests).toHaveLength(1);
  });

  it('chunks questions above maxQuestionsPerRequest', async () => {
    const config = cfg({ maxQuestionsPerRequest: 2 });
    const questions = Object.fromEntries(
      ['a', 'b', 'c', 'd', 'e'].map((k) => [k, claimQuestion(`claim ${k}`)]),
    );
    const result = await decide(state, questions, config);
    expect(mock.requests).toHaveLength(3);
    expect(Object.values(result).every((d) => d.answer)).toBe(true);
  });

  it('returns unverified decisions when Jev fails', async () => {
    mock.handler = () => ({ status: 401, body: { error: 'bad key' } });
    const result = await decide(state, { a: claimQuestion('x') }, cfg());
    expect(result.a.answer).toBeUndefined();
    expect(result.a.unverifiedReason).toContain('401');
  });

  it('is unverified without key or fixture in auto mode', async () => {
    const result = await decide(
      state,
      { a: claimQuestion('x') },
      resolveConfig({ fixturesDir: tempDir() }),
    );
    expect(result.a.unverifiedReason).toMatch(/no Jev key/);
  });

  it('is unverified in off mode', async () => {
    const result = await decide(state, { a: claimQuestion('x') }, cfg({ mode: 'off' }));
    expect(result.a.unverifiedReason).toMatch(/off/);
    expect(mock.requests).toHaveLength(0);
  });

  it('records fixtures in record mode and replays them offline', async () => {
    const dir = tempDir();
    const question = claimQuestion('payment confirmed');
    await decide(state, { a: question }, cfg({ mode: 'record', fixturesDir: dir }));
    const key = questionKey('jev-latest', state, question);
    expect(existsSync(join(dir, `${key}.json`))).toBe(true);
    expect(readFixture(dir, key)?.stateExcerpt).toContain('payment');
    memoryCache.clear();
    const replayed = await decide(
      state,
      { a: question },
      resolveConfig({ mode: 'replay', fixturesDir: dir }),
    );
    expect(replayed.a.source).toBe('fixture');
    expect(replayed.a.answer).toEqual({ type: 'noul', probability: 0.96 });
    expect(mock.requests).toHaveLength(1);
  });

  it('prefers fixtures over live calls in auto mode', async () => {
    const dir = tempDir();
    const question = claimQuestion('anything');
    writeFixture(dir, questionKey('jev-latest', state, question), {
      model: 'jev-1.13.0',
      question,
      state,
      answer: { type: 'noul', probability: 0.42 },
    });
    const result = await decide(state, { a: question }, cfg({ fixturesDir: dir }));
    expect(result.a).toMatchObject({
      source: 'fixture',
      model: 'jev-1.13.0',
      answer: { probability: 0.42 },
    });
    expect(mock.requests).toHaveLength(0);
  });

  it('reports a missing fixture in replay mode with the key and a hint', async () => {
    const result = await decide(state, { a: claimQuestion('x') }, cfg({ mode: 'replay' }));
    expect(result.a.unverifiedReason).toMatch(/no fixture .*\.json.*JEV_MODE=record/);
    expect(mock.requests).toHaveLength(0);
  });

  it('live mode ignores fixtures', async () => {
    const dir = tempDir();
    const question = claimQuestion('payment confirmed');
    writeFixture(dir, questionKey('jev-latest', state, question), {
      model: 'm',
      question,
      state,
      answer: { type: 'noul', probability: 0.1 },
    });
    const result = await decide(state, { a: question }, cfg({ mode: 'live', fixturesDir: dir }));
    expect(result.a.source).toBe('live');
    expect(readdirSync(dir)).toHaveLength(1);
  });
});

describe('store', () => {
  it('ignores unreadable fixtures', () => {
    expect(readFixture(tempDir(), 'missing')).toBeUndefined();
  });

  it('truncates long state excerpts', () => {
    const dir = tempDir();
    writeFixture(dir, 'k', {
      model: 'm',
      question: claimQuestion('x'),
      state: 'y'.repeat(900),
      answer: { type: 'noul', probability: 1 },
    });
    expect(readFixture(dir, 'k')?.stateExcerpt.length).toBe(501);
  });

  it('exposes the memory cache size', () => {
    memoryCache.set('a', { type: 'noul', probability: 1 });
    expect(memoryCache.size).toBe(1);
    expect(memoryCache.get('a')).toBeDefined();
  });
});
