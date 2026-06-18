import { Mic, MicOff, Video, VideoOff, Monitor, MonitorOff, PhoneOff } from 'lucide-react'
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

export default function MediaControlBar({
  audioEnabled,
  videoEnabled,
  toggleAudio,
  toggleVideo,
  isLocalSharing,
  onToggleShare,
  onLeaveBoard,
}: Props) {
  return (
    <div className="pointer-events-none fixed bottom-6 left-1/2 z-50 -translate-x-1/2">
      <motion.div
        initial={{ y: 24, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        className="pointer-events-auto flex items-center gap-2 rounded-2xl border border-border/60 bg-card/90 px-3 py-2 shadow-xl backdrop-blur-xl"
      >
        <button
          type="button"
          onClick={toggleAudio}
          className={`flex h-11 w-11 items-center justify-center rounded-xl transition ${
            audioEnabled
              ? 'bg-emerald-600/90 text-white hover:bg-emerald-500'
              : 'bg-muted/80 text-muted-foreground hover:bg-muted'
          }`}
          title={audioEnabled ? 'Mute microphone' : 'Turn on microphone'}
        >
          {audioEnabled ? <Mic className="h-5 w-5" /> : <MicOff className="h-5 w-5" />}
        </button>

        <button
          type="button"
          onClick={toggleVideo}
          className={`flex h-11 w-11 items-center justify-center rounded-xl transition ${
            videoEnabled
              ? 'bg-emerald-600/90 text-white hover:bg-emerald-500'
              : 'bg-muted/80 text-muted-foreground hover:bg-muted'
          }`}
          title={videoEnabled ? 'Turn off camera' : 'Turn on camera'}
        >
          {videoEnabled ? <Video className="h-5 w-5" /> : <VideoOff className="h-5 w-5" />}
        </button>

        {onToggleShare && (
          <button
            type="button"
            onClick={onToggleShare}
            className={`flex h-11 w-11 items-center justify-center rounded-xl transition ${
              isLocalSharing
                ? 'bg-blue-600/90 text-white hover:bg-blue-500'
                : 'bg-muted/80 text-muted-foreground hover:bg-muted'
            }`}
            title={isLocalSharing ? 'Stop screen share' : 'Share screen'}
          >
            {isLocalSharing ? <MonitorOff className="h-5 w-5" /> : <Monitor className="h-5 w-5" />}
          </button>
        )}

        {onLeaveBoard && (
          <>
            <div className="mx-0.5 h-7 w-px bg-border/60" />
            <button
              type="button"
              onClick={onLeaveBoard}
              className="flex h-11 w-11 items-center justify-center rounded-xl bg-red-600/90 text-white transition hover:bg-red-500"
              title="Leave board"
            >
              <PhoneOff className="h-5 w-5" />
            </button>
          </>
        )}
      </motion.div>
    </div>
  )
}
