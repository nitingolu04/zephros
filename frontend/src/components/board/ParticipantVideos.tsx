import { useEffect, useRef } from 'react'
import { MicOff, VideoOff } from 'lucide-react'
import { useMediaStore } from '@/stores/mediaStore'
import { socketService } from '@/services/socket'

function VideoTile({
  stream,
  username,
  color,
  audioEnabled,
  videoEnabled,
  isLocal,
}: {
  stream: MediaStream | null
  username: string
  color: string
  audioEnabled: boolean
  videoEnabled: boolean
  isLocal?: boolean
}) {
  const videoRef = useRef<HTMLVideoElement>(null)

  const hasVideo = Boolean(
    stream?.getVideoTracks().some((t) => t.enabled && t.readyState === 'live'),
  )
  const hasAudio = Boolean(
    stream?.getAudioTracks().some((t) => t.enabled && t.readyState === 'live'),
  )
  const showVideo = videoEnabled && hasVideo
  const needsMediaElement = Boolean(stream && (showVideo || (!isLocal && hasAudio)))

  useEffect(() => {
    const el = videoRef.current
    if (!el || !needsMediaElement) {
      if (el) el.srcObject = null
      return
    }
    el.srcObject = stream
    el.muted = Boolean(isLocal)
    void el.play().catch(() => {})
  }, [stream, isLocal, needsMediaElement])

  return (
    <div className="relative aspect-video w-36 shrink-0 overflow-hidden rounded-xl border border-border/50 bg-muted/30 sm:w-44">
      {showVideo ? (
        <video
          ref={videoRef}
          autoPlay
          playsInline
          className="h-full w-full object-cover"
        />
      ) : (
        <>
          {needsMediaElement && (
            <video
              ref={videoRef}
              autoPlay
              playsInline
              className="absolute h-0 w-0 opacity-0"
              aria-hidden
            />
          )}
          <div
            className="flex h-full w-full items-center justify-center"
            style={{ background: `color-mix(in srgb, ${color} 25%, var(--color-muted))` }}
          >
            <span
              className="flex h-12 w-12 items-center justify-center rounded-full text-lg font-semibold text-white"
              style={{ backgroundColor: color }}
            >
              {username.charAt(0).toUpperCase()}
            </span>
          </div>
        </>
      )}

      <div className="absolute inset-x-0 bottom-0 flex items-center justify-between bg-gradient-to-t from-black/70 to-transparent px-2 py-1.5">
        <span className="truncate text-xs font-medium text-white">
          {username}
          {isLocal ? ' (you)' : ''}
        </span>
        <div className="flex shrink-0 gap-1">
          {!audioEnabled && <MicOff className="h-3.5 w-3.5 text-red-400" />}
          {!videoEnabled && <VideoOff className="h-3.5 w-3.5 text-red-400" />}
        </div>
      </div>
    </div>
  )
}

export default function ParticipantVideos() {
  const participants = useMediaStore((s) => s.participants)
  const remoteStreams = useMediaStore((s) => s.remoteStreams)
  const localStream = useMediaStore((s) => s.localStream)

  const sessionId = socketService.sessionId

  const visible = participants.some(
    (p) => p.videoEnabled || p.audioEnabled || p.sessionId !== sessionId,
  )

  if (!visible || participants.length === 0) return null

  return (
    <div className="pointer-events-none fixed bottom-24 left-1/2 z-40 max-w-[min(96vw,720px)] -translate-x-1/2">
      <div className="pointer-events-auto flex gap-2 overflow-x-auto rounded-2xl border border-border/40 bg-card/80 p-2 shadow-lg backdrop-blur-xl">
        {participants.map((p) => {
          const stream = p.isLocal || p.sessionId === sessionId
            ? localStream
            : remoteStreams.get(p.sessionId) ?? null

          return (
            <VideoTile
              key={p.sessionId}
              stream={stream}
              username={p.username}
              color={p.color}
              audioEnabled={p.audioEnabled}
              videoEnabled={p.videoEnabled}
              isLocal={p.isLocal || p.sessionId === sessionId}
            />
          )
        })}
      </div>
    </div>
  )
}
