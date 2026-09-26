import { resolveConfig } from './config.js';
import { decide, type Decision } from './engine.js';
import {
  currentTestInfo,
  recordEvidence,
  type AssertionRecord,
  type AssertionStatus,
  type QuestionEvidence,
} from './evidence.js';
import { choiceQuestion, claimQuestion, scoreQuestion } from './questions.js';
import { applyRedaction } from './redact.js';
import { buildState, excerptOf, readableOf } from './target.js';
import type {
  AmbiguousPolicy,
  JevConfig,
  JevQuestion,
  JsonValue,
  UnverifiedPolicy,
} from './types.js';
import { allOf, anyOf, noulTruth, type Truth } from './verdict.js';

/** Options shared by every semantic matcher. */
export interface SemanticOptions {
  /** Assertion timeout for `Locator`/`Page` receivers. Defaults to the `expect` timeout. */
  timeout?: number;
  /** Re-read `Locator`/`Page` receivers until the expectation holds or time runs out. Default `true`. */
  poll?: boolean;
  /** Override the ambiguity policy for this assertion. */
  onAmbiguous?: AmbiguousPolicy;
  /** Override the unverified policy for this assertion. */
  onUnverified?: UnverifiedPolicy;
  /** Extra context sent with the content, e.g. `"error banner on the login form"`. */
  context?: string;
  /** Model override for this assertion. */
  model?: string;
}

/** Options for `toMean`, `toMeanAll` and `toMeanAny`. */
export interface MeanOptions extends SemanticOptions {
  /** Yes-threshold; the no-threshold is `1 - threshold`. Default from config (0.8). */
  threshold?: number;
}

/** Options for `toBeScored`. */
export interface ScoreOptions extends SemanticOptions {
  /** Minimum acceptable score (0-based level index; fractional allowed). */
  atLeast: number;
  /** Maximum acceptable score. Default: the top level. */
  atMost?: number;
  /** Below this confidence the result is ambiguous. Default from config (0.5). */
  minConfidence?: number;
}

/** Options for `toChoose`. */
export interface ChooseOptions extends SemanticOptions {
  /** The question asked about the content. Default `"Which option best describes content?"`. */
  question?: string;
  /** Below this confidence the result is ambiguous. Default from config (0.5). */
  minConfidence?: number;
}

/** A rubric for `toBeScored`: ordered levels, lowest first, optionally with the question. */
export type Rubric = readonly string[] | { question?: string; levels: readonly string[] };

/** Options for `toChoose`: a list of labels or a map of label to description. */
export type ChoiceOptions = readonly string[] | Record<string, string | null>;

/** Minimal matcher context (structurally compatible with Playwright's `ExpectMatcherState`). */
export interface MatcherContext {
  isNot: boolean;
  timeout: number;
}

/** Matcher result (structurally compatible with Playwright's `MatcherReturnType`). */
export interface MatcherResult {
  pass: boolean;
  message: () => string;
  name: string;
  expected?: unknown;
  actual?: unknown;
}

interface Judgement {
  truth: Truth | 'unverified';
  questions: QuestionEvidence[];
  reason?: string;
}

interface Spec {
  matcher: string;
  expectation: string;
  questions: Record<string, JevQuestion>;
  judge: (decisions: Record<string, Decision>, config: JevConfig) => Judgement;
  options: SemanticOptions;
  overrides: Partial<JevConfig>;
  threshold?: number;
  minConfidence?: number;
}

const POLL_INTERVALS = [100, 250, 500, 1000];
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function configFor(options: SemanticOptions, overrides: Partial<JevConfig>): JevConfig {
  const extra: Partial<JevConfig> = { ...overrides };
  if (options.onAmbiguous) extra.onAmbiguous = options.onAmbiguous;
  if (options.onUnverified) extra.onUnverified = options.onUnverified;
  if (options.context) extra.context = options.context;
  if (options.model) extra.model = options.model;
  return resolveConfig(extra);
}

function unverifiedIn(decisions: Decision[]): string | undefined {
  return decisions.find((d) => d.answer === undefined)?.unverifiedReason;
}

function sourceOf(decision: Decision): QuestionEvidence['source'] {
  return decision.source ?? 'unverified';
}

function claimsJudge(
  claims: readonly string[],
  combine: (values: Truth[]) => Truth,
): Spec['judge'] {
  return (decisions, config) => {
    const list = claims.map((_, i) => decisions[`c${i}`] as Decision);
    const reason = unverifiedIn(list);
    const questions: QuestionEvidence[] = claims.map((claim, i) => {
      const decision = list[i] as Decision;
      const answer = decision.answer;
      if (answer?.type !== 'noul') {
        return {
          label: claim,
          truth: 'unverified',
          source: 'unverified',
          reason: decision.unverifiedReason ?? '',
        };
      }
      return {
        label: claim,
        probability: answer.probability,
        truth: noulTruth(answer.probability, config.threshold),
        source: sourceOf(decision),
      };
    });
    if (reason !== undefined) return { truth: 'unverified', questions, reason };
    return { truth: combine(questions.map((q) => q.truth as Truth)), questions };
  };
}

