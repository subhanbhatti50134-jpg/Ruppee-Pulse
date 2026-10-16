import React, { useCallback, useEffect, useState } from 'react'
import { api } from '../lib/api.js'
import { useMarket } from '../context/MarketContext.jsx'
import { fmtNum, timeAgo } from '../lib/format.js'
import { getCurrentUser } from '../pages/auth.js'

const inputCls =
  'rounded-lg border border-slate-700 bg-[#0a111a] px-2.5 py-1.5 text-sm font-mono outline-none focus:border-blue-500'

const StopsPanel = () => {
  const { selectedSymbol, tickers } = useMarket()
  const [stops, setStops] = useState([])
  const [form, setForm] = useState({
    kind: 'STOP_LOSS',
    side: 'SELL',
    trigger: '',
    quantity: '',
    mode: 'single',
    tp: '',
    sl: '',
    exec: 'MARKET',
    limit: '',
  })
  const [notice, setNotice] = useState('')
  const [error, setError] = useState('')
  const authed = !!getCurrentUser()
  const marketPrice = tickers[selectedSymbol]?.price || 0

  const load = useCallback(async () => {
    if (!authed) return
    try {
      const data = await api('/api/stops')
      setStops(data.stops || [])
      setError('')
    } catch (err) {
      setError(err.message)
    }
  }, [authed])

  useEffect(() => {
    load()
    const timer = setInterval(load, 15000)
    const handler = () => load()
    window.addEventListener('rp:order-placed', handler)
    return () => {
      clearInterval(timer)
      window.removeEventListener('rp:order-placed', handler)
    }
  }, [load])

  const create = async (event) => {
    event.preventDefault()
    setNotice('')
    setError('')
    const isOco = form.mode === 'oco'
    if (!form.quantity) {
      setError('Quantity is required.')
      return
    }
    if (isOco && (!form.tp || !form.sl)) {
      setError('OCO needs both take-profit and stop-loss triggers.')
      return
    }
    if (!isOco && !form.trigger) {
      setError('Trigger price is required.')
      return
    }
    if (form.exec === 'LIMIT' && !form.limit) {
      setError('Stop-limit execution needs a limit price.')
      return
    }
    try {
      const body = {
        symbol: selectedSymbol,
        side: form.side,
        kind: isOco ? 'TAKE_PROFIT' : form.kind,
        trigger_price: Number(isOco ? form.tp : form.trigger),
        quantity: Number(form.quantity),
        mode: 'auto',
        order_type: form.exec,
        limit_price: form.exec === 'LIMIT' ? Number(form.limit) : null,
        ...(isOco ? { oco_trigger_price: Number(form.sl) } : {}),
      }
      await api('/api/stops', { method: 'POST', body })
      setNotice(
        isOco
          ? `OCO pair armed on ${selectedSymbol}: TP + SL, whichever fires first cancels the other.`
          : `${form.kind.replace('_', ' ')} armed on ${selectedSymbol}.`,
      )
      setForm({ ...form, trigger: '', quantity: '', tp: '', sl: '', limit: '' })
      load()
    } catch (err) {
      setError(err.message)
    }
  }

  const cancel = async (id) => {
    setNotice('')
    setError('')
    try {
      await api(`/api/stops/${id}`, { method: 'DELETE' })
      setNotice('Stop removed.')
      load()
    } catch (err) {
      setError(err.message)
    }
  }

  const statusColor = (s) =>
    s === 'FILLED' ? 'text-emerald-400'
    : s === 'FAILED' ? 'text-red-400'
    : s === 'CANCELED' ? 'text-slate-500'
    : 'text-amber-400'

  const th = 'py-1.5 px-2 text-left text-[11px] uppercase tracking-wide text-slate-500'
  const isOco = form.mode === 'oco'

  return (
    <div>
      <form onSubmit={create} className="mb-3 grid grid-cols-2 gap-2">
        <select
          value={form.mode}
          onChange={(e) => setForm({ ...form, mode: e.target.value })}
          className={`${inputCls} font-sans`}
        >
          <option value="single">Single leg</option>
          <option value="oco">OCO pair (TP + SL)</option>
        </select>
        <select
          value={form.side}
          onChange={(e) => setForm({ ...form, side: e.target.value })}
          className={`${inputCls} font-sans`}
        >
          <option value="SELL">SELL (exit long)</option>
          <option value="BUY">BUY (exit short)</option>
        </select>
        {!isOco && (
          <select
            value={form.kind}
            onChange={(e) => setForm({ ...form, kind: e.target.value })}
            className={`${inputCls} font-sans`}
          >
            <option value="STOP_LOSS">Stop-loss</option>
            <option value="TAKE_PROFIT">Take-profit</option>
          </select>
        )}
        {!isOco && (
          <label className="block text-xs text-slate-400">
            Trigger
            <input
              type="number"
              step="any"
              min="0"
              value={form.trigger}
              onChange={(e) => setForm({ ...form, trigger: e.target.value })}
              placeholder={marketPrice ? fmtNum(marketPrice, 2) : 'price'}
              className={`${inputCls} mt-1 w-full`}
            />
          </label>
        )}
        {isOco && (
          <label className="block text-xs text-emerald-400/80">
            Take-profit trigger
            <input
              type="number"
              step="any"
              min="0"
              value={form.tp}
              onChange={(e) => setForm({ ...form, tp: e.target.value })}
              placeholder="above entry"
              className={`${inputCls} mt-1 w-full`}
            />
          </label>
        )}
        {isOco && (
          <label className="block text-xs text-red-400/80">
            Stop-loss trigger
            <input
              type="number"
              step="any"
              min="0"
              value={form.sl}
              onChange={(e) => setForm({ ...form, sl: e.target.value })}
              placeholder="below entry"
              className={`${inputCls} mt-1 w-full`}
            />
          </label>
        )}
        <label className="block text-xs text-slate-400">
          Quantity
          <input
            type="number"
            step="any"
            min="0"
            value={form.quantity}
            onChange={(e) => setForm({ ...form, quantity: e.target.value })}
            placeholder="amount"
            className={`${inputCls} mt-1 w-full`}
          />
        </label>
        <label className="block text-xs text-slate-400">
          Execution
          <select
            value={form.exec}
            onChange={(e) => setForm({ ...form, exec: e.target.value })}
            className={`${inputCls} mt-1 w-full font-sans`}
          >
            <option value="MARKET">Market (fill now)</option>
            <option value="LIMIT">Limit (stop-limit)</option>
          </select>
        </label>
        {form.exec === 'LIMIT' && (
          <label className="col-span-2 block text-xs text-slate-400">
            Limit price (order rests at this price after trigger)
            <input
              type="number"
              step="any"
              min="0"
              value={form.limit}
              onChange={(e) => setForm({ ...form, limit: e.target.value })}
              placeholder={marketPrice ? fmtNum(marketPrice, 2) : 'limit price'}
              className={`${inputCls} mt-1 w-full`}
            />
          </label>
        )}
        <button
          type="submit"
          className="col-span-2 rounded-lg bg-blue-600 py-2 text-sm font-semibold text-white transition hover:bg-blue-500"
        >
          {isOco
            ? `Arm OCO pair on ${selectedSymbol}`
            : `Arm ${form.kind === 'STOP_LOSS' ? 'stop-loss' : 'take-profit'} on ${selectedSymbol}`}
        </button>
      </form>

      {(notice || error) && (
        <div className={`mb-2 rounded-lg border px-3 py-1.5 text-xs ${
          notice ? 'border-emerald-700 bg-emerald-950/40 text-emerald-300' : 'border-red-800 bg-red-950/40 text-red-300'
        }`}>
          {notice || error}
        </div>
      )}

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-800">
              <th className={th}>Kind</th>
              <th className={th}>Symbol</th>
              <th className={`${th} text-right`}>Trigger</th>
              <th className={th}>Exec</th>
              <th className={`${th} text-right`}>Qty</th>
              <th className={th}>Status</th>
              <th className={`${th} text-right`}>Action</th>
            </tr>
          </thead>
          <tbody>
            {stops.length === 0 && (
              <tr>
                <td colSpan={7} className="px-2 py-4 text-center text-xs text-slate-500">
                  No conditional orders — armed stops fire when the price crosses, as market or limit.
                </td>
              </tr>
            )}
            {stops.slice(0, 8).map((s) => (
              <tr key={s.id} className="border-b border-gray-800/60">
                <td className="px-2 py-1.5 text-xs font-semibold">
                  <span className={s.kind === 'STOP_LOSS' ? 'text-red-400' : 'text-emerald-400'}>
                    {s.kind === 'STOP_LOSS' ? 'SL' : 'TP'}
                  </span>
                  <span className="ml-1 text-slate-500">{s.side}</span>
                  {s.group_id && (
                    <span className="ml-1.5 rounded border border-indigo-500/50 px-1 text-[9px] font-bold text-indigo-300">
                      OCO
                    </span>
                  )}
                </td>
                <td className="px-2 py-1.5 text-xs font-semibold">{s.symbol}</td>
                <td className="px-2 py-1.5 text-right font-mono text-xs">{fmtNum(s.trigger_price, 4)}</td>
                <td className="px-2 py-1.5 text-xs">
                  {s.order_type === 'LIMIT' ? (
                    <span className="font-mono text-amber-300" title={`limit ${s.limit_price}`}>
                      LMT
                    </span>
                  ) : (
                    <span className="text-slate-500">MKT</span>
                  )}
                </td>
                <td className="px-2 py-1.5 text-right font-mono text-xs">{fmtNum(s.quantity, 5)}</td>
                <td className={`px-2 py-1.5 text-xs font-bold ${statusColor(s.status)}`}>
                  {s.status}
                  <span className="ml-1 font-normal text-slate-600">{timeAgo(s.triggered_at || s.created_at)}</span>
                </td>
                <td className="px-2 py-1.5 text-right">
                  {s.status === 'PENDING' ? (
                    <button
                      type="button"
                      onClick={() => cancel(s.id)}
                      className="rounded bg-red-900/60 px-2 py-0.5 text-[11px] font-semibold text-red-300 hover:bg-red-800"
                    >
                      Cancel
                    </button>
                  ) : s.status === 'CANCELED' ? (
                    <span className="text-[11px] text-slate-500">OCO done</span>
                  ) : (
                    <span className="text-[11px] text-slate-600">{s.error ? 'failed' : 'done'}</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

export default StopsPanel
