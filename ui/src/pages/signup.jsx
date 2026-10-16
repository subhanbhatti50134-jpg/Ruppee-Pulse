import { useEffect, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { getCurrentUser, registerUser } from './auth.js'
import '../css/auth.css'

const Signup = () => {
  const navigate = useNavigate()
  const location = useLocation()
  const redirectPath = location.state?.from || '/'
  const [form, setForm] = useState({ name: '', email: '', password: '', confirmPassword: '' })
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

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

    if (form.password.length < 6) {
      setError('Your password must be at least 6 characters.')
      return
    }
    if (form.password !== form.confirmPassword) {
      setError('Passwords do not match.')
      return
    }

    setBusy(true)
    const result = await registerUser({
      name: form.name,
      email: form.email,
      password: form.password,
    })
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
          <span className="auth-badge">Ruppee Pulse 3D</span>
          <h1 className="mt-6 text-5xl font-black  text-white">Your money,<br /><span className="text-blue-400">in perspective.</span></h1>
          <p className="mt-5 max-w-md text-lg  text-slate-400">Create your account and explore a sharper, deeper view of the rupee market.</p>
          
        </div>
        <section className="auth-card w-full rounded-2xl p-8 sm:p-10">
        <Link to="/" className="mb-8 block text-center text-2xl font-bold">
          Ruppee <span className="text-blue-500">Pulse</span>
        </Link>
        <h1 className="text-3xl font-bold">Create your account</h1>

        {error && <p role="alert" className="mt-5 rounded-lg border border-red-800 bg-red-950/40 p-3 text-sm text-red-300">{error}</p>}

        <form onSubmit={handleSubmit} className="mt-6 space-y-4">
          {[
            ['name', 'Full name', 'text', 'name', 'Your name'],
            ['email', 'Email address', 'email', 'email', 'you@example.com'],
            ['password', 'Password', 'password', 'new-password', 'At least 6 characters'],
            ['confirmPassword', 'Confirm password', 'password', 'new-password', 'Repeat your password'],
          ].map(([name, label, type, autoComplete, placeholder]) => (
            <label key={name} className="block text-sm font-medium text-slate-300">
              {label}
              <input
                name={name}
                type={type}
                value={form[name]}
                onChange={handleChange}
                autoComplete={autoComplete}
                required
                className="auth-input mt-2 w-full rounded-lg border px-4 py-3 text-white outline-none transition"
                placeholder={placeholder}
              />
            </label>
          ))}
          <button type="submit" disabled={busy} className="auth-button w-full rounded-lg px-4 py-3 font-semibold disabled:opacity-60">
            {busy ? 'Creating account…' : 'Create account'}
          </button>
        </form>

        <p className="mt-6 text-center text-sm text-slate-400">
          Already have an account?{' '}
          <Link to="/login" className="font-semibold text-blue-400 hover:text-blue-300">Log in</Link>
        </p>
        </section>
      </div>
    </main>
  )
}

export default Signup
