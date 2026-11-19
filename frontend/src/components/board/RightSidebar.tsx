import { useState, useEffect, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Activity, Users, Layers, Timer, Download, Image, Trash2, AlertTriangle,
  MessageSquare, Send, Smile, FileText, MicOff, UserX, CloudUpload, LayoutDashboard, FileSpreadsheet, Eye, Pencil,
} from 'lucide-react'
import EmojiPicker from '@/components/board/EmojiPicker'
import ChatInput, { renderMessageWithMentions } from '@/components/board/ChatInput'
import { useBoardStore } from '@/stores/boardStore'
import { useAuthStore } from '@/stores/authStore'
import { socketService } from '@/services/socket'
import { api } from '@/services/api'
import { toast } from 'sonner'
import { formatTimeAgo } from '@/lib/utils'
import { uploadToGoogleDrive, isDriveConfigured } from '@/lib/googleDrive'
import { exportStageToPdf } from '@/lib/canvasExport'

interface Props {
  boardId: string
}

type Tab = 'chat' | 'activity' | 'people' | 'board'

function Avatar({ name, color, size = 28 }: { name: string; color: string; size?: number }) {
  return (
    <span style={{
      width: size, height: size, borderRadius: '50%', flexShrink: 0, display: 'grid', placeItems: 'center',
      fontSize: Math.round(size * 0.36), fontWeight: 600, color: 'white', backgroundColor: color,
    }}>
      {name.slice(0, 2).toUpperCase()}
    </span>
  )
}

function ActionRow({ icon: Icon, title, subtitle, onClick, tone = 'default' }: {
  icon: typeof Download; title: string; subtitle: string; onClick: () => void; tone?: 'default' | 'danger'
}) {
  const danger = tone === 'danger'
  return (
    <button type="button" onClick={onClick} className="sidebar-action"
      style={{ color: danger ? 'var(--color-destructive)' : 'var(--color-foreground)' }}>
      <span className="sidebar-action-icon" style={danger ? { background: 'color-mix(in srgb, var(--color-destructive) 10%, transparent)', color: 'var(--color-destructive)' } : undefined}>
        <Icon style={{ width: 15, height: 15 }} />
      </span>
      <span style={{ textAlign: 'left', minWidth: 0 }}>
        <span style={{ display: 'block', fontSize: 13, fontWeight: 500 }}>{title}</span>
        <span style={{ display: 'block', fontSize: 11, color: 'var(--color-muted-foreground)' }}>{subtitle}</span>
      </span>
    </button>
  )
}

