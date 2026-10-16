import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { api } from '../lib/api.js'
import { getCurrentUser } from '../pages/auth.js'

const MarketContext = createContext(null)

const SELECTED_SYMBOL_KEY = 'ruppee_pulse_symbol'
const MAX_ALERTS = 50
const FLUSH_MS = 250

// Ticker snapshots replace the whole map on every broadcast; compare the
// fields the UI actually renders so identical payloads keep their identity
// and skip a full-tree re-render.
const sameTickers = (a, b) => {
  const ka = Object.keys(a)
  if (ka.length !== Object.keys(b).length) return false
  for (const s of ka) {
    const x = a[s]
    const y = b[s]
    if (!y) return false
    if (
      x.price !== y.price ||
      x.change_pct !== y.change_pct ||
      x.high !== y.high ||
      x.low !== y.low ||
      x.quoteVolume !== y.quoteVolume ||
      x.volume !== y.volume
    ) return false
  }
  return true
}

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
  const tickersRef = useRef({})
  const pendingTickers = useRef(null)
  const pendingP2p = useRef(null)
  const flushTimer = useRef(null)

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

  // Commit tickers only when rendered values actually changed.
  const commitTickers = useCallback((next) => {
    const prev = tickersRef.current
    if (prev === next || sameTickers(prev, next)) return
    tickersRef.current = next
    setTickers(next)
    setLastTick(Date.now())
  }, [])

  const flushPending = useCallback(() => {
    flushTimer.current = null
    const nextTickers = pendingTickers.current
    const nextP2p = pendingP2p.current
    pendingTickers.current = null
    pendingP2p.current = null
    if (nextP2p) applyP2p(nextP2p)
    if (nextTickers) commitTickers(nextTickers)
  }, [applyP2p, commitTickers])

  // Coalesce bursts of WS messages (snapshot + tickers + p2p arrive together
  // on connect) into a single state commit.
  const scheduleFlush = useCallback(() => {
    if (flushTimer.current == null) {
      flushTimer.current = setTimeout(flushPending, FLUSH_MS)
    }
  }, [flushPending])

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
        commitTickers(tickerRes.data || {})
        setStreamConnected(Boolean(tickerRes.stream_connected))
        applyP2p(p2pRes)
      } catch {
        /* backend may still be starting; WS retry handles it */
      }
    }
    load()
    return () => { cancelled = true }
  }, [applyP2p, commitTickers])

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
          pendingTickers.current = message.data?.tickers || {}
          setStreamConnected(Boolean(message.data?.stream_connected))
          if (message.data?.p2p) pendingP2p.current = message.data.p2p
          scheduleFlush()
        } else if (message.type === 'tickers') {
          pendingTickers.current = message.data || {}
          scheduleFlush()
        } else if (message.type === 'p2p') {
          pendingP2p.current = message.data
          scheduleFlush()
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
      clearTimeout(flushTimer.current)
      flushTimer.current = null
      if (socket) {
        socket.onclose = null
        try { socket.close() } catch { /* already closed */ }
      }
    }
  }, [pushAlert, scheduleFlush])

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
