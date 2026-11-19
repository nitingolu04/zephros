import { useEffect, useState } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { Plus } from 'lucide-react'
import { toast } from 'sonner'
import ThemeToggle from '@/components/ui/ThemeToggle'
import AccountMenu from '@/components/layout/AccountMenu'
import Logo from '@/components/ui/Logo'
import { api } from '@/services/api'

const sectionLinks = [
  { href: '#product', label: 'Product' },
  { href: '#features', label: 'Features' },
  { href: '#use-cases', label: 'Use cases' },
  { href: '#faq', label: 'FAQ' },
]

export default function Navbar() {
  const navigate = useNavigate()
  const location = useLocation()
  const isLanding = location.pathname === '/'
  const isDashboard = location.pathname === '/dashboard'
  const [creating, setCreating] = useState(false)
  const [scrolled, setScrolled] = useState(false)

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 12)
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  const handleCreate = async () => {
    if (creating) return
    setCreating(true)
    const res = await api.createBoard()
    setCreating(false)
    if (res.success && res.data) {
      toast.success('Board created')
      navigate(`/board/${res.data.boardId}`)
    } else {
      toast.error(res.error || 'Failed to create board')
    }
  }

  const solid = scrolled || !isLanding

  return (
    <header
      style={{
        position: 'fixed', top: 0, left: 0, right: 0, zIndex: 50,
        background: solid ? 'color-mix(in srgb, var(--color-background) 82%, transparent)' : 'transparent',
        backdropFilter: solid ? 'blur(14px) saturate(1.4)' : 'none',
        WebkitBackdropFilter: solid ? 'blur(14px) saturate(1.4)' : 'none',
        borderBottom: `1px solid ${solid ? 'var(--color-border)' : 'transparent'}`,
        transition: 'background-color 0.3s ease, border-color 0.3s ease',
      }}
    >
      <div className="mx-auto flex h-16 w-full max-w-6xl items-center justify-between gap-4 px-4 sm:px-6">
        <button type="button" onClick={() => navigate('/')} aria-label="Zephros home"
          className="flex shrink-0 items-center border-none bg-transparent p-0 cursor-pointer">
          <Logo size={28} />
        </button>

        {isLanding && (
          <nav className="hidden md:flex items-center gap-1" aria-label="Sections">
            {sectionLinks.map(link => (
              <a key={link.href} href={link.href}
                className="rounded-full px-3.5 py-2 text-sm text-muted-foreground no-underline transition-colors hover:text-foreground hover:bg-muted">
                {link.label}
              </a>
            ))}
          </nav>
        )}

        <div className="flex min-w-0 items-center justify-end gap-2">
          <ThemeToggle />
          <AccountMenu />
          {!isLanding && !isDashboard && (
            <button type="button" onClick={handleCreate} disabled={creating} className="btn btn-primary btn-sm hidden sm:inline-flex">
              {creating
                ? <span className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
                : <><Plus className="h-4 w-4" /> New board</>}
            </button>
          )}
        </div>
      </div>
    </header>
  )
}