function format(n: number | undefined): string {
  return n === undefined ? '-' : n.toFixed(2);
}

function describeQuestion(q: QuestionEvidence): string {
  if (q.truth === 'unverified')
    return `  - ${JSON.stringify(q.label)}: unverified (${q.reason ?? 'no answer'})`;
  if (q.probability !== undefined) {
    return `  - ${JSON.stringify(q.label)}: ${q.truth} (p=${format(q.probability)}, ${q.source})`;
  }
  const dist = q.distribution
    ? Object.entries(q.distribution)
        .sort(([, a], [, b]) => b - a)
        .slice(0, 5)
        .map(([k, v]) => `${k}=${v.toFixed(2)}`)
        .join(' ')
    : '';
  const head = q.choice !== undefined ? `choice=${q.choice}` : `score=${format(q.score)}`;
  return `  - ${q.label}: ${head} confidence=${format(q.confidence)} (${q.source}) [${dist}]`;
}

async function evaluate(
  ctx: MatcherContext,
  received: unknown,
  spec: Spec,
): Promise<MatcherResult> {
  const config = configFor(spec.options, spec.overrides);
  const readable = readableOf(received);
  const timeout = spec.options.timeout ?? ctx.timeout;
  const deadline = Date.now() + timeout;
  const desired: Truth = ctx.isNot ? 'no' : 'yes';
  const shouldPoll = readable.kind === 'live' && spec.options.poll !== false;

  let content: JsonValue = '';
  let judgement: Judgement = { truth: 'unverified', questions: [], reason: 'not evaluated' };
  let decisions: Decision[] = [];
  let attempts = 0;
  let readError: string | undefined;

  for (;;) {
    attempts += 1;
    try {
      content =
        readable.kind === 'live'
          ? await readable.read(Math.max(1, deadline - Date.now()))
          : await readable.read();
      readError = undefined;
    } catch (error) {
      readError = error instanceof Error ? error.message.split('\n')[0] : String(error);
      break;
    }
    const state = buildState(
      applyRedaction(content, config.redact),
      config.context,
      config.maxStateChars,
    );
    const byId = await decide(state, spec.questions, config);
    decisions = Object.values(byId);
    judgement = spec.judge(byId, config);
    if (judgement.truth === desired || judgement.truth === 'unverified' || !shouldPoll) break;
    const wait = POLL_INTERVALS[Math.min(attempts - 1, POLL_INTERVALS.length - 1)] as number;
    if (Date.now() + wait >= deadline) break;
    await sleep(wait);
  }

  const redacted = applyRedaction(content, config.redact);
  let status: AssertionStatus;
  let success: boolean;
  let policyApplied: AssertionRecord['policyApplied'];
  if (readError !== undefined) {
    status = 'failed';
    success = false;
  } else if (judgement.truth === 'unverified') {
    status = 'unverified';
    success = false;
    if (config.onUnverified === 'skip') policyApplied = 'skip';
  } else if (judgement.truth === 'ambiguous') {
    status = 'ambiguous';
    success = config.onAmbiguous === 'annotate';
    if (success) policyApplied = 'annotate';
  } else {
    success = judgement.truth === desired;
    status = success ? 'passed' : 'failed';
  }

  const record: AssertionRecord = {
    matcher: spec.matcher,
    negated: ctx.isNot,
    expectation: spec.expectation,
    status,
    passed: success,
    truth: judgement.truth,
    questions: judgement.questions,
    receiver: readable.describe,
    received: readError !== undefined ? '' : excerptOf(redacted),
    model: decisions.find((d) => d.source === 'live')?.model ?? decisions[0]?.model ?? config.model,
    latencyMs: Math.max(0, ...decisions.map((d) => d.latencyMs)),
    inputTokens: decisions.reduce((sum, d) => sum + d.inputTokens, 0),
    costUsd: decisions.reduce((sum, d) => sum + d.costUsd, 0),
    attempts,
  };
  if (policyApplied) record.policyApplied = policyApplied;
  if (spec.threshold !== undefined) record.threshold = spec.threshold;
  if (spec.minConfidence !== undefined) record.minConfidence = spec.minConfidence;
  const reason = readError ?? judgement.reason;
  if (reason !== undefined) record.reason = reason;
  await recordEvidence(record);

  if (policyApplied === 'skip') {
    const info = currentTestInfo();
    if (info) {
      config.logger(
        `[playwright-jev] skipping test: semantic assertion unverified (${reason ?? 'unknown'})`,
      );
      info.skip(true, `playwright-jev: unverified ${spec.matcher} (${reason ?? 'unknown'})`);
    }
  }

  const not = ctx.isNot ? '.not' : '';
  const header = `expect(${readable.describe})${not}.${spec.matcher}(${spec.expectation})`;
  const message = () => {
    const lines = [header, ''];
    if (readError !== undefined) {
      lines.push(`Could not read the ${readable.describe}: ${readError}`);
      return lines.join('\n');
    }
    const verdictLine =
      status === 'unverified'
        ? `Verdict:  UNVERIFIED — ${reason ?? 'no answer'}. A semantic assertion that could not be verified does not pass (onUnverified: "${config.onUnverified}").`
        : status === 'ambiguous'
          ? `Verdict:  AMBIGUOUS — the answer fell between the yes and no thresholds (onAmbiguous: "${config.onAmbiguous}").`
          : `Verdict:  ${judgement.truth}${ctx.isNot ? ' (expected no)' : ' (expected yes)'}`;
    lines.push(verdictLine);
    if (spec.threshold !== undefined) {
      lines.push(`Thresholds: yes ≥ ${format(spec.threshold)}, no ≤ ${format(1 - spec.threshold)}`);
    }
    if (spec.minConfidence !== undefined)
      lines.push(`Min confidence: ${format(spec.minConfidence)}`);
    lines.push('Answers:', ...judgement.questions.map(describeQuestion));
    lines.push(`Received (${readable.describe}): ${JSON.stringify(record.received)}`);
    lines.push(`Model: ${record.model}${attempts > 1 ? ` · ${attempts} reads` : ''}`);
    return lines.join('\n');
  };

  return {
    pass: success ? !ctx.isNot : ctx.isNot,
    message,
    name: spec.matcher,
    expected: spec.expectation,
    actual: record.received,
  };
}

