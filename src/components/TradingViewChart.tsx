import { useEffect, useRef, useState } from 'react'
import {
  CandlestickSeries,
  ColorType,
  CrosshairMode,
  LineSeries,
  LineStyle,
  createChart,
  type CandlestickData,
  type IChartApi,
  type ISeriesApi,
  type ISeriesPrimitive,
  type IPrimitivePaneRenderer,
  type IPrimitivePaneView,
  type LineData,
  type PrimitivePaneViewZOrder,
  type SeriesAttachedParameter,
  TickMarkType,
  type Time,
  type UTCTimestamp,
  type WhitespaceData,
} from 'lightweight-charts'
import { format } from 'date-fns'
import type { CandlePoint } from '@/lib/trade-stats'
import { bucketKeyToTs, type Timeframe } from '@/lib/buckets'
import { themeColor } from '@/lib/theme-colors'
import { formatUsd } from '@/lib/money'
import { cn } from '@/lib/utils'

// Fixed bar width (pixels) so switching timeframes keeps candle size
// constant; changing timeframe then widens / narrows the visible time
// period instead of stretching each bar.
const BAR_SPACING = 10

/**
 * Generates UTC-second timestamps on the selected timeframe's cadence so
 * candles land in consecutive slots (no 90-day gaps between quarterly
 * candles, etc.). Returns enough history + one year of future buffer to
 * keep the time axis populated when the user pans around.
 */
function makeWhitespaceTimestamps(tf: Timeframe): number[] {
  const now = new Date()
  const YEAR = now.getUTCFullYear()
  const out: number[] = []
  if (tf === 'D') {
    const start = Date.UTC(YEAR - 10, 0, 1)
    const end = Date.UTC(YEAR + 1, 11, 31)
    for (let t = start; t <= end; t += 86400_000) out.push(t / 1000)
  } else if (tf === 'W') {
    // Align to Sundays; 15 years of weeks ≈ 780 points.
    const s = new Date(Date.UTC(YEAR - 15, 0, 1))
    s.setUTCDate(s.getUTCDate() - s.getUTCDay())
    const end = Date.UTC(YEAR + 1, 11, 31)
    for (let t = s.getTime(); t <= end; t += 7 * 86400_000) out.push(t / 1000)
  } else if (tf === 'M') {
    for (let y = YEAR - 25; y <= YEAR + 1; y++) {
      for (let m = 0; m < 12; m++) out.push(Date.UTC(y, m, 1) / 1000)
    }
  } else if (tf === 'Q') {
    for (let y = YEAR - 40; y <= YEAR + 1; y++) {
      for (let q = 0; q < 4; q++) out.push(Date.UTC(y, q * 3, 1) / 1000)
    }
  } else {
    for (let y = YEAR - 80; y <= YEAR + 1; y++) out.push(Date.UTC(y, 0, 1) / 1000)
  }
  return out
}

interface AdjustmentLinesPrimitive extends ISeriesPrimitive<Time> {
  setAdjustments(list: Array<{ ts: number }>): void
  setColor(color: string): void
}

interface CrosshairPrimitive extends ISeriesPrimitive<Time> {
  setPosition(pos: { x: number; y: number } | null): void
  setHoveredPaneIndex(idx: number | null): void
  setColor(color: string): void
}

interface CandleHoverPrimitive extends ISeriesPrimitive<Time> {
  setHoveredTime(t: number | null): void
  setCandles(map: Map<number, CandlestickData<UTCTimestamp>>): void
}

/**
 * Paints a white 1px outline + wick on top of the currently-hovered candle.
 * Reads open/high/low/close from a caller-provided map and converts them to
 * canvas coords via the attached series' priceToCoordinate. Runs at
 * `zOrder: 'top'` so it sits above the candles.
 */
// Mirror of lightweight-charts's internal `optimalCandlestickWidth` — the
// only way to land the hover border exactly on the rendered body edges is
// to reuse the library's exact width algorithm (copied from
// `PaneRendererCandlesticks` in lightweight-charts 5.x).
function optimalCandlestickWidth(barSpacing: number, pixelRatio: number): number {
  const specialFrom = 2.5
  const specialTo = 4
  if (barSpacing >= specialFrom && barSpacing <= specialTo) {
    return Math.floor(3 * pixelRatio)
  }
  const reducing = 0.2
  const coeff = 1 - (reducing * Math.atan(Math.max(specialTo, barSpacing) - specialTo)) / (Math.PI * 0.5)
  const res = Math.floor(barSpacing * coeff * pixelRatio)
  const scaled = Math.floor(barSpacing * pixelRatio)
  return Math.max(Math.floor(pixelRatio), Math.min(res, scaled))
}

