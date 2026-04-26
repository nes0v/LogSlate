import type { NoteTemplateKind } from '@/db/types'

export interface NoteTemplate {
  kind: NoteTemplateKind
  label: string
  defaultTitle: (date: string) => string
  body: string
}

const PRE_MARKET = `# Pre-Market Game Plan

## Macro / news
- Economic events today:
- Earnings to watch:
- Levels in play (overnight high/low, prior day high/low):

## Bias
- Symbol(s):
- Direction:
- Why (1-2 sentences):
- Invalidation (level / event that flips the bias):

## Setups I'm hunting
1.
2.
3.

## Risk plan
- Max daily loss:
- Max position size:
- Stop trading after:

## Rules I'll follow today
- [ ] Wait for first 5m bar to close before trading
- [ ] No revenge trades
- [ ] Walk away if I hit a 2R loss
`

const WATCHLIST = `# Watchlist

| Symbol | Bias | Trigger level | Stop | Target | Notes |
| --- | --- | --- | --- | --- | --- |
| NQ | long | | | | |
| ES | | | | | |

## Headlines / catalysts
-
`

const REVIEW = `# Daily Review

## Number of trades:
## Net P&L:
## What worked
-
## What didn't
-
## One thing to do better tomorrow
-

## Trade-by-trade notes
1.
2.
3.
`

const LESSON = `# Lesson learned

## Setup / context
-
## What I expected
-
## What actually happened
-
## Why it diverged
-
## Rule to internalise
-
`

const FREE = `# Note

`

export const NOTE_TEMPLATES_LIST: NoteTemplate[] = [
  {
    kind: 'plan',
    label: 'Pre-market plan',
    defaultTitle: d => `Plan — ${d}`,
    body: PRE_MARKET,
  },
  {
    kind: 'watchlist',
    label: 'Watchlist',
    defaultTitle: d => `Watchlist — ${d}`,
    body: WATCHLIST,
  },
  {
    kind: 'review',
    label: 'Daily review',
    defaultTitle: d => `Review — ${d}`,
    body: REVIEW,
  },
  {
    kind: 'lesson',
    label: 'Lesson',
    defaultTitle: () => 'Lesson — ',
    body: LESSON,
  },
  {
    kind: 'free',
    label: 'Blank note',
    defaultTitle: () => 'Untitled',
    body: FREE,
  },
]

export function templateFor(kind: NoteTemplateKind): NoteTemplate {
  return NOTE_TEMPLATES_LIST.find(t => t.kind === kind) ?? NOTE_TEMPLATES_LIST[NOTE_TEMPLATES_LIST.length - 1]
}
