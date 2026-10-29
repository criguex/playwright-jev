import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { FullResult, TestCase, TestResult } from '@playwright/test/reporter';
import { ATTACHMENT_NAME, type AssertionRecord } from '../src/evidence.js';
import JevReporter, {
  renderMarkdown,
  renderTable,
  summarizeRun,
  type ReportedAssertion,
} from '../src/reporter.js';
import { tempDir } from './support/env.js';

const record = (over: Partial<AssertionRecord> = {}): AssertionRecord => ({
  matcher: 'toMean',
  negated: false,
  expectation: '"the payment was confirmed"',
  status: 'passed',
  passed: true,
  truth: 'yes',
  threshold: 0.8,
  questions: [
    { label: 'the payment was confirmed', probability: 0.97, truth: 'yes', source: 'live' },
  ],
  receiver: 'locator',
  received: 'Payment confirmed',
  model: 'jev-1.13.0',
  latencyMs: 210,
  inputTokens: 300,
  costUsd: 0.0000126,
  attempts: 1,
  ...over,
});

function testCase(project = 'chromium'): TestCase {
  return {
    title: 'pays',
    titlePath: () => ['', project, 'checkout.spec.ts', 'checkout', 'pays'],
    location: { file: '/repo/tests/checkout.spec.ts', line: 7, column: 1 },
    parent: { project: () => ({ name: project }) },
  } as unknown as TestCase;
}

function testResult(records: AssertionRecord[], extra: TestResult['attachments'] = []): TestResult {
  return {
    status: 'passed',
    retry: 0,
    attachments: [
      ...records.map((r) => ({
        name: ATTACHMENT_NAME,
        contentType: 'application/json',
        body: Buffer.from(JSON.stringify(r)),
      })),
      ...extra,
    ],
  } as unknown as TestResult;
}

let out: string[];
beforeEach(() => {
  out = [];
  vi.spyOn(process.stdout, 'write').mockImplementation((chunk: string | Uint8Array) => {
    out.push(String(chunk));
    return true;
  });
});

describe('JevReporter', () => {
  it('collects attachments, prints a table and writes JSON + Markdown', async () => {
    const dir = tempDir();
    const reporter = new JevReporter({
      outputFile: join(dir, 'r/jev.json'),
      markdownFile: join(dir, 'jev.md'),
    });
    reporter.onBegin({ rootDir: '/repo' });
    expect(reporter.printsToStdio()).toBe(true);
    const other = { name: 'screenshot', contentType: 'image/png', body: Buffer.from('x') };
    const broken = {
      name: ATTACHMENT_NAME,
      contentType: 'application/json',
      body: Buffer.from('{oops'),
    };
    const fromFile = {
      name: ATTACHMENT_NAME,
      contentType: 'application/json',
      path: join(dir, 'rec.json'),
    };
    const { writeFileSync } = await import('node:fs');
    writeFileSync(
      fromFile.path,
      JSON.stringify(
        record({
          matcher: 'toChoose',
          status: 'failed',
          passed: false,
          truth: 'no',
          questions: [
            { label: 'choice', choice: 'error', confidence: 0.9, truth: 'no', source: 'fixture' },
          ],
        }),
      ),
    );
    reporter.onTestEnd(testCase(), testResult([record()], [other, broken, fromFile]));
    const status = await reporter.onEnd({ status: 'passed' } as FullResult);
    expect(status).toBeUndefined();
    expect(reporter.assertions).toHaveLength(2);
    expect(reporter.assertions[0]).toMatchObject({
      test: 'checkout › pays',
      file: 'tests/checkout.spec.ts',
      line: 7,
      project: 'chromium',
    });
    const json = JSON.parse(readFileSync(join(dir, 'r/jev.json'), 'utf8'));
    expect(json.summary).toMatchObject({ total: 2, passed: 1, failed: 1, liveQuestions: 1 });
    expect(readFileSync(join(dir, 'jev.md'), 'utf8')).toContain('| failed | toChoose |');
    const printed = out.join('');
    expect(printed).toContain('2 total, 1 passed, 1 failed');
    expect(printed).toContain('0.97');
    expect(printed).toContain('error');
  });

  it('resolves relative report paths against the config file directory', async () => {
    const dir = tempDir();
    const reporter = new JevReporter({
      outputFile: '../out/jev-report.json',
      markdownFile: '../out/jev-report.md',
      print: false,
    });
    reporter.onBegin({ rootDir: join(dir, 'tests/specs'), configFile: join(dir, 'tests/pw.ts') });
    reporter.onTestEnd(testCase(), testResult([record()]));
    await reporter.onEnd({ status: 'passed' } as FullResult);
    expect(existsSync(join(dir, 'out/jev-report.json'))).toBe(true);
    expect(existsSync(join(dir, 'out/jev-report.md'))).toBe(true);
  });

  it('marks the run failed for tolerated ambiguity or skipped unverified when asked', async () => {
    const reporter = new JevReporter({
      outputFile: false,
      print: false,
      failOnAmbiguous: true,
      failOnUnverified: true,
    });
    reporter.onTestEnd(
      testCase(''),
      testResult([record({ status: 'ambiguous', policyApplied: 'annotate' })]),
    );
    expect(await reporter.onEnd({ status: 'passed' } as FullResult)).toEqual({ status: 'failed' });
    expect(reporter.assertions[0]?.test).toBe('checkout › pays');
    const lenient = new JevReporter({ outputFile: false, print: false });
    lenient.onTestEnd(
      testCase(),
      testResult([record({ status: 'unverified', policyApplied: 'skip' })]),
    );
    expect(await lenient.onEnd({ status: 'passed' } as FullResult)).toBeUndefined();
  });
});

describe('rendering', () => {
  const reported = (over: Partial<AssertionRecord>): ReportedAssertion => ({
    ...record(over),
    test: 't | x',
    file: 'f',
    line: 1,
    project: '',
    retry: 0,
    testStatus: 'passed',
  });

  it('summarizes sources, tokens and latency', () => {
    const s = summarizeRun([
      reported({}),
      reported({
        questions: [{ label: 'x', probability: 0.1, truth: 'no', source: 'cache' }],
        latencyMs: 0,
        inputTokens: 0,
        costUsd: 0,
      }),
      reported({
        status: 'unverified',
        questions: [{ label: 'x', truth: 'unverified', source: 'unverified' }],
      }),
    ]);
    expect(s).toMatchObject({
      total: 3,
      unverified: 1,
      bySource: { live: 1, cache: 1, unverified: 1 },
      avgLiveLatencyMs: 210,
    });
    expect(summarizeRun([]).avgLiveLatencyMs).toBe(0);
  });

  it('renders score, empty and negated rows', () => {
    const table = renderTable([
      reported({
        matcher: 'toBeScored',
        questions: [
          { label: 'rubric', score: 1.43, confidence: 0.15, truth: 'ambiguous', source: 'live' },
        ],
      }),
      reported({ negated: true, questions: [] }),
      reported({
        questions: [
          { label: 'x', truth: 'unverified', source: 'unverified' },
          { label: 'y', probability: 1, truth: 'yes', source: 'live' },
        ],
      }),
      reported({ questions: [{ label: 'x', truth: 'unverified', source: 'unverified' }] }),
    ]);
    expect(table).toContain('1.43');
    expect(table).toContain('not.toMean');
    expect(renderTable([])).toContain('0 total');
    expect(renderMarkdown([reported({})])).toContain('t \\| x');
  });
});