function createCandleHoverPrimitive(): CandleHoverPrimitive {
  let chart: IChartApi | null = null
  let series: ISeriesApi<'Candlestick'> | null = null
  let requestUpdate: (() => void) | null = null
  let hoveredTime: number | null = null
  let candles = new Map<number, CandlestickData<UTCTimestamp>>()

  const renderer: IPrimitivePaneRenderer = {
    draw(target) {
      if (hoveredTime === null || !chart || !series) return
      const candle = candles.get(hoveredTime)
      if (!candle) return
      const timeScale = chart.timeScale()
      const xc = timeScale.timeToCoordinate(hoveredTime as UTCTimestamp)
      if (xc === null) return
      const yHi = series.priceToCoordinate(candle.high)
      const yLo = series.priceToCoordinate(candle.low)
      const yTop = series.priceToCoordinate(Math.max(candle.open, candle.close))
      const yBot = series.priceToCoordinate(Math.min(candle.open, candle.close))
      if (yHi === null || yLo === null || yTop === null || yBot === null) return
      const barSpacing = timeScale.options().barSpacing

      target.useBitmapCoordinateSpace(scope => {
        const ctx = scope.context
        const { horizontalPixelRatio: hx, verticalPixelRatio: vy } = scope
        ctx.save()
        ctx.fillStyle = '#ffffff'

        // Match lightweight-charts's internal candle geometry exactly.
        let barWidth = optimalCandlestickWidth(barSpacing, hx)
        if (barWidth >= 2) {
          const wickW = Math.floor(hx)
          if (wickW % 2 !== barWidth % 2) barWidth--
        }
        const scaledX = Math.round(xc * hx)
        const left = scaledX - Math.floor(barWidth * 0.5)
        const right = left + barWidth - 1
        const top = Math.round(yTop * vy)
        const bottom = Math.round(yBot * vy)
        const high = Math.round(yHi * vy)
        const low = Math.round(yLo * vy)

        // Wick — same 1-pixel column the renderer paints into.
        let wickWidth = Math.min(Math.floor(hx), Math.floor(barSpacing * hx))
        wickWidth = Math.max(Math.floor(hx), Math.min(wickWidth, barWidth))
        const wickLeft = scaledX - Math.floor(wickWidth * 0.5)
        if (top > high) ctx.fillRect(wickLeft, high, wickWidth, top - high)
        if (low > bottom) ctx.fillRect(wickLeft, bottom + 1, wickWidth, low - bottom)

        // Inset body border — four 1-device-pixel rects aligned to the
        // body's outermost pixel rows/columns, so it overlays the existing
        // border without extending the candle's footprint.
        const bodyWidth = right - left + 1
        const bodyHeight = bottom - top + 1
        if (bodyWidth > 0 && bodyHeight > 0) {
          ctx.fillRect(left, top, bodyWidth, 1)
          ctx.fillRect(left, bottom, bodyWidth, 1)
          ctx.fillRect(left, top, 1, bodyHeight)
          ctx.fillRect(right, top, 1, bodyHeight)
        }
        ctx.restore()
      })
    },
  }

  const paneView: IPrimitivePaneView = {
    zOrder(): PrimitivePaneViewZOrder {
      return 'top'
    },
    renderer() {
      return renderer
    },
  }

  return {
    attached(param: SeriesAttachedParameter<Time>) {
      chart = param.chart
      series = param.series as ISeriesApi<'Candlestick'>
      requestUpdate = param.requestUpdate
    },
    detached() {
      chart = null
      series = null
      requestUpdate = null
    },
    updateAllViews() {
      /* renderer reads latest state */
    },
    paneViews() {
      return [paneView]
    },
    setHoveredTime(t) {
      if (t === hoveredTime) return
      hoveredTime = t
      requestUpdate?.()
    },
    setCandles(m) {
      candles = m
      requestUpdate?.()
    },
  }
}

/**
 * Draws our own crosshair — vertical + horizontal dashed lines at the
 * current mouse position — on the chart canvas with `zOrder: 'bottom'`,
 * so the crosshair sits BEHIND the candles. The built-in crosshair lines
 * are hidden (their labels stay visible).
 */
function createCrosshairPrimitive(opts: { ownPaneIndex: number }): CrosshairPrimitive {
  const ownPaneIndex = opts.ownPaneIndex
  let requestUpdate: (() => void) | null = null
  let position: { x: number; y: number } | null = null
  let hoveredPaneIndex: number | null = null
  let color = '#8b91a1'

  const renderer: IPrimitivePaneRenderer = {
    // Crosshair lines also sit behind the candles — `drawBackground`, not
    // `draw`. `zOrder: 'bottom'` alone only orders primitives WITHIN the
    // same pass.
    drawBackground(target) {
      const pos = position
      if (!pos) return
      target.useBitmapCoordinateSpace(scope => {
        const ctx = scope.context
        const { bitmapSize, horizontalPixelRatio: hx, verticalPixelRatio: vy } = scope
        ctx.save()
        ctx.strokeStyle = color
        ctx.lineWidth = 1
        ctx.setLineDash([4 * hx, 6 * hx])
        const px = Math.round(pos.x * hx) + 0.5
        ctx.beginPath()
        ctx.moveTo(px, 0)
        ctx.lineTo(px, bitmapSize.height)
        ctx.stroke()
        // Horizontal line only in the pane the cursor is actually in —
        // `pos.y` from subscribeCrosshairMove is pane-local, so drawing
        // it in the other pane would stamp a phantom line at a wrong y.
        if (hoveredPaneIndex === ownPaneIndex) {
          const py = Math.round(pos.y * vy) + 0.5
          ctx.beginPath()
          ctx.moveTo(0, py)
          ctx.lineTo(bitmapSize.width, py)
          ctx.stroke()
        }
        ctx.restore()
      })
    },
    draw() {
      /* nothing in the foreground layer */
    },
  }

  const paneView: IPrimitivePaneView = {
    zOrder(): PrimitivePaneViewZOrder {
      return 'bottom'
    },
    renderer() {
      return renderer
    },
  }

  return {
    attached(param: SeriesAttachedParameter<Time>) {
      requestUpdate = param.requestUpdate
    },
    detached() {
      requestUpdate = null
    },
    updateAllViews() {
      /* renderer reads latest state each draw */
    },
    paneViews() {
      return [paneView]
    },
    setPosition(pos) {
      position = pos
      requestUpdate?.()
    },
    setHoveredPaneIndex(idx) {
      hoveredPaneIndex = idx
      requestUpdate?.()
    },
    setColor(c) {
      color = c
      requestUpdate?.()
    },
  }
}

