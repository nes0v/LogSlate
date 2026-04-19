import type { ContractType, SymbolKey } from '@/db/types'

// USD value of one handle (one point of price movement) for each symbol × contract_type.
// https://www.cmegroup.com/ spec:
//   NQ  mini  = $20/pt      MNQ micro = $2/pt
//   ES  mini  = $50/pt      MES micro = $5/pt
export const HANDLE_VALUE: Record<SymbolKey, Record<ContractType, number>> = {
  NQ: { mini: 20, micro: 2 },
  ES: { mini: 50, micro: 5 },
}

export function handleValue(symbol: SymbolKey, contract_type: ContractType): number {
  return HANDLE_VALUE[symbol][contract_type]
}

// Broker fee per contract per side.
export const FEE_PER_SIDE = 0.62
