import type { ContractType, Session, SymbolKey } from '@/db/types'

// Canonical option lists for the All-prefixed Pills selectors used on
// Stats, Reports, and the Models editor. `null` is the "All" sentinel.

export const SYMBOL_OPTS = [
  { value: null, label: 'All' },
  { value: 'NQ' as const, label: 'NQ' },
  { value: 'ES' as const, label: 'ES' },
] satisfies Array<{ value: SymbolKey | null; label: string }>

export const CONTRACT_OPTS = [
  { value: null, label: 'All' },
  { value: 'micro' as const, label: 'micro' },
  { value: 'mini' as const, label: 'mini' },
] satisfies Array<{ value: ContractType | null; label: string }>

export const SESSION_OPTS = [
  { value: null, label: 'All' },
  { value: 'pre' as const, label: 'pre' },
  { value: 'am' as const, label: 'am' },
  { value: 'lunch' as const, label: 'lunch' },
  { value: 'pm' as const, label: 'pm' },
  { value: 'aft' as const, label: 'aft' },
] satisfies Array<{ value: Session | null; label: string }>