/**
 * Custom lightweight-charts series primitive that draws sparse-dotted
 * vertical lines for deposit/withdrawal dates. Uses `zOrder: 'bottom'` so
 * the lines sit BEHIND the candles on the chart's own canvas (DOM overlays
 * can only paint above the canvas, so this is the only way to get them
 * under the data).
 */
function createAdjustmentLinesPrimitive(): AdjustmentLinesPrimitive {
  let chart: IChartApi | null = null
  let requestUpdate: (() => void) | null = null
  let adjustments: Array<{ ts: number }> = []
  let color = '#6b7280'

  const renderer: IPrimitivePaneRenderer = {
    // `drawBackground` (vs `draw`) paints BEHIND the series — so the
    // dashed lines sit under the candles.
    drawBackground(target) {
      if (!chart) return
      const timeScale = chart.timeScale()
      target.useBitmapCoordinateSpace(scope => {
        const ctx = scope.context
        const { bitmapSize, horizontalPixelRatio: hx, verticalPixelRatio: vy } = scope
        ctx.save()
        ctx.strokeStyle = color
        ctx.lineWidth = 1
        ctx.setLineDash([4 * hx, 6 * hx])
        // Lines start just below the adjustment amount label (label height
        // ≈ 18px at fontSize 12, pinned at top: 4) so the label text
        // doesn't sit on top of the dotted line.
        const topY = Math.round(22 * vy) + 0.5
        for (const a of adjustments) {
          const x = timeScale.timeToCoordinate(a.ts as UTCTimestamp)
          if (x === null) continue
          const px = Math.round(x * hx) + 0.5
          ctx.beginPath()
          ctx.moveTo(px, topY)
          ctx.lineTo(px, bitmapSize.height)
          ctx.stroke()
        }
        ctx.restore()
      })
    },
    draw() {
      /* nothing in the foreground layer */
    },
  }

  const paneView: IPrimitivePaneView = {
    zOrder(): PrimitivePaneViewZOrder {
      return 'bottom'
    },
    renderer() {
      return renderer
    },
  }

  return {
    attached(param: SeriesAttachedParameter<Time>) {
      chart = param.chart
      requestUpdate = param.requestUpdate
    },
    detached() {
      chart = null
      requestUpdate = null
    },
    updateAllViews() {
      /* renderer re-reads latest state each draw */
    },
    paneViews() {
      return [paneView]
    },
    setAdjustments(list) {
      adjustments = list
      requestUpdate?.()
    },
    setColor(c) {
      color = c
      requestUpdate?.()
    },
  }
}

const MONTH = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/**
 * Time-axis label formatter tuned per timeframe. For Q/Y we squelch the
 * defaults on non-boundary ticks and relabel the remaining ticks with
 * `Q1`/`Q2` etc. D and W fall through to sensible default-like labels
 * driven by the `tickMarkType` provided by lightweight-charts.
 */
function makeTickFormatter(tf: Timeframe) {
  // M / Q / Y buckets cover long periods, so day-level tick labels add
  // noise — we suppress DayOfMonth ticks and show only Month names + Year
  // markers. D and W keep the full Year / Month / DayOfMonth cascade.
  const coarse = tf === 'M' || tf === 'Q' || tf === 'Y'
  return (time: Time, type: TickMarkType): string => {
    if (typeof time !== 'number') return ''
    const d = new Date(time * 1000)
    switch (type) {
      case TickMarkType.Year:
        return String(d.getUTCFullYear())
      case TickMarkType.Month:
        return MONTH[d.getUTCMonth()]
      case TickMarkType.DayOfMonth:
        return coarse ? '' : String(d.getUTCDate())
      default:
        return ''
    }
  }
}

interface TradingViewChartProps {
  points: CandlePoint[]
  height?: number
  onPointClick?: (key: string) => void
  /** Visual theme. `slate` = grey surface + mono candles; `dark` = app
   *  panel color + green/red candles. */
  variant?: 'slate' | 'dark'
  title?: string
  /** Deposit (+) / withdrawal (−) markers rendered on the candle timeline. */
  adjustments?: Array<{ x: string; amount: number }>
  /** Bucket timeframe of `points`. Controls the time-axis tick labels. */
  timeframe?: Timeframe
  /** Optional element rendered to the right of the chart title. */
  headerRight?: React.ReactNode
  /** Number of bars to show on initial load / after data/timeframe change.
   *  Keeping this constant across timeframes means candle size stays the
   *  same — a higher timeframe just exposes a proportionally wider time
   *  period. Clamped to a sensible minimum internally. */
  visibleBars?: number
  /** `candles` (default) renders OHLC bars; `line` renders a single
   *  line series using each bucket's close value. Both views share the
   *  same fees pane, crosshair, info row, and click-to-navigate. */
  view?: 'candles' | 'line'
}

