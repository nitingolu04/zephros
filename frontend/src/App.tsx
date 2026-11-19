import { lazy, Suspense, useEffect } from 'react'
import { Routes, Route } from 'react-router-dom'
import { Toaster } from 'sonner'
import { useThemeStore } from '@/stores/themeStore'
import { useAuthStore } from '@/stores/authStore'
import ProtectedRoute from '@/components/ProtectedRoute'
import ErrorBoundary from '@/components/ErrorBoundary'
import PageLoader from '@/components/PageLoader'
import LandingPage from '@/pages/LandingPage'
import LoginPage from '@/pages/LoginPage'
import { wakeBackend } from '@/services/api'

// Board pulls in Konva, PDF import/export, WebRTC — keep off the homepage bundle.
const DashboardPage = lazy(() => import('@/pages/DashboardPage'))
const BoardPage = lazy(() => import('@/pages/BoardPage'))
const CanvasPreviewPage = lazy(() => import('@/pages/CanvasPreviewPage'))

export default function App() {
  const resolved = useThemeStore((s) => s.resolved)
  const initAuth = useAuthStore((s) => s.init)

  useEffect(() => {
    return initAuth()
  }, [initAuth])

  useEffect(() => { wakeBackend() }, [])

  return (
    <div className="noise-overlay min-h-screen">
      <Toaster
        position="bottom-right"
        theme={resolved}
        richColors
        toastOptions={{
          style: {
            fontFamily: 'var(--font-sans)',
          },
        }}
      />
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/" element={<LandingPage />} />
        <Route
          path="/canvas-preview"
          element={(
            <ErrorBoundary fallbackTitle="Canvas preview failed to load">
              <Suspense fallback={<PageLoader label="Loading canvas…" />}>
                <CanvasPreviewPage />
              </Suspense>
            </ErrorBoundary>
          )}
        />
        <Route
          path="/dashboard"
          element={(
            <ProtectedRoute>
              <Suspense fallback={<PageLoader label="Loading dashboard…" />}>
                <DashboardPage />
              </Suspense>
            </ProtectedRoute>
          )}
        />
        <Route
          path="/board/:id"
          element={(
            <ErrorBoundary fallbackTitle="Board failed to load">
              <Suspense fallback={<PageLoader label="Loading board…" />}>
                <BoardPage />
              </Suspense>
            </ErrorBoundary>
          )}
        />
      </Routes>
    </div>
  )
}
