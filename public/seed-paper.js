// Paper-account seed for May 2025 → May 2026 (12 months).
// Use via: fetch('/seed-paper.js').then(r => r.text()).then(eval)
// Skips weekends. 3-5 days/week, 1-3 trades/day.
// PNL is back-computed to land in [-40, +120] per trade.
//
// May 4 2026 is hand-shaped: exactly 8 trades —
//   2 reversal trades (one pair: prev's last exec price+time == next's first)
//   2 'excellent' (3-star)
//   1 'good' (2-star)
//   3 'poor' (1-star)

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
const EMS = ['calm', 'focused', 'anxious', 'fearful', 'impatient', 'frustrated', 'tired', 'greedy']
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
const SPECIAL_DATE = '2026-05-04'

const iso = (date, totalMin) => {
  const h = Math.floor(totalMin / 60)
  const m = totalMin % 60
  const hh = String(h).padStart(2, '0')
  const mm = String(m).padStart(2, '0')
  return date + 'T' + hh + ':' + mm + ':00.000Z'
}
const sessionFor = totalMin => SESS.find(s => totalMin >= s.a && totalMin <= s.b)?.n ?? 'aft'

// Build a trade with a target net PNL inside [-40, +120], or with an
// explicit override. Returns the trade record only — doesn't mutate.
function makeTrade({ date, sym, ct, startMin, endMin, long, rating, entryOverride, exitOverride, contracts }) {
  const [pa, pb] = PR[sym]
  const cnt = contracts ?? ri(1, 3)
  const hv = HV[sym + '-' + ct]
  const fees = 2 * cnt * FEE[ct]
  const entry = entryOverride ?? Math.round(rand(pa, pb) * 100) / 100
  let exit
  if (exitOverride !== undefined) {
    exit = exitOverride
  } else {
    const targetPnl = ri(-40, 120)
    const gross = targetPnl + fees
    const diff = gross / (cnt * hv)
    exit = Math.round((entry + (long ? diff : -diff)) * 100) / 100
  }
  const sl = ri(20, 100) * (ct === 'mini' ? 5 : 1)
  const dd = Math.random() < 0.7 ? ri(0, Math.round(sl * 0.8)) : null
  const bu = Math.random() < 0.7 ? ri(0, Math.round(sl * 1.5)) : null
  return {
    id: uuid(),
    account_id: paper.id,
    date,
    symbol: sym,
    contract_type: ct,
    session: sessionFor(startMin),
    idea: pick(IDEAS),
    executions: [
      { kind: long ? 'buy' : 'sell', order_type: 'limit', price: entry, time: iso(date, startMin), contracts: cnt },
      { kind: long ? 'sell' : 'buy', order_type: 'limit', price: exit, time: iso(date, endMin), contracts: cnt },
    ],
    stop_loss: sl,
    profit_target: sl * ri(1, 3),
    drawdown: dd,
    runup: bu,
    rating: rating ?? pick(RATES),
    emotion: pick(EMS),
    screenshot: null,
    created_at: now,
    updated_at: now,
  }
}

const now = new Date().toISOString()
const out = []

// --- The fixed-shape May 4 2026 day --------------------------------
// Reversal pair: trade A closes long at P,T; trade B opens short at P,T.
// `isReversal()` requires same symbol + contract_type + opposite sides
// + identical price/time on the join, so we share entry-of-B with
// exit-of-A exactly.
const revSym = 'NQ'
const revCt = 'micro'
const revPriceA = 21000
const flipPrice = Math.round((revPriceA + rand(-15, 15)) * 100) / 100
const revStartA = SESS.find(s => s.n === 'am').a + 5
const flipMin = revStartA + 25
const revEndB = flipMin + 30
out.push(
  makeTrade({
    date: SPECIAL_DATE,
    sym: revSym,
    ct: revCt,
    startMin: revStartA,
    endMin: flipMin,
    long: true,
    rating: pick(RATES),
    entryOverride: revPriceA,
    exitOverride: flipPrice,
    contracts: 2,
  }),
  makeTrade({
    date: SPECIAL_DATE,
    sym: revSym,
    ct: revCt,
    startMin: flipMin,
    endMin: revEndB,
    long: false,
    rating: pick(RATES),
    entryOverride: flipPrice,
    contracts: 2,
  }),
)

// Six more, with the requested rating distribution. Walk the cursor
// forward through the session bands so the trades read chronologically.
const otherRatings = ['excellent', 'excellent', 'good', 'poor', 'poor', 'poor']
let cursor = revEndB + 30
for (const r of otherRatings) {
  // Pick the earliest session where the cursor still fits with room
  // for a trade. Past the end, clamp into `aft`.
  const sBucket =
    SESS.find(s => cursor <= s.b - 30) ?? SESS[SESS.length - 1]
  const start = Math.max(sBucket.a, Math.min(cursor, sBucket.b - 30))
  const end = Math.min(start + ri(5, 60), sBucket.b)
  out.push(
    makeTrade({
      date: SPECIAL_DATE,
      sym: pick(SYMS),
      ct: pick(CTS),
      startMin: start,
      endMin: end,
      long: Math.random() < 0.5,
      rating: r,
    }),
  )
  cursor = end + ri(15, 60)
}

// --- Random fill for May 2025 → May 2026 (skipping the special day) ---
const startYM = { y: 2025, m: 5 }
const endYM = { y: 2026, m: 5 }
const months = []
for (let y = startYM.y, m = startYM.m; y < endYM.y || (y === endYM.y && m <= endYM.m); ) {
  months.push({ y, m })
  m++
  if (m > 12) { m = 1; y++ }
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
    if (date === SPECIAL_DATE) continue
    days.push(date)
  }
  // Bucket by ISO week-of-month so a month always has 3-5 trading
  // days per week, not a clump in week 1.
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

for (const date of picked) {
  const tradeCount = ri(1, 3)
  for (let i = 0; i < tradeCount; i++) {
    const sym = pick(SYMS)
    const ct = pick(CTS)
    const s = pick(SESS)
    const start = ri(s.a, s.b - 30)
    const end = Math.min(start + ri(5, 60), s.b)
    out.push(
      makeTrade({
        date,
        sym,
        ct,
        startMin: start,
        endMin: end,
        long: Math.random() < 0.5,
      }),
    )
  }
}

const store = tx.objectStore('trades')
for (const t of out) store.put(t)
await new Promise((res, rej) => {
  tx.oncomplete = res
  tx.onerror = () => rej(tx.error)
})
console.log(
  'inserted ' + out.length + ' trades; ' +
  out.filter(t => t.date === SPECIAL_DATE).length + ' on ' + SPECIAL_DATE +
  ' across ' + (picked.size + 1) + ' day(s)',
)
})()
