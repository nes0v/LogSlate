// One-off paper-account seed for the past 11 months ending May 2026.
// Use via: fetch('/seed-may-2026.js').then(r => r.text()).then(eval)
// Skips weekends. Skips May 4 in the current month so prior demo data
// stays untouched. 3-5 days/week, 1-3 trades/day.
// PnL is back-computed to land in [-40, +120] per trade.

;(async () => {
const idb = await new Promise((res, rej) => {
  const r = indexedDB.open('logslate')
  r.onsuccess = () => res(r.result)
  r.onerror = () => rej(r.error)
})
const tx = idb.transaction(['accounts', 'trades'], 'readwrite')
const accounts = await new Promise((res, rej) => {
  const r = tx.objectStore('accounts').getAll()
  r.onsuccess = () => res(r.result)
  r.onerror = () => rej(r.error)
})
const paper = accounts.find(a => a.name.toLowerCase() === 'paper')
if (!paper) throw new Error('no paper account; have: ' + accounts.map(a => a.name).join(','))

const rand = (a, b) => Math.random() * (b - a) + a
const ri = (a, b) => Math.floor(rand(a, b + 1))
const pick = arr => arr[ri(0, arr.length - 1)]
const uuid = () => crypto.randomUUID()

const SYMS = ['NQ', 'ES']
const CTS = ['micro', 'mini']
const RATES = ['poor', 'good', 'excellent']
const EMS = ['calm', 'focused', 'anxious', 'fearful', 'FOMO', 'impatient', 'frustrated', 'tired', 'greedy', 'busy']
const IDEAS = [
  'ORB long off vwap reclaim',
  'Fade pop at resistance',
  'Trend pullback to ema',
  'Range breakout retest',
  'News spike fade',
  'Support bounce',
  'Failed breakdown reclaim',
  'Liquidity grab reversal',
  'Continuation after consolidation',
  'Gap fill play',
]
const PR = { NQ: [20800, 21300], ES: [5750, 5900] }
const HV = { 'NQ-micro': 2, 'NQ-mini': 20, 'ES-micro': 5, 'ES-mini': 50 }
const FEE = { micro: 0.62, mini: 2.25 }
// UTC minute bands map to NY-local sessions assuming +4 (DST):
//   pre   < 09:30 NY  (< 13:30 UTC)
//   am    09:30-11:29 (13:30-15:29 UTC)
//   lunch 11:30-13:29 (15:30-17:29 UTC)
//   pm    13:30-16:59 (17:30-20:59 UTC)
//   aft   >= 17:00    (>= 21:00 UTC)
const SESS = [
  { n: 'pre',   a: 11 * 60,        b: 13 * 60 + 29 },
  { n: 'am',    a: 13 * 60 + 30,   b: 15 * 60 + 29 },
  { n: 'lunch', a: 15 * 60 + 30,   b: 17 * 60 + 29 },
  { n: 'pm',    a: 17 * 60 + 30,   b: 20 * 60 + 59 },
  { n: 'aft',   a: 21 * 60,        b: 22 * 60 },
]

const iso = (date, totalMin) => {
  const h = Math.floor(totalMin / 60)
  const m = totalMin % 60
  const hh = String(h).padStart(2, '0')
  const mm = String(m).padStart(2, '0')
  return date + 'T' + hh + ':' + mm + ':00.000Z'
}

// Anchor on the current month and walk back 10 months for an 11-month window.
const today = new Date()
const months = []
for (let i = 0; i < 11; i++) {
  const d = new Date(today.getUTCFullYear(), today.getUTCMonth() - i, 1)
  months.push({ y: d.getUTCFullYear(), m: d.getUTCMonth() + 1 })
}

const picked = new Set()
for (const { y, m } of months) {
  const ymPrefix = y + '-' + String(m).padStart(2, '0')
  const lastDay = new Date(y, m, 0).getUTCDate()
  const days = []
  for (let d = 1; d <= lastDay; d++) {
    const date = ymPrefix + '-' + String(d).padStart(2, '0')
    const dow = new Date(date + 'T12:00:00Z').getUTCDay()
    if (dow === 0 || dow === 6) continue
    if (date === '2026-05-04') continue
    days.push(date)
  }
  const weeks = new Map()
  for (const d of days) {
    const wk = Math.ceil(parseInt(d.slice(8)) / 7)
    if (!weeks.has(wk)) weeks.set(wk, [])
    weeks.get(wk).push(d)
  }
  for (const [, weekDays] of weeks) {
    const n = ri(3, Math.min(5, weekDays.length))
    const shuffled = [...weekDays].sort(() => Math.random() - 0.5)
    for (const d of shuffled.slice(0, n)) picked.add(d)
  }
}

const now = new Date().toISOString()
const out = []
for (const date of picked) {
  const tradeCount = ri(1, 3)
  for (let i = 0; i < tradeCount; i++) {
    const sym = pick(SYMS)
    const ct = pick(CTS)
    const s = pick(SESS)
    const start = ri(s.a, s.b - 30)
    const end = Math.min(start + ri(5, 60), s.b)
    const long = Math.random() < 0.5
    const [pa, pb] = PR[sym]
    const entry = Math.round(rand(pa, pb) * 100) / 100
    const cnt = ri(1, 3)
    const hv = HV[sym + '-' + ct]
    const fees = 2 * cnt * FEE[ct]
    const targetPnl = ri(-40, 120)
    const gross = targetPnl + fees
    const diff = gross / (cnt * hv)
    const exit = Math.round((entry + (long ? diff : -diff)) * 100) / 100
    const sl = ri(20, 100) * (ct === 'mini' ? 5 : 1)
    const dd = Math.random() < 0.7 ? ri(0, Math.round(sl * 0.8)) : null
    const bu = Math.random() < 0.7 ? ri(0, Math.round(sl * 1.5)) : null
    out.push({
      id: uuid(),
      account_id: paper.id,
      date,
      symbol: sym,
      contract_type: ct,
      session: s.n,
      idea: pick(IDEAS),
      executions: [
        { kind: long ? 'buy' : 'sell', order_type: 'limit', price: entry, time: iso(date, start), contracts: cnt },
        { kind: long ? 'sell' : 'buy', order_type: 'limit', price: exit, time: iso(date, end), contracts: cnt },
      ],
      stop_loss: sl,
      profit_target: sl * ri(1, 3),
      drawdown: dd,
      buildup: bu,
      rating: pick(RATES),
      emotion: pick(EMS),
      screenshot: null,
      created_at: now,
      updated_at: now,
    })
  }
}

const store = tx.objectStore('trades')
for (const t of out) store.put(t)
await new Promise((res, rej) => {
  tx.oncomplete = res
  tx.onerror = () => rej(tx.error)
})
console.log('inserted ' + out.length + ' trades across ' + picked.size + ' day(s) over the past 11 months')
})()
