import { createJevClient, JevError } from './client.js';
import { hashOf, questionKey } from './hash.js';
import { memoryCache, readFixture, writeFixture } from './store.js';
import type { AnswerSource, JevAnswer, JevConfig, JevQuestion, JsonValue } from './types.js';

/** Outcome of asking one question, with provenance and cost. */
export interface Decision {
  key: string;
  answer: JevAnswer | undefined;
  source: AnswerSource | undefined;
  unverifiedReason: string | undefined;
  model: string;
  latencyMs: number;
  inputTokens: number;
  costUsd: number;
}

/** Aggregate counters for the current process. */
export interface JevStats {
  requests: number;
  questions: number;
  inputTokens: number;
  costUsd: number;
  totalLatencyMs: number;
}

const stats: JevStats = {
  requests: 0,
  questions: 0,
  inputTokens: 0,
  costUsd: 0,
  totalLatencyMs: 0,
};

/** Counters for requests actually sent to Jev by this process. */
export function getJevStats(): JevStats {
  return { ...stats };
}

/** Clears caches, pending batches and counters (mainly for tests). */
export function resetJevState(): void {
  memoryCache.clear();
  inflight.clear();
  pending.clear();
  Object.assign(stats, {
    requests: 0,
    questions: 0,
    inputTokens: 0,
    costUsd: 0,
    totalLatencyMs: 0,
  });
}

interface Entry {
  key: string;
  question: JevQuestion;
  resolve: (decision: Decision) => void;
}

interface Batch {
  state: JsonValue;
  config: JevConfig;
  entries: Entry[];
}

const pending = new Map<string, Batch>();
const inflight = new Map<string, Promise<Decision>>();

function unverified(key: string, model: string, reason: string): Decision {
  return {
    key,
    answer: undefined,
    source: undefined,
    unverifiedReason: reason,
    model,
    latencyMs: 0,
    inputTokens: 0,
    costUsd: 0,
  };
}

function hit(key: string, model: string, answer: JevAnswer, source: AnswerSource): Decision {
  return {
    key,
    answer,
    source,
    unverifiedReason: undefined,
    model,
    latencyMs: 0,
    inputTokens: 0,
    costUsd: 0,
  };
}

async function flush(batchKey: string): Promise<void> {
  const batch = pending.get(batchKey);
  pending.delete(batchKey);
  if (!batch) return;
  const { config, state } = batch;
  const client = createJevClient(config);
  const unique = new Map<string, Entry[]>();
  for (const entry of batch.entries) {
    unique.set(entry.key, [...(unique.get(entry.key) ?? []), entry]);
  }
  const keys = [...unique.keys()];
  const chunks: string[][] = [];
  for (let i = 0; i < keys.length; i += config.maxQuestionsPerRequest) {
    chunks.push(keys.slice(i, i + config.maxQuestionsPerRequest));
  }
  await Promise.all(
    chunks.map(async (chunk) => {
      const questions: Record<string, JevQuestion> = {};
      chunk.forEach((key, index) => {
        questions[`q${index}`] = (unique.get(key) as [Entry])[0].question;
      });
      try {
        const response = await client.ask(state, questions);
        const cost = (response.usage.inputTokens / 1_000_000) * config.pricePerMillionInputTokens;
        stats.requests += 1;
        stats.questions += chunk.length;
        stats.inputTokens += response.usage.inputTokens;
        stats.costUsd += cost;
        stats.totalLatencyMs += response.latencyMs;
        chunk.forEach((key, index) => {
          const answer = response.answers[`q${index}`] as JevAnswer;
          const question = questions[`q${index}`] as JevQuestion;
          memoryCache.set(key, answer);
          if (config.mode === 'record') {
            writeFixture(config.fixturesDir, key, { model: config.model, question, state, answer });
          }
          const decision: Decision = {
            key,
            answer,
            source: 'live',
            unverifiedReason: undefined,
            model: response.model,
            latencyMs: response.latencyMs,
            inputTokens: response.usage.inputTokens / chunk.length,
            costUsd: cost / chunk.length,
          };
          for (const entry of unique.get(key) ?? []) entry.resolve(decision);
        });
      } catch (error) {
        const reason = error instanceof JevError ? error.message : String(error);
        for (const key of chunk) {
          for (const entry of unique.get(key) ?? [])
            entry.resolve(unverified(key, config.model, reason));
        }
      }
    }),
  );
}

function enqueue(
  state: JsonValue,
  key: string,
  question: JevQuestion,
  config: JevConfig,
): Promise<Decision> {
  const batchKey = hashOf({ model: config.model, url: config.baseUrl ?? '', state });
  return new Promise<Decision>((resolve) => {
    const existing = pending.get(batchKey);
    if (existing) {
      existing.entries.push({ key, question, resolve });
      return;
    }
    pending.set(batchKey, { state, config, entries: [{ key, question, resolve }] });
    setTimeout(() => void flush(batchKey), config.batchWindowMs);
  });
}

function decideOne(state: JsonValue, question: JevQuestion, config: JevConfig): Promise<Decision> {
  const { model, mode } = config;
  const key = questionKey(model, state, question);
  if (mode === 'off') return Promise.resolve(unverified(key, model, 'mode is "off"'));
  const cached = memoryCache.get(key);
  if (cached) return Promise.resolve(hit(key, model, cached, 'cache'));
  if (mode === 'auto' || mode === 'replay') {
    const fixture = readFixture(config.fixturesDir, key);
    if (fixture) {
      memoryCache.set(key, fixture.answer);
      return Promise.resolve(hit(key, fixture.model, fixture.answer, 'fixture'));
    }
    if (mode === 'replay') {
      return Promise.resolve(
        unverified(
          key,
          model,
          `no fixture ${key}.json in ${config.fixturesDir} (replay mode); record it with JEV_MODE=record`,
        ),
      );
    }
  }
  if (!config.apiKey && !config.gatewayApiKey && !config.baseUrl) {
    return Promise.resolve(
      unverified(
        key,
        model,
        'no Jev key (TYPESAFE_API_KEY or AI_GATEWAY_API_KEY) and no recorded fixture',
      ),
    );
  }
  const running = inflight.get(key);
  if (running) return running;
  const promise = enqueue(state, key, question, config).finally(() => inflight.delete(key));
  inflight.set(key, promise);
  return promise;
}

/**
 * Asks every question about `state`, using cache, fixtures and batching according to
 * `config.mode`. Never throws for transport problems: failures come back as unverified
 * decisions so the caller can apply its policy.
 */
export async function decide<K extends string>(
  state: JsonValue,
  questions: Record<K, JevQuestion>,
  config: JevConfig,
): Promise<Record<K, Decision>> {
  const entries = Object.entries(questions) as [K, JevQuestion][];
  const results = await Promise.all(
    entries.map(([, question]) => decideOne(state, question, config)),
  );
  return Object.fromEntries(entries.map(([id], index) => [id, results[index]])) as Record<
    K,
    Decision
  >;
}
