import { useNavigate, useLocation } from 'react-router-dom'
import { motion } from 'framer-motion'
import { Plus, Sparkles } from 'lucide-react'
import ThemeToggle from '@/components/ui/ThemeToggle'
import AccountMenu from '@/components/layout/AccountMenu'
import { api } from '@/services/api'
import { toast } from 'sonner'
import { useState } from 'react'

export default function Navbar() {
  const navigate = useNavigate()
  const location = useLocation()
  const isLanding = location.pathname === '/'
  const isDashboard = location.pathname === '/dashboard'
  const [creating, setCreating] = useState(false)

  const handleCreate = async () => {
    if (creating) return
    setCreating(true)
    const res = await api.createBoard()
    setCreating(false)
    if (res.success && res.data) {
      toast.success('Board created!')
      navigate(`/board/${res.data.boardId}`)
    } else {
      toast.error(res.error || 'Failed to create board')
    }
  }

  return (
    <motion.header
      initial={false}
      className="fixed top-0 left-0 right-0 z-50 border-b border-border bg-card/80 backdrop-blur-xl"
    >
      <div className="mx-auto flex h-16 w-full max-w-6xl items-center justify-between gap-4 px-4 sm:px-6">
        {/* Logo */}
        <button
          type="button"
          onClick={() => navigate('/')}
          className="flex shrink-0 items-center gap-2.5 rounded-xl border-none bg-transparent p-0 text-foreground cursor-pointer"
        >
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-indigo-500 to-purple-500 shadow-md shadow-indigo-500/25">
            <Sparkles className="h-4 w-4 text-white" />
          </div>
          <span className="text-base font-bold tracking-tight">Aerix</span>
        </button>

        {/* Right side */}
        <div className="flex min-w-0 items-center justify-end gap-2 sm:gap-3">
          <ThemeToggle />
          <AccountMenu />
          {!isLanding && !isDashboard && (
            <motion.button
              type="button"
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
              onClick={handleCreate}
              disabled={creating}
              className="hidden sm:flex h-9 shrink-0 items-center gap-2 rounded-xl bg-accent px-4 text-sm font-medium text-white shadow-md shadow-accent/20 border-none cursor-pointer disabled:opacity-70"
            >
              {creating ? (
                <div className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
              ) : (
                <>
                  <Plus className="h-4 w-4" />
                  New Board
                </>
              )}
            </motion.button>
          )}
        </div>
      </div>
    </motion.header>
  )
}
