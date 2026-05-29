import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter, Routes, Route } from 'react-router-dom'
import './index.css'
import { ReportProvider } from './lib/ReportContext.jsx'
import MobileNudge from './components/MobileNudge.jsx'
import HomePage from './pages/HomePage.jsx'
import ReportPage from './pages/ReportPage.jsx'

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <MobileNudge />
    <BrowserRouter>
      <ReportProvider>
        <Routes>
          <Route path="/"        element={<HomePage />} />
          <Route path="/report"  element={<ReportPage />} />
        </Routes>
      </ReportProvider>
    </BrowserRouter>
  </React.StrictMode>
)
