import type {
  ChoiceAnswer,
  JevAnswer,
  JevConfig,
  JevQuestion,
  JevResponse,
  JsonValue,
  NoulAnswer,
  ScoreAnswer,
  TransportName,
} from './types.js';

/** TypeSafe's native endpoint. */
export const DIRECT_ENDPOINT = 'https://api.typesafe.ai/v1/systemone';
/** Vercel AI Gateway's TypeSafe-compatible endpoint. */
export const GATEWAY_ENDPOINT = 'https://ai-gateway.vercel.sh/typesafe/v1/systemone';

const RETRYABLE = new Set([408, 425, 429, 500, 502, 503, 504, 529]);

/** Resolved endpoint and credentials. */
export interface Transport {
  url: string;
  key: string;
  name: TransportName;
}

/** Error raised when Jev could not answer. Carries the HTTP status and response body when known. */
export class JevError extends Error {
  readonly status: number | undefined;
  readonly body: string | undefined;
  readonly transport: TransportName | undefined;
  readonly retryable: boolean;

  constructor(
    message: string,
    details: {
      status?: number;
      body?: string;
      transport?: TransportName;
      retryable?: boolean;
    } = {},
  ) {
    super(message);
    this.name = 'JevError';
    this.status = details.status;
    this.body = details.body;
    this.transport = details.transport;
    this.retryable = details.retryable ?? false;
  }
}

/** Picks the transport: `baseUrl` override, then TypeSafe direct, then Vercel AI Gateway. */
export function selectTransport(
  config: Pick<JevConfig, 'apiKey' | 'gatewayApiKey' | 'baseUrl'>,
): Transport | undefined {
  if (config.baseUrl) {
    return {
      url: config.baseUrl,
      key: config.apiKey ?? config.gatewayApiKey ?? '',
      name: 'custom',
    };
  }
  if (config.apiKey) return { url: DIRECT_ENDPOINT, key: config.apiKey, name: 'typesafe' };
  if (config.gatewayApiKey) {
    return { url: GATEWAY_ENDPOINT, key: config.gatewayApiKey, name: 'vercel-gateway' };
  }
  return undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function probability(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1) {
    throw new JevError(
      `Malformed answer: ${field} must be a number in [0, 1], got ${JSON.stringify(value)}`,
    );
  }
  return value;
}

function distribution(value: unknown, field: string): Record<string, number> {
  if (!isRecord(value)) throw new JevError(`Malformed answer: ${field} must be an object`);
  return Object.fromEntries(
    Object.entries(value).map(([k, v]) => [k, probability(v, `${field}.${k}`)]),
  );
}

/** Confidence as TypeSafe defines it: 1 when all mass is on one option, 0 when uniform. */
export function confidenceFrom(probabilities: Record<string, number>): number {
  const values = Object.values(probabilities);
  if (values.length < 2) return 1;
  const peak = Math.max(...values);
  const n = values.length;
  return Math.max(0, Math.min(1, (n * peak - 1) / (n - 1)));
}

function argmax(probabilities: Record<string, number>): string {
  let best: string | undefined;
  let bestValue = -1;
  for (const [key, value] of Object.entries(probabilities)) {
    if (value > bestValue) {
      best = key;
      bestValue = value;
    }
  }
  if (best === undefined) throw new JevError('Malformed answer: empty probabilities');
  return best;
}

/**
 * Normalizes one raw answer. Accepts the native TypeSafe shape (`{ type: 'noul', noul }`)
 * and the gateway shape (`{ type: 'boolean', probability }`).
 */
export function normalizeAnswer(raw: unknown, expected: JevQuestion['type']): JevAnswer {
  if (!isRecord(raw)) throw new JevError('Malformed answer: not an object');
  const type = raw.type ?? expected;
  if (type === 'noul' || type === 'boolean') {
    const value = raw.noul ?? raw.probability ?? raw.value;
    return { type: 'noul', probability: probability(value, 'noul') } satisfies NoulAnswer;
  }
  if (type === 'choice') {
    const probabilities = distribution(raw.probabilities, 'probabilities');
    const choice = typeof raw.choice === 'string' ? raw.choice : argmax(probabilities);
    const confidence =
      raw.confidence === undefined
        ? confidenceFrom(probabilities)
        : probability(raw.confidence, 'confidence');
    return { type: 'choice', choice, probabilities, confidence } satisfies ChoiceAnswer;
  }
  if (type === 'score') {
    const probabilities = distribution(raw.probabilities, 'probabilities');
    const score =
      typeof raw.score === 'number'
        ? raw.score
        : Object.entries(probabilities).reduce((sum, [k, p]) => sum + Number(k) * p, 0);
    const confidence =
      raw.confidence === undefined
        ? confidenceFrom(probabilities)
        : probability(raw.confidence, 'confidence');
    const answer: ScoreAnswer = { type: 'score', score, probabilities, confidence };
    if (isRecord(raw.legend)) answer.legend = raw.legend as Record<string, string>;
    return answer;
  }
  throw new JevError(`Malformed answer: unknown type ${JSON.stringify(type)}`);
}

function scrub(text: string, key: string): string {
  const cut = text.length > 1200 ? `${text.slice(0, 1200)}…` : text;
  return key ? cut.split(key).join('[redacted-key]') : cut;
}

