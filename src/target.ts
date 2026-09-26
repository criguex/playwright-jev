import type { JsonValue } from './types.js';

interface LocatorLike {
  first(): LocatorLike;
  waitFor(options: { state: 'visible'; timeout: number }): Promise<void>;
  allInnerTexts(): Promise<string[]>;
}

interface PageLike {
  locator(selector: string): { innerText(options?: { timeout?: number }): Promise<string> };
  url(): string;
}

interface ResponseLike {
  text(): Promise<string>;
  status(): number;
  url(): string;
}

/** A value a semantic matcher can read. */
export type Readable =
  | { kind: 'static'; describe: string; read: () => Promise<JsonValue> }
  | { kind: 'live'; describe: string; read: (timeoutMs: number) => Promise<JsonValue> };

const isFn = (value: unknown, name: string): boolean =>
  typeof (value as Record<string, unknown>)[name] === 'function';

function isLocator(value: object): value is LocatorLike {
  return isFn(value, 'allInnerTexts') && isFn(value, 'waitFor') && isFn(value, 'first');
}

function isPage(value: object): value is PageLike {
  return isFn(value, 'locator') && isFn(value, 'goto') && isFn(value, 'url');
}

function isResponse(value: object): value is ResponseLike {
  return isFn(value, 'text') && isFn(value, 'status') && isFn(value, 'headers') && !isPage(value);
}

function toJson(value: unknown): JsonValue {
  try {
    const text = JSON.stringify(value);
    if (text === undefined) throw new Error('not serializable');
    return JSON.parse(text) as JsonValue;
  } catch (error) {
    throw new TypeError(`[playwright-jev] receiver is not JSON-serializable: ${String(error)}`, {
      cause: error,
    });
  }
}

/**
 * Turns a matcher receiver into something readable. `Locator` and `Page` are re-read on
 * every poll (web-first); strings, API responses and plain values are read once.
 */
export function readableOf(received: unknown): Readable {
  if (typeof received === 'string') {
    return { kind: 'static', describe: 'string', read: async () => received };
  }
  if (typeof received === 'number' || typeof received === 'boolean') {
    return { kind: 'static', describe: typeof received, read: async () => received };
  }
  if (received === null || received === undefined) {
    throw new TypeError(
      `[playwright-jev] receiver is ${String(received)}; pass a Locator, Page, string or JSON value`,
    );
  }
  if (typeof received === 'object') {
    if (isLocator(received)) {
      return {
        kind: 'live',
        describe: 'locator',
        read: async (timeoutMs) => {
          await received.first().waitFor({ state: 'visible', timeout: Math.max(1, timeoutMs) });
          const texts = await received.allInnerTexts();
          return texts
            .map((t) => t.trim())
            .filter(Boolean)
            .join('\n');
        },
      };
    }
    if (isPage(received)) {
      return {
        kind: 'live',
        describe: 'page',
        read: async (timeoutMs) =>
          (await received.locator('body').innerText({ timeout: Math.max(1, timeoutMs) })).trim(),
      };
    }
    if (isResponse(received)) {
      return {
        kind: 'static',
        describe: 'response',
        read: async () => {
          const text = await received.text();
          try {
            return JSON.parse(text) as JsonValue;
          } catch {
            return text;
          }
        },
      };
    }
    const json = toJson(received);
    return {
      kind: 'static',
      describe: Array.isArray(received) ? 'array' : 'object',
      read: async () => json,
    };
  }
  throw new TypeError(`[playwright-jev] unsupported receiver of type ${typeof received}`);
}

/** Wraps content into the state object sent to Jev, truncating very long text. */
export function buildState(
  content: JsonValue,
  context: string | undefined,
  maxChars: number,
): JsonValue {
  let value = content;
  let truncated = false;
  if (typeof value === 'string' && value.length > maxChars) {
    value = `${value.slice(0, maxChars)}\n[truncated]`;
    truncated = true;
  } else if (typeof value !== 'string') {
    const serialized = JSON.stringify(value);
    if (serialized.length > maxChars) {
      value = `${serialized.slice(0, maxChars)}\n[truncated]`;
      truncated = true;
    }
  }
  const state: { [key: string]: JsonValue } = { content: value };
  if (context) state.context = context;
  if (truncated) state.note = 'content was truncated';
  return state;
}

/** Short printable excerpt of a state for messages and reports. */
export function excerptOf(content: JsonValue, max = 300): string {
  const text = typeof content === 'string' ? content : JSON.stringify(content);
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > max ? `${flat.slice(0, max)}…` : flat;
}
