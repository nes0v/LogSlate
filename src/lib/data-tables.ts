// Every table that sync and backup carry, keyed by its name in the on-disk
// JSON file. Adding a table here is all either needs.

import { db } from '@/db/schema'

export const DATA_TABLES = [
  { fileKey: 'trades',          table: () => db.trades },
  { fileKey: 'adjustments',     table: () => db.adjustments },
  { fileKey: 'accounts',        table: () => db.accounts },
  { fileKey: 'days',            table: () => db.days },
  { fileKey: 'models',          table: () => db.models },
  { fileKey: 'symbols',         table: () => db.symbols },
  { fileKey: 'progress_rules',  table: () => db.progress_rules },
  { fileKey: 'progress_checks', table: () => db.progress_checks },
  { fileKey: 'news',            table: () => db.news },
] as const

export type DataTableKey = (typeof DATA_TABLES)[number]['fileKey']

export const DATA_TABLE_KEYS: DataTableKey[] = DATA_TABLES.map(t => t.fileKey)
