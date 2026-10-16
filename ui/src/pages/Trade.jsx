import React, { useCallback, useEffect, useState } from 'react'
import { api } from '../lib/api.js'
import { useMarket } from '../context/MarketContext.jsx'
import CandleChart from '../components/CandleChart.jsx'
import OrderTicket from '../components/OrderTicket.jsx'
import OrderBook from '../components/OrderBook.jsx'
import StopsPanel from '../components/StopsPanel.jsx'
import PositionCalculator from '../components/PositionCalculator.jsx'
import { baseAsset, fmtNum, fmtUsd, timeAgo } from '../lib/format.js'
import { downloadCsv } from '../lib/csv.js'

const Trade = () => {
  const { selectedSymbol, tickers, wsConnected } = useMarket()
  const [interval_, setInterval_] = useState('1h')
  const [openOrders, setOpenOrders] = useState([])
  const [positions, setPositions] = useState([])
  const [history, setHistory] = useState([])
  const [balances, setBalances] = useState(null)
  const [keysState, setKeysState] = useState(null)
  const [notice, setNotice] = useState('')
  const [error, setError] = useState('')
  const [closing, setClosing] = useState(null)

  const load = useCallback(async () => {
    try {
      const [open, hist, bal, keys, port] = await Promise.all([
        api('/api/trade/orders'),
        api('/api/trade/history'),
        api('/api/trade/balances'),
        api('/api/trade/keys'),
        api('/api/trade/portfolio'),
      ])
      setOpenOrders(open.orders || [])
      setHistory(hist.orders || [])
      setBalances(bal)
      setKeysState(keys)
      setPositions((port.positions || []).filter((p) => p.qty > 1e-12))
      setError('')
    } catch (err) {
      setError(err.message)
    }
  }, [])

  useEffect(() => {
    load()
    const handler = () => load()
    window.addEventListener('rp:order-placed', handler)
    const timer = setInterval(load, 15000)
    return () => {
      window.removeEventListener('rp:order-placed', handler)
      clearInterval(timer)
    }
  }, [load])

  const cancel = async (orderId) => {
    setNotice('')
    setError('')
    try {
      await api(`/api/trade/orders/${orderId}`, { method: 'DELETE' })
      setNotice('Order cancelled.')
      load()
    } catch (err) {
      setError(err.message)
    }
  }

  const ticker = tickers[selectedSymbol]

  // Live mark for any symbol (position or open order).
  const markOf = (symbol) => tickers[symbol]?.price ?? null

  const positionPnl = (p) => {
    const mark = markOf(`${p.asset}USDT`) ?? p.price_usd
    if (!mark || !p.avg_cost) return { mark, pnl: p.unrealized_pnl ?? 0, pct: p.unrealized_pnl_pct }
    const pnl = (mark - p.avg_cost) * p.qty
    return { mark, pnl, pct: (mark / p.avg_cost - 1) * 100 }
  }

  const orderPnl = (o) => {
    const mark = markOf(o.symbol)
    const ref = o.price || o.avg_price
    if (!mark || !ref || !o.quantity) return null
    const raw = o.side === 'BUY' ? (mark - ref) * o.quantity : (ref - mark) * o.quantity
    return raw
  }

  // Two-step close so a stray click never dumps a live position.
  const closePosition = async (p) => {
    if (closing !== p.asset) {
      setClosing(p.asset)
      setTimeout(() => setClosing((cur) => (cur === p.asset ? null : cur)), 4000)
      return
    }
    setClosing(null)
    setNotice('')
    setError('')
    const held = balances?.balances.find((b) => b.asset === p.asset)
    const qty = held ? held.free : p.qty
    try {
      const res = await api('/api/trade/order', {
        method: 'POST',
        body: { symbol: `${p.asset}USDT`, side: 'SELL', type: 'MARKET', quantity: qty, mode: 'auto' },
      })
      const order = res.order
      const gain = p.avg_cost ? (order.avg_price - p.avg_cost) * order.quantity : 0
      setNotice(
        `Closed ${p.asset}: sold ${fmtNum(order.quantity, 6)} @ ${fmtUsd(order.avg_price)} — ` +
          `${gain >= 0 ? '+' : ''}${fmtUsd(gain, 2)} ${gain >= 0 ? 'profit' : 'loss'} realized.`,
      )
      window.dispatchEvent(new Event('rp:order-placed'))
      load()
    } catch (err) {
      setError(err.message)
    }
  }

  const openPnl = positions.reduce((sum, p) => sum + positionPnl(p).pnl, 0)

  const statusColor = (status) =>
    status === 'FILLED' ? 'text-emerald-400'
    : status === 'CANCELED' || status === 'REJECTED' ? 'text-red-400'
    : 'text-amber-400'

  const th = 'py-2 px-3 text-left text-xs uppercase tracking-wide text-slate-500'

  return (
    <div className="min-h-screen bg-[#080d14] text-white pt-32 px-4 pb-10">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold">Trade {baseAsset(selectedSymbol)}</h1>
          <p className="text-sm text-slate-400">
            {ticker ? `${fmtUsd(ticker.price)} · ${fmtPctText(ticker.change_pct)}` : 'Loading…'}
          </p>
        </div>
        <div className="flex items-center gap-2 text-xs">
          <span className={`flex items-center gap-1.5 rounded-full border px-3 py-1 ${
            keysState?.configured
              ? 'border-emerald-600/60 text-emerald-300'
              : 'border-amber-600/60 text-amber-300'
          }`}>
            <span className={`h-2 w-2 rounded-full ${keysState?.configured ? 'bg-emerald-400' : 'bg-amber-400'}`} />
            {keysState?.configured ? `Live keys ${keysState.api_key_masked}` : 'Demo mode — no API keys'}
          </span>
          <span className={`flex items-center gap-1.5 rounded-full border px-3 py-1 ${
            wsConnected ? 'border-slate-600 text-slate-300' : 'border-red-700 text-red-300'
          }`}>
            <span className={`h-2 w-2 rounded-full ${wsConnected ? 'bg-emerald-400' : 'bg-red-500'}`} />
            {wsConnected ? 'stream live' : 'reconnecting'}
          </span>
        </div>
      </div>

      {(notice || error) && (
        <div className={`mb-3 rounded-lg border p-3 text-sm ${
          notice
            ? 'border-emerald-700 bg-emerald-950/40 text-emerald-300'
            : 'border-red-800 bg-red-950/40 text-red-300'
        }`}>
          {notice || error}
        </div>
      )}

      <div className="grid grid-cols-12 gap-4">
        <section className="col-span-12 xl:col-span-8">
          <div className="rounded-xl border border-gray-700 bg-[#0d141d] p-4">
            <CandleChart
              symbol={selectedSymbol}
              interval={interval_}
              height={430}
              onIntervalChange={setInterval_}
            />
          </div>
        </section>

        <section className="col-span-12 xl:col-span-4">
          <div className="rounded-xl border border-gray-700 bg-[#0d141d] p-4">
            <div className="mb-4 border-b border-gray-800 pb-3">
              <h2 className="text-lg font-semibold">ORDER TICKET</h2>
            </div>
            <OrderTicket />
          </div>
        </section>

        <section className="col-span-12 lg:col-span-4">
          <div className="h-full rounded-xl border border-gray-700 bg-[#0d141d] p-4">
            <div className="mb-3 border-b border-gray-800 pb-3">
              <h2 className="text-lg font-semibold">ORDER BOOK</h2>
            </div>
            <OrderBook />
          </div>
        </section>

        <section className="col-span-12 lg:col-span-4">
          <div className="h-full rounded-xl border border-gray-700 bg-[#0d141d] p-4">
            <div className="mb-3 border-b border-gray-800 pb-3">
              <h2 className="text-lg font-semibold">STOP-LOSS / TAKE-PROFIT</h2>
            </div>
            <StopsPanel />
          </div>
        </section>

        <section className="col-span-12 lg:col-span-4">
          <div className="h-full rounded-xl border border-gray-700 bg-[#0d141d] p-4">
            <div className="mb-3 border-b border-gray-800 pb-3">
              <h2 className="text-lg font-semibold">POSITION CALCULATOR</h2>
            </div>
            <PositionCalculator balanceUsd={balances?.total_usd} />
          </div>
        </section>

        <section className="col-span-12">
          <div className="rounded-xl border border-gray-700 bg-[#0d141d] p-4">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2 border-b border-gray-800 pb-3">
              <h2 className="text-lg font-semibold">POSITIONS &amp; OPEN ORDERS</h2>
              <div className="flex items-center gap-3 text-xs text-slate-500">
                <span>{positions.length} position{positions.length === 1 ? '' : 's'}</span>
                <span>{openOrders.length} open order{openOrders.length === 1 ? '' : 's'}</span>
                {positions.length > 0 && (
                  <span className="font-mono font-semibold">
                    open P&amp;L{' '}
                    <span className={openPnl >= 0 ? 'text-emerald-400' : 'text-red-400'}>
                      {openPnl >= 0 ? '+' : ''}{fmtUsd(openPnl, 2)}
                    </span>
                  </span>
                )}
              </div>
            </div>

            <div className="mb-1 text-xs uppercase tracking-wide text-slate-500">
              Your positions — profit updates live
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-800">
                    <th className={th}>Asset</th>
                    <th className={`${th} text-right`}>Quantity</th>
                    <th className={`${th} text-right`}>Avg cost</th>
                    <th className={`${th} text-right`}>Mark</th>
                    <th className={`${th} text-right`}>Value</th>
                    <th className={`${th} text-right`}>Profit</th>
                    <th className={`${th} text-right`}>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {positions.length === 0 && (
                    <tr>
                      <td colSpan={7} className="px-3 py-4 text-center text-xs text-slate-500">
                        No open positions — anything you buy shows up here with live profit.
                      </td>
                    </tr>
                  )}
                  {positions.map((p) => {
                    const { mark, pnl, pct } = positionPnl(p)
                    const value = mark * p.qty
                    const confirming = closing === p.asset
                    return (
                      <tr key={p.asset} className="border-b border-gray-800/60 hover:bg-slate-800/40">
                        <td className="px-3 py-2 font-semibold">{p.asset}</td>
                        <td className="px-3 py-2 text-right font-mono">{fmtNum(p.qty, 6)}</td>
                        <td className="px-3 py-2 text-right font-mono text-slate-400">{fmtUsd(p.avg_cost)}</td>
                        <td className="px-3 py-2 text-right font-mono">{fmtUsd(mark)}</td>
                        <td className="px-3 py-2 text-right font-mono">{fmtUsd(value)}</td>
                        <td className={`px-3 py-2 text-right font-mono font-semibold ${pnl >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                          {pnl >= 0 ? '+' : ''}{fmtUsd(pnl, 2)}
                          {pct != null && (
                            <span className="ml-1 text-xs font-normal">({fmtPctText(pct)})</span>
                          )}
                        </td>
                        <td className="px-3 py-2 text-right">
                          <button
                            type="button"
                            onClick={() => closePosition(p)}
                            className={`rounded-md px-3 py-1 text-xs font-semibold transition ${
                              confirming
                                ? 'bg-amber-600 text-white hover:bg-amber-500'
                                : pnl >= 0
                                  ? 'bg-emerald-900/60 text-emerald-300 hover:bg-emerald-800'
                                  : 'bg-slate-700 text-slate-200 hover:bg-slate-600'
                            }`}
                          >
                            {confirming ? 'Confirm sell?' : pnl >= 0 ? 'Take profit' : 'Close'}
                          </button>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>

            <div className="mt-5 mb-1 flex items-center justify-between">
              <div className="text-xs uppercase tracking-wide text-slate-500">Open (limit) orders</div>
              <div className="text-[11px] text-slate-600">Profit vs mark · cancel keeps you out of the fill</div>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-800">
                    <th className={th}>Symbol</th>
                    <th className={th}>Side</th>
                    <th className={th}>Type</th>
                    <th className={`${th} text-right`}>Price</th>
                    <th className={`${th} text-right`}>Quantity</th>
                    <th className={`${th} text-right`}>Profit now</th>
                    <th className={th}>Mode</th>
                    <th className={th}>Placed</th>
                    <th className={`${th} text-right`}>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {openOrders.length === 0 && (
                    <tr><td colSpan={9} className="px-3 py-5 text-center text-slate-500">No open orders.</td></tr>
                  )}
                  {openOrders.map((o) => {
                    const pnl = orderPnl(o)
                    return (
                    <tr key={o.id} className="border-b border-gray-800/60 hover:bg-slate-800/40">
                      <td className="px-3 py-2 font-semibold">{o.symbol}</td>
                      <td className={`px-3 py-2 font-semibold ${o.side === 'BUY' ? 'text-emerald-400' : 'text-red-400'}`}>{o.side}</td>
                      <td className="px-3 py-2 text-slate-400">{o.type}</td>
                      <td className="px-3 py-2 text-right font-mono">{o.price ? fmtUsd(o.price) : 'MKT'}</td>
                      <td className="px-3 py-2 text-right font-mono">{fmtNum(o.quantity, 6)}</td>
                      <td className={`px-3 py-2 text-right font-mono ${pnl == null ? 'text-slate-600' : pnl >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                        {pnl == null ? '—' : `${pnl >= 0 ? '+' : ''}${fmtUsd(pnl, 2)}`}
                      </td>
                      <td className="px-3 py-2">
                        <span className={`rounded px-1.5 py-0.5 text-[10px] font-bold uppercase ${o.mode === 'demo' ? 'bg-slate-700 text-slate-300' : 'bg-emerald-900/60 text-emerald-300'}`}>
                          {o.mode}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-xs text-slate-500">{timeAgo(o.created_at)}</td>
                      <td className="px-3 py-2 text-right">
                        <button
                          type="button"
                          onClick={() => cancel(o.id)}
                          className="rounded-md bg-red-900/60 px-3 py-1 text-xs font-semibold text-red-300 transition hover:bg-red-800"
                        >
                          Cancel
                        </button>
                      </td>
                    </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </section>

        <section className="col-span-12 xl:col-span-8">
          <div className="rounded-xl border border-gray-700 bg-[#0d141d] p-4">
            <div className="mb-3 flex items-center justify-between border-b border-gray-800 pb-3">
              <h2 className="text-lg font-semibold">ORDER HISTORY</h2>
              <button
                type="button"
                onClick={() =>
                  downloadCsv(
                    `rupeepulse-orders-${new Date().toISOString().slice(0, 10)}.csv`,
                    history.map((o) => ({
                      id: o.id,
                      symbol: o.symbol,
                      side: o.side,
                      type: o.type,
                      quantity: o.quantity,
                      price: o.price ?? '',
                      avg_price: o.avg_price ?? '',
                      total: o.total ?? '',
                      status: o.status,
                      mode: o.mode,
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
                  <tr className="border-b border-gray-800">
                    <th className={th}>Symbol</th>
                    <th className={th}>Side</th>
                    <th className={th}>Type</th>
                    <th className={`${th} text-right`}>Qty</th>
                    <th className={`${th} text-right`}>Avg price</th>
                    <th className={th}>Status</th>
                    <th className={th}>Mode</th>
                    <th className={th}>When</th>
                  </tr>
                </thead>
                <tbody>
                  {history.length === 0 && (
                    <tr><td colSpan={8} className="px-3 py-5 text-center text-slate-500">No orders yet — place one from the ticket.</td></tr>
                  )}
                  {history.map((o) => (
                    <tr key={o.id} className="border-b border-gray-800/60 hover:bg-slate-800/40">
                      <td className="px-3 py-2 font-semibold">{o.symbol}</td>
                      <td className={`px-3 py-2 font-semibold ${o.side === 'BUY' ? 'text-emerald-400' : 'text-red-400'}`}>{o.side}</td>
                      <td className="px-3 py-2 text-slate-400">{o.type}</td>
                      <td className="px-3 py-2 text-right font-mono">{fmtNum(o.quantity, 6)}</td>
                      <td className="px-3 py-2 text-right font-mono">{o.avg_price ? fmtUsd(o.avg_price) : o.price ? fmtUsd(o.price) : '—'}</td>
                      <td className={`px-3 py-2 font-semibold ${statusColor(o.status)}`}>{o.status}</td>
                      <td className="px-3 py-2 text-xs uppercase text-slate-500">{o.mode}</td>
                      <td className="px-3 py-2 text-xs text-slate-500">{timeAgo(o.created_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </section>

        <section className="col-span-12 xl:col-span-4">
          <div className="rounded-xl border border-gray-700 bg-[#0d141d] p-4">
            <div className="mb-3 border-b border-gray-800 pb-3">
              <h2 className="text-lg font-semibold">BALANCES</h2>
            </div>
            {balances ? (
              <>
                <div className="mb-3 flex items-baseline justify-between">
                  <span className="text-sm text-slate-400">Portfolio value</span>
                  <span className="font-mono text-lg font-bold">
                    {fmtUsd(balances.total_usd)}
                    <span className="ml-2 text-sm text-slate-400">≈ {fmtNum(balances.total_pkr, 0)} PKR</span>
                  </span>
                </div>
                <ul className="space-y-2 text-sm">
                  {balances.balances.length === 0 && <li className="text-slate-500">No balances.</li>}
                  {balances.balances.map((b) => (
                    <li key={b.asset} className="flex items-center justify-between rounded-lg bg-[#0a111a] px-3 py-2">
                      <div>
                        <div className="font-semibold">{b.asset}</div>
                        <div className="text-xs text-slate-500">
                          {fmtNum(b.free, 6)} free{b.locked > 0 ? ` · ${fmtNum(b.locked, 6)} locked` : ''}
                        </div>
                      </div>
                      <div className="text-right font-mono">
                        <div>{fmtUsd(b.value_usd)}</div>
                        <div className="text-xs text-slate-500">{fmtNum(b.value_pkr, 0)} PKR</div>
                      </div>
                    </li>
                  ))}
                </ul>
              </>
            ) : (
              <p className="text-sm text-slate-500">Loading balances…</p>
            )}
          </div>
        </section>
      </div>
    </div>
  )
}

const fmtPctText = (value) =>
  `${value >= 0 ? '+' : ''}${Number(value).toFixed(2)}%`

export default Trade
