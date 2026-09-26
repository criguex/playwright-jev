import type { AnswerSource } from './types.js';
import type { Truth } from './verdict.js';

/** Name of the attachment each semantic assertion adds to the Playwright report. */
export const ATTACHMENT_NAME = 'jev-assertion';

/** Final status of one semantic assertion. */
export type AssertionStatus = 'passed' | 'failed' | 'ambiguous' | 'unverified';

/** One evaluated claim or question inside an assertion. */
export interface QuestionEvidence {
  label: string;
  probability?: number;
  confidence?: number;
  choice?: string;
  score?: number;
  distribution?: Record<string, number>;
  truth: Truth | 'unverified';
  source: AnswerSource | 'unverified';
  reason?: string;
}

/** Everything recorded about one semantic assertion; attached as JSON to the test. */
export interface AssertionRecord {
  matcher: string;
  negated: boolean;
  expectation: string;
  status: AssertionStatus;
  passed: boolean;
  policyApplied?: 'annotate' | 'skip';
  truth: Truth | 'unverified';
  threshold?: number;
  minConfidence?: number;
  questions: QuestionEvidence[];
  receiver: string;
  received: string;
  model: string;
  latencyMs: number;
  inputTokens: number;
  costUsd: number;
  attempts: number;
  reason?: string;
}

/** The subset of Playwright's `TestInfo` this library uses. */
export interface TestInfoLike {
  annotations: { type: string; description?: string }[];
  attach(name: string, options: { body: string; contentType: string }): Promise<void>;
  skip(condition: boolean, description?: string): void;
}

let provider: () => TestInfoLike | undefined = () => undefined;

/** Plugs in how to reach the current test (set by the package entry point). */
export function setTestInfoProvider(next: () => TestInfoLike | undefined): void {
  provider = next;
}

/** The running test, or `undefined` outside Playwright Test. */
export function currentTestInfo(): TestInfoLike | undefined {
  try {
    return provider();
  } catch {
    return undefined;
  }
}

/** One-line human summary used for annotations and the reporter. */
export function summarize(record: AssertionRecord): string {
  const parts = record.questions.map((q) => {
    if (q.probability !== undefined) return `p=${q.probability.toFixed(2)}`;
    if (q.choice !== undefined) return `choice=${q.choice} conf=${(q.confidence ?? 0).toFixed(2)}`;
    if (q.score !== undefined)
      return `score=${q.score.toFixed(2)} conf=${(q.confidence ?? 0).toFixed(2)}`;
    return 'unverified';
  });
  const not = record.negated ? 'not.' : '';
  return `${record.status.toUpperCase()} ${not}${record.matcher} ${record.expectation} [${parts.join(', ')}]`;
}

/** Adds an annotation and a JSON attachment to the running test, if any. */
export async function recordEvidence(record: AssertionRecord): Promise<void> {
  const info = currentTestInfo();
  if (!info) return;
  const type =
    record.status === 'passed'
      ? 'jev'
      : record.status === 'failed'
        ? 'jev:failed'
        : `jev:${record.status}`;
  info.annotations.push({ type, description: summarize(record) });
  await info.attach(ATTACHMENT_NAME, {
    body: JSON.stringify(record, null, 2),
    contentType: 'application/json',
  });
}
