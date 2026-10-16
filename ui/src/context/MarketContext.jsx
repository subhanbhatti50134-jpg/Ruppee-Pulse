import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { api } from '../lib/api.js'
import { getCurrentUser } from '../pages/auth.js'

const MarketContext = createContext(null)

const SELECTED_SYMBOL_KEY = 'ruppee_pulse_symbol'
const MAX_ALERTS = 50

export const MarketProvider = ({ children }) => {
  const [tickers, setTickers] = useState({})
  const [p2p, setP2p] = useState(null)
  const [interbank, setInterbank] = useState(null)
  const [premium, setPremium] = useState(null)
  const [ma, setMa] = useState(null)
  const [alerts, setAlerts] = useState([])
  const [wsConnected, setWsConnected] = useState(false)
  const [streamConnected, setStreamConnected] = useState(false)
  const [lastTick, setLastTick] = useState(0)
  const [selectedSymbol, setSelectedSymbolState] = useState(
    () => localStorage.getItem(SELECTED_SYMBOL_KEY) || 'BTCUSDT',
  )
  const [watchlist, setWatchlist] = useState([])
  const alertIds = useRef(new Set())

  const setSelectedSymbol = useCallback((symbol) => {
    localStorage.setItem(SELECTED_SYMBOL_KEY, symbol)
    setSelectedSymbolState(symbol)
  }, [])

  const pushAlert = useCallback((event) => {
    if (!event?.id || alertIds.current.has(event.id)) return
    alertIds.current.add(event.id)
    setAlerts((prev) => [event, ...prev].slice(0, MAX_ALERTS))
    if (typeof Notification !== 'undefined' && Notification.permission === 'granted' && document.hidden) {
      try {
        new Notification('RupeePulse alert', { body: event.message })
      } catch {
        /* notification construction can fail on some platforms */
      }
    }
  }, [])

  const applyP2p = useCallback((payload) => {
    if (!payload) return
    if (payload.p2p) setP2p(payload.p2p)
    if (payload.interbank) setInterbank(payload.interbank)
    if (payload.premium !== undefined) setPremium(payload.premium)
    if (payload.ma !== undefined) setMa(payload.ma)
  }, [])

  const dismissAlerts = useCallback(() => setAlerts([]), [])

  const inWatchlist = useCallback((symbol) => watchlist.includes(symbol), [watchlist])

  const toggleWatchlist = useCallback(async (symbol) => {
    if (!getCurrentUser()) return
    const removing = watchlist.includes(symbol)
    setWatchlist((prev) =>
      removing ? prev.filter((s) => s !== symbol) : [...prev, symbol],
    )
    try {
      const res = removing
        ? await api(`/api/watchlist/${symbol}`, { method: 'DELETE' })
        : await api('/api/watchlist', { method: 'POST', body: { symbol } })
      setWatchlist(res.symbols || [])
    } catch {
      /* revert on failure */
      setWatchlist((prev) =>
        removing ? [...prev, symbol] : prev.filter((s) => s !== symbol),
      )
    }
  }, [watchlist])

  // Load the watchlist for the signed-in user (reloads on login/logout).
  useEffect(() => {
    const loadWatchlist = async () => {
      if (!getCurrentUser()) {
        setWatchlist([])
        return
      }
      try {
        const res = await api('/api/watchlist')
        setWatchlist(res.symbols || [])
      } catch {
        setWatchlist([])
      }
    }
    loadWatchlist()
    window.addEventListener('rp:auth-changed', loadWatchlist)
    return () => window.removeEventListener('rp:auth-changed', loadWatchlist)
  }, [])

  // Initial REST snapshot so the UI renders before the socket connects.
  useEffect(() => {
    let cancelled = false
    const load = async () => {
      try {
        const [tickerRes, p2pRes] = await Promise.all([
          api('/api/market/tickers'),
          api('/api/p2p/rates'),
        ])
        if (cancelled) return
        setTickers(tickerRes.data || {})
        setStreamConnected(Boolean(tickerRes.stream_connected))
        applyP2p(p2pRes)
      } catch {
        /* backend may still be starting; WS retry handles it */
      }
    }
    load()
    return () => { cancelled = true }
  }, [applyP2p])

  // Live WebSocket stream with backoff reconnect.
  useEffect(() => {
    let socket = null
    let stopped = false
    let retryTimer = null
    let attempt = 0

    const connect = () => {
      if (stopped) return
      const proto = window.location.protocol === 'https:' ? 'wss' : 'ws'
      const url = `${proto}://${window.location.host}/ws`
      try {
        socket = new WebSocket(url)
      } catch {
        scheduleRetry()
        return
      }

      socket.onopen = () => {
        attempt = 0
        setWsConnected(true)
      }
      socket.onmessage = (event) => {
        let message
        try {
          message = JSON.parse(event.data)
        } catch {
          return
        }
        if (message.type === 'snapshot') {
          setTickers(message.data?.tickers || {})
          setStreamConnected(Boolean(message.data?.stream_connected))
          applyP2p(message.data?.p2p)
        } else if (message.type === 'tickers') {
          setTickers(message.data || {})
          setLastTick(Date.now())
        } else if (message.type === 'p2p') {
          applyP2p(message.data)
        } else if (message.type === 'alert') {
          pushAlert(message.data)
        } else if (message.type === 'status') {
          setStreamConnected(Boolean(message.connected))
        }
      }
      socket.onclose = () => {
        setWsConnected(false)
        scheduleRetry()
      }
      socket.onerror = () => {
        try { socket.close() } catch { /* already closed */ }
      }
    }

    const scheduleRetry = () => {
      if (stopped) return
      attempt += 1
      const delay = Math.min(1000 * 2 ** Math.min(attempt, 5), 15000)
      retryTimer = setTimeout(connect, delay)
    }

    connect()
    return () => {
      stopped = true
      clearTimeout(retryTimer)
      if (socket) {
        socket.onclose = null
        try { socket.close() } catch { /* already closed */ }
      }
    }
  }, [applyP2p, pushAlert])

  const value = useMemo(
    () => ({
      tickers,
      p2p,
      interbank,
      premium,
      ma,
      alerts,
      dismissAlerts,
      wsConnected,
      streamConnected,
      lastTick,
      selectedSymbol,
      setSelectedSymbol,
      watchlist,
      inWatchlist,
      toggleWatchlist,
      buyRate: p2p?.buy?.best ?? interbank ?? null,
      sellRate: p2p?.sell?.best ?? null,
    }),
    [tickers, p2p, interbank, premium, ma, alerts, dismissAlerts, wsConnected, streamConnected, lastTick, selectedSymbol, setSelectedSymbol, watchlist, inWatchlist, toggleWatchlist],
  )

  return <MarketContext.Provider value={value}>{children}</MarketContext.Provider>
}

export const useMarket = () => {
  const ctx = useContext(MarketContext)
  if (!ctx) throw new Error('useMarket must be used inside MarketProvider')
  return ctx
}