function assertClaims(claims: unknown, matcher: string): asserts claims is readonly string[] {
  if (
    !Array.isArray(claims) ||
    claims.length === 0 ||
    !claims.every((c) => typeof c === 'string' && c.trim())
  ) {
    throw new TypeError(
      `[playwright-jev] ${matcher} expects a non-empty array of non-empty strings`,
    );
  }
}

function thresholdOf(options: MeanOptions): Partial<JevConfig> {
  return options.threshold === undefined ? {} : { threshold: options.threshold };
}

function claimsSpec(
  matcher: string,
  claims: readonly string[],
  combine: (values: Truth[]) => Truth,
  options: MeanOptions,
): Spec {
  const overrides = thresholdOf(options);
  const threshold = resolveConfig(overrides).threshold;
  return {
    matcher,
    expectation: claims.length === 1 ? JSON.stringify(claims[0]) : JSON.stringify(claims),
    questions: Object.fromEntries(claims.map((claim, i) => [`c${i}`, claimQuestion(claim)])),
    judge: claimsJudge(claims, combine),
    options,
    overrides,
    threshold,
  };
}

/**
 * Passes when the received content states or clearly implies `claim`
 * (probability ≥ threshold). With `.not`, passes when probability ≤ 1 − threshold.
 * Anything in between is ambiguous and fails by default.
 */
export async function toMean(
  this: MatcherContext,
  received: unknown,
  claim: string,
  options: MeanOptions = {},
): Promise<MatcherResult> {
  if (typeof claim !== 'string' || !claim.trim()) {
    throw new TypeError('[playwright-jev] toMean expects a non-empty claim string');
  }
  return evaluate(this, received, claimsSpec('toMean', [claim], allOf, options));
}

/** Passes when every claim holds. All claims are sent in one request. */
export async function toMeanAll(
  this: MatcherContext,
  received: unknown,
  claims: readonly string[],
  options: MeanOptions = {},
): Promise<MatcherResult> {
  assertClaims(claims, 'toMeanAll');
  return evaluate(this, received, claimsSpec('toMeanAll', claims, allOf, options));
}

/** Passes when at least one claim holds. All claims are sent in one request. */
export async function toMeanAny(
  this: MatcherContext,
  received: unknown,
  claims: readonly string[],
  options: MeanOptions = {},
): Promise<MatcherResult> {
  assertClaims(claims, 'toMeanAny');
  return evaluate(this, received, claimsSpec('toMeanAny', claims, anyOf, options));
}

/**
 * Places the content on an ordered rubric (2–10 levels, lowest first) and passes when
 * the probability-weighted score is within `[atLeast, atMost]` with enough confidence.
 */
