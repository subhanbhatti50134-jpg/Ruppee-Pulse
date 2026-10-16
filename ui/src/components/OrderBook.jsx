import React, { useEffect, useState } from 'react'
import { api } from '../lib/api.js'
import { useMarket } from '../context/MarketContext.jsx'
import { fmtNum } from '../lib/format.js'

const ROWS = 8

const OrderBook = () => {
  const { selectedSymbol, tickers } = useMarket()
  const [book, setBook] = useState(null)
  const [error, setError] = useState('')

  useEffect(() => {
    let alive = true
    const load = async () => {
      try {
        const data = await api(`/api/market/depth?symbol=${selectedSymbol}&limit=25`)
        if (alive) {
          setBook(data)
          setError('')
        }
      } catch (err) {
        if (alive) setError(err.message)
      }
    }
    load()
    const timer = setInterval(load, 2500)
    return () => {
      alive = false
      clearInterval(timer)
    }
  }, [selectedSymbol])

  const asks = (book?.asks || []).slice(0, ROWS)
  const bids = (book?.bids || []).slice(0, ROWS)
  const maxQty = Math.max(1e-12, ...asks.map((a) => a.qty), ...bids.map((b) => b.qty))
  const last = tickers[selectedSymbol]?.price
  const decimals = last >= 1000 ? 2 : last >= 1 ? 4 : 6

  const row = (level, side) => {
    const width = Math.min(100, (level.qty / maxQty) * 100)
    return (
      <div key={`${side}-${level.price}`} className="relative flex justify-between px-2 py-[3px] text-xs font-mono">
        <div
          className={`absolute inset-y-0 ${side === 'ask' ? 'right-0 bg-red-500/10' : 'left-0 bg-emerald-500/10'}`}
          style={{ width: `${width}%` }}
        />
        <span className={`relative ${side === 'ask' ? 'text-red-400' : 'text-emerald-400'}`}>
          {fmtNum(level.price, decimals)}
        </span>
        <span className="relative text-slate-400">{fmtNum(level.qty, 4)}</span>
      </div>
    )
  }

  return (
    <div>
      <div className="mb-2 flex items-center justify-between text-[11px] uppercase tracking-wide text-slate-500">
        <span>Price</span>
        <span>Size</span>
      </div>

      {error && <div className="mb-2 rounded bg-red-950/40 px-2 py-1 text-xs text-red-300">{error}</div>}

      {!book && !error && <div className="py-6 text-center text-xs text-slate-500">Loading book…</div>}

      <div className="space-y-px">{asks.slice().reverse().map((a) => row(a, 'ask'))}</div>

      <div className="my-1.5 flex items-center justify-between border-y border-gray-700 px-2 py-1.5">
        <span className="font-mono text-sm font-bold text-slate-100">
          {last ? fmtNum(last, decimals) : '—'}
        </span>
        <span className="text-[11px] text-slate-500">
          spread {book?.spread != null ? fmtNum(book.spread, decimals) : '—'}
        </span>
      </div>

      <div className="space-y-px">{bids.map((b) => row(b, 'bid'))}</div>

      {book && (
        <div className="mt-2 border-t border-gray-800 pt-2 text-[11px] text-slate-500">
          {book.symbol} · {asks.length + bids.length} levels · updates every 2.5s
        </div>
      )}
    </div>
  )
}

export default OrderBook
