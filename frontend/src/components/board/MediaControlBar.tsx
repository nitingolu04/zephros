import { Mic, MicOff, Video, VideoOff, MonitorUp, MonitorX, LogOut } from 'lucide-react'
import { motion } from 'framer-motion'

interface Props {
  audioEnabled: boolean
  videoEnabled: boolean
  toggleAudio: () => void
  toggleVideo: () => void
  isLocalSharing?: boolean
  onToggleShare?: () => void
  onLeaveBoard?: () => void
}

function DockButton({ on, danger, accent, title, onClick, children }: {
  on?: boolean; danger?: boolean; accent?: boolean; title: string; onClick: () => void; children: React.ReactNode
}) {
  // Off mic/camera reads as a soft red "muted" state; on is calm ink; sharing uses the accent.
  const background = accent ? 'var(--color-accent)' : danger ? 'color-mix(in srgb, var(--color-destructive) 12%, transparent)' : on ? 'var(--color-ink)' : 'transparent'
  const color = accent ? '#fff' : danger ? 'var(--color-destructive)' : on ? 'var(--color-ink-foreground)' : 'var(--color-foreground)'
  return (
    <motion.button type="button" whileTap={{ scale: 0.94 }} onClick={onClick} title={title} aria-label={title} aria-pressed={on || accent}
      className="media-dock-btn" style={{ background, color }}>
      {children}
    </motion.button>
  )
}

/** Call controls: a single island centred on the canvas (not the window), so it never drifts under the sidebar. */
export default function MediaControlBar({
  audioEnabled, videoEnabled, toggleAudio, toggleVideo, isLocalSharing, onToggleShare, onLeaveBoard,
}: Props) {
  return (
    <motion.div
      initial={{ y: 24, opacity: 0, x: '-50%' }}
      animate={{ y: 0, opacity: 1, x: '-50%' }}
      transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
      className="floating-toolbar media-dock"
      role="toolbar"
      aria-label="Call controls"
    >
      <DockButton on={audioEnabled} danger={!audioEnabled} title={audioEnabled ? 'Mute microphone' : 'Unmute microphone'} onClick={toggleAudio}>
        {audioEnabled ? <Mic style={{ width: 18, height: 18 }} /> : <MicOff style={{ width: 18, height: 18 }} />}
      </DockButton>
      <DockButton on={videoEnabled} danger={!videoEnabled} title={videoEnabled ? 'Turn camera off' : 'Turn camera on'} onClick={toggleVideo}>
        {videoEnabled ? <Video style={{ width: 18, height: 18 }} /> : <VideoOff style={{ width: 18, height: 18 }} />}
      </DockButton>
      {onToggleShare && (
        <DockButton accent={isLocalSharing} title={isLocalSharing ? 'Stop sharing screen' : 'Share screen'} onClick={onToggleShare}>
          {isLocalSharing ? <MonitorX style={{ width: 18, height: 18 }} /> : <MonitorUp style={{ width: 18, height: 18 }} />}
        </DockButton>
      )}
      {onLeaveBoard && (
        <>
          <span aria-hidden style={{ width: 1, height: 24, background: 'var(--color-border)', margin: '0 4px' }} />
          <motion.button type="button" whileTap={{ scale: 0.96 }} onClick={onLeaveBoard} title="Leave board"
            className="media-dock-leave">
            <LogOut style={{ width: 15, height: 15 }} />
            <span className="media-dock-leave-label">Leave</span>
          </motion.button>
        </>
      )}
    </motion.div>
  )
}
