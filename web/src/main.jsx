import './demo/backend.js' // first, so the fake brain is in place before any screen connects (VITE_DEMO only)
import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter, HashRouter, Navigate, Routes, Route } from 'react-router-dom'
import './index.css'
import Home from './pages/Home.jsx'
import Login from './pages/Login.jsx'
import { getUser } from './lib/user'
import Dashboard from './pages/Dashboard.jsx'
import Headset from './pages/Headset.jsx'
import Node from './pages/Node.jsx'
import Strobe from './pages/Strobe.jsx'
import Captions from './pages/Captions.jsx'
import Rear from './pages/Rear.jsx'
import Mic from './pages/Mic.jsx'

// Checked on every visit, not once at startup, so signing in takes effect right away.
const RequireUser = ({ children }) => (getUser() ? children : <Navigate to="/" replace />)

// Hosts that can't send every path to index.html (an embedded preview) build with VITE_ROUTER=hash.
const Router = import.meta.env.VITE_ROUTER === 'hash' ? HashRouter : BrowserRouter
const routerProps = import.meta.env.VITE_ROUTER === 'hash' ? {} : { basename: import.meta.env.BASE_URL }

ReactDOM.createRoot(document.getElementById('root')).render(
  <Router {...routerProps}>
    <Routes>
      <Route path="/" element={<Login />} />
      <Route path="/devices" element={<Home />} />
      {/* Only the caregiver dashboard needs a login. Phones scan a QR code and go straight to their page. */}
      <Route path="/dashboard" element={<RequireUser><Dashboard /></RequireUser>} />
      <Route path="/headset" element={<Headset />} />
      <Route path="/node" element={<Node />} />
      <Route path="/strobe" element={<Strobe />} />
      <Route path="/captions" element={<Captions />} />
      <Route path="/rear" element={<Rear />} />
      <Route path="/mic" element={<Mic />} />
    </Routes>
  </Router>
)
