import { useEffect, useRef, useState } from 'react'
import {
  ColorType,
  createChart,
  CandlestickSeries,
  HistogramSeries,
  LineSeries,
} from 'lightweight-charts'
import { api } from '../lib/api.js'
import { useMarket } from '../context/MarketContext.jsx'

const INTERVALS = ['1m', '5m', '15m', '1h', '4h', '1d']
const MA_PERIODS = [7, 25, 99]
const MA_COLORS = { 7: '#f59e0b', 25: '#38bdf8', 99: '#a78bfa' }

const chartOptions = (height) => ({
  height,
  layout: {
    background: { type: ColorType.Solid, color: 'transparent' },
    textColor: '#94a3b8',
    fontSize: 11,
  },
  grid: {
    vertLines: { color: 'rgba(148, 163, 184, 0.08)' },
    horzLines: { color: 'rgba(148, 163, 184, 0.08)' },
  },
  rightPriceScale: { borderColor: 'rgba(148, 163, 184, 0.2)' },
  timeScale: { borderColor: 'rgba(148, 163, 184, 0.2)', timeVisible: true, secondsVisible: false },
  crosshair: { mode: 0 },
  autoSize: true,
})

const sma = (points, period) => {
  const out = []
  let sum = 0
  for (let i = 0; i < points.length; i += 1) {
    sum += points[i].close
    if (i >= period) sum -= points[i - period].close
    if (i >= period - 1) out.push({ time: points[i].time, value: sum / period })
  }
  return out
}

const rsiCalc = (points, period = 14) => {
  const out = []
  let avgGain = 0
  let avgLoss = 0
  for (let i = 1; i < points.length; i += 1) {
    const diff = points[i].close - points[i - 1].close
    const gain = Math.max(diff, 0)
    const loss = Math.max(-diff, 0)
    if (i <= period) {
      avgGain += gain / period
      avgLoss += loss / period
      if (i < period) continue
    } else {
      avgGain = (avgGain * (period - 1) + gain) / period
      avgLoss = (avgLoss * (period - 1) + loss) / period
    }
    const rs = avgLoss === 0 ? 100 : avgGain / avgLoss
    out.push({ time: points[i].time, value: 100 - 100 / (1 + rs) })
  }
  return out
}

