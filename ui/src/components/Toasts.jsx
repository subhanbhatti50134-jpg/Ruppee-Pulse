import { useEffect, useState } from 'react'
import { useMarket } from '../context/MarketContext.jsx'

const Toasts = () => {
  const { alerts, dismissAlerts } = useMarket()
  const [hidden, setHidden] = useState(new Set())
  const [permission, setPermission] = useState(
    () => (typeof Notification !== 'undefined' ? Notification.permission : 'unsupported'),
  )
  const latestId = alerts[0]?.id

  useEffect(() => {
    setHidden(new Set())
  }, [latestId])

  const enableNotifications = async () => {
    if (typeof Notification === 'undefined') return
    try {
      const result = await Notification.requestPermission()
      setPermission(result)
    } catch {
      /* user dismissed the prompt */
    }
  }

  const visible = alerts.filter((a) => !hidden.has(a.id)).slice(0, 3)
  if (!visible.length) return null

  const hide = (id) => setHidden((prev) => new Set(prev).add(id))

  return (
    <div className="pointer-events-none fixed right-4 top-24 z-[60] flex w-80 flex-col gap-2">
      <div className="pointer-events-auto flex items-center justify-between rounded-lg border border-amber-600/50 bg-[#111a26] px-3 py-1.5 text-xs text-amber-300">
        <span>Arbitrage alerts</span>
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
              {alert.kind === 'threshold' ? 'Threshold' : 'Premium MA'}
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
