import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { JevAnswer, JevQuestion, JsonValue } from './types.js';

/** One recorded answer, stored as `<fixturesDir>/<key>.json`. */
export interface Fixture {
  key: string;
  model: string;
  recordedAt: string;
  question: JevQuestion;
  stateExcerpt: string;
  answer: JevAnswer;
}

const memory = new Map<string, JevAnswer>();

/** In-process cache keyed by content hash. */
export const memoryCache = {
  get: (key: string): JevAnswer | undefined => memory.get(key),
  set: (key: string, answer: JevAnswer): void => {
    memory.set(key, answer);
  },
  clear: (): void => memory.clear(),
  get size(): number {
    return memory.size;
  },
};

function excerpt(state: JsonValue): string {
  const text = typeof state === 'string' ? state : JSON.stringify(state);
  return text.length > 500 ? `${text.slice(0, 500)}…` : text;
}

/** Reads a fixture; returns `undefined` when absent or unreadable. */
export function readFixture(dir: string, key: string): Fixture | undefined {
  try {
    const parsed = JSON.parse(readFileSync(join(dir, `${key}.json`), 'utf8')) as Fixture;
    return parsed.answer ? parsed : undefined;
  } catch {
    return undefined;
  }
}

/** Writes a fixture atomically (temp file + rename), safe across parallel workers. */
export function writeFixture(
  dir: string,
  key: string,
  data: { model: string; question: JevQuestion; state: JsonValue; answer: JevAnswer },
): void {
  mkdirSync(dir, { recursive: true });
  const fixture: Fixture = {
    key,
    model: data.model,
    recordedAt: new Date().toISOString(),
    question: data.question,
    stateExcerpt: excerpt(data.state),
    answer: data.answer,
  };
  const target = join(dir, `${key}.json`);
  const temp = `${target}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(temp, `${JSON.stringify(fixture, null, 2)}\n`, 'utf8');
  renameSync(temp, target);
}
