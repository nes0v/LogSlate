import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { db } from './schema'
import {
  createAdjustment,
  createTrade,
  deleteAdjustment,
  deleteTrade,
  getTrade,
  listAdjustments,
  listAllTrades,
  listTradesByDate,
  listTradesInRange,
  updateAdjustment,
  updateTrade,
} from './queries'
import { adjustmentDraft, tradeDraft } from '@/test/fixtures'

beforeEach(async () => {
  await db.trades.clear()
  await db.adjustments.clear()
})
afterEach(async () => {
  await db.trades.clear()
  await db.adjustments.clear()
})

describe('trade queries', () => {
  it('createTrade assigns id + timestamps', async () => {
    const t = await createTrade(tradeDraft())
    expect(t.id).toBeTruthy()
    expect(t.created_at).toBeTruthy()
    expect(t.updated_at).toBe(t.created_at)
  })

  it('getTrade round-trips through storage', async () => {
    const t = await createTrade(tradeDraft({ idea: 'read me back' }))
    const fetched = await getTrade(t.id)
    expect(fetched?.idea).toBe('read me back')
  })

  it('updateTrade bumps updated_at', async () => {
    const t = await createTrade(tradeDraft())
    await new Promise(r => setTimeout(r, 2))
    await updateTrade(t.id, { idea: 'updated' })
    const fetched = await getTrade(t.id)
    expect(fetched?.idea).toBe('updated')
    expect(fetched!.updated_at >= t.updated_at).toBe(true)
  })

  it('deleteTrade removes the record', async () => {
    const t = await createTrade(tradeDraft())
    await deleteTrade(t.id)
    expect(await getTrade(t.id)).toBeUndefined()
  })

  it('listTradesByDate filters to a single day', async () => {
    await createTrade(tradeDraft({ trade_date: '2026-04-10' }))
    await createTrade(tradeDraft({ trade_date: '2026-04-10' }))
    await createTrade(tradeDraft({ trade_date: '2026-04-11' }))
    expect(await listTradesByDate('2026-04-10')).toHaveLength(2)
  })

  it('listTradesInRange is inclusive on both ends', async () => {
    await createTrade(tradeDraft({ trade_date: '2026-04-01' }))
    await createTrade(tradeDraft({ trade_date: '2026-04-15' }))
    await createTrade(tradeDraft({ trade_date: '2026-04-30' }))
    await createTrade(tradeDraft({ trade_date: '2026-05-01' }))
    const out = await listTradesInRange('2026-04-01', '2026-04-30')
    expect(out).toHaveLength(3)
  })

  it('listAllTrades returns every stored trade', async () => {
    await createTrade(tradeDraft())
    await createTrade(tradeDraft())
    await createTrade(tradeDraft())
    expect(await listAllTrades()).toHaveLength(3)
  })
})

describe('adjustment queries', () => {
  it('createAdjustment assigns id + timestamps', async () => {
    const a = await createAdjustment(adjustmentDraft())
    expect(a.id).toBeTruthy()
    expect(a.created_at).toBe(a.updated_at)
  })

  it('updateAdjustment bumps updated_at', async () => {
    const a = await createAdjustment(adjustmentDraft({ amount: 100 }))
    await new Promise(r => setTimeout(r, 2))
    await updateAdjustment(a.id, { amount: 200 })
    const [fetched] = await listAdjustments()
    expect(fetched.amount).toBe(200)
    expect(fetched.updated_at >= a.updated_at).toBe(true)
  })

  it('deleteAdjustment removes the record', async () => {
    const a = await createAdjustment(adjustmentDraft())
    await deleteAdjustment(a.id)
    expect(await listAdjustments()).toHaveLength(0)
  })

  it('listAdjustments orders by date', async () => {
    await createAdjustment(adjustmentDraft({ date: '2026-04-20' }))
    await createAdjustment(adjustmentDraft({ date: '2026-04-01' }))
    await createAdjustment(adjustmentDraft({ date: '2026-04-10' }))
    const out = await listAdjustments()
    expect(out.map(a => a.date)).toEqual(['2026-04-01', '2026-04-10', '2026-04-20'])
  })
})
