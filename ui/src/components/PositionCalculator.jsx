import React, { useMemo, useState } from 'react'
import { useMarket } from '../context/MarketContext.jsx'
import { fmtNum, fmtUsd } from '../lib/format.js'

const inputCls =
  'mt-1 w-full rounded-lg border border-slate-700 bg-[#0a111a] px-2.5 py-2 text-sm font-mono text-white outline-none focus:border-blue-500'

const PositionCalculator = ({ balanceUsd }) => {
  const { selectedSymbol, tickers } = useMarket()
  const marketPrice = tickers[selectedSymbol]?.price || 0
  const [entry, setEntry] = useState('')
  const [stop, setStop] = useState('')
  const [target, setTarget] = useState('')
  const [risk, setRisk] = useState('1')
  const [side, setSide] = useState('LONG')

  const result = useMemo(() => {
    const e = Number(entry) || marketPrice
    const s = Number(stop)
    const r = Number(risk)
    const t = Number(target)
    const bal = Number(balanceUsd) || 0
    if (!e || !s || !r || bal <= 0) return null
    const riskUsd = (bal * r) / 100
    const stopDist = Math.abs(e - s)
    if (stopDist <= 0) return { error: 'Stop must differ from entry.' }
    if (side === 'LONG' && s >= e) return { error: 'Long stop must be below entry.' }
    if (side === 'SHORT' && s <= e) return { error: 'Short stop must be above entry.' }
    const qty = riskUsd / stopDist
    const notional = qty * e
    const out = {
      riskUsd,
      qty,
      notional,
      notionalPct: bal > 0 ? (notional / bal) * 100 : 0,
      stopLoss: s,
    }
    if (t) {
      const reward = Math.abs(t - e) * qty
      out.target = t
      out.rewardUsd = reward
      out.rr = riskUsd > 0 ? reward / riskUsd : null
      out.targetPct = ((t - e) / e) * 100 * (side === 'LONG' ? 1 : -1)
    }
    return out
  }, [entry, stop, target, risk, side, marketPrice, balanceUsd])

  const quick = (field, value) => {
    const set = { entry: setEntry, stop: setStop, target: setTarget }
    set[field](String(value))
  }

  return (
    <div>
      <div className="mb-3 flex gap-1.5">
        {['LONG', 'SHORT'].map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => setSide(s)}
            className={`flex-1 rounded-lg py-1.5 text-xs font-bold transition ${
              side === s
                ? s === 'LONG'
                  ? 'bg-emerald-600 text-white'
                  : 'bg-red-600 text-white'
                : 'bg-slate-800 text-slate-400 hover:bg-slate-700'
            }`}
          >
            {s}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-2 gap-2.5">
        <label className="block text-xs text-slate-400">
          Entry price
          <input
            type="number"
            step="any"
            min="0"
            value={entry}
            onChange={(e) => setEntry(e.target.value)}
            onBlur={() => !entry && marketPrice && quick('entry', marketPrice)}
            placeholder={marketPrice ? fmtNum(marketPrice, 2) : 'price'}
            className={inputCls}
          />
        </label>
        <label className="block text-xs text-slate-400">
          Stop-loss
          <input
            type="number"
            step="any"
            min="0"
            value={stop}
            onChange={(e) => setStop(e.target.value)}
            placeholder="trigger"
            className={inputCls}
          />
        </label>
        <label className="block text-xs text-slate-400">
          Take-profit <span className="text-slate-600">(optional)</span>
          <input
            type="number"
            step="any"
            min="0"
            value={target}
            onChange={(e) => setTarget(e.target.value)}
            placeholder="target"
            className={inputCls}
          />
        </label>
        <label className="block text-xs text-slate-400">
          Risk % of balance
          <input
            type="number"
            step="any"
            min="0"
            max="100"
            value={risk}
            onChange={(e) => setRisk(e.target.value)}
            className={inputCls}
          />
        </label>
      </div>

      <div className="mt-3 rounded-lg bg-[#0a111a] p-3 text-sm">
        {!result && (
          <p className="text-xs text-slate-500">
            Enter entry + stop (balance {fmtUsd(balanceUsd)}) to size the position.
          </p>
        )}
        {result?.error && <p className="text-xs text-red-400">{result.error}</p>}
        {result && !result.error && (
          <div className="space-y-1.5">
            <div className="flex justify-between">
              <span className="text-slate-400">Position size</span>
              <span className="font-mono font-bold text-slate-100">
                {fmtNum(result.qty, 6)} {baseOf(selectedSymbol)}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-400">Notional</span>
              <span className="font-mono text-slate-200">
                {fmtUsd(result.notional)}{' '}
                <span className={`text-xs ${result.notionalPct > 100 ? 'text-red-400' : 'text-slate-500'}`}>
                  ({result.notionalPct.toFixed(1)}% of balance{result.notionalPct > 100 ? ' — over balance' : ''})
                </span>
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-400">Risk at stop</span>
              <span className="font-mono text-red-400">− {fmtUsd(result.riskUsd)}</span>
            </div>
            {result.rewardUsd != null && (
              <>
                <div className="flex justify-between">
                  <span className="text-slate-400">Reward at target</span>
                  <span className="font-mono text-emerald-400">+ {fmtUsd(result.rewardUsd)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400">R : R</span>
                  <span className="font-mono font-bold text-blue-300">
                    {result.rr ? `1 : ${result.rr.toFixed(2)}` : '—'}
                    <span className="ml-1.5 text-xs font-normal text-slate-500">
                      ({result.targetPct >= 0 ? '+' : ''}{result.targetPct.toFixed(2)}% move)
                    </span>
                  </span>
                </div>
              </>
            )}
          </div>
        )}
      </div>
      <p className="mt-2 text-[11px] text-slate-600">
        Uses {selectedSymbol} live price as default entry. Sizes assume spot (no leverage).
      </p>
    </div>
  )
}

const baseOf = (symbol) => (symbol || '').replace(/USDT$/, '')

export default PositionCalculator
