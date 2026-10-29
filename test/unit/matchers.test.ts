import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { configureJev } from '../../src/config.js';
import { resetJevState } from '../../src/engine.js';
import { setTestInfoProvider, summarize, type AssertionRecord } from '../../src/evidence.js';
import {
  toBeScored,
  toChoose,
  toMean,
  toMeanAll,
  toMeanAny,
  type MatcherContext,
} from '../../src/matchers.js';
import { redactors } from '../../src/redact.js';
import { cleanEnv, fakeTestInfo, tempDir, useMock, type FakeTestInfo } from '../support/env.js';
import { startMockJev, type MockJev } from '../support/mock-jev.js';

let mock: MockJev;
let info: FakeTestInfo;
beforeAll(async () => {
  mock = await startMockJev();
});
afterAll(() => mock.close());
beforeEach(() => {
  cleanEnv();
  mock.handler = undefined;
  mock.requests.length = 0;
  useMock(mock.url);
  info = fakeTestInfo();
  setTestInfoProvider(() => info);
});

const pos: MatcherContext = { isNot: false, timeout: 1000 };
const neg: MatcherContext = { isNot: true, timeout: 1000 };
const records = () => info.attachments.map((a) => JSON.parse(a.body) as AssertionRecord);

describe('toMean', () => {
  it('passes when the claim holds and records evidence', async () => {
    const result = await toMean.call(pos, 'Your payment was confirmed', 'payment confirmed');
    expect(result.pass).toBe(true);
    expect(result.name).toBe('toMean');
    const [record] = records();
    expect(record).toMatchObject({
      matcher: 'toMean',
      status: 'passed',
      passed: true,
      threshold: 0.8,
      receiver: 'string',
    });
    expect(record?.questions[0]).toMatchObject({ probability: 0.96, truth: 'yes', source: 'live' });
    expect(info.annotations[0]).toMatchObject({
      type: 'jev',
      description: expect.stringContaining('PASSED toMean'),
    });
  });

  it('fails with a readable message when the claim does not hold', async () => {
    const result = await toMean.call(pos, 'Card declined', 'payment confirmed');
    expect(result.pass).toBe(false);
    const message = result.message();
    expect(message).toContain('expect(string).toMean("payment confirmed")');
    expect(message).toContain('Verdict:  no (expected yes)');
    expect(message).toContain('p=0.03');
    expect(message).toContain('Received (string): "Card declined"');
    expect(info.annotations[0]?.type).toBe('jev:failed');
  });

  it('supports .not', async () => {
    const ok = await toMean.call(neg, 'Card declined', 'payment confirmed');
    expect(ok.pass).toBe(false);
    const bad = await toMean.call(neg, 'Payment confirmed', 'payment confirmed');
    expect(bad.pass).toBe(true);
    expect(bad.message()).toContain('expected no');
  });

  it('fails ambiguous answers by default, in both directions', async () => {
    const plain = await toMean.call(pos, 'payment [[ambiguous]]', 'payment confirmed');
    expect(plain.pass).toBe(false);
    expect(plain.message()).toContain('AMBIGUOUS');
    const negated = await toMean.call(neg, 'payment [[ambiguous]]', 'payment confirmed');
    expect(negated.pass).toBe(true);
    expect(records().map((r) => r.status)).toEqual(['ambiguous', 'ambiguous']);
  });

  it('annotates instead of failing when onAmbiguous is annotate', async () => {
    const result = await toMean.call(pos, 'payment [[ambiguous]]', 'payment confirmed', {
      onAmbiguous: 'annotate',
    });
    expect(result.pass).toBe(true);
    expect(records()[0]).toMatchObject({
      status: 'ambiguous',
      policyApplied: 'annotate',
      passed: true,
    });
    expect(info.annotations[0]?.type).toBe('jev:ambiguous');
  });

  it('honours a per-assertion threshold', async () => {
    const result = await toMean.call(pos, 'payment [[ambiguous]]', 'payment confirmed', {
      threshold: 0.55,
    });
    expect(result.pass).toBe(true);
  });

  it('unverified assertions fail by default', async () => {
    cleanEnv();
    configureJev({ fixturesDir: tempDir(), logger: () => {} });
    setTestInfoProvider(() => info);
    const result = await toMean.call(pos, 'Payment confirmed', 'payment confirmed');
    expect(result.pass).toBe(false);
    expect(result.message()).toContain('UNVERIFIED');
    expect(result.message()).toContain('does not pass');
    const negated = await toMean.call(neg, 'Payment confirmed', 'payment confirmed');
    expect(negated.pass).toBe(true);
    expect(records()[0]).toMatchObject({ status: 'unverified', passed: false });
  });

  it('skips the test when onUnverified is skip', async () => {
    mock.handler = () => ({ status: 500, body: {} });
    const logs: string[] = [];
    configureJev({ maxRetries: 0, logger: (m) => logs.push(m) });
    await expect(toMean.call(pos, 'x', 'y', { onUnverified: 'skip' })).rejects.toThrow(/SKIP/);
    expect(info.skipped).toMatch(/unverified toMean/);
    expect(records()[0]).toMatchObject({ status: 'unverified', policyApplied: 'skip' });
    expect(logs.join()).toMatch(/skipping test/);
  });

  it('fails when skip is requested outside a test', async () => {
    setTestInfoProvider(() => undefined);
    configureJev({ mode: 'off' });
    const result = await toMean.call(pos, 'x', 'y', { onUnverified: 'skip' });
    expect(result.pass).toBe(false);
  });

  it('survives a throwing test-info provider', async () => {
    setTestInfoProvider(() => {
      throw new Error('outside test');
    });
    const result = await toMean.call(pos, 'Payment confirmed', 'payment confirmed');
    expect(result.pass).toBe(true);
  });

  it('redacts before sending and in evidence', async () => {
    configureJev({ redact: [redactors.emails] });
    await toMean.call(pos, 'Receipt sent to ana@example.com', 'receipt sent');
    expect(JSON.stringify(mock.requests[0]?.body.state)).not.toContain('ana@example.com');
    expect(records()[0]?.received).toBe('Receipt sent to [email]');
  });

  it('sends context and model overrides', async () => {
    await toMean.call(pos, 'Payment confirmed', 'payment confirmed', {
      context: 'checkout page',
      model: 'jev-1.13.0',
    });
    expect(mock.requests[0]?.body.state).toMatchObject({ context: 'checkout page' });
    expect(mock.requests[0]?.body.model).toBe('jev-1.13.0');
  });

  it('validates the claim', async () => {
    await expect(toMean.call(pos, 'x', '  ')).rejects.toThrow(/non-empty claim/);
  });
});

