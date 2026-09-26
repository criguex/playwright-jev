import { expect as baseExpect, test } from '@playwright/test';
import { setTestInfoProvider } from './evidence.js';
import { jevMatchers } from './matchers.js';

setTestInfoProvider(() => test.info());

/**
 * Playwright's `expect` extended with the semantic matchers.
 *
 * @example
 * ```ts
 * import { test } from '@playwright/test';
 * import { expect } from 'playwright-jev';
 *
 * test('checkout', async ({ page }) => {
 *   await expect(page.getByRole('alert')).toMean('the payment was confirmed');
 * });
 * ```
 */
export const expect = baseExpect.extend(jevMatchers);

export { configureJev, resetJevConfig, resolveConfig } from './config.js';
export {
  createJevClient,
  confidenceFrom,
  normalizeAnswer,
  selectTransport,
  JevError,
  DIRECT_ENDPOINT,
  GATEWAY_ENDPOINT,
} from './client.js';
export type { JevClient, JevClientOptions, Transport } from './client.js';
export { decide, getJevStats, resetJevState } from './engine.js';
export type { Decision, JevStats } from './engine.js';
export { ATTACHMENT_NAME, setTestInfoProvider } from './evidence.js';
export type {
  AssertionRecord,
  AssertionStatus,
  QuestionEvidence,
  TestInfoLike,
} from './evidence.js';
export { jevMatchers, toMean, toMeanAll, toMeanAny, toBeScored, toChoose } from './matchers.js';
export type {
  ChoiceOptions,
  ChooseOptions,
  MatcherContext,
  MatcherResult,
  MeanOptions,
  Rubric,
  ScoreOptions,
  SemanticOptions,
} from './matchers.js';
export { claimQuestion, choiceQuestion, scoreQuestion } from './questions.js';
export { redactors, applyRedaction } from './redact.js';
export { memoryCache, readFixture, writeFixture } from './store.js';
export type { Fixture } from './store.js';
export { allOf, anyOf, noulTruth } from './verdict.js';
export type { Truth } from './verdict.js';
export type * from './types.js';
