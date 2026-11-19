export default function PageLoader({ label = 'Loading…' }: { label?: string }) {
  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 16,
        background: '#F8FAFC',
        color: '#334155',
      }}
    >
      <div
        style={{
          width: 36,
          height: 36,
          borderRadius: '50%',
          border: '3px solid #E2E8F0',
          borderTopColor: 'var(--color-ink)',
          animation: 'zephros-spin 0.8s linear infinite',
        }}
      />
      <style>{'@keyframes zephros-spin { to { transform: rotate(360deg) } }'}</style>
      <p style={{ fontSize: 14, fontWeight: 500 }}>{label}</p>
    </div>
  )
}
