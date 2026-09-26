import type { AmbiguousPolicy, JevConfig, JevMode, UnverifiedPolicy } from './types.js';

const MODES: readonly JevMode[] = ['auto', 'live', 'record', 'replay', 'off'];
const AMBIGUOUS: readonly AmbiguousPolicy[] = ['fail', 'annotate'];
const UNVERIFIED: readonly UnverifiedPolicy[] = ['fail', 'skip'];

let overrides: Partial<JevConfig> = {};

function pick<T extends string>(
  value: string | undefined,
  allowed: readonly T[],
  name: string,
): T | undefined {
  if (value === undefined || value === '') return undefined;
  if ((allowed as readonly string[]).includes(value)) return value as T;
  throw new Error(
    `[playwright-jev] ${name}="${value}" is invalid; expected one of ${allowed.join(', ')}`,
  );
}

function unit(value: string | undefined, name: string): number | undefined {
  if (value === undefined || value === '') return undefined;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 1) {
    throw new Error(`[playwright-jev] ${name}="${value}" must be a number between 0 and 1`);
  }
  return parsed;
}

function nonEmpty(value: string | undefined): string | undefined {
  return value === undefined || value.trim() === '' ? undefined : value.trim();
}

function fromEnv(env: NodeJS.ProcessEnv): Partial<JevConfig> {
  const result: Partial<JevConfig> = {};
  const mode = pick(env.JEV_MODE, MODES, 'JEV_MODE');
  if (mode) result.mode = mode;
  const model = nonEmpty(env.JEV_MODEL);
  if (model) result.model = model;
  const threshold = unit(env.JEV_THRESHOLD, 'JEV_THRESHOLD');
  if (threshold !== undefined) result.threshold = threshold;
  const onAmbiguous = pick(env.JEV_ON_AMBIGUOUS, AMBIGUOUS, 'JEV_ON_AMBIGUOUS');
  if (onAmbiguous) result.onAmbiguous = onAmbiguous;
  const onUnverified = pick(env.JEV_ON_UNVERIFIED, UNVERIFIED, 'JEV_ON_UNVERIFIED');
  if (onUnverified) result.onUnverified = onUnverified;
  const fixturesDir = nonEmpty(env.JEV_FIXTURES_DIR);
  if (fixturesDir) result.fixturesDir = fixturesDir;
  return result;
}

function defaults(env: NodeJS.ProcessEnv): JevConfig {
  return {
    mode: 'auto',
    model: 'jev-latest',
    threshold: 0.8,
    minConfidence: 0.5,
    onAmbiguous: 'fail',
    onUnverified: 'fail',
    fixturesDir: '.jev/fixtures',
    apiKey: nonEmpty(env.TYPESAFE_API_KEY),
    gatewayApiKey: nonEmpty(env.AI_GATEWAY_API_KEY),
    baseUrl: nonEmpty(env.JEV_BASE_URL),
    requestTimeoutMs: 15_000,
    maxRetries: 2,
    maxRetryDelayMs: 8_000,
    batchWindowMs: 20,
    maxQuestionsPerRequest: 32,
    maxStateChars: 60_000,
    redact: [],
    pricePerMillionInputTokens: 0.042,
    context: undefined,
    logger: (message) => console.warn(message),
    fetch: (...args) => globalThis.fetch(...args),
  };
}

function validate(config: JevConfig): JevConfig {
  if (!(config.threshold > 0.5 && config.threshold <= 1)) {
    throw new Error(`[playwright-jev] threshold must be in (0.5, 1], got ${config.threshold}`);
  }
  if (!(config.minConfidence >= 0 && config.minConfidence <= 1)) {
    throw new Error(
      `[playwright-jev] minConfidence must be in [0, 1], got ${config.minConfidence}`,
    );
  }
  if (!(config.maxQuestionsPerRequest >= 1)) {
    throw new Error('[playwright-jev] maxQuestionsPerRequest must be >= 1');
  }
  return config;
}

/**
 * Sets process-wide configuration. Call it at the top of `playwright.config.ts`
 * (the config file is evaluated in every worker) or in a setup file.
 *
 * Precedence: per-assertion options, then `configureJev`, then environment
 * variables, then defaults.
 *
 * @example
 * ```ts
 * configureJev({ threshold: 0.85, redact: [redactors.emails] });
 * ```
 */
export function configureJev(config: Partial<JevConfig>): void {
  overrides = { ...overrides, ...config };
  resolveConfig();
}

/** Restores the defaults (mainly for tests). */
export function resetJevConfig(): void {
  overrides = {};
}

/** Returns the effective configuration. */
export function resolveConfig(extra: Partial<JevConfig> = {}): JevConfig {
  const env = process.env;
  return validate({ ...defaults(env), ...fromEnv(env), ...overrides, ...extra });
}