function retryAfterMs(header: string | null): number | undefined {
  if (!header) return undefined;
  const seconds = Number(header);
  if (Number.isFinite(seconds)) return seconds * 1000;
  const date = Date.parse(header);
  return Number.isNaN(date) ? undefined : Math.max(0, date - Date.now());
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Options for {@link createJevClient}. */
export type JevClientOptions = Partial<
  Pick<
    JevConfig,
    | 'apiKey'
    | 'gatewayApiKey'
    | 'baseUrl'
    | 'model'
    | 'requestTimeoutMs'
    | 'maxRetries'
    | 'maxRetryDelayMs'
    | 'fetch'
    | 'logger'
  >
>;

/** Low-level client: one call, one state, many questions. */
export interface JevClient {
  /** The transport in use, or `undefined` when no key is configured. */
  readonly transport: Transport | undefined;
  /** Sends one request. Throws {@link JevError} on failure. */
  ask(state: JsonValue, questions: Record<string, JevQuestion>): Promise<JevResponse>;
}

/**
 * Creates a low-level Jev client with retries, timeout and response normalization.
 *
 * @example
 * ```ts
 * const jev = createJevClient();
 * const { answers } = await jev.ask('Order placed', { ok: { type: 'noul', instructions: 'Did it succeed?' } });
 * ```
 */
export function createJevClient(options: JevClientOptions = {}): JevClient {
  const config = {
    apiKey: options.apiKey ?? process.env.TYPESAFE_API_KEY,
    gatewayApiKey: options.gatewayApiKey ?? process.env.AI_GATEWAY_API_KEY,
    baseUrl: options.baseUrl ?? process.env.JEV_BASE_URL,
    model: options.model ?? 'jev-latest',
    requestTimeoutMs: options.requestTimeoutMs ?? 15_000,
    maxRetries: options.maxRetries ?? 2,
    maxRetryDelayMs: options.maxRetryDelayMs ?? 8_000,
    fetch: options.fetch ?? ((...args: Parameters<typeof fetch>) => globalThis.fetch(...args)),
    logger: options.logger ?? ((message: string) => console.warn(message)),
  };
  const transport = selectTransport(config);

  async function attempt(
    route: Transport,
    body: string,
    timeoutMs: number,
  ): Promise<{ payload: unknown; retryAfter?: number }> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const headers: Record<string, string> = { 'content-type': 'application/json' };
      if (route.key) headers.authorization = `Bearer ${route.key}`;
      const response = await config.fetch(route.url, {
        method: 'POST',
        headers,
        body,
        signal: controller.signal,
      });
      const text = await response.text();
      if (!response.ok) {
        const retryAfter = retryAfterMs(response.headers.get('retry-after'));
        const error = new JevError(
          `Jev ${response.status}${response.statusText ? ` ${response.statusText}` : ''} via ${route.name}: ${scrub(text, route.key) || 'no body'}`,
          {
            status: response.status,
            body: scrub(text, route.key),
            transport: route.name,
            retryable: RETRYABLE.has(response.status),
          },
        );
        throw Object.assign(error, { retryAfter });
      }
      try {
        return { payload: JSON.parse(text) as unknown };
      } catch {
        throw new JevError(`Jev returned non-JSON via ${route.name}: ${scrub(text, route.key)}`, {
          status: response.status,
          body: scrub(text, route.key),
          transport: route.name,
        });
      }
    } catch (error) {
      if (error instanceof JevError) throw error;
      if (controller.signal.aborted) {
        throw new JevError(`Jev request timed out after ${timeoutMs} ms via ${route.name}`, {
          transport: route.name,
          retryable: false,
        });
      }
      throw new JevError(`Jev unreachable via ${route.name}: ${String(error)}`, {
        transport: route.name,
        retryable: true,
      });
    } finally {
      clearTimeout(timer);
    }
  }

  return {
    transport,
    async ask(state, questions) {
      if (!transport) {
        throw new JevError('No Jev key configured: set TYPESAFE_API_KEY or AI_GATEWAY_API_KEY');
      }
      const body = JSON.stringify({ model: config.model, state, questions });
      const started = Date.now();
      const deadline = started + config.requestTimeoutMs;
      let tries = 0;
      for (;;) {
        const remaining = deadline - Date.now();
        try {
          const { payload } = await attempt(transport, body, Math.max(1, remaining));
          return parse(payload, questions, transport, Date.now() - started);
        } catch (error) {
          const jevError = error as JevError & { retryAfter?: number };
          config.logger(`[playwright-jev] ${jevError.message}`);
          if (!jevError.retryable || tries >= config.maxRetries) throw jevError;
          const backoff = Math.min(
            config.maxRetryDelayMs,
            jevError.retryAfter ?? 250 * 2 ** tries + Math.floor(Math.random() * 100),
          );
          if (Date.now() + backoff >= deadline) throw jevError;
          tries += 1;
          await sleep(backoff);
        }
      }
    },
  };
}

function parse(
  payload: unknown,
  questions: Record<string, JevQuestion>,
  transport: Transport,
  latencyMs: number,
): JevResponse {
  if (!isRecord(payload) || !isRecord(payload.answers)) {
    throw new JevError(`Malformed response via ${transport.name}: missing answers`, {
      body: JSON.stringify(payload).slice(0, 1200),
      transport: transport.name,
    });
  }
  const rawAnswers = payload.answers;
  const answers: Record<string, JevAnswer> = {};
  for (const [id, question] of Object.entries(questions)) {
    if (!(id in rawAnswers)) {
      throw new JevError(`Malformed response via ${transport.name}: no answer for "${id}"`, {
        transport: transport.name,
      });
    }
    answers[id] = normalizeAnswer(rawAnswers[id], question.type);
  }
  const usage = isRecord(payload.usage) ? payload.usage : {};
  return {
    model: typeof payload.model === 'string' ? payload.model : 'unknown',
    answers,
    usage: {
      inputTokens: typeof usage.input_tokens === 'number' ? usage.input_tokens : 0,
      outputTokens: typeof usage.output_tokens === 'number' ? usage.output_tokens : 0,
    },
    latencyMs,
    transport: transport.name,
  };
}
