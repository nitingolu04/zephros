import { useState, useEffect, useMemo, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Search, Copy, Clock, ArrowLeft, Plus, LayoutGrid,
  Circle, CopyPlus, Trash2, ExternalLink,
} from 'lucide-react'
import Navbar from '@/components/layout/Navbar'
import { api } from '@/services/api'
import { toast } from 'sonner'
import { formatTimeAgo } from '@/lib/utils'
import type { BoardHistoryItem } from '@/types'

type FilterTab = 'all' | 'saved' | 'ephemeral'

const NOTE_COLORS = ['var(--color-note-yellow)', 'var(--color-note-mint)', 'var(--color-note-sky)', 'var(--color-note-pink)']

/** Paper-and-sticky-note thumbnail, varied per board so rows are easy to scan. */
function BoardThumbnail({ index, className = '' }: { index: number; className?: string }) {
  const a = NOTE_COLORS[index % NOTE_COLORS.length]
  const b = NOTE_COLORS[(index + 2) % NOTE_COLORS.length]
  return (
    <div className={`canvas-grid relative overflow-hidden rounded-lg border border-border ${className}`} style={{ backgroundSize: '10px 10px' }}>
      <span className="absolute rounded-[3px]" style={{ left: '14%', top: '20%', width: '34%', height: '38%', background: a, transform: 'rotate(-4deg)' }} />
      <span className="absolute rounded-[3px]" style={{ right: '14%', bottom: '18%', width: '30%', height: '34%', background: b, transform: 'rotate(5deg)' }} />
    </div>
  )
}