/**
 * Equity chart built on TradingView's lightweight-charts (Apache 2.0,
 * canvas-based). Supports a candlestick and a line view, a synced fees
 * pane, deposit/withdrawal annotations, a timeframe-aware axis, and an
 * inline info row that tracks the hovered bucket.
 */
export function TradingViewChart({
  points,
  height = 560,
  onPointClick,
  variant = 'slate',
  title = 'Equity',
  adjustments,
  timeframe = 'D',
  headerRight,
  visibleBars = 30,
  view = 'candles',
}: TradingViewChartProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const chartRef = useRef<IChartApi | null>(null)
  const seriesRef = useRef<ISeriesApi<'Candlestick'> | ISeriesApi<'Line'> | null>(null)
  const feesSeriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null)
  const adjLinesPrimRef = useRef<AdjustmentLinesPrimitive | null>(null)
  const crosshairPrimRef = useRef<CrosshairPrimitive | null>(null)
  const feesCrosshairPrimRef = useRef<CrosshairPrimitive | null>(null)
  const candleHoverPrimRef = useRef<CandleHoverPrimitive | null>(null)
  const feesHoverPrimRef = useRef<CandleHoverPrimitive | null>(null)
  // Single source of truth for per-bucket state — all hit-tests, click
  // navigation, and the hover info row read from this map keyed by the
  // bucket's UTC-second timestamp.
  const pointByTimeRef = useRef<Map<number, CandlePoint>>(new Map())
  const [hoveredPoint, setHoveredPoint] = useState<CandlePoint | null>(null)
  const [adjLabels, setAdjLabels] = useState<Array<{ x: number; amount: number }>>([])
  // Width of the right price-scale column — adjustment labels are clipped
  // at (chartWidth - priceScaleWidth) so their text can't overlap price
  // labels.
  const [priceScaleWidth, setPriceScaleWidth] = useState(0)
  const onClickRef = useRef(onPointClick)
  useEffect(() => {
    onClickRef.current = onPointClick
  }, [onPointClick])

  // Create the chart once on mount; data flows through a separate effect.
  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    const isDark = variant === 'dark'
    // Slate = grey surface + mono candles (white=up, black=down, black
    // wicks + borders). Dark = app panel tones + classic green/red candles
    // without an explicit border stroke.
    const bg = isDark
      ? themeColor('--color-panel', '#12151c')
      : '#9598a1'
    const text = isDark
      ? themeColor('--color-text-dim', '#8b91a1')
      : '#111827'
    const scaleBorder = isDark
      ? themeColor('--color-border', '#232836')
      : '#000000'
    const crosshairColor = isDark
      ? themeColor('--color-text-dim', '#8b91a1')
      : '#1f2937'
    const bodyUp = isDark
      ? themeColor('--color-win', '#22c55e')
      : '#ffffff'
    const bodyDown = isDark
      ? themeColor('--color-loss', '#ef4444')
      : '#000000'
    const candleBorderVisible = !isDark
    const candleStroke = '#000000'
    const wickUp = isDark ? bodyUp : candleStroke
    const wickDown = isDark ? bodyDown : candleStroke
    const crosshairStyle = isDark ? LineStyle.SparseDotted : LineStyle.LargeDashed
    // Slate variant uses a black chip (lightweight-charts auto-picks white
    // text); dark variant uses a light chip so the labels pop against the
    // panel and read as dark text.
    const crosshairLabelBg = isDark ? '#e5e7eb' : '#000000'

    const chart = createChart(container, {
      height,
      layout: {
        background: { type: ColorType.Solid, color: bg },
        textColor: text,
        fontSize: 11,
        attributionLogo: false,
        // Pane separator matches the price / time scale border exactly —
        // same color in idle state and on hover so there's no highlight.
        panes: { separatorColor: scaleBorder, separatorHoverColor: scaleBorder },
      },
      grid: {
        horzLines: { visible: false },
        vertLines: { visible: false },
      },
      rightPriceScale: { borderVisible: true, borderColor: scaleBorder },
      timeScale: {
        borderVisible: true,
        borderColor: scaleBorder,
        timeVisible: false,
        secondsVisible: false,
        barSpacing: BAR_SPACING,
        rightOffset: 5,
      },
      crosshair: {
        mode: CrosshairMode.Normal,
        // Lines hidden — we draw our own via CrosshairPrimitive so they
        // can sit BEHIND the candles. Labels stay visible.
        vertLine: {
          color: crosshairColor,
          style: crosshairStyle,
          width: 1,
          visible: false,
          labelVisible: true,
          labelBackgroundColor: crosshairLabelBg,
        },
        horzLine: {
          color: crosshairColor,
          style: crosshairStyle,
          width: 1,
          visible: false,
          labelVisible: true,
          labelBackgroundColor: crosshairLabelBg,
        },
      },
      autoSize: true,
    })
    chartRef.current = chart

    const series: ISeriesApi<'Candlestick'> | ISeriesApi<'Line'> =
      view === 'line'
        ? chart.addSeries(LineSeries, {
            color: themeColor('--color-line', '#2563eb'),
            lineWidth: 2,
            priceLineVisible: false,
            lastValueVisible: false,
            crosshairMarkerVisible: true,
            crosshairMarkerRadius: 4,
          })
        : chart.addSeries(CandlestickSeries, {
            upColor: bodyUp,
            downColor: bodyDown,
            borderVisible: candleBorderVisible,
            borderUpColor: candleStroke,
            borderDownColor: candleStroke,
            wickUpColor: wickUp,
            wickDownColor: wickDown,
            priceLineVisible: false,
            lastValueVisible: false,
          })
    seriesRef.current = series

    // Fees pane — drawn as candlesticks (open=0, close=fee) so the bar
    // body width matches the equity candles exactly. A histogram would
    // use a different width algorithm and look visibly thicker.
    const feesColor = themeColor('--color-fee', '#f59e0b')
    const feesSeries = chart.addSeries(
      CandlestickSeries,
      {
        upColor: feesColor,
        downColor: feesColor,
        borderVisible: false,
        wickUpColor: feesColor,
        wickDownColor: feesColor,
        priceFormat: { type: 'price', precision: 2, minMove: 0.01 },
        priceLineVisible: false,
        lastValueVisible: false,
      },
      1, // paneIndex 1 = new pane below main.
    )
    feesSeriesRef.current = feesSeries
    // Fixed-height fees pane — the remainder goes to the equity candles,
    // so bumping `height` grows the equity pane without resizing fees.
    const panes = chart.panes()
    if (panes.length >= 2) panes[1].setHeight(160)

    const adjPrim = createAdjustmentLinesPrimitive()
    // Darker, subtler gray than the crosshair — sits a step further back
    // so the two annotation layers are distinguishable.
    adjPrim.setColor(isDark ? '#374151' : '#1f2937')
    series.attachPrimitive(adjPrim)
    adjLinesPrimRef.current = adjPrim

    const crossPrim = createCrosshairPrimitive({ ownPaneIndex: 0 })
    // A darker gray than the theme's text-dim so the crosshair reads
    // clearly without being bright.
    const crossColor = isDark ? '#6b7280' : '#374151'
    crossPrim.setColor(crossColor)
    series.attachPrimitive(crossPrim)
    crosshairPrimRef.current = crossPrim

    // Mirror the vertical cursor line into the fees pane. The horizontal
    // line is gated by `hoveredPaneIndex` so each pane only draws its own
    // horizontal cursor — no ghost line in the other pane.
    const feesCrossPrim = createCrosshairPrimitive({ ownPaneIndex: 1 })
    feesCrossPrim.setColor(crossColor)
    feesSeries.attachPrimitive(feesCrossPrim)
    feesCrosshairPrimRef.current = feesCrossPrim

    // White-border hover is a candle-specific visual — line mode relies
    // on the crosshair marker dot that lightweight-charts draws natively.
    const hoverPrim = view === 'candles' ? createCandleHoverPrimitive() : null
    if (hoverPrim) {
      series.attachPrimitive(hoverPrim)
      candleHoverPrimRef.current = hoverPrim
    }

    // Same white-border hover treatment for the fees pane, minus the
    // pointer-cursor swap and click handling — fee bars aren't clickable.
    const feesHoverPrim = createCandleHoverPrimitive()
    feesSeries.attachPrimitive(feesHoverPrim)
    feesHoverPrimRef.current = feesHoverPrim

    const handleCrosshair = (param: {
      point?: { x: number; y: number }
      time?: Time
      paneIndex?: number
    }) => {
      const pos = param.point ? { x: param.point.x, y: param.point.y } : null
      const paneIdx = typeof param.paneIndex === 'number' ? param.paneIndex : null
      crossPrim.setPosition(pos)
      crossPrim.setHoveredPaneIndex(paneIdx)
      feesCrossPrim.setPosition(pos)
      feesCrossPrim.setHoveredPaneIndex(paneIdx)
      // Hover highlight is gated by the same hit-test as the pointer
      // cursor — the candle only lights up when the mouse is actually
      // over its body or wick, not just in the same time column.
      const overCandle = isOverCandle(param)
      hoverPrim?.setHoveredTime(overCandle && typeof param.time === 'number' ? param.time : null)
      const overFee = isOverFeeCandle(param)
      feesHoverPrim.setHoveredTime(overFee && typeof param.time === 'number' ? param.time : null)
      // Info row appears whenever the crosshair sits over a real bucket
      // — no body-hit-test gate, so "empty candles" (count = 0 slots)
      // still report equity / trades=0 like the old Recharts version.
      const nextPt =
        typeof param.time === 'number'
          ? pointByTimeRef.current.get(param.time as number) ?? null
          : null
      setHoveredPoint(prev => (prev === nextPt ? prev : nextPt))
      // Only equity candles are clickable, so only they swap the cursor
      // to pointer. Fee bars get the hover border but stay default-cursor.
      const el = containerRef.current
      if (el) el.style.cursor = overCandle ? 'pointer' : ''
    }
    chart.subscribeCrosshairMove(handleCrosshair)

    const handleClick = (param: { time?: Time; point?: { x: number; y: number } }) => {
      if (!isOverCandle(param)) return
      const t = param.time
      if (typeof t !== 'number') return
      const key = pointByTimeRef.current.get(t as number)?.key
      if (key) onClickRef.current?.(key)
    }
    chart.subscribeClick(handleClick)

    // Shared hit-test — a point counts as "on the candle" when it falls
    // inside the rendered body rect (extended by 1px on each side for
    // easier clicking) OR near the wick (±3px from centre, between low
    // and high but outside the body's vertical range).
    const BODY_PADDING = 1
    const WICK_HALF = 3
    const isOverCandle = (param: {
      time?: Time
      point?: { x: number; y: number }
      paneIndex?: number
    }) => {
      const t = param.time
      const pt = param.point
      if (typeof t !== 'number' || !pt) return false
      // Only the equity pane (index 0) hosts the main series — hovering
      // the fees pane must never highlight or point-cursor anything here.
      if (param.paneIndex !== 0) return false
      // In line mode, every bucket on the equity pane is clickable —
      // there's no "body" to hit-test against, just a continuous line.
      if (view === 'line') {
        return pointByTimeRef.current.has(t as number)
      }
      const activeSeries = seriesRef.current
      const p = pointByTimeRef.current.get(t as number)
      // `count === 0` buckets exist (equity holds flat) but have no
      // candle to hit — gate them out here so the click handler and the
      // white-border hover ignore them in candle mode.
      if (!activeSeries || !p || p.count === 0 || !chartRef.current) return false
      const xc = chartRef.current.timeScale().timeToCoordinate(t as UTCTimestamp)
      if (xc === null) return false
      const barSpacing = chartRef.current.timeScale().options().barSpacing
      const bodyHalf = Math.max(3, Math.round(barSpacing * 0.78)) / 2
      const yOpen = activeSeries.priceToCoordinate(p.open)
      const yClose = activeSeries.priceToCoordinate(p.close)
      const yHi = activeSeries.priceToCoordinate(p.high)
      const yLo = activeSeries.priceToCoordinate(p.low)
      if (yOpen === null || yClose === null || yHi === null || yLo === null) return false
      const yBodyTop = Math.min(yOpen, yClose)
      const yBodyBot = Math.max(yOpen, yClose)
      const dx = Math.abs(pt.x - xc)
      // Body hit.
      if (pt.y >= yBodyTop && pt.y <= yBodyBot && dx <= bodyHalf + BODY_PADDING) return true
      // Wick hit (above or below the body, narrow central column).
      if (
        ((pt.y >= yHi && pt.y < yBodyTop) || (pt.y > yBodyBot && pt.y <= yLo)) &&
        dx <= WICK_HALF
      ) {
        return true
      }
      return false
    }

    // Fee-bar hit-test — same geometry as `isOverCandle` but scoped to
    // the fees pane (paneIndex 1) and the fees series, using the stored
    // fee values to reconstruct each bar's open=0/close=fee rect.
    const isOverFeeCandle = (param: {
      time?: Time
      point?: { x: number; y: number }
      paneIndex?: number
    }) => {
      const t = param.time
      const pt = param.point
      if (typeof t !== 'number' || !pt) return false
      if (param.paneIndex !== 1) return false
      const fSeries = feesSeriesRef.current
      const p = pointByTimeRef.current.get(t as number)
      if (!fSeries || !p || p.fees <= 0 || !chartRef.current) return false
      const xc = chartRef.current.timeScale().timeToCoordinate(t as UTCTimestamp)
      if (xc === null) return false
      const barSpacing = chartRef.current.timeScale().options().barSpacing
      const bodyHalf = Math.max(3, Math.round(barSpacing * 0.78)) / 2
      const yTop = fSeries.priceToCoordinate(p.fees)
      const yBot = fSeries.priceToCoordinate(0)
      if (yTop === null || yBot === null) return false
      const yBodyTop = Math.min(yTop, yBot)
      const yBodyBot = Math.max(yTop, yBot)
      const dx = Math.abs(pt.x - xc)
      if (pt.y >= yBodyTop && pt.y <= yBodyBot && dx <= bodyHalf + BODY_PADDING) return true
      return false
    }

    return () => {
      chart.unsubscribeClick(handleClick)
      chart.unsubscribeCrosshairMove(handleCrosshair)
      if (adjLinesPrimRef.current) {
        series.detachPrimitive(adjLinesPrimRef.current)
        adjLinesPrimRef.current = null
      }
      if (crosshairPrimRef.current) {
        series.detachPrimitive(crosshairPrimRef.current)
        crosshairPrimRef.current = null
      }
      if (feesCrosshairPrimRef.current) {
        feesSeries.detachPrimitive(feesCrosshairPrimRef.current)
        feesCrosshairPrimRef.current = null
      }
      if (candleHoverPrimRef.current) {
        series.detachPrimitive(candleHoverPrimRef.current)
        candleHoverPrimRef.current = null
      }
      if (feesHoverPrimRef.current) {
        feesSeries.detachPrimitive(feesHoverPrimRef.current)
        feesHoverPrimRef.current = null
      }
      chart.remove()
      chartRef.current = null
      seriesRef.current = null
      feesSeriesRef.current = null
    }
  }, [height, variant, view])

  // Tick-mark formatter follows the active timeframe.
  useEffect(() => {
    const chart = chartRef.current
    if (!chart) return
    chart.applyOptions({
      timeScale: { tickMarkFormatter: makeTickFormatter(timeframe) },
    })
  }, [timeframe])

  useEffect(() => {
    const series = seriesRef.current
    if (!series) return
    // Single pass over `points` — everything downstream (series data,
    // primitives, hit-tests) reads from `pointByTime`.
    const pointByTime = new Map<number, CandlePoint>()
    const candleByTime = new Map<number, CandlestickData<UTCTimestamp>>()
    const feesHoverCandles = new Map<number, CandlestickData<UTCTimestamp>>()
    for (const p of points) {
      const ts = bucketKeyToTs(p.key)
      if (ts === 0) continue
      pointByTime.set(ts, p)
      if (p.count > 0) {
        candleByTime.set(ts, {
          time: ts as UTCTimestamp,
          open: p.open,
          high: p.high,
          low: p.low,
          close: p.close,
        })
      }
      if (p.fees > 0) {
        feesHoverCandles.set(ts, {
          time: ts as UTCTimestamp,
          open: 0,
          high: p.fees,
          low: 0,
          close: p.fees,
        })
      }
    }
    pointByTimeRef.current = pointByTime

    // Whitespace at the timeframe's cadence — candles sit in adjacent
    // slots so bar spacing stays sensible for M/Q/Y (no 90-day gaps
    // between quarterly candles, etc).
    const data: (CandlestickData<UTCTimestamp> | WhitespaceData<UTCTimestamp>)[] = []
    const feesData: (CandlestickData<UTCTimestamp> | WhitespaceData<UTCTimestamp>)[] = []
    let lastCandleIdx = -1
    for (const ts of makeWhitespaceTimestamps(timeframe)) {
      const candle = candleByTime.get(ts)
      if (candle) lastCandleIdx = data.length
      data.push(candle ?? { time: ts as UTCTimestamp })
      feesData.push(feesHoverCandles.get(ts) ?? { time: ts as UTCTimestamp })
    }
    candleHoverPrimRef.current?.setCandles(candleByTime)
    candleHoverPrimRef.current?.setHoveredTime(null)
    feesHoverPrimRef.current?.setCandles(feesHoverCandles)
    feesHoverPrimRef.current?.setHoveredTime(null)
    if (view === 'line') {
      // Line view uses closes only — whitespace slots stay as-is so the
      // x-axis keeps its date coverage outside the candle range.
      const lineData: (LineData<UTCTimestamp> | WhitespaceData<UTCTimestamp>)[] = []
      for (const d of data) {
        lineData.push(
          'close' in d
            ? { time: d.time, value: d.close }
            : { time: d.time },
        )
      }
      ;(series as ISeriesApi<'Line'>).setData(lineData)
    } else {
      ;(series as ISeriesApi<'Candlestick'>).setData(data)
    }
    feesSeriesRef.current?.setData(feesData)
    // Anchor the visible range to the last candle — show `visibleBars`
    // bars to its left plus a small right-edge buffer. Bar spacing
    // auto-fits to the container width, so switching timeframes with
    // the same `visibleBars` keeps each candle the same size and
    // simply widens the time period covered.
    if (lastCandleIdx >= 0) {
      const bars = Math.max(10, visibleBars)
      chartRef.current?.timeScale().setVisibleLogicalRange({
        from: Math.max(0, lastCandleIdx - bars + 1),
        to: lastCandleIdx + 3,
      })
    }
  }, [points, timeframe, visibleBars, view])

  // Deposit/withdrawal annotations:
  //  - sparse-dotted vertical lines painted on the chart canvas UNDER the
  //    candles by the AdjustmentLinesPrimitive (line color = crosshair
  //    colour of the active variant).
  //  - signed amount labels rendered as DOM overlays above the chart so
  //    they sit outside the canvas and stay crisp.
  useEffect(() => {
    const chart = chartRef.current
    if (!chart) return
    const list = adjustments ?? []
    // Feed the primitive so the canvas lines redraw.
    adjLinesPrimRef.current?.setAdjustments(
      list.flatMap(a => {
        const ts = bucketKeyToTs(a.x)
        return ts === 0 ? [] : [{ ts }]
      }),
    )
    const recompute = () => {
      const ts = chart.timeScale()
      const next: Array<{ x: number; amount: number }> = []
      for (const a of list) {
        const t = bucketKeyToTs(a.x)
        if (t === 0) continue
        const x = ts.timeToCoordinate(t as UTCTimestamp)
        if (x === null) continue
        next.push({ x, amount: a.amount })
      }
      setAdjLabels(next)
      setPriceScaleWidth(chart.priceScale('right').width())
    }
    recompute()
    chart.timeScale().subscribeVisibleLogicalRangeChange(recompute)
    chart.timeScale().subscribeSizeChange(recompute)
    return () => {
      chart.timeScale().unsubscribeVisibleLogicalRangeChange(recompute)
      chart.timeScale().unsubscribeSizeChange(recompute)
    }
    // `view` is in the deps because switching between candles and line
    // recreates the chart + series (and with it, a fresh empty
    // AdjustmentLinesPrimitive) — without rerunning this effect the new
    // primitive never receives its data and the dashed lines vanish.
  }, [adjustments, points, view])

  const winColor = themeColor('--color-win', '#22c55e')
  const lossColor = themeColor('--color-loss', '#ef4444')

  return (
    <section className="space-y-2">
      {/* `items-center` + fixed min-height keep the title anchored when the
          hover info row mounts/unmounts — the row is taller than the
          title alone, and `items-end` made the title drift upward. */}
      <div className="flex items-center justify-between gap-4 min-h-[28px]">
        <div className="flex items-center gap-3 min-w-0">
          <h2 className="text-sm font-medium shrink-0">{title}</h2>
          <CandleInfoRow point={hoveredPoint} timeframe={timeframe} />
        </div>
        {headerRight}
      </div>
      <div
        className="relative border border-(--color-border) rounded-md overflow-hidden"
        style={{ width: '100%', height }}
      >
        <div ref={containerRef} style={{ position: 'absolute', inset: 0 }} />
        {/* Adjustment-label overlay clipped to the PLOT AREA only —
            `right: priceScaleWidth` stops labels from reaching into the
            right price-scale column, and `overflow: hidden` hides any
            label whose x is outside the chart. Chart x-coords equal this
            overlay's x-coords (both start at the container's left edge),
            so `left: line.x` still places a label exactly above its
            dashed vertical line. */}
        <div
          className="absolute pointer-events-none"
          style={{
            left: 0,
            right: priceScaleWidth,
            top: 0,
            bottom: 0,
            overflow: 'hidden',
            zIndex: 2,
          }}
        >
          {adjLabels.map((line, i) => {
            const color = line.amount >= 0 ? winColor : lossColor
            const label = `${line.amount >= 0 ? '+' : '−'}$${Math.round(Math.abs(line.amount)).toLocaleString()}`
            return (
              <div
                key={`${line.x}-${i}`}
                className="absolute"
                style={{
                  left: Math.round(line.x),
                  top: 4,
                  transform: 'translateX(-50%)',
                  color,
                  fontSize: 12,
                  fontFamily: 'var(--font-mono)',
                  whiteSpace: 'nowrap',
                }}
              >
                {label}
              </div>
            )
          })}
        </div>
      </div>
    </section>
  )
}

