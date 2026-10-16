import React, { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '../lib/api.js'
import { getCurrentUser, logoutUser } from './auth.js'
import { timeAgo } from '../lib/format.js'

const Profile = () => {
  const navigate = useNavigate()
  const user = getCurrentUser()
  const [keysState, setKeysState] = useState(null)
  const [tg, setTg] = useState(null)
  const [tgBusy, setTgBusy] = useState(false)
  const [tgResult, setTgResult] = useState(null)
  const [form, setForm] = useState({ api_key: '', api_secret: '' })
  const [showSecret, setShowSecret] = useState(false)
  const [busy, setBusy] = useState(false)
  const [testing, setTesting] = useState(false)
  const [testRes, setTestRes] = useState(null)
  const [notice, setNotice] = useState('')
  const [error, setError] = useState('')
  const [pw, setPw] = useState({ current_password: '', new_password: '', confirm: '' })
  const [pwBusy, setPwBusy] = useState(false)

  const loadKeys = async () => {
    try {
      setKeysState(await api('/api/trade/keys'))
    } catch (err) {
      setError(err.message)
    }
  }

  const loadTelegram = async () => {
    try {
      setTg(await api('/api/telegram/status'))
    } catch {
      setTg({ configured: false })
    }
  }

  useEffect(() => {
    loadKeys()
    loadTelegram()
  }, [])

  const testTelegram = async () => {
    setTgBusy(true)
    setTgResult(null)
    try {
      setTgResult(await api('/api/telegram/test', { method: 'POST' }))
      loadTelegram()
    } catch (err) {
      setTgResult({ ok: false, detail: err.message })
    } finally {
      setTgBusy(false)
    }
  }

  const saveKeys = async (event) => {
    event.preventDefault()
    setNotice('')
    setError('')
    if (form.api_key.trim().length < 8 || form.api_secret.trim().length < 8) {
      setError('API key and secret must each be at least 8 characters.')
      return
    }
    setBusy(true)
    try {
      await api('/api/trade/keys', { method: 'POST', body: form })
      setNotice('API keys saved — encrypted with AES-256-GCM before storage.')
      setForm({ api_key: '', api_secret: '' })
      loadKeys()
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  const removeKeys = async () => {
    setNotice('')
    setError('')
    try {
      await api('/api/trade/keys', { method: 'DELETE' })
      setNotice('API keys removed. You are back in demo mode.')
      setTestRes(null)
      loadKeys()
    } catch (err) {
      setError(err.message)
    }
  }

  const testKeys = async () => {
    setTesting(true)
    setTestRes(null)
    try {
      setTestRes(await api('/api/trade/keys/test', { method: 'POST' }))
    } catch (err) {
      setTestRes({ ok: false, detail: err.message })
    } finally {
      setTesting(false)
    }
  }

  const handleLogout = async () => {
    await logoutUser()
    navigate('/login', { state: { message: 'You have been logged out.' } })
  }

  const changePassword = async (event) => {
    event.preventDefault()
    setNotice('')
    setError('')
    if (pw.new_password.length < 6) {
      setError('New password must be at least 6 characters.')
      return
    }
    if (pw.new_password !== pw.confirm) {
      setError('New password and confirmation do not match.')
      return
    }
    setPwBusy(true)
    try {
      const res = await api('/api/auth/change-password', {
        method: 'POST',
        body: { current_password: pw.current_password, new_password: pw.new_password },
      })
      setNotice(res.message || 'Password updated.')
      setPw({ current_password: '', new_password: '', confirm: '' })
    } catch (err) {
      setError(err.message)
    } finally {
      setPwBusy(false)
    }
  }

  const inputCls =
    'mt-1 w-full rounded-lg border border-slate-700 bg-[#0a111a] px-3 py-2.5 text-sm text-white outline-none focus:border-blue-500'

  return (
    <div className="min-h-screen bg-[#080d14] text-white pt-32 px-4 pb-10">
      <div className="mb-4">
        <h1 className="text-xl font-bold">Profile</h1>
        <p className="text-sm text-slate-400">Account security and Binance API connection</p>
      </div>

      {(notice || error) && (
        <div className={`mb-3 rounded-lg border p-3 text-sm ${
          notice ? 'border-emerald-700 bg-emerald-950/40 text-emerald-300' : 'border-red-800 bg-red-950/40 text-red-300'
        }`}>
          {notice || error}
        </div>
      )}

      <div className="grid grid-cols-12 gap-4">
        <section className="col-span-12 lg:col-span-4">
          <div className="rounded-xl border border-gray-700 bg-[#0d141d] p-5">
            <div className="flex items-center gap-4">
              <div className="flex h-14 w-14 items-center justify-center rounded-full bg-blue-600/20 text-xl font-bold text-blue-300">
                {user?.name?.[0]?.toUpperCase() || '?'}
              </div>
              <div>
                <div className="text-lg font-semibold">{user?.name}</div>
                <div className="text-sm text-slate-400">{user?.email}</div>
              </div>
            </div>
            <dl className="mt-5 space-y-2 border-t border-gray-800 pt-4 text-sm">
              <div className="flex justify-between">
                <dt className="text-slate-400">Account ID</dt>
                <dd className="font-mono text-xs text-slate-500">{user?.id?.slice(0, 12)}…</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-slate-400">Session</dt>
                <dd className="text-xs text-emerald-400">active</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-slate-400">Trading mode</dt>
                <dd className={keysState?.configured ? 'text-emerald-400' : 'text-amber-400'}>
                  {keysState?.configured ? 'Live (Binance)' : 'Demo (paper)'}
                </dd>
              </div>
            </dl>
            <button
              type="button"
              onClick={handleLogout}
              className="mt-5 w-full rounded-lg border border-red-800 bg-red-950/30 py-2 text-sm font-semibold text-red-300 transition hover:bg-red-900/40"
            >
              Log out
            </button>
          </div>

          <div className="mt-4 rounded-xl border border-gray-700 bg-[#0d141d] p-5 text-sm text-slate-400">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="font-semibold text-slate-200">Change password</h2>
              <span className="rounded-full border border-slate-600 px-2.5 py-0.5 text-xs text-slate-400">
                signs out other sessions
              </span>
            </div>
            <form onSubmit={changePassword} className="space-y-3">
              <label className="block text-xs text-slate-400">
                Current password
                <input
                  type="password"
                  value={pw.current_password}
                  onChange={(e) => setPw({ ...pw, current_password: e.target.value })}
                  placeholder="••••••••"
                  autoComplete="current-password"
                  className={inputCls}
                />
              </label>
              <label className="block text-xs text-slate-400">
                New password
                <input
                  type="password"
                  value={pw.new_password}
                  onChange={(e) => setPw({ ...pw, new_password: e.target.value })}
                  placeholder="at least 6 characters"
                  autoComplete="new-password"
                  className={inputCls}
                />
              </label>
              <label className="block text-xs text-slate-400">
                Confirm new password
                <input
                  type="password"
                  value={pw.confirm}
                  onChange={(e) => setPw({ ...pw, confirm: e.target.value })}
                  placeholder="repeat new password"
                  autoComplete="new-password"
                  className={inputCls}
                />
              </label>
              <button
                type="submit"
                disabled={pwBusy}
                className="w-full rounded-lg bg-blue-600 py-2 text-xs font-semibold text-white transition hover:bg-blue-500 disabled:opacity-60"
              >
                {pwBusy ? 'Updating…' : 'Update password'}
              </button>
            </form>
          </div>

          <div className="mt-4 rounded-xl border border-gray-700 bg-[#0d141d] p-5 text-sm text-slate-400">
            <div className="mb-2 flex items-center justify-between">
              <h2 className="font-semibold text-slate-200">Telegram alerts</h2>
              <span className={`rounded-full border px-2.5 py-0.5 text-xs ${
                tg?.configured
                  ? 'border-emerald-600/60 text-emerald-300'
                  : 'border-slate-600 text-slate-400'
              }`}>
                {tg?.configured ? 'Configured' : 'Not configured'}
              </span>
            </div>
            {tg?.configured ? (
              <p className="mb-3 text-xs">
                Alerts are forwarded to chat{' '}
                <code className="font-mono text-slate-300">{tg.chat_id}</code>.
              </p>
            ) : (
              <p className="mb-3 text-xs">
                Set <code className="font-mono text-slate-300">RP_TELEGRAM_BOT_TOKEN</code> and{' '}
                <code className="font-mono text-slate-300">RP_TELEGRAM_CHAT_ID</code> in{' '}
                <code className="font-mono text-slate-300">APis/.env</code>, then restart the
                backend to push arbitrage &amp; premium alerts to your chat.
              </p>
            )}
            <button
              type="button"
              onClick={testTelegram}
              disabled={tgBusy || !tg?.configured}
              className="w-full rounded-lg border border-slate-700 py-2 text-xs font-semibold text-slate-300 transition hover:bg-slate-800 disabled:opacity-50"
            >
              {tgBusy ? 'Sending test…' : 'Send test message'}
            </button>
            {tgResult && (
              <p className={`mt-2 text-xs ${tgResult.ok ? 'text-emerald-400' : 'text-amber-400'}`}>
                {tgResult.detail || (tgResult.ok ? 'Sent.' : 'Failed.')}
              </p>
            )}
          </div>

          <div className="mt-4 rounded-xl border border-gray-700 bg-[#0d141d] p-5 text-sm text-slate-400">
            <h2 className="mb-2 font-semibold text-slate-200">Security</h2>
            <ul className="list-inside list-disc space-y-1.5 text-xs">
              <li>Passwords hashed with PBKDF2-HMAC-SHA256 (200k iterations).</li>
              <li>API keys encrypted client-to-server with AES-256-GCM before hitting storage.</li>
              <li>Master encryption key lives outside the database in <code className="text-slate-300">APis/data/master.key</code>.</li>
              <li>Orders are signed with HMAC-SHA256 directly against Binance — secrets never leave the backend.</li>
            </ul>
          </div>
        </section>

        <section className="col-span-12 lg:col-span-8">
          <div className="rounded-xl border border-gray-700 bg-[#0d141d] p-5">
            <div className="mb-4 flex items-center justify-between border-b border-gray-800 pb-3">
              <h2 className="text-lg font-semibold">BINANCE API KEYS</h2>
              <span className={`rounded-full border px-3 py-1 text-xs ${
                keysState?.configured
                  ? 'border-emerald-600/60 text-emerald-300'
                  : 'border-amber-600/60 text-amber-300'
              }`}>
                {keysState?.configured ? 'Connected' : 'Not connected — demo mode'}
              </span>
            </div>

            {keysState?.configured && (
              <div className="mb-4 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-700 bg-[#0a111a] px-4 py-3 text-sm">
                <div>
                  <span className="text-slate-400">Stored key: </span>
                  <span className="font-mono">{keysState.api_key_masked}</span>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-xs text-slate-500">since {timeAgo(keysState.created_at)}</span>
                  <button
                    type="button"
                    onClick={testKeys}
                    disabled={testing}
                    className="rounded-md border border-slate-600 px-3 py-1 text-xs text-slate-300 transition hover:bg-slate-800 disabled:opacity-60"
                  >
                    {testing ? 'Testing…' : 'Test connection'}
                  </button>
                  <button
                    type="button"
                    onClick={removeKeys}
                    className="rounded-md bg-red-900/60 px-3 py-1 text-xs font-semibold text-red-300 hover:bg-red-800"
                  >
                    Remove keys
                  </button>
                </div>
              </div>
            )}

            {testRes && (
              <div
                className={`mb-4 rounded-lg border p-4 text-sm ${
                  testRes.ok
                    ? 'border-emerald-700/50 bg-emerald-950/20 text-emerald-100'
                    : 'border-red-700/50 bg-red-950/20 text-red-200'
                }`}
              >
                {testRes.ok ? (
                  <ul className="space-y-1">
                    <li><b>Valid key</b> — Binance account reachable (read-only check, no order placed).</li>
                    <li>Spot trading: <b>{testRes.can_trade ? 'enabled' : 'disabled'}</b>
                      {!testRes.can_trade && ' — turn on “Spot & Margin Trading” for this key.'}
                    </li>
                    <li>Withdrawals: <b>{testRes.can_withdraw ? 'ON — turn this OFF now' : 'off (recommended)'}</b>
                      {testRes.can_withdraw && ' — this app never needs withdrawal permission.'}
                    </li>
                    <li>Funded assets: {testRes.nonzero_balances} · permissions: {testRes.permissions.join(', ') || '—'}</li>
                  </ul>
                ) : (
                  <p><b>Test failed:</b> {testRes.detail}</p>
                )}
              </div>
            )}

            <form onSubmit={saveKeys} className="grid gap-4 sm:grid-cols-2">
              <label className="block text-sm text-slate-300">
                API key
                <input
                  type={showSecret ? 'text' : 'password'}
                  value={form.api_key}
                  onChange={(e) => setForm({ ...form, api_key: e.target.value })}
                  placeholder="Paste your Binance API key"
                  className={inputCls}
                  autoComplete="off"
                />
              </label>
              <label className="block text-sm text-slate-300">
                API secret
                <input
                  type={showSecret ? 'text' : 'password'}
                  value={form.api_secret}
                  onChange={(e) => setForm({ ...form, api_secret: e.target.value })}
                  placeholder="Paste your Binance API secret"
                  className={inputCls}
                  autoComplete="off"
                />
              </label>
              <div className="flex items-center justify-between sm:col-span-2">
                <label className="flex items-center gap-2 text-xs text-slate-400">
                  <input
                    type="checkbox"
                    checked={showSecret}
                    onChange={(e) => setShowSecret(e.target.checked)}
                  />
                  Show secrets
                </label>
                <button
                  type="submit"
                  disabled={busy}
                  className="rounded-lg bg-blue-600 px-5 py-2 text-sm font-semibold text-white transition hover:bg-blue-500 disabled:opacity-60"
                >
                  {busy ? 'Saving…' : keysState?.configured ? 'Replace keys' : 'Connect keys'}
                </button>
              </div>
            </form>

            <div className="mt-5 rounded-lg border border-slate-800 bg-[#0a111a] p-4 text-xs text-slate-400">
              <p className="font-semibold text-slate-300">How to create keys on Binance</p>
              <ol className="mt-2 list-inside list-decimal space-y-1">
                <li>Open Binance → Profile → API Management.</li>
                <li>Create a key, restrict it to <b>Enable Reading</b> + <b>Spot &amp; Margin Trading</b>.</li>
                <li>Whitelist this machine&apos;s IP if you enable IP restrictions.</li>
                <li>Paste the key + secret above. Both are AES-256-GCM encrypted before storage.</li>
              </ol>
              <p className="mt-2 text-slate-500">
                Without keys, RupeePulse runs in demo mode: orders are simulated against live prices
                with virtual funds so the whole workflow stays testable.
              </p>
            </div>

            {keysState?.configured && (
              <div className="mt-4 rounded-lg border border-amber-700/40 bg-amber-950/20 p-4 text-xs text-amber-100/90">
                <p className="font-semibold text-amber-300">Going live safely — first-trade checklist</p>
                <ol className="mt-2 list-inside list-decimal space-y-1">
                  <li>Keep key permissions to Reading + Spot Trading only — Withdrawals must stay OFF.</li>
                  <li>Run <b>Test connection</b> above and fix anything it flags before trading.</li>
                  <li>Place one tiny market order first (about $10) from the Trade ticket.</li>
                  <li>Confirm it in Order History and check its P&amp;L before scaling up.</li>
                  <li>Remove the keys any time to drop straight back to demo mode.</li>
                </ol>
              </div>
            )}
          </div>
        </section>
      </div>
    </div>
  )
}

export default Profile
