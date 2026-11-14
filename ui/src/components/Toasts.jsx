import { useState } from 'react'
import { useMarket } from '../context/MarketContext.jsx'

// Kinds emitted by APis/app/alerts.py and APis/app/stops.py.
const ALERT_LABELS = {
  premium_ma: 'Premium MA',
  threshold: 'Threshold',
  arbitrage: 'Arbitrage',
  price: 'Price alert',
  stop: 'Stop order',
}

const Toasts = () => {
  const { alerts, dismissAlerts } = useMarket()
  const [hidden, setHidden] = useState(new Set())
  const [permission, setPermission] = useState(
    () => (typeof Notification !== 'undefined' ? Notification.permission : 'unsupported'),
  )
  // No reset-on-new-alert here: pushAlert dedupes by id, so a dismissed toast
  // can never legitimately reappear — clearing `hidden` would only resurrect
  // every toast the user already closed.
  const visible = alerts.filter((a) => !hidden.has(a.id)).slice(0, 3)

  const enableNotifications = async () => {
    if (typeof Notification === 'undefined') return
    try {
      const result = await Notification.requestPermission()
      setPermission(result)
    } catch {
      /* user dismissed the prompt */
    }
  }

  if (!visible.length) return null

  const hide = (id) =>
    setHidden((prev) => {
      // Keep the set bounded: forget ids no longer in the (50-max) alert list.
      const live = new Set(alerts.map((a) => a.id))
      const next = new Set([...prev].filter((x) => live.has(x)))
      next.add(id)
      return next
    })

  return (
    <div className="pointer-events-none fixed right-4 top-24 z-[60] flex w-80 flex-col gap-2">
      <div className="pointer-events-auto flex items-center justify-between rounded-lg border border-amber-600/50 bg-[#111a26] px-3 py-1.5 text-xs text-amber-300">
        <span>Alerts</span>
        <div className="flex items-center gap-3">
          {permission !== 'unsupported' && permission !== 'granted' && (
            <button
              type="button"
              onClick={enableNotifications}
              className="flex items-center gap-1 text-[11px] text-slate-400 underline decoration-dotted hover:text-white"
              title="Get notified even when this tab is in the background"
            >
              🔔 enable
            </button>
          )}
          <button type="button" onClick={dismissAlerts} className="text-slate-400 hover:text-white">
            clear
          </button>
        </div>
      </div>
      {visible.map((alert) => (
        <div
          key={alert.id}
          className="pointer-events-auto rounded-xl border border-amber-500/40 bg-[#0d141d] p-3 shadow-xl shadow-black/40"
        >
          <div className="flex items-start justify-between gap-2">
            <span className="rounded bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-amber-400">
              {ALERT_LABELS[alert.kind] ?? 'Alert'}
            </span>
            <button
              type="button"
              onClick={() => hide(alert.id)}
              className="text-slate-500 hover:text-white"
              aria-label="Dismiss"
            >
              ×
            </button>
          </div>
          <p className="mt-2 text-sm text-slate-200">{alert.message}</p>
        </div>
      ))}
    </div>
  )
}

export default Toasts
