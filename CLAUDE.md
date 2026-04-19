# logslate

Personal trading journal for index futures (NQ, ES). Replaces a Google Sheets workflow. Single-user, single-device-at-a-time, client-only PWA. No server, no backend, no auth.

## Stack

- **Vite 7 + React 19 + TypeScript**
- **Tailwind CSS v4** via `@tailwindcss/vite` (theme via `@theme` block in `src/index.css`, CSS variables, dark-only)
- **React Router 7** (data router via `createBrowserRouter` in `src/router.tsx`)
- **Dexie.js** over IndexedDB — the source of truth on every device
- **react-hook-form + zod** for form state and validation
- **Recharts** for charts, **date-fns** for time math
- **vite-plugin-pwa** for installable PWA + service worker
- **Google Identity Services + Google Drive API v3** for auto-sync (step 8)
- `lucide-react` for icons, `clsx + tailwind-merge` via `cn()` in `src/lib/utils.ts`

Not using: Next.js, any server, hosted DB, auth system, shadcn CLI (we hand-write small components; shadcn can be added later if needed).

## Commands

- `npm run dev` — start dev server (default Vite port)
- `npm run build` — typecheck + production build
- `npm run preview` — preview production build
- `npm run lint` — ESLint

## Domain model

Trading NQ (Nasdaq-100) and ES (S&P 500) index futures, both micro and mini contracts.

Point ("handle") values by symbol:
- NQ (mini): $20 per handle | MNQ (micro): $2 per handle
- ES (mini): $50 per handle | MES (micro): $5 per handle

Sessions: `pre | AM | LT | PM | aft` (pre-market, morning, lunch, evening, after-hours).

### Trade schema (v1)

**Stored fields (user enters):**
- `symbol` (NQ | ES), `contract_type` (micro | mini), `session`
- `idea` (free text)
- `buys[]` — array of `{ price, time, contracts }`
- `sells[]` — array of `{ price, time, contracts }`
- `stop_loss` USD, `drawdown` USD (MAE), `buildup` USD (MFE)
- `planned_rr` — integer 1–7 (1x..7x only, no decimals)
- `rating` — 👍 good | 🔥 excellent | 🥚 meh
- `pnl` USD — auto-computed by default, with manual override allowed
- `screenshot` — image (base64 inline in IndexedDB for v1)

**Computed / derived (never stored):**
- `side` (long/short) — inferred from first action: first `sell` → short, first `buy` → long
- `trade_date` — set by the day-click in the month calendar view (UX sets it, not a form field)
- `duration` (total) and `duration_before_first_exit`
- `total_contracts` — sum of contracts on one side (buys and sells match for closed trades)
- `fees` — total sides × $0.62 (e.g. 1 buy + 1 sell = $1.24)
- `ahpc` (average handles per contract) = weighted_avg_exit_price − weighted_avg_entry_price (sign-flipped for shorts)
- `realized_rr` = pnl / stop_loss

## Architecture

- **Data:** Dexie over IndexedDB (`src/db/`). Live queries via `dexie-react-hooks`.
- **Sync:** Google Drive auto-sync using `appDataFolder` (app-scoped, invisible in user's normal Drive UI). Pull → merge per-trade by `updated_at` → push. Debounced writes.
- **Screenshots:** inline as base64 in the trade record for v1. If the sync file grows too large (~>20MB), extract to separate Drive files.
- **Routing:** see `src/router.tsx`.

## Conventions

- Path alias: `@/` → `src/`
- Tailwind v4: theme tokens live in `@theme` in `src/index.css`. Use the CSS-variable arbitrary-value syntax: `text-(--color-accent)`, `bg-(--color-panel)`.
- Dark-only UI (no light theme). Color tokens are the only source of truth for colors.
- `verbatimModuleSyntax: true` → use `import type { ... }` for type-only imports.
- Keep stored-vs-computed boundary crisp: computed fields are derived on read from `src/lib/trade-math.ts`, never persisted.
- Numbers: store `number` (JS floats). Money values are USD; format at the edge with `Intl.NumberFormat`.
- Times: store ISO strings (UTC). Use date-fns for all computation.

## PWA

- Service worker via `vite-plugin-pwa` with `registerType: 'autoUpdate'`.
- Target device: Android (Chrome "Install app"). Desktop Chrome also supported.
- No offline syncing — Drive pull/push happens when online; app runs fully offline otherwise.

## Memory system

Persistent memory about this project lives in `/home/nuts/.claude/projects/-home-nuts-nuts-logslate/memory/`. Check `MEMORY.md` there for the current index.

Relevant memories:
- `project_trade_schema.md` — authoritative schema (matches the section above)
- `project_deployment_constraint.md` — no-server rule, Drive-sync rule, Android target
- `user_trading.md` — user's trading profile (symbols, sessions, handle values)
