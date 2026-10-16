import { useEffect, useRef } from 'react'
import { ColorType, createChart, LineSeries } from 'lightweight-charts'

const EquityChart = ({ points, height = 260, up = true }) => {
  const containerRef = useRef(null)
  const chartRef = useRef(null)
  const seriesRef = useRef(null)

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

    const line = chart.addSeries(LineSeries, {
      color: up ? '#22c55e' : '#ef4444',
      lineWidth: 2,
      priceFormat: { type: 'price', precision: 2, minMove: 0.01 },
      crosshairMarkerVisible: true,
      crosshairMarkerRadius: 4,
    })

    chartRef.current = chart
    seriesRef.current = line
    return () => {
      chart.remove()
      chartRef.current = null
      seriesRef.current = null
    }
  }, [height, up])

  useEffect(() => {
    const line = seriesRef.current
    if (!line || !points?.length) return
    const data = []
    let last = 0
    for (const p of points) {
      const t = Math.floor(p.ts)
      const time = t > last ? t : last + 1
      last = time
      data.push({ time, value: p.equity })
    }
    try {
      line.setData(data)
      chartRef.current?.timeScale().fitContent()
    } catch {
      /* out-of-order or empty data; next refresh corrects */
    }
  }, [points])

  return <div ref={containerRef} style={{ width: '100%', height }} />
}

export default EquityChart
