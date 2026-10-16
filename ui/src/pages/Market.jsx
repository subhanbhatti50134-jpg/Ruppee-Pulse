import React, { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useMarket } from '../context/MarketContext.jsx'
import { baseAsset, fmtCompact, fmtNum, fmtPct, fmtPkr, fmtUsd } from '../lib/format.js'

const Market = () => {
  const navigate = useNavigate()
  const { tickers, buyRate, selectedSymbol, setSelectedSymbol, premium, interbank, inWatchlist, toggleWatchlist } = useMarket()
  const [query, setQuery] = useState('')
  const [onlyWatched, setOnlyWatched] = useState(false)
  const [sortKey, setSortKey] = useState('quoteVolume')
  const [sortDir, setSortDir] = useState(-1)

  const rows = useMemo(() => {
    const list = Object.values(tickers)
      .filter((t) => t.symbol.toLowerCase().includes(query.trim().toLowerCase()))
      .filter((t) => (onlyWatched ? inWatchlist(t.symbol) : true))
      .sort((a, b) => {
        const av = a[sortKey] ?? 0
        const bv = b[sortKey] ?? 0
        return (av - bv) * sortDir
      })
    return list
  }, [tickers, query, sortKey, sortDir, onlyWatched, inWatchlist])

  const movers = useMemo(() => {
    const all = Object.values(tickers)
    return {
      gainers: [...all].sort((a, b) => b.change_pct - a.change_pct).slice(0, 3),
      losers: [...all].sort((a, b) => a.change_pct - b.change_pct).slice(0, 3),
    }
  }, [tickers])

  const toggleSort = (key) => {
    if (key === sortKey) setSortDir((d) => -d)
    else {
      setSortKey(key)
      setSortDir(-1)
    }
  }

  const sortArrow = (key) => (sortKey === key ? (sortDir === -1 ? ' ↓' : ' ↑') : '')

  const trade = (symbol) => {
    setSelectedSymbol(symbol)
    navigate('/trade')
  }

  const th = 'py-2 px-3 text-left text-xs uppercase tracking-wide text-slate-500 cursor-pointer select-none hover:text-slate-300'

  return (
    <div className="min-h-screen bg-[#080d14] text-white pt-32 px-4 pb-10">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold">Market</h1>
          <p className="text-sm text-slate-400">
            Spot prices in USD with live P2P PKR valuation
            {premium && (
              <span className="ml-2 rounded bg-amber-500/10 px-2 py-0.5 text-amber-300">
                premium {premium.premium_pct.toFixed(2)}%
              </span>
            )}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setOnlyWatched((v) => !v)}
            className={`rounded-lg border px-3 py-2 text-sm transition ${
              onlyWatched
                ? 'border-amber-500 bg-amber-500/10 text-amber-300'
                : 'border-slate-700 text-slate-400 hover:bg-slate-800'
            }`}
          >
            ★ Watchlist
          </button>
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Filter symbol (e.g. BTC)"
            className="w-56 rounded-lg border border-slate-700 bg-[#0d141d] px-3 py-2 text-sm outline-none focus:border-blue-500"
          />
        </div>
      </div>

      <div className="mb-4 grid grid-cols-2 gap-4 lg:grid-cols-2">
        {[
          { title: 'Top gainers', list: movers.gainers, cls: 'text-emerald-400' },
          { title: 'Top losers', list: movers.losers, cls: 'text-red-400' },
        ].map((group) => (
          <div key={group.title} className="rounded-xl border border-gray-700 bg-[#0d141d] p-3">
            <div className="mb-2 text-xs uppercase tracking-wide text-slate-500">{group.title}</div>
            <div className="flex flex-wrap gap-2">
              {group.list.length === 0 && <span className="text-xs text-slate-600">Loading…</span>}
              {group.list.map((t) => (
                <button
                  key={t.symbol}
                  type="button"
                  onClick={() => { setSelectedSymbol(t.symbol); navigate('/trade') }}
                  className="flex items-center gap-2 rounded-lg bg-[#0a111a] px-3 py-1.5 text-sm transition hover:bg-slate-800"
                >
                  <span className="font-semibold">{baseAsset(t.symbol)}</span>
                  <span className="font-mono text-slate-400">{fmtUsd(t.price)}</span>
                  <span className={`font-mono font-semibold ${group.cls}`}>{fmtPct(t.change_pct)}</span>
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>

      <div className="overflow-x-auto rounded-xl border border-gray-700 bg-[#0d141d]">
        <table className="w-full text-sm">
          <thead className="border-b border-gray-800">
            <tr>
              <th className={`${th} w-8`}>★</th>
              <th className={th} onClick={() => toggleSort('symbol')}>Symbol{sortArrow('symbol')}</th>
              <th className={`${th} text-right`} onClick={() => toggleSort('price')}>Last (USD){sortArrow('price')}</th>
              <th className={`${th} text-right`}>Last (PKR)</th>
              <th className={`${th} text-right`} onClick={() => toggleSort('change_pct')}>24h %{sortArrow('change_pct')}</th>
              <th className={`${th} text-right`} onClick={() => toggleSort('high')}>24h High{sortArrow('high')}</th>
              <th className={`${th} text-right`} onClick={() => toggleSort('low')}>24h Low{sortArrow('low')}</th>
              <th className={`${th} text-right`} onClick={() => toggleSort('quoteVolume')}>Volume 24h{sortArrow('quoteVolume')}</th>
              <th className={`${th} text-right`}>Action</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td colSpan={9} className="px-3 py-6 text-center text-slate-500">
                  {onlyWatched && Object.keys(tickers).length > 0
                    ? 'Your watchlist is empty — tap a ★ to add symbols.'
                    : Object.keys(tickers).length === 0
                      ? 'Connecting to market feed…'
                      : 'No symbols match your filter.'}
                </td>
              </tr>
            )}
            {rows.map((t, index) => {
              const up = t.change_pct >= 0
              const active = t.symbol === selectedSymbol
              const watched = inWatchlist(t.symbol)
              return (
                <tr
                  key={t.symbol}
                  className={`border-b border-gray-800/60 transition hover:bg-slate-800/40 ${active ? 'bg-blue-600/10' : ''}`}
                >
                  <td className="px-2 py-2.5 text-center">
                    <button
                      type="button"
                      onClick={() => toggleWatchlist(t.symbol)}
                      aria-label={watched ? 'Remove from watchlist' : 'Add to watchlist'}
                      className={`text-lg leading-none transition hover:scale-110 ${
                        watched ? 'text-amber-400' : 'text-slate-600 hover:text-amber-400'
                      }`}
                    >
                      {watched ? '★' : '☆'}
                    </button>
                  </td>
                  <td className="px-3 py-2.5">
                    <span className="mr-2 text-xs text-slate-600">{index + 1}</span>
                    <span className="font-semibold">{baseAsset(t.symbol)}</span>
                    <span className="text-xs text-slate-500">/USDT</span>
                  </td>
                  <td className="px-3 py-2.5 text-right font-mono">{fmtUsd(t.price)}</td>
                  <td className="px-3 py-2.5 text-right font-mono text-slate-300">
                    {buyRate ? fmtPkr(t.price * buyRate) : '—'}
                  </td>
                  <td className={`px-3 py-2.5 text-right font-mono font-semibold ${up ? 'text-emerald-400' : 'text-red-400'}`}>
                    {fmtPct(t.change_pct)}
                  </td>
                  <td className="px-3 py-2.5 text-right font-mono text-slate-400">{fmtUsd(t.high)}</td>
                  <td className="px-3 py-2.5 text-right font-mono text-slate-400">{fmtUsd(t.low)}</td>
                  <td className="px-3 py-2.5 text-right font-mono text-slate-400">${fmtCompact(t.quoteVolume)}</td>
                  <td className="px-3 py-2.5 text-right">
                    <button
                      type="button"
                      onClick={() => trade(t.symbol)}
                      className="rounded-md bg-blue-600/80 px-3 py-1 text-xs font-semibold text-white transition hover:bg-blue-500"
                    >
                      Trade
                    </button>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      <p className="mt-3 text-xs text-slate-500">
        PKR values use the live Binance P2P USDT/PKR rate
        {buyRate ? ` (${fmtNum(buyRate, 2)})` : ''}
        {interbank ? `, interbank reference ${fmtNum(interbank, 3)}` : ''}.
      </p>
    </div>
  )
}

export default Market
