/**
 * Persisted state defaults pattern per spec §0.2.
 *
 * Rule: every persisted interface ships a `createDefault*()` factory that
 * enumerates ALL field defaults. Every read uses `mergeWithDefaults` to fill
 * missing fields from loaded data. Anti-pattern: `loaded.field` direct, or
 * `{ ...loaded }` shallow spread without merge.
 *
 * Arrays are treated as FULL OVERRIDES, not merged element-wise. This matches
 * user intent for things like roster lists: "I configured these exact 2" should
 * not silently include the 3 defaults.
 */

type Plain = Record<string, unknown>;

function isPlainObject(v: unknown): v is Plain {
  return typeof v === "object" && v !== null && !Array.isArray(v) && Object.getPrototypeOf(v) === Object.prototype;
}

export function deepMerge<T>(base: T, overlay: Partial<T>): T {
  if (!isPlainObject(base) || !isPlainObject(overlay)) {
    return (overlay ?? base) as T;
  }
  const out: Plain = { ...(base as unknown as Plain) };
  for (const [key, value] of Object.entries(overlay as Plain)) {
    if (value === undefined || value === null) {
      // Skip — leave the default
      continue;
    }
    const currentBase = (base as unknown as Plain)[key];
    if (isPlainObject(currentBase) && isPlainObject(value)) {
      out[key] = deepMerge(currentBase, value as Partial<typeof currentBase>);
    } else {
      // Array or primitive: full override
      out[key] = value;
    }
  }
  return out as T;
}

/**
 * Merges `loaded` into `defaults`. Missing/null/undefined fields in `loaded`
 * fall back to the default value.
 */
export function mergeWithDefaults<T>(defaults: T, loaded: Partial<T> | undefined | null): T {
  if (!loaded) return defaults;
  return deepMerge(defaults, loaded);
}