describe('toMeanAll / toMeanAny', () => {
  it('toMeanAll sends one request and requires every claim', async () => {
    const ok = await toMeanAll.call(pos, 'Payment confirmed, order shipped', [
      'payment confirmed',
      'order shipped',
    ]);
    expect(ok.pass).toBe(true);
    expect(mock.requests).toHaveLength(1);
    const bad = await toMeanAll.call(pos, 'Payment confirmed, order shipped', [
      'payment confirmed',
      'refund issued',
    ]);
    expect(bad.pass).toBe(false);
    expect(bad.message()).toContain('"refund issued": no');
  });

  it('toMeanAny requires at least one claim', async () => {
    expect(
      (await toMeanAny.call(pos, 'Order shipped', ['refund issued', 'order shipped'])).pass,
    ).toBe(true);
    expect(
      (await toMeanAny.call(pos, 'Order shipped', ['refund issued', 'payment declined'])).pass,
    ).toBe(false);
  });

  it('is unverified when any claim is unverified', async () => {
    mock.handler = () => ({ status: 422, body: { detail: 'bad' } });
    const result = await toMeanAll.call(pos, 'x', ['a claim', 'b claim']);
    expect(result.pass).toBe(false);
    expect(result.message()).toContain('unverified (');
  });

  it('validates claims', async () => {
    await expect(toMeanAll.call(pos, 'x', [])).rejects.toThrow(/non-empty array/);
    await expect(toMeanAny.call(pos, 'x', ['ok', ''])).rejects.toThrow(/non-empty array/);
  });
});

