import './demo/backend.js' // first, so the fake brain is in place before any screen connects (VITE_DEMO only)
import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter, HashRouter, Navigate, Routes, Route } from 'react-router-dom'
import './index.css'
import Home from './pages/Home.jsx'
import Landing from './pages/Landing.jsx'
import Login from './pages/Login.jsx'
import { getUser } from './lib/user'
import Dashboard from './pages/Dashboard.jsx'
import Node from './pages/Node.jsx'
import Strobe from './pages/Strobe.jsx'
import Captions from './pages/Captions.jsx'
import Rear from './pages/Rear.jsx'
import Mic from './pages/Mic.jsx'
import Voices from './pages/Voices.jsx'

// Checked on every visit, not once at startup, so signing in takes effect right away.
const RequireUser = ({ children }) => (getUser() ? children : <Navigate to="/start" replace />)

// Hosts that can't send every path to index.html (an embedded preview) build with VITE_ROUTER=hash.
const Router = import.meta.env.VITE_ROUTER === 'hash' ? HashRouter : BrowserRouter
const routerProps = import.meta.env.VITE_ROUTER === 'hash' ? {} : { basename: import.meta.env.BASE_URL }

ReactDOM.createRoot(document.getElementById('root')).render(
  <Router {...routerProps}>
    <Routes>
      {/* The landing page explains Lumen; "Enter the demo" goes to sign-in, which skips to the dashboard if signed in. */}
      <Route path="/" element={<Landing />} />
      <Route path="/start" element={<Login />} />
      <Route path="/devices" element={<Home />} />
      {/* Only the caregiver dashboard needs a login. Phones scan a QR code and go straight to their page. */}
      <Route path="/dashboard" element={<RequireUser><Dashboard /></RequireUser>} />
      {/* The headset page was folded into Captions; old links and QR codes still land somewhere useful. */}
      <Route path="/headset" element={<Navigate to="/captions" replace />} />
      <Route path="/node" element={<Node />} />
      <Route path="/strobe" element={<Strobe />} />
      <Route path="/captions" element={<Captions />} />
      <Route path="/rear" element={<Rear />} />
      <Route path="/mic" element={<Mic />} />
      <Route path="/voices" element={<Voices />} />
    </Routes>
  </Router>
)
