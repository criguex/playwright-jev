import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, relative } from 'node:path';
import type { FullResult, Reporter, TestCase, TestResult } from '@playwright/test/reporter';
import { ATTACHMENT_NAME, type AssertionRecord, type QuestionEvidence } from './evidence.js';

/** Options for the playwright-jev reporter. */
export interface JevReporterOptions {
  /** JSON report path, or `false` to disable. Default `jev-report.json`. */
  outputFile?: string | false;
  /** Markdown report path, or `false` to disable. Default `false`. */
  markdownFile?: string | false;
  /** Print the summary table to stdout. Default `true`. */
  print?: boolean;
  /** Mark the run failed when any assertion was ambiguous but annotated instead of failed. Default `false`. */
  failOnAmbiguous?: boolean;
  /** Mark the run failed when any assertion was unverified but skipped instead of failed. Default `false`. */
  failOnUnverified?: boolean;
}

/** One assertion as it appears in the report. */
export interface ReportedAssertion extends AssertionRecord {
  test: string;
  file: string;
  line: number;
  project: string;
  retry: number;
  testStatus: TestResult['status'];
}

/** Totals for the whole run. */
export interface JevRunSummary {
  total: number;
  passed: number;
  failed: number;
  ambiguous: number;
  unverified: number;
  bySource: Record<string, number>;
  liveQuestions: number;
  inputTokens: number;
  costUsd: number;
  avgLiveLatencyMs: number;
}

/** Aggregates reported assertions. */
export function summarizeRun(assertions: readonly ReportedAssertion[]): JevRunSummary {
  const bySource: Record<string, number> = {};
  let liveQuestions = 0;
  let liveLatency = 0;
  let liveAssertions = 0;
  for (const a of assertions) {
    for (const q of a.questions) {
      bySource[q.source] = (bySource[q.source] ?? 0) + 1;
      if (q.source === 'live') liveQuestions += 1;
    }
    if (a.questions.some((q) => q.source === 'live')) {
      liveLatency += a.latencyMs;
      liveAssertions += 1;
    }
  }
  const count = (status: AssertionRecord['status']) =>
    assertions.filter((a) => a.status === status).length;
  return {
    total: assertions.length,
    passed: count('passed'),
    failed: count('failed'),
    ambiguous: count('ambiguous'),
    unverified: count('unverified'),
    bySource,
    liveQuestions,
    inputTokens: assertions.reduce((sum, a) => sum + a.inputTokens, 0),
    costUsd: assertions.reduce((sum, a) => sum + a.costUsd, 0),
    avgLiveLatencyMs: liveAssertions ? Math.round(liveLatency / liveAssertions) : 0,
  };
}

function metric(a: AssertionRecord): { value: string; confidence: string } {
  const q = a.questions;
  if (q.length === 0) return { value: '-', confidence: '-' };
  if (q.every((x) => x.probability !== undefined)) {
    return { value: q.map((x) => (x.probability as number).toFixed(2)).join('/'), confidence: '-' };
  }
  const [first] = q as [QuestionEvidence];
  const conf = first.confidence === undefined ? '-' : first.confidence.toFixed(2);
  if (first.choice !== undefined) return { value: first.choice, confidence: conf };
  if (first.score !== undefined) return { value: first.score.toFixed(2), confidence: conf };
  return { value: '-', confidence: '-' };
}

function sources(a: AssertionRecord): string {
  return [...new Set(a.questions.map((q) => q.source))].join('+') || '-';
}

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

/** Renders the summary table printed to stdout. */
export function renderTable(assertions: readonly ReportedAssertion[]): string {
  const s = summarizeRun(assertions);
  const lines = [
    '',
    `  Semantic assertions (playwright-jev): ${s.total} total, ${s.passed} passed, ${s.failed} failed, ${s.ambiguous} ambiguous, ${s.unverified} unverified`,
  ];
  if (assertions.length > 0) {
    lines.push(
      `  ${'STATUS'.padEnd(11)}${'MATCHER'.padEnd(16)}${'P/SCORE'.padEnd(14)}${'CONF'.padEnd(6)}${'SOURCE'.padEnd(9)}TEST · EXPECTATION`,
    );
    for (const a of assertions) {
      const m = metric(a);
      const matcher = `${a.negated ? 'not.' : ''}${a.matcher}`;
      lines.push(
        `  ${a.status.padEnd(11)}${matcher.padEnd(16)}${truncate(m.value, 13).padEnd(14)}${m.confidence.padEnd(6)}${truncate(sources(a), 8).padEnd(9)}${truncate(`${a.test} · ${a.expectation}`, 90)}`,
      );
    }
  }
  const src = Object.entries(s.bySource)
    .map(([k, v]) => `${k}=${v}`)
    .join(' ');
  lines.push(
    `  Questions by source: ${src || 'none'} · live input tokens ${Math.round(s.inputTokens)} · cost $${s.costUsd.toFixed(6)} · avg live latency ${s.avgLiveLatencyMs} ms`,
    '',
  );
  return lines.join('\n');
}

