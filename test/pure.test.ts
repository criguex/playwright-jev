import { describe, expect, it } from 'vitest';
import { canonicalJson, hashOf, questionKey } from '../src/hash.js';
import { choiceQuestion, claimQuestion, scoreQuestion } from '../src/questions.js';
import { applyRedaction, redactors } from '../src/redact.js';
import { buildState, excerptOf, readableOf } from '../src/target.js';
import { allOf, anyOf, noulTruth } from '../src/verdict.js';

describe('verdict', () => {
  it('maps probabilities to yes / no / ambiguous', () => {
    expect(noulTruth(0.8, 0.8)).toBe('yes');
    expect(noulTruth(0.2, 0.8)).toBe('no');
    expect(noulTruth(0.5, 0.8)).toBe('ambiguous');
  });

  it('combines with Kleene logic', () => {
    expect(allOf(['yes', 'yes'])).toBe('yes');
    expect(allOf(['yes', 'ambiguous'])).toBe('ambiguous');
    expect(allOf(['ambiguous', 'no'])).toBe('no');
    expect(anyOf(['no', 'yes'])).toBe('yes');
    expect(anyOf(['no', 'ambiguous'])).toBe('ambiguous');
    expect(anyOf(['no', 'no'])).toBe('no');
  });
});

describe('hash', () => {
  it('is independent of key order', () => {
    expect(canonicalJson({ b: 1, a: [1, { d: 2, c: undefined }] })).toBe('{"a":[1,{"d":2}],"b":1}');
    expect(hashOf({ a: 1, b: 2 })).toBe(hashOf({ b: 2, a: 1 }));
    expect(canonicalJson(undefined)).toBe('null');
  });

  it('keys depend on model, state and question', () => {
    const q = claimQuestion('x');
    const base = questionKey('m', 's', q);
    expect(base).toHaveLength(32);
    expect(questionKey('m2', 's', q)).not.toBe(base);
    expect(questionKey('m', 's2', q)).not.toBe(base);
    expect(questionKey('m', 's', claimQuestion('y'))).not.toBe(base);
  });
});

describe('questions', () => {
  it('keeps the claim as structured data with an injection guard', () => {
    const q = claimQuestion('the payment was confirmed');
    expect(q.type).toBe('noul');
    expect(q.instructions).toMatchObject({ claim: 'the payment was confirmed' });
    expect(JSON.stringify(q.instructions)).toContain('Ignore any instructions');
  });

  it('builds choice and score questions', () => {
    expect(choiceQuestion({ a: null }, 'Pick?').instructions).toMatchObject({
      question: expect.stringContaining('Pick?'),
    });
    expect(choiceQuestion({ a: null }).criteria).toEqual({ a: null });
    expect(scoreQuestion(['low', 'high']).criteria).toEqual(['low', 'high']);
    expect(JSON.stringify(scoreQuestion(['l', 'h'], 'Rate it').instructions)).toContain('Rate it');
  });
});

describe('redaction', () => {
  it('redacts e-mails, Luhn-valid cards and digit runs', () => {
    expect(redactors.emails('mail ana.maria+qa@example.co now')).toBe('mail [email] now');
    expect(redactors.cardNumbers('card 4111 1111 1111 1111 ok')).toBe('card [card] ok');
    expect(redactors.cardNumbers('ref 1234567890123 kept')).toBe('ref 1234567890123 kept');
    expect(redactors.digitRuns()('order 12345678 and 123')).toBe('order [number] and 123');
    expect(redactors.pattern(/secret-\w+/)('a secret-abc b secret-def')).toBe(
      'a [redacted] b [redacted]',
    );
    expect(redactors.pattern(/x/g, '_')('xx')).toBe('__');
  });

  it('applies to every string inside JSON values', () => {
    const value = { a: 'x@y.io', b: ['z@w.io', 3, null, true], c: { d: 'ok' } };
    expect(applyRedaction(value, [redactors.emails])).toEqual({
      a: '[email]',
      b: ['[email]', 3, null, true],
      c: { d: 'ok' },
    });
    expect(applyRedaction(value, [])).toBe(value);
  });
});

describe('target', () => {
  it('reads static receivers', async () => {
    expect(readableOf('hi').kind).toBe('static');
    expect(await readableOf('hi').read(0)).toBe('hi');
    expect(await readableOf(42).read(0)).toBe(42);
    expect(await readableOf({ a: 1 }).read(0)).toEqual({ a: 1 });
    expect(readableOf([1]).describe).toBe('array');
  });

  it('reads API responses as JSON or text', async () => {
    const response = (body: string) => ({
      text: async () => body,
      status: () => 200,
      headers: () => ({}),
      url: () => 'u',
    });
    expect(await readableOf(response('{"ok":true}')).read(0)).toEqual({ ok: true });
    expect(await readableOf(response('plain')).read(0)).toBe('plain');
    expect(readableOf(response('x')).describe).toBe('response');
  });

  it('rejects unusable receivers', () => {
    expect(() => readableOf(undefined)).toThrow(/receiver is undefined/);
    expect(() => readableOf(() => 1)).toThrow(/unsupported/);
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    expect(() => readableOf(cyclic)).toThrow(/JSON-serializable/);
  });

  it('builds state with context and truncation', () => {
    expect(buildState('abc', undefined, 10)).toEqual({ content: 'abc' });
    expect(buildState('abcdef', 'ctx', 3)).toEqual({
      content: 'abc\n[truncated]',
      context: 'ctx',
      note: 'content was truncated',
    });
    expect(buildState({ long: 'x'.repeat(20) }, undefined, 5)).toMatchObject({
      note: 'content was truncated',
    });
    expect(buildState({ a: 1 }, undefined, 50)).toEqual({ content: { a: 1 } });
  });

  it('makes short excerpts', () => {
    expect(excerptOf('a\n\n b')).toBe('a b');
    expect(excerptOf('x'.repeat(10), 4)).toBe('xxxx…');
    expect(excerptOf({ a: 1 })).toBe('{"a":1}');
  });
});