describe('toBeScored', () => {
  const rubric = ['unclear', 'partly clear', 'clear'];

  it('passes inside the range with enough confidence', async () => {
    const result = await toBeScored.call(pos, 'All good [[score:2]]', rubric, { atLeast: 1.5 });
    expect(result.pass).toBe(true);
    expect(records()[0]?.questions[0]).toMatchObject({ score: 2, confidence: 0.8 });
  });

  it('fails below the range and reports the distribution', async () => {
    const result = await toBeScored.call(
      pos,
      'Meh [[score:0.4]]',
      { question: 'How clear?', levels: rubric },
      { atLeast: 1 },
    );
    expect(result.pass).toBe(false);
    expect(result.message()).toContain('score=0.40');
    expect(JSON.stringify(mock.requests[0]?.body.questions)).toContain('How clear?');
  });

  it('respects atMost and .not', async () => {
    expect(
      (await toBeScored.call(pos, '[[score:2]]', rubric, { atLeast: 0, atMost: 1 })).pass,
    ).toBe(false);
    expect((await toBeScored.call(neg, '[[score:0]]', rubric, { atLeast: 1 })).pass).toBe(false);
  });

  it('treats low confidence as ambiguous', async () => {
    const result = await toBeScored.call(pos, '[[score:2]] [[ambiguous]]', rubric, { atLeast: 1 });
    expect(result.pass).toBe(false);
    expect(records()[0]?.status).toBe('ambiguous');
    const lenient = await toBeScored.call(pos, '[[score:2]] [[ambiguous]]', rubric, {
      atLeast: 1,
      minConfidence: 0.05,
    });
    expect(lenient.pass).toBe(true);
  });

  it('is unverified without an answer', async () => {
    configureJev({ mode: 'off' });
    const result = await toBeScored.call(pos, 'x', rubric, { atLeast: 1 });
    expect(result.message()).toContain('UNVERIFIED');
  });

  it('validates rubric and range', async () => {
    await expect(toBeScored.call(pos, 'x', ['one'], { atLeast: 0 })).rejects.toThrow(/2 to 10/);
    await expect(toBeScored.call(pos, 'x', rubric, {} as never)).rejects.toThrow(/atLeast/);
    await expect(toBeScored.call(pos, 'x', rubric, { atLeast: 3 })).rejects.toThrow(/outside/);
  });
});

describe('toChoose', () => {
  it('passes when the expected option is chosen confidently', async () => {
    const result = await toChoose.call(
      pos,
      'Status: success',
      { success: 'it worked', error: 'it failed' },
      'success',
    );
    expect(result.pass).toBe(true);
    expect(records()[0]?.questions[0]).toMatchObject({ choice: 'success', confidence: 0.85 });
  });

  it('fails on a different choice and shows the distribution', async () => {
    const result = await toChoose.call(
      pos,
      'Status: error',
      ['success', 'error', 'pending'],
      ['success', 'pending'],
      { question: 'What status?' },
    );
    expect(result.pass).toBe(false);
    expect(result.message()).toContain('choice=error');
    expect(result.message()).toContain('error=0.90');
  });

  it('supports .not and ambiguity', async () => {
    expect((await toChoose.call(neg, 'Status: error', ['success', 'error'], 'success')).pass).toBe(
      false,
    );
    const ambiguous = await toChoose.call(
      pos,
      'Status: success [[ambiguous]]',
      ['success', 'error'],
      'success',
    );
    expect(ambiguous.pass).toBe(false);
    expect(records().at(-1)?.status).toBe('ambiguous');
  });

  it('is unverified without an answer', async () => {
    configureJev({ mode: 'off' });
    expect((await toChoose.call(pos, 'x', ['a', 'b'], 'a')).message()).toContain('UNVERIFIED');
  });

  it('validates options and expected values', async () => {
    await expect(toChoose.call(pos, 'x', ['only'], 'only')).rejects.toThrow(/between 2 and 255/);
    await expect(
      toChoose.call(
        pos,
        'x',
        Array.from({ length: 256 }, (_, i) => `o${i}`),
        'o1',
      ),
    ).rejects.toThrow(/255/);
    await expect(toChoose.call(pos, 'x', ['a', 'b'], 'c')).rejects.toThrow(/not among/);
    await expect(toChoose.call(pos, 'x', ['a', 'b'], [])).rejects.toThrow(/not among/);
  });
});

