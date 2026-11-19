import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import ErrorBoundary from '@/components/ErrorBoundary'
import App from './App'
import './index.css'

// Development only: expose stores for debugging and UI testing. Stripped from production builds.
if (import.meta.env.DEV) {
  void Promise.all([import('@/stores/boardStore'), import('@/stores/mediaStore')]).then(([board, media]) => {
    Object.assign(window, { __zephros: { useBoardStore: board.useBoardStore, useMediaStore: media.useMediaStore } })
  })
}

function showBootError(message: string) {
  const root = document.getElementById('root')
  // Only replace the page if React never mounted (true boot failure).
  if (!root || root.childElementCount > 0) return
  root.innerHTML = `
    <div style="min-height:100vh;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px;padding:24px;background:#FAF9F6;color:#18181B;text-align:center;font-family:Geist,system-ui,sans-serif">
      <h1 style="font-size:20px;font-weight:700;margin:0">Zephros failed to start</h1>
      <p style="font-size:14px;color:#6B6862;max-width:420px;margin:0">${message}</p>
      <button type="button" onclick="location.reload()" style="margin-top:8px;border-radius:10px;border:none;padding:10px 18px;background:#18181B;color:white;font-weight:600;cursor:pointer">Reload</button>
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
    <ErrorBoundary fallbackTitle="Zephros failed to start">
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </ErrorBoundary>
  </React.StrictMode>,
)
