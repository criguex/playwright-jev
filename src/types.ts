/** Anything Jev accepts as `state`, `instructions` or a criterion. */
export type JsonValue =
  string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

/** A yes/no question. The answer is the probability of "yes". */
export interface NoulQuestion {
  type: 'noul';
  instructions: JsonValue;
  criteria?: { true: JsonValue; false: JsonValue };
}

/** Pick one option out of up to 255. */
export interface ChoiceQuestion {
  type: 'choice';
  instructions: JsonValue;
  criteria: Record<string, JsonValue>;
}

/** Place the state on an ordered rubric of 2 to 10 levels. */
export interface ScoreQuestion {
  type: 'score';
  instructions: JsonValue;
  criteria: JsonValue[];
}

/** Any Jev question. */
export type JevQuestion = NoulQuestion | ChoiceQuestion | ScoreQuestion;

/** Normalized noul answer (`noul` natively, `probability` via the gateway). */
export interface NoulAnswer {
  type: 'noul';
  probability: number;
}

/** Normalized choice answer. */
export interface ChoiceAnswer {
  type: 'choice';
  choice: string;
  probabilities: Record<string, number>;
  confidence: number;
}

/** Normalized score answer. `score` is the probability-weighted level index. */
export interface ScoreAnswer {
  type: 'score';
  score: number;
  probabilities: Record<string, number>;
  confidence: number;
  legend?: Record<string, string>;
}

/** Any normalized Jev answer. */
export type JevAnswer = NoulAnswer | ChoiceAnswer | ScoreAnswer;

/** Token usage reported by Jev for one request. */
export interface JevUsage {
  inputTokens: number;
  outputTokens: number;
}

/** Result of one HTTP call to Jev. */
export interface JevResponse {
  model: string;
  answers: Record<string, JevAnswer>;
  usage: JevUsage;
  latencyMs: number;
  transport: TransportName;
}

/** Which endpoint served a request. */
export type TransportName = 'typesafe' | 'vercel-gateway' | 'custom';

/**
 * How answers are obtained.
 *
 * - `auto`: committed fixture, else live call when a key is present, else unverified.
 * - `live`: always call Jev (memory cache still applies).
 * - `record`: call Jev and write every answer to the fixtures directory.
 * - `replay`: fixtures only; a missing fixture is unverified. Never touches the network.
 * - `off`: every semantic assertion is unverified.
 */
export type JevMode = 'auto' | 'live' | 'record' | 'replay' | 'off';

/** Where an answer came from. */
export type AnswerSource = 'live' | 'cache' | 'fixture';

/** What to do when an answer lands in the ambiguity band. */
export type AmbiguousPolicy = 'fail' | 'annotate';

/** What to do when no answer could be obtained. */
export type UnverifiedPolicy = 'fail' | 'skip';

/** Transforms the state before it is hashed or sent. Use it to strip PII. */
export type Redactor = (text: string) => string;

/** Library configuration. Every field is optional; see {@link configureJev}. */
export interface JevConfig {
  /** Answer source strategy. Default `auto` (env `JEV_MODE`). */
  mode: JevMode;
  /** Model id or alias. Default `jev-latest` (env `JEV_MODEL`). */
  model: string;
  /** Yes-threshold for noul matchers. `no` is `<= 1 - threshold`. Default 0.8 (env `JEV_THRESHOLD`). */
  threshold: number;
  /** Minimum confidence for `toChoose` and `toBeScored`. Default 0.5. */
  minConfidence: number;
  /** Policy for ambiguous answers. Default `fail` (env `JEV_ON_AMBIGUOUS`). */
  onAmbiguous: AmbiguousPolicy;
  /** Policy for assertions that could not be verified. Default `fail` (env `JEV_ON_UNVERIFIED`). */
  onUnverified: UnverifiedPolicy;
  /** Directory for record/replay fixtures. Default `.jev/fixtures` (env `JEV_FIXTURES_DIR`). */
  fixturesDir: string;
  /** TypeSafe API key. Default env `TYPESAFE_API_KEY`. */
  apiKey: string | undefined;
  /** Vercel AI Gateway key. Default env `AI_GATEWAY_API_KEY`. */
  gatewayApiKey: string | undefined;
  /** Override the endpoint (tests, proxies). Default env `JEV_BASE_URL`. */
  baseUrl: string | undefined;
  /** Per-request timeout in ms, retries included. Default 15000. */
  requestTimeoutMs: number;
  /** Retries on 429, 5xx, 529 and network errors. Default 2. */
  maxRetries: number;
  /** Upper bound for one backoff wait (also caps `retry-after`). Default 8000. */
  maxRetryDelayMs: number;
  /** Time window in ms during which concurrent questions on the same state are coalesced. Default 5. */
  batchWindowMs: number;
  /** Maximum questions sent in one request. Default 32. */
  maxQuestionsPerRequest: number;
  /** Maximum characters of state sent to Jev; longer text is truncated with a marker. Default 60000. */
  maxStateChars: number;
  /** Redactors applied to every text state before hashing and sending. Default none. */
  redact: Redactor[];
  /** Price per million input tokens in USD, for cost tracking. Default 0.042. */
  pricePerMillionInputTokens: number;
  /** Extra context sent alongside page content, e.g. `"checkout page of an online store"`. */
  context: string | undefined;
  /** Receives diagnostic messages. Default `console.warn`. */
  logger: (message: string) => void;
  /** Custom fetch implementation. */
  fetch: typeof fetch;
}
