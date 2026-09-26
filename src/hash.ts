import { createHash } from 'node:crypto';
import type { JevQuestion, JsonValue } from './types.js';

/** JSON with sorted keys, so logically equal values hash identically. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(',')}}`;
}

/** Short sha256 hex digest of the canonical JSON of `value`. */
export function hashOf(value: unknown): string {
  return createHash('sha256').update(canonicalJson(value)).digest('hex');
}

/** Cache and fixture key for one question about one state under one model. */
export function questionKey(model: string, state: JsonValue, question: JevQuestion): string {
  return hashOf({ model, state, question }).slice(0, 32);
}
