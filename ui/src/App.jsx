import React from 'react'
import { BrowserRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom'
import Analytics from './pages/Analytics.jsx'
import Nav from './pages/Nav.jsx'
import Market from './pages/Market.jsx'
import Profile from './pages/Profile.jsx'
import Trade from './pages/Trade.jsx'
import Wallet from './pages/Wallet.jsx'
import Overview from './pages/Overview.jsx'
import Card from './pages/404.jsx'
import Login from './pages/login.jsx'
import Signup from './pages/signup.jsx'
import { getCurrentUser } from './pages/auth.js'
import { MarketProvider } from './context/MarketContext.jsx'
import Toasts from './components/Toasts.jsx'

const ProtectedRoute = ({ children }) => {
  const location = useLocation()

  if (!getCurrentUser()) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />
  }

  return children
}

const protectedPage = (element) => <ProtectedRoute>{element}</ProtectedRoute>

const App = () => {
  return (
    <MarketProvider>
      <BrowserRouter>
        <Nav />
        <Routes>
          <Route path="/" element={protectedPage(<Overview />)} />
          <Route path="/overview" element={protectedPage(<Overview />)} />
          <Route path="/market" element={protectedPage(<Market />)} />
          <Route path="/trade" element={protectedPage(<Trade />)} />
          <Route path="/wallet" element={protectedPage(<Wallet />)} />
          <Route path="/analytics" element={protectedPage(<Analytics />)} />
          <Route path="/profile" element={protectedPage(<Profile />)} />
          <Route path="/login" element={<Login />} />
          <Route path="/signup" element={<Signup />} />
          <Route path="/*" element={<Card />} />
        </Routes>
        <Toasts />
      </BrowserRouter>
    </MarketProvider>
  )
}

export default App