/** Renders a Markdown report. */
export function renderMarkdown(assertions: readonly ReportedAssertion[]): string {
  const s = summarizeRun(assertions);
  const rows = assertions.map((a) => {
    const m = metric(a);
    const cell = (text: string) => text.replace(/\|/g, '\\|').replace(/\n/g, ' ');
    return `| ${a.status} | ${a.negated ? 'not.' : ''}${a.matcher} | ${cell(a.expectation)} | ${m.value} | ${m.confidence} | ${sources(a)} | ${cell(a.test)} |`;
  });
  return [
    '# Semantic assertions',
    '',
    `${s.total} total · ${s.passed} passed · ${s.failed} failed · ${s.ambiguous} ambiguous · ${s.unverified} unverified · cost $${s.costUsd.toFixed(6)}`,
    '',
    '| Status | Matcher | Expectation | P / score | Confidence | Source | Test |',
    '| --- | --- | --- | --- | --- | --- | --- |',
    ...rows,
    '',
  ].join('\n');
}

function readRecords(result: TestResult): AssertionRecord[] {
  const records: AssertionRecord[] = [];
  for (const attachment of result.attachments) {
    if (attachment.name !== ATTACHMENT_NAME) continue;
    try {
      const raw = attachment.body
        ? attachment.body.toString('utf8')
        : attachment.path
          ? readFileSync(attachment.path, 'utf8')
          : '';
      if (raw) records.push(JSON.parse(raw) as AssertionRecord);
    } catch {
      continue;
    }
  }
  return records;
}

/**
 * Playwright reporter that lists every semantic assertion with its probability or
 * score, confidence, source (live, cache, fixture) and cost, and writes JSON/Markdown.
 *
 * @example
 * ```ts
 * reporter: [['list'], ['playwright-jev/reporter', { markdownFile: 'jev-report.md' }]]
 * ```
 */
export default class JevReporter implements Reporter {
  readonly assertions: ReportedAssertion[] = [];
  private readonly options: Required<JevReporterOptions>;
  private rootDir = process.cwd();

  constructor(options: JevReporterOptions = {}) {
    this.options = {
      outputFile: options.outputFile ?? 'jev-report.json',
      markdownFile: options.markdownFile ?? false,
      print: options.print ?? true,
      failOnAmbiguous: options.failOnAmbiguous ?? false,
      failOnUnverified: options.failOnUnverified ?? false,
    };
  }

  onBegin(config: { rootDir: string }): void {
    this.rootDir = config.rootDir;
  }

  printsToStdio(): boolean {
    return this.options.print;
  }

  onTestEnd(test: TestCase, result: TestResult): void {
    const project = test.parent.project()?.name ?? '';
    for (const record of readRecords(result)) {
      this.assertions.push({
        ...record,
        test: test.titlePath().slice(3).join(' › ') || test.title,
        file: relative(this.rootDir, test.location.file),
        line: test.location.line,
        project,
        retry: result.retry,
        testStatus: result.status,
      });
    }
  }

  async onEnd(result: FullResult): Promise<{ status?: FullResult['status'] } | undefined> {
    const { outputFile, markdownFile, print, failOnAmbiguous, failOnUnverified } = this.options;
    const summary = summarizeRun(this.assertions);
    if (outputFile) {
      mkdirSync(dirname(outputFile), { recursive: true });
      writeFileSync(
        outputFile,
        `${JSON.stringify({ summary, assertions: this.assertions }, null, 2)}\n`,
        'utf8',
      );
    }
    if (markdownFile) {
      mkdirSync(dirname(markdownFile), { recursive: true });
      writeFileSync(markdownFile, renderMarkdown(this.assertions), 'utf8');
    }
    if (print) process.stdout.write(`${renderTable(this.assertions)}\n`);
    const tolerated = this.assertions.filter(
      (a) =>
        (failOnAmbiguous && a.status === 'ambiguous' && a.policyApplied === 'annotate') ||
        (failOnUnverified && a.status === 'unverified' && a.policyApplied === 'skip'),
    );
    if (tolerated.length > 0 && result.status === 'passed') {
      process.stdout.write(
        `  playwright-jev: marking the run failed, ${tolerated.length} semantic assertion(s) were tolerated by policy.\n`,
      );
      return { status: 'failed' };
    }
    return undefined;
  }
}
