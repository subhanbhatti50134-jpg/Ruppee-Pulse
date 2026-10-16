import { useEffect, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { getCurrentUser, loginUser } from './auth.js'
import '../css/auth.css'

const Login = () => {
  const navigate = useNavigate()
  const location = useLocation()
  const redirectPath = (location.state && location.state.from) || '/'
  const [form, setForm] = useState({ email: '', password: '' })
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState((location.state && location.state.message) || '')

  useEffect(() => {
    if (getCurrentUser()) {
      navigate(redirectPath)
    }
  }, [navigate, redirectPath])

  const handleChange = (event) => {
    setForm({ ...form, [event.target.name]: event.target.value })
    setError('')
  }

  const handleSubmit = async (event) => {
    event.preventDefault()
    setMessage('')

    if (!form.email || !form.password) {
      setError('Please enter your email and password.')
      return
    }

    setBusy(true)
    const result = await loginUser(form.email, form.password)
    setBusy(false)
    if (result.error) {
      setError(result.error)
      return
    }

    navigate(redirectPath)
  }

  return (
    <main className="auth-page flex min-h-screen items-center justify-center px-4 py-12 text-white">

      <div className="auth-layout">
        <div className="auth-intro hidden text-slate-300 md:block">
          <span className="auth-badge">Ruppee Pulse</span>
          <h1 className="mt-6 text-5xl font-black  text-white">See the market<br /><span className="text-blue-400">from every angle.</span></h1>
          <p className="mt-5 max-w-md text-lg  text-slate-400">Your dashboard turns currency movement into a clear, dimensional financial picture.</p>
          </div>
        <section className="auth-card w-full rounded-2xl p-8 sm:p-10">
        <Link to="/" className="mb-8 block text-center text-2xl font-bold">
          Ruppee <span className="text-blue-500">Pulse</span>
        </Link>
        <h1 className="text-3xl font-bold">Welcome back</h1>
        <p className="mt-2 text-slate-400">Sign in to continue to your dashboard.</p>

        {message && <p className="mt-5 rounded-lg border border-emerald-700 bg-emerald-950/40 p-3 text-sm text-emerald-300">{message}</p>}
        {error && <p role="alert" className="mt-5 rounded-lg border border-red-800 bg-red-950/40 p-3 text-sm text-red-300">{error}</p>}

        <form onSubmit={handleSubmit} className="mt-6 space-y-5">
          <label className="block text-sm font-medium text-slate-300">
            Email address
            <input
              name="email"
              type="email"
              value={form.email}
              onChange={handleChange}
              autoComplete="email"
              required
              className="auth-input mt-2 w-full rounded-lg border px-4 py-3 text-white outline-none transition"
              placeholder="you@example.com"
            />
          </label>
          <label className="block text-sm font-medium text-slate-300">
            Password
            <input
              name="password"
              type="password"
              value={form.password}
              onChange={handleChange}
              autoComplete="current-password"
              required
              className="auth-input mt-2 w-full rounded-lg border px-4 py-3 text-white outline-none transition"
              placeholder="Enter your password"
            />
          </label>
          <button type="submit" disabled={busy} className="auth-button w-full rounded-lg px-4 py-3 font-semibold disabled:opacity-60">
            {busy ? 'Logging in…' : 'Log in'}
          </button>
        </form>

        <p className="mt-6 text-center text-sm text-slate-400">
          Don&apos;t have an account?{' '}
          <Link to="/signup" className="font-semibold text-blue-400 hover:text-blue-300">Create one</Link>
        </p>
        </section>
      </div>
    </main>)
}

export default Login