export async function toBeScored(
  this: MatcherContext,
  received: unknown,
  rubric: Rubric,
  options: ScoreOptions,
): Promise<MatcherResult> {
  const levels = Array.isArray(rubric) ? rubric : (rubric as { levels: readonly string[] }).levels;
  const question = Array.isArray(rubric) ? undefined : (rubric as { question?: string }).question;
  if (
    !Array.isArray(levels) ||
    levels.length < 2 ||
    levels.length > 10 ||
    !levels.every((l) => typeof l === 'string')
  ) {
    throw new TypeError(
      '[playwright-jev] toBeScored expects 2 to 10 rubric levels (strings, lowest first)',
    );
  }
  if (typeof options?.atLeast !== 'number') {
    throw new TypeError('[playwright-jev] toBeScored requires { atLeast: number }');
  }
  const atLeast = options.atLeast;
  const atMost = options.atMost ?? levels.length - 1;
  if (atLeast < 0 || atMost > levels.length - 1 || atLeast > atMost) {
    throw new TypeError(
      `[playwright-jev] toBeScored range [${atLeast}, ${atMost}] is outside 0..${levels.length - 1}`,
    );
  }
  const overrides: Partial<JevConfig> =
    options.minConfidence === undefined ? {} : { minConfidence: options.minConfidence };
  const minConfidence = resolveConfig(overrides).minConfidence;
  return evaluate(this, received, {
    matcher: 'toBeScored',
    expectation: `score in [${atLeast}, ${atMost}] of ${JSON.stringify(levels)}`,
    questions: { s: scoreQuestion(levels, question) },
    options,
    overrides,
    minConfidence,
    judge: (decisions) => {
      const decision = decisions.s as Decision;
      const answer = decision.answer;
      if (answer?.type !== 'score') {
        const reason = decision.unverifiedReason ?? 'no answer';
        return {
          truth: 'unverified',
          reason,
          questions: [{ label: 'rubric', truth: 'unverified', source: 'unverified', reason }],
        };
      }
      const truth: Truth =
        answer.confidence < minConfidence
          ? 'ambiguous'
          : answer.score >= atLeast && answer.score <= atMost
            ? 'yes'
            : 'no';
      return {
        truth,
        questions: [
          {
            label: 'rubric',
            score: answer.score,
            confidence: answer.confidence,
            distribution: answer.probabilities,
            truth,
            source: sourceOf(decision),
          },
        ],
      };
    },
  });
}

/**
 * Asks Jev to pick one of `options` for the content and passes when the pick is
 * `expected` (or one of several) with enough confidence. Up to 255 options.
 */
export async function toChoose(
  this: MatcherContext,
  received: unknown,
  options: ChoiceOptions,
  expected: string | readonly string[],
  settings: ChooseOptions = {},
): Promise<MatcherResult> {
  const criteria: Record<string, string | null> = Array.isArray(options)
    ? Object.fromEntries((options as readonly string[]).map((o) => [o, null]))
    : { ...(options as Record<string, string | null>) };
  const labels = Object.keys(criteria);
  if (labels.length < 2 || labels.length > 255) {
    throw new TypeError('[playwright-jev] toChoose expects between 2 and 255 options');
  }
  const wanted = typeof expected === 'string' ? [expected] : [...expected];
  const unknown = wanted.filter((w) => !labels.includes(w));
  if (wanted.length === 0 || unknown.length > 0) {
    throw new TypeError(
      `[playwright-jev] toChoose expected ${JSON.stringify(unknown)} is not among the options`,
    );
  }
  const overrides: Partial<JevConfig> =
    settings.minConfidence === undefined ? {} : { minConfidence: settings.minConfidence };
  const minConfidence = resolveConfig(overrides).minConfidence;
  return evaluate(this, received, {
    matcher: 'toChoose',
    expectation: wanted.length === 1 ? JSON.stringify(wanted[0]) : JSON.stringify(wanted),
    questions: { k: choiceQuestion(criteria, settings.question) },
    options: settings,
    overrides,
    minConfidence,
    judge: (decisions) => {
      const decision = decisions.k as Decision;
      const answer = decision.answer;
      if (answer?.type !== 'choice') {
        const reason = decision.unverifiedReason ?? 'no answer';
        return {
          truth: 'unverified',
          reason,
          questions: [{ label: 'choice', truth: 'unverified', source: 'unverified', reason }],
        };
      }
      const truth: Truth =
        answer.confidence < minConfidence
          ? 'ambiguous'
          : wanted.includes(answer.choice)
            ? 'yes'
            : 'no';
      return {
        truth,
        questions: [
          {
            label: 'choice',
            choice: answer.choice,
            confidence: answer.confidence,
            distribution: answer.probabilities,
            truth,
            source: sourceOf(decision),
          },
        ],
      };
    },
  });
}

/** All semantic matchers, ready for `expect.extend(jevMatchers)`. */
export const jevMatchers = { toMean, toMeanAll, toMeanAny, toBeScored, toChoose };
