import { useAccountBasis } from '@/lib/use-account-basis'

/**
 * The active account's opening capital, or `undefined` while the row loads —
 * for callers that need only the balance. Every windowed equity calculation
 * starts from this rather than from 0; fold it into the `loaded` gate. Callers
 * that also need the loss limit use `useAccountBasis` directly, so the row is
 * subscribed to once.
 */
export function useStartingBalance(): number | undefined {
  return useAccountBasis()?.startingBalance
}
