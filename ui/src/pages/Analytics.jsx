import React, { useCallback, useEffect, useState } from 'react'
import { api } from '../lib/api.js'
import PremiumChart from '../components/PremiumChart.jsx'
import { fmtNum, fmtPct, timeAgo } from '../lib/format.js'
import { downloadCsv } from '../lib/csv.js'
import { useMarket } from '../context/MarketContext.jsx'

const Analytics = () => {
  const { selectedSymbol } = useMarket()
  const [analytics, setAnalytics] = useState(null)
  const [alerts, setAlerts] = useState({ rules: [], events: [] })
  const [priceAlerts, setPriceAlerts] = useState([])
  const [arb, setArb] = useState(null)
  const [ads, setAds] = useState(null)
  const [adsSide, setAdsSide] = useState('both')
  const [form, setForm] = useState({ direction: 'above', threshold: '' })
  const [priceForm, setPriceForm] = useState({ symbol: '', direction: 'up', price: '', one_shot: true })
  const [notice, setNotice] = useState('')
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    try {
      const [stats, alertData, priceData, arbData, adsData] = await Promise.all([
        api('/api/p2p/analytics'),
        api('/api/alerts'),
        api('/api/price-alerts'),
        api('/api/p2p/arbitrage'),
        api('/api/p2p/ads?limit=40'),
      ])
      setAnalytics(stats)
      setAlerts(alertData)
      setPriceAlerts(priceData.alerts || [])
      setArb(arbData)
      setAds(adsData)
      setError('')
    } catch (err) {
      setError(err.message)
    }
  }, [])

  useEffect(() => {
    load()
    const timer = setInterval(load, 30000)
    return () => clearInterval(timer)
  }, [load])

  const createRule = async (event) => {
    event.preventDefault()
    setNotice('')
    setError('')
    if (!form.threshold) {
      setError('Enter a premium threshold.')
      return
    }
    try {
      await api('/api/alerts', {
        method: 'POST',
        body: { direction: form.direction, threshold: Number(form.threshold) },
      })
      setNotice('Alert rule created.')
      setForm({ direction: 'above', threshold: '' })
      load()
    } catch (err) {
      setError(err.message)
    }
  }

  const removeRule = async (id) => {
    try {
      await api(`/api/alerts/${id}`, { method: 'DELETE' })
      load()
    } catch (err) {
      setError(err.message)
    }
  }

  const createPriceAlert = async (event) => {
    event.preventDefault()
    setNotice('')
    setError('')
    if (!priceForm.symbol.trim() || !priceForm.price) {
      setError('Enter a symbol and trigger price.')
      return
    }
    try {
      await api('/api/price-alerts', {
        method: 'POST',
        body: {
          symbol: priceForm.symbol.trim().toUpperCase(),
          direction: priceForm.direction,
          price: Number(priceForm.price),
          one_shot: priceForm.one_shot,
        },
      })
      setNotice('Price alert armed — you will be notified when it triggers.')
      setPriceForm({ symbol: '', direction: priceForm.direction, price: '', one_shot: priceForm.one_shot })
      load()
    } catch (err) {
      setError(err.message)
    }
  }

  const removePriceAlert = async (id) => {
    try {
      await api(`/api/price-alerts/${id}`, { method: 'DELETE' })
      load()
    } catch (err) {
      setError(err.message)
    }
  }

  const togglePriceAlert = async (id) => {
    try {
      await api(`/api/price-alerts/${id}/toggle`, { method: 'POST' })
      load()
    } catch (err) {
      setError(err.message)
    }
  }

  const premium = analytics?.premium
  const ma = analytics?.ma
  const maxMethodPremium = Math.max(
    1,
    ...(analytics?.methods || []).map((m) => Math.abs(m.premium_pct || 0)),
  )

  const stat = (label, value, accent) => (
    <div className="rounded-xl border border-gray-700 bg-[#0d141d] p-4">
      <div className="text-xs uppercase tracking-wide text-slate-500">{label}</div>
      <div className={`mt-1 font-mono text-2xl font-bold ${accent || 'text-white'}`}>{value}</div>
    </div>
  )

  return (
    <div className="min-h-screen bg-[#080d14] text-white pt-32 px-4 pb-10">
      <div className="mb-4">
        <h1 className="text-xl font-bold">Analytics</h1>
        <p className="text-sm text-slate-400">
          P2P premium vs interbank rate — arbitrage opportunities localized to PKR
        </p>
      </div>

      {(notice || error) && (
        <div className={`mb-3 rounded-lg border p-3 text-sm ${
          notice ? 'border-emerald-700 bg-emerald-950/40 text-emerald-300' : 'border-red-800 bg-red-950/40 text-red-300'
        }`}>
          {notice || error}
        </div>
      )}

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {stat('Current premium', premium ? fmtPct(premium.premium_pct) : '—', 'text-amber-300')}
        {stat('Premium MA (30)', ma != null ? `${ma.toFixed(2)}%` : 'accumulating…', 'text-blue-300')}
        {stat('Interbank USD/PKR', analytics?.interbank ? fmtNum(analytics.interbank, 3) : '—')}
        {stat('P2P spread', analytics?.spread != null ? `${fmtNum(analytics.spread, 2)} PKR` : '—', 'text-emerald-300')}
      </div>

      <div className="mt-4 grid grid-cols-12 gap-4">
        <section className="col-span-12 xl:col-span-8">
          <div className="rounded-xl border border-gray-700 bg-[#0d141d] p-4">
            <div className="mb-3 flex items-center justify-between border-b border-gray-800 pb-3">
              <h2 className="text-lg font-semibold">PREMIUM HISTORY</h2>
              <div className="flex items-center gap-3 text-xs text-slate-400">
                <span className="flex items-center gap-1.5"><span className="inline-block h-0.5 w-4 bg-blue-500" /> premium %</span>
                <span className="flex items-center gap-1.5"><span className="inline-block h-0.5 w-4 bg-amber-500" /> MA(30)</span>
                <button
                  type="button"
                  onClick={() =>
                    downloadCsv(
                      `rupeepulse-premium-${new Date().toISOString().slice(0, 10)}.csv`,
                      (analytics?.history || []).map((h) => ({
                        ts: new Date(h.ts * 1000).toISOString(),
                        premium_pct: h.premium_pct,
                        p2p_rate: h.p2p_rate,
                        interbank_rate: h.interbank_rate,
                      })),
                    )
                  }
                  className="rounded-md border border-slate-600 px-3 py-1 text-xs text-slate-300 transition hover:bg-slate-800"
                >
                  Export CSV
                </button>
              </div>
            </div>
            {analytics?.history?.length > 1 ? (
              <PremiumChart points={analytics.history} height={320} />
            ) : (
              <div className="flex h-72 items-center justify-center text-sm text-slate-500">
                Collecting premium samples… (one per minute)
              </div>
            )}
          </div>
        </section>

        <section className="col-span-12 xl:col-span-4">
          <div className="rounded-xl border border-gray-700 bg-[#0d141d] p-4">
            <div className="mb-3 border-b border-gray-800 pb-3">
              <h2 className="text-lg font-semibold">THRESHOLD ALERTS</h2>
            </div>
            <form onSubmit={createRule} className="mb-4 flex gap-2">
              <select
                value={form.direction}
                onChange={(e) => setForm({ ...form, direction: e.target.value })}
                className="rounded-lg border border-slate-700 bg-[#0a111a] px-2 py-2 text-sm outline-none focus:border-blue-500"
              >
                <option value="above">Premium above</option>
                <option value="below">Premium below</option>
              </select>
              <input
                type="number"
                step="0.1"
                min="0"
                value={form.threshold}
                onChange={(e) => setForm({ ...form, threshold: e.target.value })}
                placeholder="% e.g. 2.5"
                className="w-full rounded-lg border border-slate-700 bg-[#0a111a] px-3 py-2 text-sm outline-none focus:border-blue-500"
              />
              <button type="submit" className="rounded-lg bg-blue-600 px-3 py-2 text-sm font-semibold hover:bg-blue-500">
                Add
              </button>
            </form>

            <ul className="space-y-2 text-sm">
              {alerts.rules.length === 0 && (
                <li className="text-slate-500">No rules yet — get notified when the premium crosses your level.</li>
              )}
              {alerts.rules.map((rule) => (
                <li key={rule.id} className="flex items-center justify-between rounded-lg bg-[#0a111a] px-3 py-2">
                  <span>
                    Premium {rule.direction}{' '}
                    <span className="font-mono text-amber-300">{rule.threshold}%</span>
                  </span>
                  <button
                    type="button"
                    onClick={() => removeRule(rule.id)}
                    className="text-xs text-red-400 hover:text-red-300"
                  >
                    remove
                  </button>
                </li>
              ))}
            </ul>

            <div className="mt-4 border-t border-gray-800 pt-3 text-xs text-slate-500">
              Automatic alerts also fire when the premium deviates ±1.5 pts from its moving average.
            </div>
          </div>

          <div className="mt-4 rounded-xl border border-gray-700 bg-[#0d141d] p-4">
            <div className="mb-3 border-b border-gray-800 pb-3">
              <h2 className="text-lg font-semibold">PRICE ALERTS</h2>
            </div>
            <form onSubmit={createPriceAlert} className="mb-4 flex flex-wrap gap-2">
              <input
                type="text"
                value={priceForm.symbol}
                onChange={(e) => setPriceForm({ ...priceForm, symbol: e.target.value })}
                placeholder={selectedSymbol || 'BTCUSDT'}
                className="w-32 rounded-lg border border-slate-700 bg-[#0a111a] px-3 py-2 text-sm outline-none focus:border-blue-500"
              />
              <select
                value={priceForm.direction}
                onChange={(e) => setPriceForm({ ...priceForm, direction: e.target.value })}
                className="rounded-lg border border-slate-700 bg-[#0a111a] px-2 py-2 text-sm outline-none focus:border-blue-500"
              >
                <option value="up">Price rises above</option>
                <option value="down">Price falls below</option>
              </select>
              <input
                type="number"
                step="any"
                min="0"
                value={priceForm.price}
                onChange={(e) => setPriceForm({ ...priceForm, price: e.target.value })}
                placeholder="Trigger price"
                className="w-36 rounded-lg border border-slate-700 bg-[#0a111a] px-3 py-2 text-sm outline-none focus:border-blue-500"
              />
              <label className="flex cursor-pointer items-center gap-1.5 text-xs text-slate-400">
                <input
                  type="checkbox"
                  checked={priceForm.one_shot}
                  onChange={(e) => setPriceForm({ ...priceForm, one_shot: e.target.checked })}
                  className="accent-blue-500"
                />
                one-shot
              </label>
              <button type="submit" className="rounded-lg bg-blue-600 px-3 py-2 text-sm font-semibold hover:bg-blue-500">
                Add
              </button>
            </form>

            <ul className="space-y-2 text-sm">
              {priceAlerts.length === 0 && (
                <li className="text-slate-500">No price alerts yet — watch a level and get notified.</li>
              )}
              {priceAlerts.map((a) => (
                <li key={a.id} className="flex items-center justify-between rounded-lg bg-[#0a111a] px-3 py-2">
                  <span className={a.enabled ? '' : 'opacity-50'}>
                    <span className="font-semibold">{a.symbol}</span>{' '}
                    {a.direction === 'up' ? 'rises above' : 'falls below'}{' '}
                    <span className="font-mono text-amber-300">{fmtNum(a.price, 4)}</span>
                    {!a.one_shot && <span className="ml-1 text-xs text-slate-500">(recurring)</span>}
                  </span>
                  <span className="flex items-center gap-3">
                    <button
                      type="button"
                      onClick={() => togglePriceAlert(a.id)}
                      className={`text-xs ${a.enabled ? 'text-emerald-400 hover:text-emerald-300' : 'text-slate-500 hover:text-slate-300'}`}
                    >
                      {a.enabled ? 'armed' : 'paused'}
                    </button>
                    <button
                      type="button"
                      onClick={() => removePriceAlert(a.id)}
                      className="text-xs text-red-400 hover:text-red-300"
                    >
                      remove
                    </button>
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </section>

        <section className="col-span-12 xl:col-span-5">
          <div className="h-full rounded-xl border border-gray-700 bg-[#0d141d] p-4">
            <div className="mb-3 flex items-center justify-between border-b border-gray-800 pb-3">
              <h2 className="text-lg font-semibold">ARBITRAGE SCANNER</h2>
              <span className="rounded-full border border-slate-600 px-2 py-0.5 text-[11px] text-slate-400">
                ≥ {arb?.arb_threshold_pct ?? 1.0}% threshold
              </span>
            </div>

            {arb?.cross?.margin != null && (
              <div className="mb-3 rounded-lg border border-slate-700 bg-[#0a111a] p-3 text-sm">
                <div className="text-xs uppercase tracking-wide text-slate-500">Best cross-method round trip</div>
                <div className="mt-1 flex flex-wrap items-baseline gap-x-3">
                  <span className="font-mono text-slate-300">
                    buy {arb.cross.best_buy} → sell {arb.cross.best_sell} PKR
                  </span>
                  <span className={`font-mono font-bold ${
                    (arb.cross.margin ?? 0) > 0 ? 'text-emerald-400' : 'text-red-400'
                  }`}>
                    {arb.cross.margin > 0 ? '+' : ''}{arb.cross.margin} PKR ({arb.cross.margin_pct > 0 ? '+' : ''}{arb.cross.margin_pct}%)
                  </span>
                </div>
              </div>
            )}

            <ul className="space-y-1.5 text-sm">
              {!(arb?.rows || []).length && (
                <li className="text-slate-500">Waiting for P2P snapshots…</li>
              )}
              {(arb?.rows || []).slice(0, 8).map((r) => {
                const opp = r.margin_pct != null && r.margin_pct >= (arb.arb_threshold_pct || 1)
                return (
                  <li
                    key={r.method}
                    className={`flex items-center justify-between rounded-lg px-3 py-2 ${
                      opp ? 'border border-emerald-600/60 bg-emerald-950/30' : 'bg-[#0a111a]'
                    }`}
                  >
                    <div>
                      <div className="font-medium">{r.method}</div>
                      <div className="text-xs text-slate-500">
                        buy {r.buy ?? '—'} · sell {r.sell ?? '—'} PKR
                      </div>
                    </div>
                    <div className="text-right">
                      <div className={`font-mono font-semibold ${
                        r.margin == null ? 'text-slate-600' : r.margin > 0 ? 'text-emerald-400' : 'text-red-400'
                      }`}>
                        {r.margin == null ? '—' : `${r.margin > 0 ? '+' : ''}${r.margin}`}
                      </div>
                      <div className={`text-xs ${r.margin_pct == null ? 'text-slate-600' : r.margin_pct > 0 ? 'text-emerald-400/80' : 'text-red-400/80'}`}>
                        {r.margin_pct == null ? 'no both-way ads' : `${r.margin_pct > 0 ? '+' : ''}${r.margin_pct}%`}
                      </div>
                    </div>
                  </li>
                )
              })}
            </ul>
            <div className="mt-3 border-t border-gray-800 pt-3 text-xs text-slate-500">
              Margin = sell price − buy price on the same method, before transfer
              fees. Highlighted rows clear the alert threshold.
            </div>
          </div>
        </section>

        <section className="col-span-12 xl:col-span-7">
          <div className="h-full rounded-xl border border-gray-700 bg-[#0d141d] p-4">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2 border-b border-gray-800 pb-3">
              <h2 className="text-lg font-semibold">LIVE P2P ADS · USDT/PKR</h2>
              <div className="flex gap-1.5">
                {['both', 'buy', 'sell'].map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => setAdsSide(s)}
                    className={`rounded-md border px-2.5 py-1 text-xs transition ${
                      adsSide === s
                        ? 'border-blue-500 bg-blue-500/15 text-blue-300'
                        : 'border-slate-700 text-slate-400 hover:bg-slate-800'
                    }`}
                  >
                    {s === 'both' ? 'all' : s === 'buy' ? 'I buy' : 'I sell'}
                  </button>
                ))}
              </div>
            </div>
            <div className="-mx-1 overflow-x-auto">
              <table className="w-full min-w-[560px] text-sm">
                <thead>
                  <tr className="text-left text-xs uppercase tracking-wide text-slate-500">
                    <th className="px-1 pb-2">Side</th>
                    <th className="px-1 pb-2">Price</th>
                    <th className="px-1 pb-2">Methods</th>
                    <th className="px-1 pb-2">Limits (PKR)</th>
                    <th className="px-1 pb-2 text-right">Available</th>
                    <th className="px-1 pb-2 text-right">Merchant</th>
                  </tr>
                </thead>
                <tbody>
                  {!(ads?.ads || []).length && (
                    <tr><td colSpan={6} className="py-6 text-center text-slate-500">Loading ads…</td></tr>
                  )}
                  {(ads?.ads || [])
                    .filter((a) => adsSide === 'both' || a.side === adsSide)
                    .slice(0, 14)
                    .map((a, i) => (
                      <tr key={`${a.merchant}-${a.price}-${i}`} className="border-t border-gray-800/60">
                        <td className="px-1 py-1.5">
                          <span className={`rounded px-1.5 py-0.5 text-[11px] font-semibold ${
                            a.side === 'buy' ? 'bg-emerald-500/15 text-emerald-300' : 'bg-blue-500/15 text-blue-300'
                          }`}>
                            {a.side === 'buy' ? 'BUY' : 'SELL'}
                          </span>
                        </td>
                        <td className="px-1 py-1.5 font-mono text-slate-200">{a.price}</td>
                        <td className="px-1 py-1.5 text-xs text-slate-400">{a.methods.join(', ')}</td>
                        <td className="px-1 py-1.5 font-mono text-xs text-slate-400">
                          {a.min ? fmtNum(a.min, 0) : '—'} – {a.max ? fmtNum(a.max, 0) : '—'}
                        </td>
                        <td className="px-1 py-1.5 text-right font-mono text-xs text-slate-300">
                          {a.available ? fmtNum(a.available, 1) : '—'}
                        </td>
                        <td className="px-1 py-1.5 text-right text-xs">
                          <span className="text-slate-400">{a.merchant}</span>
                          <span className="ml-1.5 text-slate-600">({a.monthly_orders} · {a.completion_rate}%)</span>
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
            <div className="mt-3 border-t border-gray-800 pt-3 text-xs text-slate-500">
              I buy = you acquire USDT from a merchant · I sell = a merchant buys
              your USDT. Interbank reference:{' '}
              <span className="font-mono text-slate-400">
                {ads?.interbank ? fmtNum(ads.interbank, 3) : '—'} PKR/USD
              </span>
            </div>
          </div>
        </section>

        <section className="col-span-12 lg:col-span-6">
          <div className="rounded-xl border border-gray-700 bg-[#0d141d] p-4">
            <div className="mb-3 border-b border-gray-800 pb-3">
              <h2 className="text-lg font-semibold">PREMIUM BY PAYMENT METHOD</h2>
            </div>
            <ul className="space-y-3">
              {!(analytics?.methods || []).length && (
                <li className="text-sm text-slate-500">Loading method spreads…</li>
              )}
              {(analytics?.methods || []).map((m) => {
                const width = Math.min(100, (Math.abs(m.premium_pct || 0) / maxMethodPremium) * 100)
                return (
                  <li key={m.method}>
                    <div className="mb-1 flex items-center justify-between text-sm">
                      <span className="text-slate-300">{m.method}</span>
                      <span className="font-mono text-slate-400">
                        buy {m.buy ? fmtNum(m.buy, 2) : '—'} ·{' '}
                        <span className="text-amber-300">
                          {m.premium_pct != null ? fmtPct(m.premium_pct) : '—'}
                        </span>
                      </span>
                    </div>
                    <div className="h-2 overflow-hidden rounded bg-slate-800">
                      <div
                        className={`h-full rounded ${m.premium_pct >= 0 ? 'bg-amber-500' : 'bg-emerald-500'}`}
                        style={{ width: `${width}%` }}
                      />
                    </div>
                  </li>
                )
              })}
            </ul>
          </div>
        </section>

        <section className="col-span-12 lg:col-span-6">
          <div className="rounded-xl border border-gray-700 bg-[#0d141d] p-4">
            <div className="mb-3 border-b border-gray-800 pb-3">
              <h2 className="text-lg font-semibold">ALERT FEED</h2>
            </div>
            <ul className="max-h-80 space-y-2 overflow-y-auto text-sm">
              {alerts.events.length === 0 && (
                <li className="text-slate-500">No alerts yet. They appear here and as pop-ups.</li>
              )}
              {alerts.events.map((ev) => (
                <li key={ev.id} className="rounded-lg border border-slate-800 bg-[#0a111a] px-3 py-2">
                  <div className="flex items-center justify-between text-xs text-slate-500">
                    <span className="uppercase tracking-wide text-amber-400">{ev.kind.replace('_', ' ')}</span>
                    <span>{timeAgo(ev.created_at)}</span>
                  </div>
                  <p className="mt-1 text-slate-200">{ev.message}</p>
                </li>
              ))}
            </ul>
          </div>
        </section>
      </div>
    </div>
  )
}

export default Analytics
