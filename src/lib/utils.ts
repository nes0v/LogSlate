import { clsx, type ClassValue } from 'clsx'
import type { Ref, MutableRefObject } from 'react'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/**
 * Extract a user-facing message from a caught value. Replaces the
 * `(e as Error).message ?? String(e)` pattern: `as Error` lies when the
 * thrown value is a string / null / non-Error object, leaving `.message`
 * undefined and the user staring at "undefined".
 */
export function errorMessage(e: unknown): string {
  if (e instanceof Error) return e.message || e.name || 'Error'
  if (typeof e === 'string') return e || 'Error'
  return String(e)
}

/**
 * Combine multiple refs into one callback-ref. Lets a single DOM node be
 * tracked by callers that each need their own ref (e.g. react-hook-form's
 * `register().ref` + a hook's auto-resize ref).
 */
export function mergeRefs<T>(
  ...refs: Array<Ref<T> | null | undefined>
): (value: T | null) => void {
  return value => {
    for (const ref of refs) {
      if (!ref) continue
      if (typeof ref === 'function') ref(value)
      else (ref as MutableRefObject<T | null>).current = value
    }
  }
}
