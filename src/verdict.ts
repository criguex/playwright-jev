/** Three-valued truth used to combine claims: `yes`, `no` or `ambiguous`. */
export type Truth = 'yes' | 'no' | 'ambiguous';

/** Maps a noul probability onto yes / no / ambiguous. */
export function noulTruth(probability: number, threshold: number): Truth {
  if (probability >= threshold - 1e-9) return 'yes';
  if (probability <= 1 - threshold + 1e-9) return 'no';
  return 'ambiguous';
}

/** Kleene AND: any `no` is `no`; all `yes` is `yes`; otherwise `ambiguous`. */
export function allOf(values: readonly Truth[]): Truth {
  if (values.includes('no')) return 'no';
  return values.every((v) => v === 'yes') ? 'yes' : 'ambiguous';
}

/** Kleene OR: any `yes` is `yes`; all `no` is `no`; otherwise `ambiguous`. */
export function anyOf(values: readonly Truth[]): Truth {
  if (values.includes('yes')) return 'yes';
  return values.every((v) => v === 'no') ? 'no' : 'ambiguous';
}
