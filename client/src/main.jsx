import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter, Routes, Route } from 'react-router-dom'
import './index.css'
import { ReportProvider } from './lib/ReportContext.jsx'
import MobileNudge from './components/MobileNudge.jsx'
import HomePage from './pages/HomePage.jsx'
import ReportPage from './pages/ReportPage.jsx'
import HistoryPage from './pages/HistoryPage.jsx'
import FeedbackPage from './pages/FeedbackPage.jsx'

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <MobileNudge />
    <BrowserRouter>
      <ReportProvider>
        <Routes>
          <Route path="/"        element={<HomePage />} />
          <Route path="/report"  element={<ReportPage />} />
          <Route path="/history" element={<HistoryPage />} />
          <Route path="/feedback" element={<FeedbackPage />} />
        </Routes>
      </ReportProvider>
    </BrowserRouter>
  </React.StrictMode>
)
