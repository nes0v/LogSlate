// Tiny wrappers around `localStorage` JSON read/write that swallow:
//  - localStorage being unavailable (privacy mode, quota errors)
//  - JSON parse failures (corrupt entry from a previous schema)
//  - shape mismatches from a previous version of the app
//
// Each caller supplies a validator that returns the parsed value when
// the shape matches and `null` otherwise; the helper returns the
// validator's value or the supplied `fallback` on any error path.

export function loadJsonFromStorage<T>(
  key: string,
  validate: (raw: unknown) => T | null,
  fallback: T,
): T {
  try {
    const raw = localStorage.getItem(key)
    if (raw === null) return fallback
    const parsed = JSON.parse(raw) as unknown
    const v = validate(parsed)
    return v === null ? fallback : v
  } catch {
    return fallback
  }
}

export function saveJsonToStorage(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    // localStorage unavailable — caller proceeds without persistence.
  }
}

export function removeFromStorage(key: string): void {
  try {
    localStorage.removeItem(key)
  } catch {
    // localStorage unavailable — no-op.
  }
}

/**
 * Removes every key starting with `prefix`.
 *
 * Collects the doomed keys before deleting any: `localStorage.key(i)` reads a
 * live index, so removing mid-loop shifts everything after it down and skips
 * entries.
 */
export function removeStorageKeysWithPrefix(prefix: string): void {
  try {
    const doomed: string[] = []
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i)
      if (key !== null && key.startsWith(prefix)) doomed.push(key)
    }
    for (const key of doomed) localStorage.removeItem(key)
  } catch {
    // localStorage unavailable — no-op.
  }
}
