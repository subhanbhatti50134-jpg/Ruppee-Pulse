import React, { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useMarket } from '../context/MarketContext.jsx'
import CandleChart from '../components/CandleChart.jsx'
import OrderTicket from '../components/OrderTicket.jsx'
import { baseAsset, fmtCompact, fmtNum, fmtPct, fmtPkr, fmtUsd } from '../lib/format.js'

const Overview = () => {
  const navigate = useNavigate()
  const [interval_, setInterval_] = useState('1h')
  const {
    tickers,
    p2p,
    interbank,
    premium,
    ma,
    selectedSymbol,
    setSelectedSymbol,
    inWatchlist,
    toggleWatchlist,
    buyRate,
    sellRate,
    wsConnected,
    streamConnected,
  } = useMarket()

  const allTickers = Object.values(tickers)
  const sorted = allTickers.sort((a, b) => b.quoteVolume - a.quoteVolume)
  const topGainer = allTickers.length ? [...allTickers].sort((a, b) => b.change_pct - a.change_pct)[0] : null
  const topLoser = allTickers.length ? [...allTickers].sort((a, b) => a.change_pct - b.change_pct)[0] : null

  const methodRows = Object.entries(p2p?.methods || {})
    .map(([method, entry]) => ({
      method,
      buy: entry.buy?.median ?? null,
      sell: entry.sell?.median ?? null,
      buyCount: entry.buy?.count ?? 0,
      sellCount: entry.sell?.count ?? 0,
    }))
    .sort((a, b) => a.method.localeCompare(b.method))

  const statusDot = (on) => (
    <span className={`inline-block h-2 w-2 rounded-full ${on ? 'bg-emerald-400' : 'bg-red-500'}`} />
  )

  return (
    <div className="min-h-screen bg-[#080d14] text-white pt-32 px-4 pb-10">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-4 text-xs text-slate-400">
          <span className="flex items-center gap-1.5">{statusDot(wsConnected)} feed {wsConnected ? 'live' : 'reconnecting'}</span>
          <span className="flex items-center gap-1.5">{statusDot(streamConnected)} binance spot {streamConnected ? 'streaming' : 'down'}</span>
          {premium && (
            <span className="rounded bg-blue-500/10 px-2 py-0.5 text-blue-300">
              P2P premium {premium.premium_pct.toFixed(2)}% vs interbank
            </span>
          )}
          {topGainer && (
            <span className="flex items-center gap-2 rounded bg-slate-800/70 px-2 py-0.5">
              <span className="text-slate-500">movers</span>
              <button
                type="button"
                onClick={() => { setSelectedSymbol(topGainer.symbol); navigate('/trade') }}
                className="font-semibold text-emerald-400 hover:underline"
              >
                ↑ {baseAsset(topGainer.symbol)} {fmtPct(topGainer.change_pct)}
              </button>
              {topLoser && (
                <button
                  type="button"
                  onClick={() => { setSelectedSymbol(topLoser.symbol); navigate('/trade') }}
                  className="font-semibold text-red-400 hover:underline"
                >
                  ↓ {baseAsset(topLoser.symbol)} {fmtPct(topLoser.change_pct)}
                </button>
              )}
            </span>
          )}
        </div>
        <div className="text-xs text-slate-500">
          Interbank USD/PKR: <span className="text-slate-300">{interbank ? fmtNum(interbank, 3) : '—'}</span>
          {' · '}
          P2P buy: <span className="text-emerald-300">{buyRate ? fmtNum(buyRate, 2) : '—'}</span>
        </div>
      </div>

      <div className="grid grid-cols-12 gap-4">
        <section className="col-span-12 lg:col-span-3">
          <div className="border border-gray-700 bg-[#0d141d] rounded-xl lg:h-140 p-4 flex flex-col">
            <div className="flex items-center justify-between mb-4 border-b border-gray-800 pb-3">
              <h2 className="text-lg font-semibold">LIVE MARKET PRICES</h2>
              <span className="text-[10px] uppercase tracking-wide text-slate-500">USD + PKR</span>
            </div>
            <div className="-mx-1 flex-1 overflow-y-auto pr-1">
              {sorted.length === 0 && (
                <p className="p-3 text-sm text-slate-500">Connecting to market feed…</p>
              )}
              {sorted.map((t) => {
                const active = t.symbol === selectedSymbol
                const up = t.change_pct >= 0
                const watched = inWatchlist(t.symbol)
                return (
                  <div
                    key={t.symbol}
                    className={`mb-1 flex w-full items-center gap-1 rounded-lg px-1 py-2 transition ${
                      active ? 'bg-blue-600/15 ring-1 ring-blue-500/40' : 'hover:bg-slate-800/60'
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() => toggleWatchlist(t.symbol)}
                      aria-label={watched ? 'Remove from watchlist' : 'Add to watchlist'}
                      className={`px-1 text-base leading-none transition hover:scale-110 ${
                        watched ? 'text-amber-400' : 'text-slate-600 hover:text-amber-400'
                      }`}
                    >
                      {watched ? '★' : '☆'}
                    </button>
                    <button
                      type="button"
                      onClick={() => setSelectedSymbol(t.symbol)}
                      onDoubleClick={() => navigate('/trade')}
                      className="flex flex-1 items-center justify-between text-left"
                    >
                      <div>
                        <div className="text-sm font-semibold">{baseAsset(t.symbol)}</div>
                        <div className="text-[11px] text-slate-500">
                          {buyRate ? fmtPkr(t.price * buyRate) : '—'}
                        </div>
                      </div>
                      <div className="text-right">
                        <div className="text-sm font-mono">{fmtUsd(t.price)}</div>
                        <div className={`text-[11px] font-semibold ${up ? 'text-emerald-400' : 'text-red-400'}`}>
                          {fmtPct(t.change_pct)}
                        </div>
                      </div>
                    </button>
                  </div>
                )
              })}
            </div>
          </div>
        </section>

        <section className="col-span-12 lg:col-span-6">
          <div className="border border-gray-700 bg-[#0d141d] rounded-xl lg:h-140 p-4 overflow-hidden">
            <div className="flex items-center justify-between border-b border-gray-800 pb-3">
              <div className="text-lg font-semibold">Chart</div>
              <div className="text-sm text-slate-400">
                {tickers[selectedSymbol] ? fmtUsd(tickers[selectedSymbol].price) : '—'}
              </div>
            </div>
            <div className="mt-3 h-[calc(100%-3.5rem)]">
              <CandleChart symbol={selectedSymbol} interval={interval_} height={470} onIntervalChange={setInterval_} />
            </div>
          </div>
        </section>

        <section className="col-span-12 lg:col-span-3">
          <div className="border border-gray-700 bg-[#0d141d] rounded-xl lg:h-140 p-4 overflow-y-auto">
            <div className="flex items-center justify-between mb-5 border-b border-gray-800 pb-3">
              <h2 className="text-lg font-semibold">TRADE EXECUTION</h2>
            </div>
            <OrderTicket compact />
          </div>
        </section>

        <section className="col-span-12 lg:col-span-9">
          <div className="border border-gray-700 bg-[#0d141d] rounded-xl p-4 min-h-52.5">
            <div className="flex items-center justify-between mb-5">
              <h2 className="text-lg font-semibold">
                P2P PKR FUNDING RATES
                <span className="text-gray-400 text-sm font-normal"> (LIVE BINANCE P2P)</span>
              </h2>
              <span className="text-xs text-slate-500">
                {p2p?.buy?.count ?? 0} buy ads · {p2p?.sell?.count ?? 0} sell ads
              </span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-800 text-left text-xs uppercase tracking-wide text-slate-500">
                    <th className="py-2 pr-4">Payment method</th>
                    <th className="py-2 pr-4 text-right">Buy USDT (median)</th>
                    <th className="py-2 pr-4 text-right">Sell USDT (median)</th>
                    <th className="py-2 pr-4 text-right">Premium vs interbank</th>
                    <th className="py-2 text-right">Ads</th>
                  </tr>
                </thead>
                <tbody>
                  {methodRows.length === 0 && (
                    <tr>
                      <td colSpan={5} className="py-4 text-slate-500">Loading P2P rates…</td>
                    </tr>
                  )}
                  {methodRows.map((row) => {
                    const prem =
                      row.buy && interbank ? ((row.buy - interbank) / interbank) * 100 : null
                    return (
                      <tr key={row.method} className="border-b border-gray-800/60 hover:bg-slate-800/40">
                        <td className="py-2 pr-4 font-medium">{row.method}</td>
                        <td className="py-2 pr-4 text-right font-mono text-emerald-300">
                          {row.buy ? fmtNum(row.buy, 2) : '—'}
                        </td>
                        <td className="py-2 pr-4 text-right font-mono text-red-300">
                          {row.sell ? fmtNum(row.sell, 2) : '—'}
                        </td>
                        <td className="py-2 pr-4 text-right font-mono text-amber-300">
                          {prem !== null ? `${prem >= 0 ? '+' : ''}${prem.toFixed(2)}%` : '—'}
                        </td>
                        <td className="py-2 text-right text-slate-500">{row.buyCount + row.sellCount}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </section>

        <section className="col-span-12 lg:col-span-3">
          <div className="border border-gray-700 bg-[#0d141d] rounded-xl p-4 min-h-52.5">
            <div className="mb-4 border-b border-gray-800 pb-3">
              <h2 className="text-lg font-semibold">SPREAD & PREMIUM</h2>
            </div>
            <dl className="space-y-3 text-sm">
              <div className="flex items-center justify-between">
                <dt className="text-slate-400">Interbank USD/PKR</dt>
                <dd className="font-mono">{interbank ? fmtNum(interbank, 3) : '—'}</dd>
              </div>
              <div className="flex items-center justify-between">
                <dt className="text-slate-400">P2P best buy</dt>
                <dd className="font-mono text-emerald-300">{buyRate ? fmtNum(buyRate, 2) : '—'}</dd>
              </div>
              <div className="flex items-center justify-between">
                <dt className="text-slate-400">P2P best sell</dt>
                <dd className="font-mono text-red-300">{sellRate ? fmtNum(sellRate, 2) : '—'}</dd>
              </div>
              <div className="flex items-center justify-between">
                <dt className="text-slate-400">P2P spread</dt>
                <dd className="font-mono">{p2p?.spread != null ? `${fmtNum(p2p.spread, 2)} PKR` : '—'}</dd>
              </div>
              <div className="flex items-center justify-between">
                <dt className="text-slate-400">Premium</dt>
                <dd className="font-mono text-amber-300">
                  {premium ? `${premium.premium_pct >= 0 ? '+' : ''}${premium.premium_pct.toFixed(2)}%` : '—'}
                </dd>
              </div>
              <div className="flex items-center justify-between">
                <dt className="text-slate-400">{ma !== null && ma !== undefined ? 'Premium MA (30)' : 'Premium MA'}</dt>
                <dd className="font-mono">{ma != null ? `${ma.toFixed(2)}%` : 'accumulating…'}</dd>
              </div>
              <div className="flex items-center justify-between">
                <dt className="text-slate-400">Volume 24h (BTC)</dt>
                <dd className="font-mono">{tickers.BTCUSDT ? `$${fmtCompact(tickers.BTCUSDT.quoteVolume)}` : '—'}</dd>
              </div>
            </dl>
          </div>
        </section>
      </div>
    </div>
  )
}

export default Overview
