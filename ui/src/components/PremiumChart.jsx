import { useEffect, useRef } from 'react'
import {
  ColorType,
  createChart,
  AreaSeries,
  LineSeries,
} from 'lightweight-charts'

const PremiumChart = ({ points, windowSize = 30, height = 320 }) => {
  const containerRef = useRef(null)
  const chartRef = useRef(null)
  const areaRef = useRef(null)
  const maRef = useRef(null)

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
      rightPriceScale: {
        borderColor: 'rgba(148, 163, 184, 0.2)',
        scaleMargins: { top: 0.15, bottom: 0.15 },
      },
      timeScale: { borderColor: 'rgba(148, 163, 184, 0.2)', timeVisible: true },
      autoSize: true,
    })

    const area = chart.addSeries(AreaSeries, {
      lineColor: '#3b82f6',
      topColor: 'rgba(59, 130, 246, 0.35)',
      bottomColor: 'rgba(59, 130, 246, 0.02)',
      lineWidth: 2,
      priceFormat: { type: 'price', precision: 2, minMove: 0.01 },
    })

    const maLine = chart.addSeries(LineSeries, {
      color: '#f59e0b',
      lineWidth: 2,
      lineStyle: 2,
      priceFormat: { type: 'price', precision: 2, minMove: 0.01 },
    })

    chartRef.current = chart
    areaRef.current = area
    maRef.current = maLine

    return () => {
      chart.remove()
      chartRef.current = null
      areaRef.current = null
      maRef.current = null
    }
  }, [height])

  useEffect(() => {
    const area = areaRef.current
    const maLine = maRef.current
    if (!area || !points?.length) return

    // Timestamps are floored to whole seconds and refresh_once() can run
    // concurrently from several endpoints, so duplicates are possible — and
    // lightweight-charts throws on non-unique time (uncaught = blank app).
    const seen = new Set()
    const data = []
    for (const p of points) {
      const t = Math.floor(p.ts)
      if (seen.has(t)) continue
      seen.add(t)
      data.push({ time: t, value: p.premium_pct })
    }
    if (!data.length) return

    const maData = []
    for (let i = 0; i < data.length; i += 1) {
      const from = Math.max(0, i - windowSize + 1)
      const slice = data.slice(from, i + 1)
      if (slice.length < Math.min(windowSize, 10)) continue
      const mean = slice.reduce((s, p) => s + p.value, 0) / slice.length
      maData.push({ time: data[i].time, value: mean })
    }

    try {
      area.setData(data)
      maLine.setData(maData)
    } catch (err) {
      // Never let a chart-library throw escape a passive effect (no error
      // boundary above this tree — it would take the whole app down).
      console.warn('premium chart setData failed:', err)
      return
    }

    const first = data[0]
    const last = data[data.length - 1]
    if (first && last && first.time !== last.time) {
      chartRef.current?.timeScale().fitContent()
    }
  }, [points, windowSize])

  return <div ref={containerRef} style={{ width: '100%', height }} />
}

export default PremiumChart