export default function DashboardPage() {
  const navigate = useNavigate()
  const [creating, setCreating] = useState(false)
  const [recentBoards, setRecentBoards] = useState<BoardHistoryItem[]>([])
  const [searchQuery, setSearchQuery] = useState('')
  const [filterTab, setFilterTab] = useState<FilterTab>('all')
  const [loadingBoards, setLoadingBoards] = useState(true)
  const [menuOpenId, setMenuOpenId] = useState<string | null>(null)
  const [actionLoading, setActionLoading] = useState<string | null>(null)

  const loadBoards = () => {
    setLoadingBoards(true)
    api.getBoardHistory().then((res) => {
      if (res.success && res.data) setRecentBoards(res.data.boards)
      setLoadingBoards(false)
    })
  }

  useEffect(() => { loadBoards() }, [])

  useEffect(() => {
    const close = () => setMenuOpenId(null)
    if (menuOpenId) document.addEventListener('click', close)
    return () => document.removeEventListener('click', close)
  }, [menuOpenId])

  const copyLink = (id: string, e: React.MouseEvent) => {
    e.stopPropagation()
    navigator.clipboard.writeText(`${window.location.origin}/board/${id}`)
    toast.success('Link copied')
  }

  const handleDuplicate = async (board: BoardHistoryItem, e: React.MouseEvent) => {
    e.stopPropagation()
    setMenuOpenId(null)
    if (!board.exists) {
      toast.error('Board no longer exists')
      return
    }
    setActionLoading(board.id)
    const res = await api.duplicateBoard(board.id)
    setActionLoading(null)
    if (res.success && res.data) {
      toast.success('Board duplicated')
      navigate(`/board/${res.data.boardId}`)
    } else {
      toast.error(res.error || 'Duplicate failed')
    }
  }

  const handleDelete = async (board: BoardHistoryItem, e: React.MouseEvent) => {
    e.stopPropagation()
    setMenuOpenId(null)
    if (!board.isOwner) {
      toast.error('Only the board owner can delete')
      return
    }
    if (!confirm(`Delete "${board.title}" permanently?`)) return
    setActionLoading(board.id)
    const res = await api.deleteBoard(board.id)
    setActionLoading(null)
    if (res.success) {
      toast.success('Board deleted')
      setRecentBoards((prev) => prev.filter((b) => b.id !== board.id))
    } else {
      toast.error(res.error || 'Delete failed')
    }
  }

  const filtered = useMemo(() => {
    return recentBoards.filter((b) => {
      const q = searchQuery.toLowerCase()
      const matchesSearch = b.title.toLowerCase().includes(q) || b.id.toLowerCase().includes(q)
      if (!matchesSearch) return false
      if (filterTab === 'saved') return b.persistent && b.exists
      if (filterTab === 'ephemeral') return !b.persistent
      return true
    })
  }, [recentBoards, searchQuery, filterTab])

  const savedCount = useMemo(() => recentBoards.filter((b) => b.persistent && b.exists).length, [recentBoards])
  const liveCount = useMemo(() => recentBoards.filter((b) => b.activeSessions > 0).length, [recentBoards])

  const createBoard = async () => {
    if (creating) return
    setCreating(true)
    const res = await api.createBoard('Untitled Board', true)
    setCreating(false)
    if (res.success && res.data) {
      api.recordBoardVisit(res.data.boardId, 'Untitled Board').catch(() => {})
      navigate(`/board/${res.data.boardId}`)
    } else {
      toast.error(res.error || 'Could not create board')
    }
  }

  const openBoard = (board: BoardHistoryItem) => {
    if (!board.exists && !board.persistent) {
      toast.error('This board has expired')
      return
    }
    navigate(`/board/${board.id}`)
  }

  return (
    <div className="min-h-screen bg-background">
      <Navbar />

      <div className="mx-auto max-w-5xl px-4 pb-24 pt-[5.5rem] sm:px-6 sm:pt-24">
        <button
          type="button"
          onClick={() => navigate('/')}
          className="mb-8 inline-flex items-center gap-2 text-sm font-medium text-muted-foreground bg-transparent border-none cursor-pointer hover:text-foreground transition-colors"
        >
          <ArrowLeft className="h-4 w-4" />
          Home
        </button>

        <div className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm dark:shadow-none">
          <div className="border-b border-border px-6 py-8 sm:px-8 sm:py-10">
            <div className="flex flex-col gap-6 lg:flex-row lg:items-start lg:justify-between">
              <div className="min-w-0">
                <span className="eyebrow mb-3">Workspace</span>
                <h1 className="text-foreground" style={{ fontSize: 'clamp(32px, 4vw, 44px)', fontWeight: 600, letterSpacing: '-0.035em', lineHeight: 1.05 }}>
                  My <span className="font-display" style={{ fontStyle: 'italic', fontWeight: 400 }}>boards</span>
                </h1>
                <p className="mt-2 max-w-lg text-sm leading-6 text-muted-foreground sm:text-[15px]">
                  Boards you&apos;ve created or joined. Saved boards stay after sessions end.
                </p>
              </div>

              <div className="flex items-center gap-6 shrink-0">
                {!loadingBoards && recentBoards.length > 0 && (
                  <div className="flex gap-6">
                    <Stat label="Total" value={recentBoards.length} />
                    <Stat label="Saved" value={savedCount} />
                    <Stat label="Live now" value={liveCount} accent />
                  </div>
                )}
                <button type="button" onClick={createBoard} disabled={creating} className="btn btn-primary">
                  {creating ? <span className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" /> : <><Plus className="h-4 w-4" /> New board</>}
                </button>
              </div>
            </div>

            {!loadingBoards && recentBoards.length > 0 && (
              <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:items-center">
                <div className="flex gap-1 rounded-full border border-border bg-surface-1 p-1">
                  {(['all', 'saved', 'ephemeral'] as FilterTab[]).map((tab) => (
                    <button
                      key={tab}
                      type="button"
                      onClick={() => setFilterTab(tab)}
                      className={`rounded-full border-none px-3.5 py-1.5 text-xs font-medium capitalize transition-colors cursor-pointer ${
                        filterTab === tab
                          ? 'bg-ink text-ink-foreground'
                          : 'bg-transparent text-muted-foreground hover:text-foreground'
                      }`}
                    >
                      {tab}
                    </button>
                  ))}
                </div>
                <div className="relative flex-1 max-w-sm">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <input
                    type="search"
                    placeholder="Search by title..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="h-10 w-full rounded-full border border-border bg-surface-1 pl-9 pr-3 text-sm text-foreground outline-none transition-colors focus:border-border-strong focus:ring-2 focus:ring-accent/15"
                  />
                </div>
                <span className="text-xs text-muted-foreground">
                  {filtered.length} result{filtered.length !== 1 ? 's' : ''}
                </span>
              </div>
            )}
          </div>

          <div className="px-6 py-6 sm:px-8 sm:py-8">
            {loadingBoards ? (
              <div className="space-y-3">
                {[0, 1, 2].map((i) => (
                  <div key={i} className="skeleton h-16 rounded-xl" />
                ))}
              </div>
            ) : filtered.length === 0 ? (
              <div className="flex flex-col items-center py-16 text-center sm:py-20">
                <div className="mb-5 flex h-14 w-14 items-center justify-center rounded-2xl bg-muted">
                  <LayoutGrid className="h-6 w-6 text-muted-foreground" />
                </div>
                <h2 className="text-lg font-semibold text-foreground">No boards found</h2>
                <p className="mt-2 max-w-xs text-sm text-muted-foreground">
                  {searchQuery || filterTab !== 'all'
                    ? 'Try a different search or filter.'
                    : 'Create your first saved board to see it here.'}
                </p>
                {!searchQuery && filterTab === 'all' && (
                  <button type="button" onClick={createBoard} disabled={creating} className="btn btn-primary btn-sm mt-6"><Plus className="h-4 w-4" /> New board</button>
                )}
              </div>
            ) : (
              <>
                <div className="hidden md:block">
                  <div className="mb-2 grid grid-cols-[1fr_100px_100px_130px_120px_80px] gap-3 px-4 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    <span>Board</span>
                    <span>Type</span>
                    <span>Activity</span>
                    <span>Last updated</span>
                    <span>Last visited</span>
                    <span className="text-right">Actions</span>
                  </div>
                  <div className="space-y-1">
                    {filtered.map((board, i) => (
                      <BoardRow
                        key={board.id}
                        board={board}
                        index={i}
                        loading={actionLoading === board.id}
                        menuOpen={menuOpenId === board.id}
                        onOpen={() => openBoard(board)}
                        onMenuToggle={(e) => {
                          e.stopPropagation()
                          setMenuOpenId(menuOpenId === board.id ? null : board.id)
                        }}
                        onCopy={(e) => copyLink(board.id, e)}
                        onDuplicate={(e) => void handleDuplicate(board, e)}
                        onDelete={(e) => void handleDelete(board, e)}
                      />
                    ))}
                  </div>
                </div>

                <div className="grid gap-4 md:hidden">
                  {filtered.map((board, i) => (
                    <motion.button
                      key={board.id}
                      type="button"
                      initial={{ opacity: 0, y: 8 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: i * 0.04 }}
                      onClick={() => openBoard(board)}
                      className="w-full overflow-hidden rounded-xl border border-border bg-surface-1 text-left cursor-pointer"
                    >
                      <div className="p-3 pb-0">
                        <BoardThumbnail index={i} className="aspect-[16/10] w-full" />
                      </div>
                      <div className="p-4">
                        <p className="truncate font-semibold text-foreground">{board.title}</p>
                        <div className="mt-2 flex flex-wrap gap-2">
                          <TypeBadge board={board} />
                          {board.activeSessions > 0 && <LiveBadge />}
                        </div>
                        <p className="mt-2 text-xs text-muted-foreground">
                          Updated {board.updatedAt ? formatTimeAgo(board.updatedAt) : '—'}
                          {board.lastEditedBy?.displayName ? ` · ${board.lastEditedBy.displayName}` : ''}
                        </p>
                      </div>
                    </motion.button>
                  ))}
                </div>
              </>
            )}
          </div>
        </div>

        <p className="mt-8 text-center text-xs text-muted-foreground">
          <span className="font-medium text-emerald-600 dark:text-emerald-400">Saved</span> boards persist after everyone leaves.
          {' '}<span className="font-medium">Ephemeral</span> boards are removed when the session ends.
        </p>
      </div>
    </div>
  )
}

function BoardRow({
  board, index, loading, menuOpen, onOpen, onMenuToggle, onCopy, onDuplicate, onDelete,
}: {
  board: BoardHistoryItem
  index: number
  loading: boolean
  menuOpen: boolean
  onOpen: () => void
  onMenuToggle: (e: React.MouseEvent) => void
  onCopy: (e: React.MouseEvent) => void
  onDuplicate: (e: React.MouseEvent) => void
  onDelete: (e: React.MouseEvent) => void
}) {
  const menuRef = useRef<HTMLDivElement>(null)

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ delay: index * 0.03 }}
      onClick={onOpen}
      className={`group grid cursor-pointer grid-cols-[1fr_100px_100px_130px_120px_80px] items-center gap-3 rounded-xl px-4 py-3.5 transition-colors hover:bg-muted/60 ${loading ? 'opacity-60' : ''}`}
    >
      <div className="flex min-w-0 items-center gap-4">
        <BoardThumbnail index={index} className="h-12 w-[4.5rem] shrink-0" />
        <div className="min-w-0">
          <p className="truncate font-medium text-foreground">
            {board.title}
          </p>
          <p className="mt-0.5 truncate font-mono text-xs text-muted-foreground">{board.id}</p>
        </div>
      </div>
      <TypeBadge board={board} />
      <div>
        {board.activeSessions > 0 ? <LiveBadge /> : (
          <span className="text-xs text-muted-foreground">Idle</span>
        )}
      </div>
      <div className="min-w-0 text-sm text-muted-foreground">
        <p>{board.updatedAt ? formatTimeAgo(board.updatedAt) : '—'}</p>
        {board.lastEditedBy?.displayName && (
          <p className="truncate text-xs opacity-80">by {board.lastEditedBy.displayName}</p>
        )}
      </div>
      <span className="flex items-center gap-1.5 text-sm text-muted-foreground">
        <Clock className="h-3.5 w-3.5 shrink-0" />
        {formatTimeAgo(board.lastVisited)}
      </span>
      <div className="relative flex justify-end gap-1" ref={menuRef}>
        <IconBtn onClick={onCopy} title="Copy link"><Copy className="h-4 w-4" /></IconBtn>
        <IconBtn onClick={onMenuToggle} title="More">···</IconBtn>
        <AnimatePresence>
          {menuOpen && (
            <motion.div
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 4 }}
              onClick={(e) => e.stopPropagation()}
              className="absolute right-0 top-full z-50 mt-1 min-w-[160px] overflow-hidden rounded-xl border border-border bg-card py-1 shadow-xl"
            >
              <MenuItem icon={ExternalLink} label="Open" onClick={() => onOpen()} />
              <MenuItem icon={CopyPlus} label="Duplicate" onClick={onDuplicate} disabled={!board.exists} />
              {board.isOwner && (
                <MenuItem icon={Trash2} label="Delete" onClick={onDelete} danger />
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </motion.div>
  )
}