describe('web-first receivers', () => {
  function fakeLocator(texts: string[][], opts: { failWait?: boolean } = {}) {
    let reads = 0;
    const locator = {
      reads: () => reads,
      first: () => locator,
      waitFor: async () => {
        if (opts.failWait) throw new Error('Timeout 1000ms exceeded.\nwaiting for locator');
      },
      allInnerTexts: async () => texts[Math.min(reads++, texts.length - 1)] ?? [],
    };
    return locator;
  }

  it('re-reads a locator until the meaning appears', async () => {
    const locator = fakeLocator([['Processing…'], ['Processing…'], ['  Payment confirmed ', '']]);
    const result = await toMean.call({ isNot: false, timeout: 3000 }, locator, 'payment confirmed');
    expect(result.pass).toBe(true);
    expect(locator.reads()).toBe(3);
    expect(records()[0]).toMatchObject({
      receiver: 'locator',
      attempts: 3,
      received: 'Payment confirmed',
    });
    expect(mock.requests).toHaveLength(2);
  });

  it('keeps polling past states that have no fixture in replay mode', async () => {
    const dir = tempDir();
    configureJev({ mode: 'record', fixturesDir: dir });
    await toMean.call(pos, 'Payment confirmed', 'payment confirmed');
    info.attachments.length = 0;
    resetJevState();
    configureJev({ mode: 'replay', baseUrl: undefined });
    const locator = fakeLocator([['Processing…'], ['Payment confirmed']]);
    const result = await toMean.call({ isNot: false, timeout: 2000 }, locator, 'payment confirmed');
    expect(result.pass).toBe(true);
    expect(records()[0]?.questions[0]?.source).toBe('fixture');
  });

  it('stops polling at the timeout', async () => {
    const locator = fakeLocator([['Processing…']]);
    const result = await toMean.call({ isNot: false, timeout: 400 }, locator, 'payment confirmed');
    expect(result.pass).toBe(false);
    expect(result.message()).toMatch(/\d+ reads/);
  });

  it('does not poll when poll is false', async () => {
    const locator = fakeLocator([['Processing…'], ['Payment confirmed']]);
    const result = await toMean.call(pos, locator, 'payment confirmed', { poll: false });
    expect(result.pass).toBe(false);
    expect(locator.reads()).toBe(1);
  });

  it('fails clearly when the locator never becomes visible', async () => {
    const result = await toMean.call(
      neg,
      fakeLocator([[]], { failWait: true }),
      'payment confirmed',
    );
    expect(result.pass).toBe(true);
    expect(result.message()).toContain('Could not read the locator: Timeout 1000ms exceeded.');
    expect(records()[0]?.status).toBe('failed');
  });

  it('reads the page body', async () => {
    const page = {
      goto: async () => undefined,
      url: () => 'http://x',
      locator: () => ({ innerText: async () => '\nOrder shipped\n' }),
    };
    const result = await toMean.call(pos, page, 'order shipped');
    expect(result.pass).toBe(true);
    expect(records()[0]?.receiver).toBe('page');
  });

  it('judges JSON values', async () => {
    const result = await toMean.call(pos, { status: 'shipped', order: 12 }, 'status shipped');
    expect(result.pass).toBe(true);
    expect(mock.requests[0]?.body.state).toEqual({ content: { status: 'shipped', order: 12 } });
  });
});

describe('summarize', () => {
  it('describes each kind of answer', () => {
    const base = {
      matcher: 'toMean',
      negated: true,
      expectation: '"x"',
      status: 'passed',
      passed: true,
      truth: 'no',
      receiver: 'string',
      received: '',
      model: 'm',
      latencyMs: 0,
      inputTokens: 0,
      costUsd: 0,
      attempts: 1,
    } as const;
    expect(
      summarize({
        ...base,
        questions: [
          { label: 'a', probability: 0.1, truth: 'no', source: 'live' },
          { label: 'b', choice: 'c', truth: 'yes', source: 'cache' },
          { label: 'c', score: 1, truth: 'yes', source: 'fixture' },
          { label: 'd', truth: 'unverified', source: 'unverified' },
        ],
      }),
    ).toBe('PASSED not.toMean "x" [p=0.10, choice=c conf=0.00, score=1.00 conf=0.00, unverified]');
  });
});
