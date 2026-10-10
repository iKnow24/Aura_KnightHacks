import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter, Navigate, Routes, Route } from 'react-router-dom'
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

ReactDOM.createRoot(document.getElementById('root')).render(
  <BrowserRouter>
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
  </BrowserRouter>
)
