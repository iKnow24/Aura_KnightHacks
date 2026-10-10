import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter, Routes, Route } from 'react-router-dom'
import './index.css'
import Home from './pages/Home.jsx'
import Dashboard from './pages/Dashboard.jsx'
import Headset from './pages/Headset.jsx'
import Node from './pages/Node.jsx'
import Strobe from './pages/Strobe.jsx'

ReactDOM.createRoot(document.getElementById('root')).render(
  <BrowserRouter>
    <Routes>
      <Route path="/" element={<Home />} />
      <Route path="/dashboard" element={<Dashboard />} />
      <Route path="/headset" element={<Headset />} />
      <Route path="/node" element={<Node />} />
      <Route path="/strobe" element={<Strobe />} />
    </Routes>
  </BrowserRouter>
)
