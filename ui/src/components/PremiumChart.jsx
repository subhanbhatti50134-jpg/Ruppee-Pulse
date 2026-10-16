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

    const data = points.map((p) => ({ time: Math.floor(p.ts), value: p.premium_pct }))
    area.setData(data)

    const maData = []
    for (let i = 0; i < points.length; i += 1) {
      const from = Math.max(0, i - windowSize + 1)
      const slice = points.slice(from, i + 1)
      if (slice.length < Math.min(windowSize, 10)) continue
      const mean = slice.reduce((s, p) => s + p.premium_pct, 0) / slice.length
      maData.push({ time: Math.floor(points[i].ts), value: mean })
    }
    maLine.setData(maData)

    const first = data[0]
    const last = data[data.length - 1]
    if (first && last && first.time !== last.time) {
      chartRef.current?.timeScale().fitContent()
    }
  }, [points, windowSize])

  return <div ref={containerRef} style={{ width: '100%', height }} />
}

export default PremiumChart