export default function RightSidebar({ boardId }: Props) {
  const { activityFeed, activeUsers, elements, clearBoard, chatMessages, updateChatReaction, typingUsers, board, myRole } = useBoardStore()
  const clearLocalChat = useBoardStore((s) => s.clearChat)
  const serverChat = useBoardStore((s) => s.serverChat)
  const authUser = useAuthStore((s) => s.user)
  const isOwner = Boolean(board?.ownerUid && authUser?.uid && board.ownerUid === authUser.uid)
  const canModerate = Boolean(authUser?.uid && (isOwner || !board?.ownerUid))
  // The teacher (board owner) takes attendance; on a board without an owner anyone may.
  const canTakeAttendance = isOwner || !board?.ownerUid
  const [attendanceBusy, setAttendanceBusy] = useState(false)
  // Server-stored chat is cleared for everyone, so only the owner may (anyone on an ownerless board).
  const canClearChat = !serverChat || !board?.ownerUid || isOwner
  const clearChat = () => {
    if (serverChat) socketService.emitClearChat(boardId)
    else clearLocalChat()
  }
  const [tab, setTab] = useState<Tab>('chat')
  const [sessionStart] = useState(Date.now())
  const [elapsed, setElapsed] = useState(0)
  const [showClearConfirm, setShowClearConfirm] = useState(false)
  const [chatMessage, setChatMessage] = useState('')
  const [showEmojiPicker, setShowEmojiPicker] = useState(false)
  const [seenMessages, setSeenMessages] = useState(chatMessages.length)
  const chatListRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const timer = setInterval(() => setElapsed(Math.floor((Date.now() - sessionStart) / 1000)), 1000)
    return () => clearInterval(timer)
  }, [sessionStart])

  // Scroll only the message list (never the whole sidebar) and track unread messages on other tabs.
  useEffect(() => {
    if (tab !== 'chat') return
    setSeenMessages(chatMessages.length)
    const list = chatListRef.current
    if (list) list.scrollTo({ top: list.scrollHeight, behavior: 'smooth' })
  }, [chatMessages, tab])

  const unread = tab === 'chat' ? 0 : Math.max(0, chatMessages.length - seenMessages)

  const kickUser = (sessionId: string, username: string) => {
    socketService.emitKickUser(boardId, sessionId)
    toast.success(`Removed ${username}`)
  }
  const muteUser = (sessionId: string, username: string) => {
    socketService.emitMuteUser(boardId, sessionId)
    toast.success(`Muted ${username}`)
  }

  const handleSendMessage = (msg: string, mentions: { sessionId: string; username: string }[]) => {
    socketService.emitChatMessage(boardId, msg, mentions)
  }

  const handleSendClick = () => {
    const msg = chatMessage.trim()
    if (!msg) return
    const mentions = activeUsers
      .filter((u) => u.sessionId !== socketService.sessionId && msg.includes(`@${u.username}`))
      .map((u) => ({ sessionId: u.sessionId, username: u.username }))
    handleSendMessage(msg, mentions)
    setChatMessage('')
  }

  const handleChatReaction = (messageId: string, emoji: string) => {
    const msg = chatMessages.find((m) => m.id === messageId)
    const existing = msg?.reactions?.find((r) => r.emoji === emoji)
    const has = existing?.sessionIds.includes(socketService.sessionId)
    updateChatReaction(messageId, emoji, socketService.sessionId, !has)
    socketService.emitChatReaction(boardId, messageId, emoji)
  }

  const formatDuration = (s: number) => {
    const h = Math.floor(s / 3600)
    const m = Math.floor((s % 3600) / 60)
    const sec = s % 60
    return h ? `${h}:${m.toString().padStart(2, '0')}:${sec.toString().padStart(2, '0')}` : `${m}:${sec.toString().padStart(2, '0')}`
  }

  const handleExportJson = async () => {
    const res = await api.exportJson(boardId)
    if (res.success && res.data) {
      const blob = new Blob([JSON.stringify(res.data, null, 2)], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url; a.download = `Zephros-${boardId}.json`; a.click()
      URL.revokeObjectURL(url)
      toast.success('JSON exported')
    } else toast.error('Export failed')
  }

  const handleDownloadAttendance = async () => {
    if (attendanceBusy) return
    setAttendanceBusy(true)
    const res = await api.downloadAttendance(boardId)
    setAttendanceBusy(false)
    if (!res.blob) { toast.error(res.error || 'Could not download attendance'); return }
    const url = URL.createObjectURL(res.blob)
    const a = document.createElement('a')
    const title = (board?.title || '').replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '-').slice(0, 40)
    a.href = url; a.download = title ? res.fileName!.replace('Attendance-', `Attendance-${title}-`) : res.fileName!
    a.click()
    URL.revokeObjectURL(url)
    toast.success('Attendance downloaded')
  }

  const handleSaveJsonToDrive = async () => {
    const res = await api.exportJson(boardId)
    if (!res.success || !res.data) { toast.error('Export failed'); return }
    try {
      const blob = new Blob([JSON.stringify(res.data, null, 2)], { type: 'application/json' })
      const link = await uploadToGoogleDrive(blob, `Zephros-${boardId}.json`)
      toast.success('Saved to Google Drive', { action: { label: 'Open', onClick: () => window.open(link, '_blank') } })
    } catch (e) {
      toast.error((e as Error).message)
    }
  }

  const handleExportPng = () => {
    const stageContainer = document.querySelector('.konvajs-content')
    const canvases = stageContainer?.querySelectorAll('canvas')
    if (!canvases?.length) { toast.error('Canvas not found'); return }
    const first = canvases[0] as HTMLCanvasElement
    const scale = 2
    const out = document.createElement('canvas')
    out.width = first.width * scale
    out.height = first.height * scale
    const ctx = out.getContext('2d')
    if (!ctx) return
    ctx.imageSmoothingEnabled = true
    ctx.imageSmoothingQuality = 'high'
    ctx.fillStyle = document.documentElement.classList.contains('dark') ? '#151514' : '#FBFAF7'
    ctx.fillRect(0, 0, out.width, out.height)
    ctx.scale(scale, scale)
    canvases.forEach((c) => ctx.drawImage(c as HTMLCanvasElement, 0, 0))
    out.toBlob((blob) => {
      if (!blob) { toast.error('Export failed'); return }
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url; a.download = `Zephros-${boardId}.png`
      document.body.appendChild(a); a.click(); document.body.removeChild(a)
      URL.revokeObjectURL(url)
      toast.success('PNG exported')
    }, 'image/png', 1.0)
  }

  const handleExportPdf = async () => {
    const stageContainer = document.querySelector('.konvajs-content')
    if (!stageContainer) { toast.error('Canvas not found'); return }
    try {
      await exportStageToPdf(stageContainer as HTMLElement, `Zephros-${boardId}.pdf`)
      toast.success('PDF exported')
    } catch {
      toast.error('PDF export failed')
    }
  }

  const handleClearBoard = () => {
    clearBoard()
    socketService.emitClearBoard(boardId)
    toast.success('Board cleared')
    setShowClearConfirm(false)
  }

  const typingNames = Object.values(typingUsers)
  const tabs: { id: Tab; label: string; icon: typeof MessageSquare; badge?: number }[] = [
    { id: 'chat', label: 'Chat', icon: MessageSquare, badge: unread },
    { id: 'activity', label: 'Activity', icon: Activity },
    { id: 'people', label: 'People', icon: Users, badge: activeUsers.length },
    { id: 'board', label: 'Board', icon: LayoutDashboard },
  ]

  return (
    <aside style={{ display: 'flex', flexDirection: 'column', width: 320, height: '100%', borderLeft: '1px solid var(--color-border)', background: 'var(--color-card)' }}>
      {/* Segmented tabs */}
      <div style={{ padding: 12, borderBottom: '1px solid var(--color-border)' }}>
        <div role="tablist" aria-label="Sidebar" style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 2, padding: 3, borderRadius: 12, background: 'var(--color-muted)' }}>
          {tabs.map((t) => {
            const active = tab === t.id
            return (
              <button key={t.id} type="button" role="tab" aria-selected={active} onClick={() => setTab(t.id)} title={t.label}
                style={{ position: 'relative', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2, padding: '6px 0', border: 'none', borderRadius: 9, cursor: 'pointer', background: 'transparent', color: active ? 'var(--color-foreground)' : 'var(--color-muted-foreground)', fontSize: 11, fontWeight: 500 }}>
                {active && <motion.span layoutId="sidebar-tab" transition={{ type: 'spring', stiffness: 500, damping: 38 }} style={{ position: 'absolute', inset: 0, borderRadius: 9, background: 'var(--color-card)', boxShadow: 'var(--shadow-sm)' }} />}
                <t.icon style={{ position: 'relative', width: 15, height: 15 }} />
                <span style={{ position: 'relative' }}>{t.label}</span>
                {Boolean(t.badge) && (
                  <span style={{ position: 'absolute', top: 2, right: 8, minWidth: 16, height: 16, padding: '0 4px', borderRadius: 99, fontSize: 9, fontWeight: 600, display: 'grid', placeItems: 'center', background: t.id === 'chat' ? 'var(--color-accent)' : 'var(--color-border-strong)', color: t.id === 'chat' ? '#fff' : 'var(--color-foreground)' }}>
                    {t.badge}
                  </span>
                )}
              </button>
            )
          })}
        </div>
      </div>

      <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
        {/* ── Chat ── */}
        {tab === 'chat' && (
          <>
            <div ref={chatListRef} style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
              {chatMessages.length === 0 ? (
                <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 10, textAlign: 'center', padding: 24 }}>
                  <span style={{ width: 44, height: 44, borderRadius: 14, background: 'var(--color-note-yellow)', color: '#3D2E14', display: 'grid', placeItems: 'center', transform: 'rotate(-4deg)' }}>
                    <MessageSquare style={{ width: 20, height: 20 }} />
                  </span>
                  <p style={{ fontSize: 14, fontWeight: 500 }}>No messages yet</p>
                  <p style={{ fontSize: 12, color: 'var(--color-muted-foreground)', lineHeight: 1.5 }}>Say hi, or type @ to mention someone on the board.</p>
                </div>
              ) : (
                <>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, fontSize: 11, color: 'var(--color-muted-foreground)' }}>
                    <span>{serverChat ? 'Chat is saved with this board' : 'History saved on this device'}</span>
                    {canClearChat && (
                      <>·<button type="button" onClick={clearChat} title={serverChat ? 'Clear chat for everyone' : 'Clear chat on this device'} style={{ background: 'none', border: 'none', padding: 0, fontSize: 11, color: 'var(--color-muted-foreground)', cursor: 'pointer', textDecoration: 'underline' }}>Clear</button></>
                    )}
                  </div>
                  {chatMessages.map((msg) => {
                    const isMe = msg.sessionId === socketService.sessionId
                    return (
                      <motion.div key={msg.id} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}
                        style={{ display: 'flex', gap: 8, flexDirection: isMe ? 'row-reverse' : 'row', alignItems: 'flex-end' }}>
                        {!isMe && <Avatar name={msg.username} color={msg.color} size={24} />}
                        <div style={{ display: 'flex', flexDirection: 'column', alignItems: isMe ? 'flex-end' : 'flex-start', gap: 4, maxWidth: '82%' }}>
                          <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
                            {!isMe && <span style={{ fontSize: 11, fontWeight: 600 }}>{msg.username}</span>}
                            <span style={{ fontSize: 10, color: 'var(--color-muted-foreground)' }}>{new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                          </div>
                          <div style={{
                            padding: '8px 12px', borderRadius: 14, fontSize: 13, lineHeight: 1.45, wordBreak: 'break-word',
                            background: isMe ? 'var(--color-ink)' : 'var(--color-muted)',
                            color: isMe ? 'var(--color-ink-foreground)' : 'var(--color-foreground)',
                            borderBottomRightRadius: isMe ? 4 : 14,
                            borderBottomLeftRadius: isMe ? 14 : 4,
                          }}>
                            {renderMessageWithMentions(msg.message, msg.mentions, socketService.sessionId)}
                          </div>
                          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                            {(msg.reactions || []).map((r) => (
                              <button key={r.emoji} type="button" onClick={() => handleChatReaction(msg.id, r.emoji)}
                                style={{ fontSize: 11, padding: '1px 7px', borderRadius: 99, border: '1px solid var(--color-border)', background: r.sessionIds.includes(socketService.sessionId) ? 'var(--color-accent-soft)' : 'var(--color-card)', cursor: 'pointer', color: 'var(--color-foreground)' }}>
                                {r.emoji} {r.sessionIds.length}
                              </button>
                            ))}
                            <button type="button" onClick={() => handleChatReaction(msg.id, '👍')} title="React with 👍"
                              style={{ fontSize: 11, padding: '1px 7px', borderRadius: 99, border: '1px dashed var(--color-border-strong)', background: 'transparent', cursor: 'pointer', color: 'var(--color-muted-foreground)' }}>
                              +
                            </button>
                          </div>
                        </div>
                      </motion.div>
                    )
                  })}
                </>
              )}
            </div>
            <div style={{ padding: 12, borderTop: '1px solid var(--color-border)' }}>
              <p style={{ minHeight: 16, fontSize: 11, color: 'var(--color-muted-foreground)', fontStyle: 'italic', marginBottom: 6 }}>
                {typingNames.length === 1 ? `${typingNames[0]} is typing…`
                  : typingNames.length > 1 ? `${typingNames.slice(0, 2).join(', ')}${typingNames.length > 2 ? '…' : ''} are typing…` : ''}
              </p>
              <div style={{ display: 'flex', gap: 6, alignItems: 'flex-end' }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <ChatInput value={chatMessage} onChange={setChatMessage} onSubmit={handleSendMessage}
                    activeUsers={activeUsers} currentSessionId={socketService.sessionId} boardId={boardId} />
                </div>
                <div style={{ position: 'relative' }}>
                  <EmojiPicker open={showEmojiPicker} onClose={() => setShowEmojiPicker(false)} onSelect={(emoji) => setChatMessage((prev) => prev + emoji)} />
                  <button type="button" onClick={() => setShowEmojiPicker((v) => !v)} title="Emoji" className={`toolbar-btn${showEmojiPicker ? ' active' : ''}`} style={{ width: 36, height: 36 }}>
                    <Smile style={{ width: 16, height: 16 }} />
                  </button>
                </div>
                <button type="button" onClick={handleSendClick} title="Send" aria-label="Send message"
                  style={{ width: 36, height: 36, borderRadius: 10, background: 'var(--color-ink)', border: 'none', color: 'var(--color-ink-foreground)', display: 'grid', placeItems: 'center', cursor: 'pointer', flexShrink: 0 }}>
                  <Send style={{ width: 14, height: 14 }} />
                </button>
              </div>
            </div>
          </>
        )}

        {/* ── Activity ── */}
        {tab === 'activity' && (
          <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: 16 }}>
            {activityFeed.length === 0 ? (
              <p style={{ fontSize: 13, color: 'var(--color-muted-foreground)', textAlign: 'center', padding: '32px 0' }}>No activity yet</p>
            ) : (
              <ol style={{ listStyle: 'none', position: 'relative', paddingLeft: 4 }}>
                <span aria-hidden style={{ position: 'absolute', left: 15, top: 8, bottom: 8, width: 1, background: 'var(--color-border)' }} />
                {activityFeed.slice(0, 40).map((event) => (
                  <motion.li key={event.id} initial={{ opacity: 0, x: 8 }} animate={{ opacity: 1, x: 0 }}
                    style={{ position: 'relative', display: 'flex', alignItems: 'flex-start', gap: 12, padding: '8px 0' }}>
                    <Avatar name={event.username} color={event.color} size={24} />
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <p style={{ fontSize: 13, lineHeight: 1.4 }}>{event.message}</p>
                      <p style={{ fontSize: 11, color: 'var(--color-muted-foreground)', marginTop: 2 }}>{formatTimeAgo(event.timestamp)}</p>
                    </div>
                  </motion.li>
                ))}
              </ol>
            )}
          </div>
        )}

        {/* ── People ── */}
        {tab === 'people' && (
          <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: 12, display: 'flex', flexDirection: 'column', gap: 4 }}>
            {canTakeAttendance && (
              <div style={{ marginBottom: 8 }}>
                <ActionRow icon={FileSpreadsheet} title={attendanceBusy ? 'Preparing…' : 'Download attendance'}
                  subtitle="Excel sheet of everyone who joined" onClick={() => { void handleDownloadAttendance() }} />
              </div>
            )}
            <p className="toolbar-panel-label" style={{ padding: '4px 6px 0' }}>On this board · {activeUsers.length}</p>
            {activeUsers.map((u) => {
              const me = u.sessionId === socketService.sessionId
              return (
                <div key={u.sessionId} className="sidebar-person">
                  <span style={{ position: 'relative' }}>
                    <Avatar name={u.username} color={u.color} size={32} />
                    <span style={{ position: 'absolute', right: -1, bottom: -1, width: 10, height: 10, borderRadius: 99, background: 'var(--color-success)', border: '2px solid var(--color-card)' }} />
                  </span>
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <span style={{ display: 'block', fontSize: 13, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{u.username}{me ? ' (you)' : ''}</span>
                    <span style={{ display: 'block', fontSize: 11, color: 'var(--color-muted-foreground)' }}>
                      {board?.ownerUid && u.userId === board.ownerUid ? 'Host' : u.role === 'viewer' ? 'Can view' : 'Can edit'} · {u.userId ? 'Signed in' : 'Guest'}
                    </span>
                  </span>
                  {u.isMuted && <MicOff style={{ width: 14, height: 14, color: 'var(--color-destructive)', flexShrink: 0 }} />}
                  {isOwner && !me && u.userId !== board?.ownerUid && (
                    <button type="button" className="toolbar-btn toolbar-btn-compact" style={{ flexShrink: 0 }}
                      title={u.role === 'viewer' ? `Let ${u.username} edit` : `Make ${u.username} view-only`}
                      onClick={() => {
                        socketService.emitSetRole(boardId, u.sessionId, u.role === 'viewer' ? 'editor' : 'viewer')
                        toast.success(u.role === 'viewer' ? `${u.username} can now edit` : `${u.username} can now only view`)
                      }}>
                      {u.role === 'viewer' ? <Eye style={{ width: 14, height: 14 }} /> : <Pencil style={{ width: 14, height: 14 }} />}
                    </button>
                  )}
                  {canModerate && !me && (
                    <span style={{ display: 'flex', gap: 2, flexShrink: 0 }}>
                      <button type="button" title={`Mute ${u.username}`} onClick={() => muteUser(u.sessionId, u.username)} className="toolbar-btn toolbar-btn-compact">
                        <MicOff style={{ width: 14, height: 14 }} />
                      </button>
                      <button type="button" title={`Remove ${u.username}`} onClick={() => kickUser(u.sessionId, u.username)} className="toolbar-btn toolbar-btn-compact" style={{ color: 'var(--color-destructive)' }}>
                        <UserX style={{ width: 14, height: 14 }} />
                      </button>
                    </span>
                  )}
                </div>
              )
            })}
            {activeUsers.length === 0 && <p style={{ fontSize: 13, color: 'var(--color-muted-foreground)', textAlign: 'center', padding: '24px 0' }}>Connecting…</p>}
          </div>
        )}

        {/* ── Board: stats, export, danger zone ── */}
        {tab === 'board' && (
          <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: 16, display: 'flex', flexDirection: 'column', gap: 20 }}>
            <section>
              <p className="toolbar-panel-label">Session</p>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
                {[
                  { icon: Users, label: 'Online', value: activeUsers.length },
                  { icon: Layers, label: 'Elements', value: elements.length },
                  { icon: Timer, label: 'Duration', value: formatDuration(elapsed) },
                ].map((m) => (
                  <div key={m.label} style={{ borderRadius: 12, border: '1px solid var(--color-border)', padding: '12px 10px' }}>
                    <m.icon style={{ width: 14, height: 14, color: 'var(--color-muted-foreground)' }} />
                    <div style={{ fontSize: 20, fontWeight: 600, letterSpacing: '-0.02em', marginTop: 8, fontVariantNumeric: 'tabular-nums' }}>{m.value}</div>
                    <div style={{ fontSize: 11, color: 'var(--color-muted-foreground)' }}>{m.label}</div>
                  </div>
                ))}
              </div>
            </section>

            <section style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <p className="toolbar-panel-label">Export</p>
              <ActionRow icon={Image} title="PNG image" subtitle="High-resolution snapshot" onClick={handleExportPng} />
              <ActionRow icon={FileText} title="PDF document" subtitle="Print-ready page" onClick={() => { void handleExportPdf() }} />
              <ActionRow icon={Download} title="JSON data" subtitle="Re-importable board data" onClick={() => { void handleExportJson() }} />
              {canTakeAttendance && <ActionRow icon={FileSpreadsheet} title="Attendance (Excel)" subtitle="Who joined, when, and for how long" onClick={() => { void handleDownloadAttendance() }} />}
              {isDriveConfigured() && <ActionRow icon={CloudUpload} title="Save to Google Drive" subtitle="Upload the JSON export" onClick={() => { void handleSaveJsonToDrive() }} />}
            </section>

            {myRole !== 'viewer' && <section style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <p className="toolbar-panel-label">Danger zone</p>
              <AnimatePresence mode="wait" initial={false}>
                {!showClearConfirm ? (
                  <motion.div key="clear" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                    <ActionRow icon={Trash2} title="Clear board" subtitle="Remove every element for everyone" onClick={() => setShowClearConfirm(true)} tone="danger" />
                  </motion.div>
                ) : (
                  <motion.div key="confirm" initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }}
                    style={{ borderRadius: 12, border: '1px solid color-mix(in srgb, var(--color-destructive) 30%, transparent)', background: 'color-mix(in srgb, var(--color-destructive) 6%, transparent)', padding: 14 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8, color: 'var(--color-destructive)' }}>
                      <AlertTriangle style={{ width: 16, height: 16 }} />
                      <span style={{ fontSize: 13, fontWeight: 600 }}>Clear the whole board?</span>
                    </div>
                    <p style={{ fontSize: 12, color: 'var(--color-muted-foreground)', marginBottom: 12, lineHeight: 1.5 }}>
                      Everyone loses these elements. You can undo, or restore a saved version from Version history.
                    </p>
                    <div style={{ display: 'flex', gap: 8 }}>
                      <button type="button" onClick={handleClearBoard} className="btn btn-sm" style={{ flex: 1, borderRadius: 9, background: 'var(--color-destructive)', color: '#fff' }}>Clear all</button>
                      <button type="button" onClick={() => setShowClearConfirm(false)} className="btn btn-ghost btn-sm" style={{ flex: 1, borderRadius: 9 }}>Cancel</button>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </section>}
          </div>
        )}
      </div>
    </aside>
  )
}
