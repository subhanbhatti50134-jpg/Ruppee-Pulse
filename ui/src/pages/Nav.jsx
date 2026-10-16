import React, { useState } from 'react'
import { NavLink, useLocation, useNavigate } from 'react-router-dom'
import logo from '../assets/logo.svg'
import { CiSearch, CiMenuBurger, CiCircleRemove } from 'react-icons/ci'
import '../css/nav.css'
import { getCurrentUser, logoutUser } from './auth.js'

const Nav = () => {
  const location = useLocation()
  const navigate = useNavigate()
  const user = getCurrentUser()
  const [menuOpen, setMenuOpen] = useState(false)
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
          <span>Rupee <strong>Pulse</strong></span>
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
            <button type="button" onClick={handleLogout} className="nav-3d__button nav-3d__logout">
              Log out
            </button>
          </div>
        ) : (
          <NavLink to="/login" className="nav-3d__button">
            Log in
          </NavLink>
        )}
        <button
          type="button"
          className="nav-3d__burger"
          aria-label={menuOpen ? 'Close menu' : 'Open menu'}
          aria-expanded={menuOpen}
          onClick={() => setMenuOpen((v) => !v)}
        >
          {menuOpen ? <CiCircleRemove /> : <CiMenuBurger />}
        </button>
      </div>
      <div className={`nav-3d__mobile${menuOpen ? ' nav-3d__mobile--open' : ''}`}>
        {links.map(({ to, label }) => (
          <NavLink
            key={to}
            to={to}
            onClick={() => setMenuOpen(false)}
            className={({ isActive }) => isActive ? 'nav-3d__link nav-3d__link--active' : 'nav-3d__link'}
          >
            {label}
          </NavLink>
        ))}
        <button type="button" onClick={handleLogout} className="nav-3d__button">
          Log out
        </button>
      </div>
    </header>
  )
}

export default Nav
