import { api, clearSession, getSession } from '../lib/api.js'

const SESSION_KEY = 'ruppee_pulse_session'

const saveSession = ({ user, token }) => {
  const session = { id: user.id, name: user.name, email: user.email, token }
  localStorage.setItem(SESSION_KEY, JSON.stringify(session))
  window.dispatchEvent(new Event('rp:auth-changed'))
  return session
}

export const getCurrentUser = () => {
  const session = getSession()
  if (!session?.token) return null
  return session
}

export const registerUser = async ({ name, email, password }) => {
  try {
    const res = await api('/api/auth/register', {
      method: 'POST',
      body: { name, email, password },
    })
    return { user: saveSession(res) }
  } catch (err) {
    return { error: err.message || 'Registration failed.' }
  }
}

export const loginUser = async (email, password) => {
  try {
    const res = await api('/api/auth/login', {
      method: 'POST',
      body: { email, password },
    })
    return { user: saveSession(res) }
  } catch (err) {
    return { error: err.message || 'Login failed.' }
  }
}

export const logoutUser = async () => {
  try {
    await api('/api/auth/logout', { method: 'POST' })
  } catch {
    /* clearing locally is enough */
  }
  clearSession()
  window.dispatchEvent(new Event('rp:auth-changed'))
}
