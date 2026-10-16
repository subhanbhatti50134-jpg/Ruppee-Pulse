import { useEffect, useState } from 'react'
import { api } from '../lib/api.js'
import { useMarket } from '../context/MarketContext.jsx'
import { fmtNum, fmtUsd, baseAsset } from '../lib/format.js'

const OrderTicket = ({ compact = false, defaultSymbol }) => {
  const { selectedSymbol, setSelectedSymbol, tickers, buyRate } = useMarket()
  const symbol = defaultSymbol || selectedSymbol
  const [side, setSide] = useState('BUY')
  const [type, setType] = useState('MARKET')
  const [quantity, setQuantity] = useState('')
  const [total, setTotal] = useState('')
  const [price, setPrice] = useState('')
  const [busy, setBusy] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [feedback, setFeedback] = useState(null)
  const [balances, setBalances] = useState(null)
  const [mode, setMode] = useState('auto')

  const ticker = tickers[symbol]
  const marketPrice = ticker?.price ?? null

  const loadBalances = async () => {
    try {
      const res = await api('/api/trade/balances')
      setBalances(res)
    } catch {
      setBalances(null)
    }
  }

  useEffect(() => {
    loadBalances()
    const handler = () => loadBalances()
    window.addEventListener('rp:order-placed', handler)
    return () => window.removeEventListener('rp:order-placed', handler)
  }, [])

  useEffect(() => {
    setPrice('')
    setFeedback(null)
    setConfirming(false)
  }, [symbol])

  const base = baseAsset(symbol)
  const available = balances?.balances?.find((b) => b.asset === (side === 'BUY' ? 'USDT' : base))
  const execPrice = type === 'LIMIT' && Number(price) > 0 ? Number(price) : marketPrice
  const estTotal =
    Number(quantity) > 0 && execPrice ? Number(quantity) * execPrice
    : Number(total) > 0 && execPrice ? Number(total)
    : null
  const FEE_RATE = 0.001
  const estFee = estTotal ? estTotal * FEE_RATE : null
  const netReceive =
    estTotal && execPrice
      ? side === 'BUY'
        ? (Number(quantity) > 0 ? Number(quantity) - estFee / execPrice : estTotal / execPrice - estFee / execPrice)
        : estTotal - estFee
      : null

  const submit = async (event) => {
    event.preventDefault()
    setFeedback(null)
    const payload = {
      symbol,
      side,
      type,
      mode,
      quantity: quantity ? Number(quantity) : null,
      quote_quantity: type === 'MARKET' && total ? Number(total) : null,
      price: type === 'LIMIT' ? Number(price) : null,
    }
    if (type === 'LIMIT' && (!payload.quantity || !payload.price)) {
      setFeedback({ error: 'Limit orders need quantity and price.' })
      return
    }
    if (type === 'MARKET' && !payload.quantity && !payload.quote_quantity) {
      setFeedback({ error: 'Enter an amount to trade.' })
      return
    }

    if (!confirming) {
      setConfirming(true)
      return
    }

    setBusy(true)
    try {
      const res = await api('/api/trade/order', { method: 'POST', body: payload })
      setFeedback({ order: res.order })
      setQuantity('')
      setTotal('')
      setConfirming(false)
      window.dispatchEvent(new CustomEvent('rp:order-placed', { detail: res.order }))
      loadBalances()
    } catch (err) {
      setFeedback({ error: err.message })
      setConfirming(false)
    } finally {
      setBusy(false)
    }
  }

  const cancelConfirm = () => {
    setConfirming(false)
    setFeedback(null)
  }

  const inputCls =
    'w-full rounded-lg border border-slate-700 bg-[#0a111a] px-3 py-2 text-sm text-white outline-none focus:border-blue-500'

  return (
    <form onSubmit={submit} className="flex flex-col gap-3">
      <div className="grid grid-cols-2 gap-2">
        <label className="block text-xs text-slate-400">
          Symbol
          <select
            value={symbol}
            onChange={(e) => setSelectedSymbol(e.target.value)}
            className={`${inputCls} mt-1 text-white`}
          >
            {Object.keys(tickers).length === 0 && <option>{symbol}</option>}
            {Object.keys(tickers).sort().map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
        </label>
        <label className="block text-xs text-slate-400">
          Mode
          <select value={mode} onChange={(e) => setMode(e.target.value)} className={`${inputCls} mt-1`}>
            <option value="auto">Auto</option>
            <option value="demo">Demo</option>
            <option value="live">Live</option>
          </select>
        </label>
      </div>

      <div className="grid grid-cols-2 gap-2">
        {['BUY', 'SELL'].map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => { setSide(s); setFeedback(null); setConfirming(false) }}
            className={`rounded-lg py-2 text-sm font-bold transition ${
              side === s
                ? s === 'BUY'
                  ? 'bg-emerald-600 text-white'
                  : 'bg-red-600 text-white'
                : 'bg-slate-800 text-slate-400 hover:bg-slate-700'
            }`}
          >
            {s}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-2 gap-2">
        {['MARKET', 'LIMIT'].map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => { setType(t); setConfirming(false) }}
            className={`rounded-lg py-1.5 text-xs font-semibold transition ${
              type === t ? 'bg-blue-600 text-white' : 'bg-slate-800 text-slate-400 hover:bg-slate-700'
            }`}
          >
            {t}
          </button>
        ))}
      </div>

      {type === 'LIMIT' && (
        <label className="block text-xs text-slate-400">
          Limit price (USDT)
          <input
            type="number"
            step="any"
            min="0"
            value={price}
            onChange={(e) => { setPrice(e.target.value); setConfirming(false) }}
            placeholder={marketPrice ? String(marketPrice) : ''}
            className={`${inputCls} mt-1`}
          />
        </label>
      )}

      <label className="block text-xs text-slate-400">
        Quantity ({base})
        <input
          type="number"
          step="any"
          min="0"
          value={quantity}
          onChange={(e) => { setQuantity(e.target.value); setConfirming(false) }}
          placeholder="0.00"
          className={`${inputCls} mt-1`}
        />
      </label>

      {type === 'MARKET' && (
        <label className="block text-xs text-slate-400">
          Or total (USDT)
          <input
            type="number"
            step="any"
            min="0"
            value={total}
            onChange={(e) => { setTotal(e.target.value); setConfirming(false) }}
            placeholder="100"
            className={`${inputCls} mt-1`}
          />
        </label>
      )}

      <div className="flex items-center justify-between text-xs text-slate-400">
        <span>
          Market: {fmtUsd(marketPrice)}
          {buyRate ? <> · ≈ {fmtNum(marketPrice ? marketPrice * buyRate : null, 0)} PKR</> : null}
        </span>
        <span>
          {available ? `${side === 'BUY' ? 'Avail' : 'Hold'}: ${fmtNum(available.free, 4)} ${available.asset}` : '—'}
        </span>
      </div>

      {estTotal && (
        <div className="rounded-lg bg-[#0a111a] px-3 py-2 text-xs text-slate-400">
          <div className="flex justify-between">
            <span>Order total</span>
            <span className="font-mono text-slate-200">≈ {fmtUsd(estTotal)}</span>
          </div>
          <div className="mt-1 flex justify-between">
            <span>Trading fee (0.1%)</span>
            <span className="font-mono text-amber-300">− {fmtUsd(estFee)}</span>
          </div>
          <div className="mt-1 flex justify-between border-t border-slate-800 pt-1">
            <span>You receive</span>
            <span className="font-mono text-emerald-300">
              ≈ {side === 'BUY' ? `${fmtNum(netReceive, 6)} ${base}` : `${fmtNum(netReceive, 4)} USDT`}
            </span>
          </div>
        </div>
      )}

      {confirming && (
        <div className="rounded-lg border border-amber-600/50 bg-amber-950/30 p-2.5 text-xs text-amber-200">
          Confirm {side} {fmtNum(Number(quantity) || (estTotal && execPrice ? estTotal / execPrice : 0), 6)} {base}
          {type === 'LIMIT' ? ` at ${fmtUsd(price)}` : ' at market'} in {mode === 'auto' ? 'auto' : mode} mode?
        </div>
      )}

      <button
        type="submit"
        disabled={busy}
        className={`rounded-lg py-2.5 text-sm font-bold text-white transition disabled:opacity-60 ${
          confirming
            ? side === 'BUY'
              ? 'bg-emerald-700 hover:bg-emerald-600'
              : 'bg-red-700 hover:bg-red-600'
            : side === 'BUY'
              ? 'bg-emerald-600 hover:bg-emerald-500'
              : 'bg-red-600 hover:bg-red-500'
        }`}
      >
        {busy
          ? 'Placing…'
          : confirming
            ? `Confirm ${side === 'BUY' ? 'Buy' : 'Sell'}`
            : `Review ${side === 'BUY' ? 'Buy' : 'Sell'} ${base}`}
      </button>

      {confirming && !busy && (
        <button
          type="button"
          onClick={cancelConfirm}
          className="w-full rounded-lg border border-slate-700 py-1.5 text-xs text-slate-400 transition hover:bg-slate-800"
        >
          Back
        </button>
      )}

      {!compact && balances && (
        <div className="text-xs text-slate-500">
          Portfolio: {fmtUsd(balances.total_usd)} · {balances.mode === 'demo' ? 'Demo funds' : 'Binance spot'}
        </div>
      )}

      {feedback?.error && (
        <p className="rounded-lg border border-red-800 bg-red-950/40 p-2 text-xs text-red-300">
          {feedback.error}
        </p>
      )}
      {feedback?.order && (
        <p className="rounded-lg border border-emerald-700 bg-emerald-950/40 p-2 text-xs text-emerald-300">
          {feedback.order.side} {feedback.order.symbol} {feedback.order.status} ·{' '}
          {fmtNum(feedback.order.quantity, 6)}
          {feedback.order.avg_price ? ` @ ${fmtUsd(feedback.order.avg_price)}` : ''}
          {feedback.order.mode === 'demo' ? ' (demo)' : ''}
        </p>
      )}
    </form>
  )
}

export default OrderTicket
