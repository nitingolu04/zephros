import { Component, type ErrorInfo, type ReactNode } from 'react'

interface Props {
  children: ReactNode
  fallbackTitle?: string
}

interface State {
  error: Error | null
}

export default class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error) {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[Aerix] Render error:', error, info.componentStack)
  }

  render() {
    if (this.state.error) {
      return (
        <div style={{
          minHeight: '100vh', display: 'flex', flexDirection: 'column',
          alignItems: 'center', justifyContent: 'center', gap: 16,
          padding: 24, background: '#F8FAFC', color: '#0F172A', textAlign: 'center',
        }}
        >
          <h1 style={{ fontSize: 20, fontWeight: 700 }}>
            {this.props.fallbackTitle || 'Something went wrong'}
          </h1>
          <p style={{ fontSize: 14, color: '#64748B', maxWidth: 420 }}>
            {this.state.error.message || 'An unexpected error occurred.'}
          </p>
          <button
            type="button"
            onClick={() => { window.location.href = '/' }}
            style={{
              marginTop: 8, borderRadius: 10, border: 'none', padding: '10px 18px',
              background: '#6366F1', color: 'white', fontWeight: 600, cursor: 'pointer',
            }}
          >
            Back to homepage
          </button>
        </div>
      )
    }
    return this.props.children
  }
}
