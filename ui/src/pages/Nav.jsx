import React from 'react'
import { NavLink, useLocation, useNavigate } from 'react-router-dom'
import logo from '../assets/logo.svg'
import { CiSearch } from 'react-icons/ci'
import '../css/nav.css'
import { getCurrentUser, logoutUser } from './auth.js'

const Nav = () => {
  const location = useLocation()
  const navigate = useNavigate()
  const user = getCurrentUser()
  const links = [
    { to: '/overview', label: 'Overview' },
    { to: '/market', label: 'Market' },
    { to: '/trade', label: 'Trade' },
    { to: '/wallet', label: 'Wallet' },
    { to: '/analytics', label: 'Analytics' },
    { to: '/profile', label: 'Profile' },
  ]

  if (location.pathname === '/login' || location.pathname === '/signup') {
    return null
  }

  const handleLogout = () => {
    logoutUser()
    navigate('/login', { state: { message: 'You have been logged out.' } })
  }

  return (
    <header className="nav-3d">
      <div className="nav-3d__surface">
        <NavLink to="/" className="nav-3d__brand">
          <img src={logo} alt="" className="nav-3d__logo" />
          <span>Ruppee <strong>Pulse</strong></span>
        </NavLink>
        <nav className="nav-3d__links">
          {links.map(({ to, label }) => (
            <NavLink
              key={to}
              to={to}
              className={({ isActive }) => isActive ? 'nav-3d__link nav-3d__link--active' : 'nav-3d__link'}
            >
              {label}
            </NavLink>
          ))}
        </nav>
        <div className="nav-3d__search">
          <CiSearch />
        <input
          type="search"
          placeholder="Search"
          aria-label="Search"
          className="nav-3d__search-input"
        />
        </div>
        {user ? (
          <div className="nav-3d__account">
            <span className="nav-3d__greeting">Hi, {user.name}</span>
            <button type="button" onClick={handleLogout} className="nav-3d__button">
              Log out
            </button>
          </div>
        ) : (
          <NavLink to="/login" className="nav-3d__button">
            Log in
          </NavLink>
        )}
      </div>
    </header>
  )
}

export default Nav
