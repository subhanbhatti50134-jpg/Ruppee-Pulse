const SESSION_KEY = 'ruppee_pulse_session'

export const getSession = () => {
  try {
    return JSON.parse(localStorage.getItem(SESSION_KEY) || 'null')
  } catch {
    return null
  }
}

export const clearSession = () => localStorage.removeItem(SESSION_KEY)

export class ApiError extends Error {
  constructor(message, status) {
    super(message)
    this.status = status
  }
}

export const api = async (path, { method = 'GET', body, signal } = {}) => {
  const session = getSession()
  const headers = { 'Content-Type': 'application/json' }
  if (session?.token) {
    headers.Authorization = `Bearer ${session.token}`
  }

  let response
  try {
    response = await fetch(path, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal,
    })
  } catch {
    throw new ApiError('Cannot reach the RupeePulse backend. Is it running on port 8010?', 0)
  }

  let data = null
  try {
    data = await response.json()
  } catch {
    data = null
  }

  if (!response.ok) {
    const detail = data?.detail
    const message = typeof detail === 'string'
      ? detail
      : Array.isArray(detail)
        ? detail.map((d) => d.msg || d.type).join(', ')
        : `Request failed (${response.status})`
    if (response.status === 401 && session?.token) {
      clearSession()
    }
    throw new ApiError(message, response.status)
  }
  return data
}
