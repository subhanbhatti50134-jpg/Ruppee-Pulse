import React, { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../lib/api.js'
import { useMarket } from '../context/MarketContext.jsx'
import { fmtNum, fmtPct, fmtUsd, timeAgo } from '../lib/format.js'
import { downloadCsv } from '../lib/csv.js'
import { getCurrentUser } from './auth.js'
import EquityChart from '../components/EquityChart.jsx'

const Wallet = () => {
  const { buyRate, premium, tickers } = useMarket()
  const user = getCurrentUser()
  const [balances, setBalances] = useState(null)
  const [portfolio, setPortfolio] = useState(null)
  const [history, setHistory] = useState([])
  const [keysState, setKeysState] = useState(null)
  const [equity, setEquity] = useState(null)
  const [notice, setNotice] = useState('')
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    try {
      const [bal, hist, keys, port, eq] = await Promise.all([
        api('/api/trade/balances'),
        api('/api/trade/history'),
        api('/api/trade/keys'),
        api('/api/trade/portfolio'),
        api('/api/trade/equity'),
      ])
      setBalances(bal)
      setHistory(hist.orders || [])
      setKeysState(keys)
      setPortfolio(port)
      setEquity(eq)
      setError('')
    } catch (err) {
      setError(err.message)
    }
  }, [])

  useEffect(() => {
    load()
    const handler = () => load()
    window.addEventListener('rp:order-placed', handler)
    return () => window.removeEventListener('rp:order-placed', handler)
  }, [load])

  const resetDemo = async () => {
    setNotice('')
    setError('')
    try {
      await api('/api/trade/demo/reset', { method: 'POST' })
      setNotice('Demo portfolio reset to starting balance.')
      load()
    } catch (err) {
      setError(err.message)
    }
  }

  const filled = history.filter((o) => o.status === 'FILLED')
  const buyVolume = filled.filter((o) => o.side === 'BUY').reduce((s, o) => s + (o.total || 0), 0)
  const sellVolume = filled.filter((o) => o.side === 'SELL').reduce((s, o) => s + (o.total || 0), 0)

  return (
    <div className="min-h-screen bg-[#080d14] text-white pt-32 px-4 pb-10">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold">Wallet</h1>
          <p className="text-sm text-slate-400">
            {user?.name} · {balances?.mode === 'live' ? 'Binance spot account' : 'Demo portfolio (paper funds)'}
          </p>
        </div>
        <div className="flex gap-2 text-xs">
          {balances?.mode !== 'live' && (
            <button
              type="button"
              onClick={resetDemo}
              className="rounded-lg border border-slate-600 px-3 py-1.5 text-slate-300 transition hover:bg-slate-800"
            >
              Reset demo funds
            </button>
          )}
          <Link to="/profile" className="rounded-lg border border-blue-600/60 px-3 py-1.5 text-blue-300 transition hover:bg-blue-900/40">
            {keysState?.configured ? 'Manage API keys' : 'Connect Binance API'}
          </Link>
        </div>
      </div>

      {(notice || error) && (
        <div className={`mb-3 rounded-lg border p-3 text-sm ${
          notice ? 'border-emerald-700 bg-emerald-950/40 text-emerald-300' : 'border-red-800 bg-red-950/40 text-red-300'
        }`}>
          {notice || error}
        </div>
      )}

      <div className="grid grid-cols-12 gap-4">
        <section className="col-span-12">
          <div className="rounded-xl border border-gray-700 bg-[#0d141d] p-5">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-3 border-b border-gray-800 pb-3">
              <div className="flex items-baseline gap-3">
                <h2 className="text-lg font-semibold">PORTFOLIO GROWTH</h2>
                <span className="font-mono text-2xl font-bold">
                  {equity ? fmtUsd(equity.current_equity) : '—'}
                </span>
                <span
                  className={`font-mono text-sm font-semibold ${
                    (equity?.change ?? 0) >= 0 ? 'text-emerald-400' : 'text-red-400'
                  }`}
                >
                  {equity ? `${equity.change >= 0 ? '+' : ''}${fmtUsd(equity.change, 2)} (${fmtPct(equity.change_pct ?? 0)})` : '—'}
                </span>
              </div>
              <div className="flex gap-4 text-xs text-slate-400">
                <span>
                  Realized{' '}
                  <b className={`font-mono ${(equity?.realized_pnl ?? 0) >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                    {equity ? fmtUsd(equity.realized_pnl, 2) : '—'}
                  </b>
                </span>
                <span>
                  Since first trade <b className="font-mono text-slate-200">{equity ? fmtUsd(equity.start_equity) : '—'}</b>
                </span>
              </div>
            </div>
            {equity?.points?.length ? (
              <EquityChart points={equity.points} height={240} up={(equity.change ?? 0) >= 0} />
            ) : (
              <div className="flex h-[240px] items-center justify-center text-sm text-slate-500">
                No trades yet — your growth curve starts with your first fill.
              </div>
            )}
          </div>
        </section>

        <section className="col-span-12 lg:col-span-4">
          <div className="rounded-xl border border-gray-700 bg-[#0d141d] p-5">
            <h2 className="text-sm uppercase tracking-wide text-slate-500">Total portfolio value</h2>
            <div className="mt-2 font-mono text-3xl font-bold">
              {balances ? fmtUsd(balances.total_usd) : '—'}
            </div>
            <div className="mt-1 font-mono text-lg text-slate-400">
              {balances ? `${fmtNum(balances.total_pkr, 0)} PKR` : '—'}
            </div>
            <div className="mt-4 space-y-1.5 border-t border-gray-800 pt-4 text-xs text-slate-400">
              <div className="flex justify-between">
                <span>PKR conversion rate</span>
                <span className="font-mono text-slate-200">
                  {balances?.pkr_rate ? fmtNum(balances.pkr_rate, 2) : buyRate ? fmtNum(buyRate, 2) : '—'}
                </span>
              </div>
              <div className="flex justify-between">
                <span>24h market premium</span>
                <span className="font-mono text-amber-300">{premium ? fmtPct(premium.premium_pct) : '—'}</span>
              </div>
              <div className="flex justify-between">
                <span>Filled buy volume</span>
                <span className="font-mono text-slate-200">{fmtUsd(buyVolume)}</span>
              </div>
              <div className="flex justify-between">
                <span>Filled sell volume</span>
                <span className="font-mono text-slate-200">{fmtUsd(sellVolume)}</span>
              </div>
            </div>
          </div>
        </section>

        <section className="col-span-12 lg:col-span-8">
          <div className="rounded-xl border border-gray-700 bg-[#0d141d] p-5">
            <div className="mb-3 flex items-center justify-between border-b border-gray-800 pb-3">
              <h2 className="text-lg font-semibold">Balances</h2>
              <span className="text-xs text-slate-500">
                {balances?.mode === 'live' ? 'live spot' : 'demo · paper trading'}
              </span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-800 text-left text-xs uppercase tracking-wide text-slate-500">
                    <th className="py-2 pr-3">Asset</th>
                    <th className="py-2 pr-3 text-right">Free</th>
                    <th className="py-2 pr-3 text-right">Locked</th>
                    <th className="py-2 pr-3 text-right">Price</th>
                    <th className="py-2 pr-3 text-right">Value (USD)</th>
                    <th className="py-2 text-right">Value (PKR)</th>
                  </tr>
                </thead>
                <tbody>
                  {!balances && (
                    <tr><td colSpan={6} className="py-5 text-center text-slate-500">Loading balances…</td></tr>
                  )}
                  {balances?.balances?.length === 0 && (
                    <tr><td colSpan={6} className="py-5 text-center text-slate-500">No assets held.</td></tr>
                  )}
                  {balances?.balances?.map((b) => (
                    <tr key={b.asset} className="border-b border-gray-800/60 hover:bg-slate-800/40">
                      <td className="py-2.5 pr-3 font-semibold">{b.asset}</td>
                      <td className="py-2.5 pr-3 text-right font-mono">{fmtNum(b.free, 6)}</td>
                      <td className="py-2.5 pr-3 text-right font-mono text-slate-400">{fmtNum(b.locked, 6)}</td>
                      <td className="py-2.5 pr-3 text-right font-mono text-slate-400">{fmtUsd(b.price_usd)}</td>
                      <td className="py-2.5 pr-3 text-right font-mono">{fmtUsd(b.value_usd)}</td>
                      <td className="py-2.5 text-right font-mono text-slate-300">{fmtNum(b.value_pkr, 0)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </section>

        <section className="col-span-12">
          <div className="rounded-xl border border-gray-700 bg-[#0d141d] p-5">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2 border-b border-gray-800 pb-3">
              <h2 className="text-lg font-semibold">Positions &amp; PnL</h2>
              <div className="flex flex-wrap gap-3 text-xs">
                <span className="text-slate-400">
                  Unrealized{' '}
                  <span className={`font-mono font-semibold ${(portfolio?.unrealized_pnl ?? 0) >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                    {(portfolio?.unrealized_pnl ?? 0) >= 0 ? '+' : ''}
                    {fmtUsd(portfolio?.unrealized_pnl ?? 0, 2)}
                  </span>
                </span>
                <span className="text-slate-400">
                  Realized{' '}
                  <span className={`font-mono font-semibold ${(portfolio?.realized_pnl ?? 0) >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                    {(portfolio?.realized_pnl ?? 0) >= 0 ? '+' : ''}
                    {fmtUsd(portfolio?.realized_pnl ?? 0, 2)}
                  </span>
                </span>
                <span className="text-slate-400">
                  Total{' '}
                  <span className={`font-mono font-semibold ${(portfolio?.total_pnl ?? 0) >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                    {(portfolio?.total_pnl ?? 0) >= 0 ? '+' : ''}
                    {fmtUsd(portfolio?.total_pnl ?? 0, 2)}
                  </span>
                </span>
              </div>
            </div>

            <div className="mb-4">
              <div className="mb-1.5 text-xs uppercase tracking-wide text-slate-500">Allocation</div>
              <div className="flex h-3 w-full overflow-hidden rounded-full bg-slate-800">
                {(portfolio?.allocation || []).map((a, i) => (
                  <div
                    key={a.asset}
                    title={`${a.asset} ${a.weight_pct}%`}
                    className={`h-full ${['bg-blue-500', 'bg-amber-500', 'bg-emerald-500', 'bg-purple-500', 'bg-cyan-500', 'bg-rose-500', 'bg-slate-500'][i % 7]}`}
                    style={{ width: `${Math.max(a.weight_pct, 0.5)}%` }}
                  />
                ))}
              </div>
              <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-400">
                {(portfolio?.allocation || []).slice(0, 8).map((a, i) => (
                  <span key={a.asset} className="flex items-center gap-1.5">
                    <span className={`inline-block h-2 w-2 rounded-full ${['bg-blue-500', 'bg-amber-500', 'bg-emerald-500', 'bg-purple-500', 'bg-cyan-500', 'bg-rose-500', 'bg-slate-500'][i % 7]}`} />
                    {a.asset} <span className="font-mono text-slate-500">{a.weight_pct}%</span>
                  </span>
                ))}
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-800 text-left text-xs uppercase tracking-wide text-slate-500">
                    <th className="py-2 pr-3">Asset</th>
                    <th className="py-2 pr-3 text-right">Qty</th>
                    <th className="py-2 pr-3 text-right">Avg cost</th>
                    <th className="py-2 pr-3 text-right">Mark</th>
                    <th className="py-2 pr-3 text-right">Value</th>
                    <th className="py-2 pr-3 text-right">Unrealized</th>
                    <th className="py-2 text-right">Realized</th>
                  </tr>
                </thead>
                <tbody>
                  {!portfolio && (
                    <tr><td colSpan={7} className="py-5 text-center text-slate-500">Loading positions…</td></tr>
                  )}
                  {portfolio?.positions?.length === 0 && (
                    <tr><td colSpan={7} className="py-5 text-center text-slate-500">No positions with trade history yet.</td></tr>
                  )}
                  {(portfolio?.positions || []).map((p) => (
                    <tr key={p.asset} className="border-b border-gray-800/60 hover:bg-slate-800/40">
                      <td className="py-2.5 pr-3 font-semibold">{p.asset}</td>
                      <td className="py-2.5 pr-3 text-right font-mono">{fmtNum(p.qty, 6)}</td>
                      <td className="py-2.5 pr-3 text-right font-mono text-slate-400">
                        {p.avg_cost ? fmtUsd(p.avg_cost) : '—'}
                      </td>
                      <td className="py-2.5 pr-3 text-right font-mono">{fmtUsd(p.price_usd)}</td>
                      <td className="py-2.5 pr-3 text-right font-mono">{fmtUsd(p.value_usd)}</td>
                      <td className={`py-2.5 pr-3 text-right font-mono ${p.unrealized_pnl >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                        {p.unrealized_pnl >= 0 ? '+' : ''}{fmtUsd(p.unrealized_pnl, 2)}
                        {p.unrealized_pnl_pct != null && (
                          <span className="ml-1 text-xs">({p.unrealized_pnl_pct >= 0 ? '+' : ''}{p.unrealized_pnl_pct}%)</span>
                        )}
                      </td>
                      <td className={`py-2.5 text-right font-mono ${p.realized_pnl >= 0 ? 'text-emerald-400/80' : 'text-red-400/80'}`}>
                        {p.realized_pnl ? `${p.realized_pnl >= 0 ? '+' : ''}${fmtUsd(p.realized_pnl, 2)}` : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="mt-3 text-xs text-slate-600">
              Average-cost accounting across filled orders · unrealized uses live marks ·
              reset demo funds to recompute from a clean slate.
            </p>
          </div>
        </section>

        <section className="col-span-12">
          <div className="rounded-xl border border-gray-700 bg-[#0d141d] p-5">
            <div className="mb-3 flex items-center justify-between border-b border-gray-800 pb-3">
              <h2 className="text-lg font-semibold">Recent activity</h2>
              <button
                type="button"
                onClick={() =>
                  downloadCsv(
                    `rupeepulse-activity-${new Date().toISOString().slice(0, 10)}.csv`,
                    history.map((o) => ({
                      symbol: o.symbol,
                      side: o.side,
                      type: o.type,
                      quantity: o.quantity,
                      avg_price: o.avg_price ?? '',
                      total: o.total ?? '',
                      status: o.status,
                      mode: o.mode,
                      pnl: o.pnl ?? '',
                      created_at: new Date(o.created_at * 1000).toISOString(),
                    })),
                  )
                }
                className="rounded-md border border-slate-600 px-3 py-1 text-xs text-slate-300 transition hover:bg-slate-800"
              >
                Export CSV
              </button>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-800 text-left text-xs uppercase tracking-wide text-slate-500">
                    <th className="py-2 pr-3">Order</th>
                    <th className="py-2 pr-3">Symbol</th>
                    <th className="py-2 pr-3">Side</th>
                    <th className="py-2 pr-3 text-right">Total</th>
                    <th className="py-2 pr-3 text-right">P&L</th>
                    <th className="py-2 pr-3">Status</th>
                    <th className="py-2 text-right">When</th>
                  </tr>
                </thead>
                <tbody>
                  {history.length === 0 && (
                    <tr><td colSpan={7} className="py-5 text-center text-slate-500">No activity yet.</td></tr>
                  )}
                  {history.slice(0, 15).map((o) => (
                    <tr key={o.id} className="border-b border-gray-800/60 hover:bg-slate-800/40">
                      <td className="py-2 pr-3 font-mono text-xs text-slate-500">{o.type}</td>
                      <td className="py-2 pr-3 font-semibold">{o.symbol}</td>
                      <td className={`py-2 pr-3 font-semibold ${o.side === 'BUY' ? 'text-emerald-400' : 'text-red-400'}`}>{o.side}</td>
                      <td className="py-2 pr-3 text-right font-mono">{o.total ? fmtUsd(o.total) : '—'}</td>
                      <td className="py-2 pr-3 text-right font-mono">
                        {o.pnl == null ? (
                          <span className="text-slate-600">—</span>
                        ) : (
                          <span className={o.pnl >= 0 ? 'text-emerald-400' : 'text-red-400'}>
                            {o.pnl >= 0 ? '+' : ''}{fmtUsd(o.pnl, 2)}
                          </span>
                        )}
                      </td>
                      <td className="py-2 pr-3 text-xs font-semibold text-slate-400">{o.status}</td>
                      <td className="py-2 text-right text-xs text-slate-500">{timeAgo(o.created_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </section>

        <section className="col-span-12 rounded-xl border border-blue-800/40 bg-blue-950/20 p-4 text-sm text-slate-300">
          <span className="font-semibold text-blue-300">Funding in PKR:</span>{' '}
          use the live P2P rate of{' '}
          <span className="font-mono text-emerald-300">{buyRate ? fmtNum(buyRate, 2) : '—'} PKR/USDT</span>{' '}
          (Easypaisa, Raast, Bank Transfer) — {Object.keys(tickers).length} markets available on the{' '}
          <Link to="/market" className="font-semibold text-blue-400 hover:text-blue-300">Market</Link> page.
        </section>
      </div>
    </div>
  )
}

export default Wallet
