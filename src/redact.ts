import type { JsonValue, Redactor } from './types.js';

function luhn(digits: string): boolean {
  let sum = 0;
  let double = false;
  for (let i = digits.length - 1; i >= 0; i -= 1) {
    let d = Number(digits[i]);
    if (double) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
    double = !double;
  }
  return sum % 10 === 0;
}

/** Built-in redactors. Combine them in `configureJev({ redact: [...] })`. */
export const redactors = {
  /** Replaces e-mail addresses with `[email]`. */
  emails: ((text) => text.replace(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g, '[email]')) as Redactor,
  /** Replaces Luhn-valid 13–19 digit card numbers (spaces or dashes allowed) with `[card]`. */
  cardNumbers: ((text) =>
    text.replace(/\b(?:\d[ -]?){12,18}\d\b/g, (match) => {
      const digits = match.replace(/\D/g, '');
      return digits.length >= 13 && digits.length <= 19 && luhn(digits) ? '[card]' : match;
    })) as Redactor,
  /** Replaces any run of `min` or more digits with `[number]`. */
  digitRuns:
    (min = 6): Redactor =>
    (text) =>
      text.replace(new RegExp(`\\d{${min},}`, 'g'), '[number]'),
  /** Replaces every match of `pattern` with `replacement`. */
  pattern:
    (pattern: RegExp, replacement = '[redacted]'): Redactor =>
    (text) =>
      text.replace(
        new RegExp(
          pattern.source,
          pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`,
        ),
        replacement,
      ),
};

/** Applies redactors to every string inside a JSON value. */
export function applyRedaction(value: JsonValue, redact: readonly Redactor[]): JsonValue {
  if (redact.length === 0) return value;
  if (typeof value === 'string') return redact.reduce((text, fn) => fn(text), value);
  if (Array.isArray(value)) return value.map((item) => applyRedaction(item, redact));
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [k, applyRedaction(v, redact)]),
    );
  }
  return value;
}
