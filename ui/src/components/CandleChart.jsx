import { useEffect, useRef } from 'react'
import {
  ColorType,
  createChart,
  CandlestickSeries,
  HistogramSeries,
} from 'lightweight-charts'
import { api } from '../lib/api.js'
import { useMarket } from '../context/MarketContext.jsx'

const INTERVALS = ['1m', '5m', '15m', '1h', '4h', '1d']

const CandleChart = ({ symbol, interval = '1h', height = 420, onIntervalChange }) => {
  const containerRef = useRef(null)
  const chartRef = useRef(null)
  const candleSeriesRef = useRef(null)
  const volumeSeriesRef = useRef(null)
  const lastBarRef = useRef(null)
  const { tickers, lastTick } = useMarket()

  useEffect(() => {
    const el = containerRef.current
    if (!el) return undefined

    const chart = createChart(el, {
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
    chart.priceScale('volume').applyOptions({
      scaleMargins: { top: 0.82, bottom: 0 },
    })

    chartRef.current = chart
    candleSeriesRef.current = candles
    volumeSeriesRef.current = volume

    return () => {
      chart.remove()
      chartRef.current = null
      candleSeriesRef.current = null
      volumeSeriesRef.current = null
    }
  }, [height])

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
        candleSeriesRef.current.setData(res.data)
        volumeSeriesRef.current.setData(
          res.data.map((c) => ({ time: c.time, value: c.volume, color: c.close >= c.open ? 'rgba(34,197,94,0.35)' : 'rgba(239,68,68,0.35)' })),
        )
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
    } catch {
      /* out-of-order update; next full fetch corrects it */
    }
  }, [lastTick, tickers, symbol, interval])

  return (
    <div>
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="text-sm font-semibold text-slate-300">{symbol} · {interval}</div>
        <div className="flex gap-1">
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
        </div>
      </div>
      <div ref={containerRef} style={{ width: '100%', height }} />
    </div>
  )
}

export default CandleChart