function CandleInfoRow({
  point,
  timeframe,
}: {
  point: CandlePoint | null
  timeframe: Timeframe
}) {
  if (!point) return null
  const dateLabel = formatInfoDate(point.key, timeframe)
  const tradingPnl = point.close - point.open
  const delta = tradingPnl + point.adjustment
  return (
    <div className="flex items-center gap-x-4 text-xs font-mono bg-(--color-panel-2) border border-(--color-border) rounded-md px-2 py-1 pointer-events-none whitespace-nowrap">
      <span className="text-(--color-text-dim)">{dateLabel}</span>
      {point.count > 0 ? (
        <>
          <InfoCell label="O" value={formatUsd(point.open)} />
          <InfoCell label="H" value={formatUsd(point.high)} />
          <InfoCell label="L" value={formatUsd(point.low)} />
          <InfoCell label="C" value={formatUsd(point.close)} />
          {tradingPnl !== 0 && (
            <InfoCell
              label="pnl"
              value={formatUsd(tradingPnl)}
              tone={tradingPnl > 0 ? 'win' : 'loss'}
            />
          )}
          {delta !== 0 && delta !== tradingPnl && (
            <InfoCell
              label="Δ"
              value={formatUsd(delta)}
              tone={delta > 0 ? 'win' : 'loss'}
            />
          )}
          {point.fees > 0 && <InfoCell label="fees" value={formatUsd(point.fees)} />}
          <InfoCell label="trades" value={String(point.count)} />
        </>
      ) : (
        <>
          <InfoCell label="equity" value={formatUsd(point.close)} />
          {point.adjustment !== 0 && (
            <InfoCell
              label="Δ"
              value={formatUsd(point.adjustment)}
              tone={point.adjustment > 0 ? 'win' : 'loss'}
            />
          )}
          <InfoCell label="trades" value="0" />
        </>
      )}
    </div>
  )
}

function InfoCell({
  label,
  value,
  tone,
}: {
  label: string
  value: string
  tone?: 'win' | 'loss' | 'dim'
}) {
  return (
    <span className="inline-flex items-center gap-1">
      <span className="text-(--color-text-dim)">{label}</span>
      <span
        className={cn(
          tone === 'win' && 'text-(--color-win)',
          tone === 'loss' && 'text-(--color-loss)',
          tone === 'dim' && 'text-(--color-text-dim)',
        )}
      >
        {value}
      </span>
    </span>
  )
}

// `key` is the bucket key for the active timeframe — daily bars use
// YYYY-MM-DD, weekly also YYYY-MM-DD, months YYYY-MM, quarters YYYY-Qn,
// years YYYY. Format accordingly so the info row reads naturally.
function formatInfoDate(key: string, tf: Timeframe): string {
  if (tf === 'D' || tf === 'W') {
    return /^\d{4}-\d{2}-\d{2}$/.test(key)
      ? format(new Date(key + 'T00:00:00'), 'MMM d')
      : key
  }
  if (tf === 'M') {
    return /^\d{4}-\d{2}$/.test(key)
      ? format(new Date(key + '-01T00:00:00'), 'MMM yyyy')
      : key
  }
  return key
}