const CandleChart = ({ symbol, interval = '1h', height = 420, onIntervalChange }) => {
  const containerRef = useRef(null)
  const rsiContainerRef = useRef(null)
  const chartRef = useRef(null)
  const candleSeriesRef = useRef(null)
  const volumeSeriesRef = useRef(null)
  const maSeriesRef = useRef({})
  const rsiChartRef = useRef(null)
  const rsiSeriesRef = useRef(null)
  const klinesRef = useRef([])
  const syncingRef = useRef(false)
  const lastBarRef = useRef(null)
  const [maOn, setMaOn] = useState({ 7: true, 25: true, 99: false })
  const [rsiOn, setRsiOn] = useState(true)
  const { tickers, lastTick } = useMarket()

  useEffect(() => {
    const el = containerRef.current
    if (!el) return undefined

    const chart = createChart(el, chartOptions(height))
    const candles = chart.addSeries(CandlestickSeries, {
      upColor: '#22c55e',
      downColor: '#ef4444',
      borderVisible: false,
      wickUpColor: '#22c55e',
      wickDownColor: '#ef4444',
      priceFormat: { type: 'price', precision: 2, minMove: 0.01 },
    })
    const volume = chart.addSeries(HistogramSeries, {
      priceFormat: { type: 'volume' },
      priceScaleId: 'volume',
      lastValueVisible: false,
      priceLineVisible: false,
    })
    chart.priceScale('volume').applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } })

    const mas = {}
    for (const p of MA_PERIODS) {
      mas[p] = chart.addSeries(LineSeries, {
        color: MA_COLORS[p],
        lineWidth: 1,
        priceLineVisible: false,
        lastValueVisible: false,
        crosshairMarkerVisible: false,
        visible: !!maOn[p],
      })
    }

    chartRef.current = chart
    candleSeriesRef.current = candles
    volumeSeriesRef.current = volume
    maSeriesRef.current = mas

    return () => {
      chart.remove()
      chartRef.current = null
      candleSeriesRef.current = null
      volumeSeriesRef.current = null
      maSeriesRef.current = {}
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [height])

  // RSI subchart + two-way time-scale sync, mounted only while enabled
  useEffect(() => {
    if (!rsiOn) {
      rsiChartRef.current?.remove()
      rsiChartRef.current = null
      rsiSeriesRef.current = null
      return undefined
    }
    const el = rsiContainerRef.current
    const main = chartRef.current
    if (!el || !main) return undefined

    const chart = createChart(el, chartOptions(96))
    chart.applyOptions({
      rightPriceScale: { borderColor: 'rgba(148, 163, 184, 0.2)', scaleMargins: { top: 0.15, bottom: 0.15 } },
    })
    const series = chart.addSeries(LineSeries, {
      color: '#c084fc',
      lineWidth: 2,
      priceFormat: { type: 'price', precision: 1, minMove: 0.1 },
      priceLineVisible: false,
    })
    series.createPriceLine({ price: 70, color: 'rgba(239,68,68,0.5)', lineWidth: 1, lineStyle: 2, axisLabelVisible: false })
    series.createPriceLine({ price: 30, color: 'rgba(34,197,94,0.5)', lineWidth: 1, lineStyle: 2, axisLabelVisible: false })

    const toMain = (range) => {
      if (range && !syncingRef.current) {
        syncingRef.current = true
        main.timeScale().setVisibleLogicalRange(range)
        syncingRef.current = false
      }
    }
    const toRsi = (range) => {
      if (range && !syncingRef.current) {
        syncingRef.current = true
        chart.timeScale().setVisibleLogicalRange(range)
        syncingRef.current = false
      }
    }
    chart.timeScale().subscribeVisibleLogicalRangeChange(toMain)
    main.timeScale().subscribeVisibleLogicalRangeChange(toRsi)

    rsiChartRef.current = chart
    rsiSeriesRef.current = series
    if (klinesRef.current.length) series.setData(rsiCalc(klinesRef.current))
    try {
      chart.timeScale().setVisibleLogicalRange(main.timeScale().getVisibleLogicalRange() || { from: 0, to: 60 })
    } catch {
      /* charts not laid out yet; next interaction syncs them */
    }

    return () => {
      main.timeScale().unsubscribeVisibleLogicalRangeChange(toRsi)
      chart.remove()
      rsiChartRef.current = null
      rsiSeriesRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rsiOn])

  // visibility toggles without refetching
  useEffect(() => {
    for (const p of MA_PERIODS) maSeriesRef.current[p]?.applyOptions({ visible: !!maOn[p] })
  }, [maOn])

  const applyIndicators = (data) => {
    for (const p of MA_PERIODS) maSeriesRef.current[p]?.setData(sma(data, p))
    if (rsiSeriesRef.current) rsiSeriesRef.current.setData(rsiCalc(data))
  }

  useEffect(() => {
    let cancelled = false
    const candles = candleSeriesRef.current
    if (!candles || !symbol) return undefined

    const load = async () => {
      try {
        const res = await api(
          `/api/market/klines?symbol=${encodeURIComponent(symbol)}&interval=${interval}&limit=300`,
        )
        if (cancelled || !candleSeriesRef.current) return
        klinesRef.current = res.data
        candleSeriesRef.current.setData(res.data)
        volumeSeriesRef.current.setData(
          res.data.map((c) => ({ time: c.time, value: c.volume, color: c.close >= c.open ? 'rgba(34,197,94,0.35)' : 'rgba(239,68,68,0.35)' })),
        )
        applyIndicators(res.data)
        lastBarRef.current = res.data.length ? res.data[res.data.length - 1] : null
        chartRef.current?.timeScale().scrollToRealTime()
      } catch {
        /* chart stays empty on fetch error */
      }
    }
    load()
    const timer = setInterval(load, 30000)
    return () => {
      cancelled = true
      clearInterval(timer)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [symbol, interval])

  // Fold live ticker ticks into the forming candle.
  useEffect(() => {
    if (!lastTick) return
    const ticker = tickers[symbol]
    const candles = candleSeriesRef.current
    if (!ticker || !candles) return
    const price = ticker.price
    const bucket =
      interval === '1d' ? 86400
      : interval === '4h' ? 14400
      : interval === '1h' ? 3600
      : interval === '15m' ? 900
      : interval === '5m' ? 300
      : 60
    const barTime = Math.floor(ticker.ts / 1000 / bucket) * bucket
    const prev = lastBarRef.current
    if (prev && prev.time > barTime) return

    const bar =
      prev && prev.time === barTime
        ? {
            time: barTime,
            open: prev.open,
            high: Math.max(prev.high, price),
            low: Math.min(prev.low, price),
            close: price,
          }
        : { time: barTime, open: price, high: price, low: price, close: price }

    lastBarRef.current = bar
    try {
      candles.update(bar)
      volumeSeriesRef.current?.update({
        time: barTime,
        value: ticker.volume,
        color:
          bar.close >= bar.open
            ? 'rgba(34,197,94,0.35)'
            : 'rgba(239,68,68,0.35)',
      })
      // fold the new close into MAs + RSI so overlays stay current between fetches
      if (klinesRef.current.length) {
        klinesRef.current =
          prev && prev.time === barTime
            ? [...klinesRef.current.slice(0, -1), bar]
            : [...klinesRef.current, bar]
        applyIndicators(klinesRef.current)
      }
    } catch {
      /* out-of-order update; next full fetch corrects it */
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lastTick, tickers, symbol, interval])

  const toggleBtn = (active) =>
    `rounded px-2 py-1 text-xs transition ${
      active ? 'bg-indigo-600 text-white' : 'bg-slate-800 text-slate-400 hover:bg-slate-700'
    }`

  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <div className="text-sm font-semibold text-slate-300">{symbol} · {interval}</div>
        <div className="flex flex-wrap items-center gap-1">
          {INTERVALS.map((iv) => (
            <button
              key={iv}
              type="button"
              onClick={() => onIntervalChange?.(iv)}
              className={`rounded px-2 py-1 text-xs transition ${
                iv === interval
                  ? 'bg-blue-600 text-white'
                  : 'bg-slate-800 text-slate-400 hover:bg-slate-700'
              }`}
            >
              {iv}
            </button>
          ))}
          <span className="mx-1 h-4 w-px bg-slate-700" />
          {MA_PERIODS.map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => setMaOn((s) => ({ ...s, [p]: !s[p] }))}
              className={toggleBtn(maOn[p])}
              style={maOn[p] ? { backgroundColor: MA_COLORS[p] } : undefined}
              title={`Simple moving average, ${p} periods`}
            >
              MA{p}
            </button>
          ))}
          <button
            type="button"
            onClick={() => setRsiOn((v) => !v)}
            className={toggleBtn(rsiOn)}
            title="Relative strength index (14)"
          >
            RSI
          </button>
        </div>
      </div>
      <div ref={containerRef} style={{ width: '100%', height }} />
      <div className="mt-1 flex items-center justify-between">
        <span className="text-[11px] font-semibold text-slate-500">
          RSI 14 · overbought 70 / oversold 30
        </span>
      </div>
      <div ref={rsiContainerRef} style={{ width: '100%', height: rsiOn ? 96 : 0, display: rsiOn ? 'block' : 'none' }} />
    </div>
  )
}

export default CandleChart