function TypeBadge({ board }: { board: BoardHistoryItem }) {
  if (!board.exists) {
    return (
      <span className="inline-flex w-fit rounded-md bg-red-500/10 px-2 py-1 text-xs font-medium text-red-600 dark:text-red-400">
        Expired
      </span>
    )
  }
  if (board.persistent) {
    return (
      <span className="inline-flex w-fit rounded-md bg-emerald-500/10 px-2 py-1 text-xs font-medium text-emerald-600 dark:text-emerald-400">
        Saved
      </span>
    )
  }
  return (
    <span className="inline-flex w-fit rounded-md bg-muted px-2 py-1 text-xs font-medium text-muted-foreground">
      Ephemeral
    </span>
  )
}

function LiveBadge() {
  return (
    <span className="inline-flex w-fit items-center gap-1.5 rounded-md bg-emerald-500/10 px-2 py-1 text-xs font-medium text-emerald-600 dark:text-emerald-400">
      <Circle className="h-1.5 w-1.5 fill-current" />
      Live
    </span>
  )
}

function Stat({ label, value, accent }: { label: string; value: number; accent?: boolean }) {
  return (
    <div className="text-right">
      <p className={`text-2xl font-bold tabular-nums leading-none ${accent ? 'text-success' : 'text-foreground'}`}>
        {value}
      </p>
      <p className="mt-1 text-xs font-medium text-muted-foreground">{label}</p>
    </div>
  )
}

function IconBtn({ children, onClick, title }: {
  children: React.ReactNode
  onClick: (e: React.MouseEvent) => void
  title: string
}) {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      className="flex h-8 w-8 items-center justify-center rounded-lg border border-transparent bg-transparent text-muted-foreground cursor-pointer transition-colors hover:border-border hover:bg-muted hover:text-foreground"
    >
      {children}
    </button>
  )
}

function MenuItem({ icon: Icon, label, onClick, danger, disabled }: {
  icon: typeof Copy
  label: string
  onClick: (e: React.MouseEvent) => void
  danger?: boolean
  disabled?: boolean
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={`flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition-colors hover:bg-muted disabled:opacity-40 ${
        danger ? 'text-destructive' : 'text-foreground'
      }`}
    >
      <Icon className="h-4 w-4" />
      {label}
    </button>
  )
}
