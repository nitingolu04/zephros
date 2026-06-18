import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import ErrorBoundary from '@/components/ErrorBoundary'
import App from './App'
import './index.css'

function showBootError(message: string) {
  const root = document.getElementById('root')
  // Only replace the page if React never mounted (true boot failure).
  if (!root || root.childElementCount > 0) return
  root.innerHTML = `
    <div style="min-height:100vh;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px;padding:24px;background:#F8FAFC;color:#0F172A;text-align:center;font-family:Inter,system-ui,sans-serif">
      <h1 style="font-size:20px;font-weight:700;margin:0">Aerix failed to start</h1>
      <p style="font-size:14px;color:#64748B;max-width:420px;margin:0">${message}</p>
      <button type="button" onclick="location.reload()" style="margin-top:8px;border-radius:10px;border:none;padding:10px 18px;background:#6366F1;color:white;font-weight:600;cursor:pointer">Reload</button>
    </div>
  `
}

window.addEventListener('error', (event) => {
  if (event.message) showBootError(event.message)
})

window.addEventListener('unhandledrejection', (event) => {
  const message = event.reason instanceof Error ? event.reason.message : String(event.reason)
  if (message) showBootError(message)
})

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ErrorBoundary fallbackTitle="Aerix failed to start">
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </ErrorBoundary>
  </React.StrictMode>,
)
