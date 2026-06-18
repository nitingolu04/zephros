const STORAGE_KEY = 'aerix_notification_sounds'

export type NotificationSoundType = 'join' | 'leave' | 'screenShare' | 'screenShareStop' | 'chat'

const SOUND_CONFIG: Record<NotificationSoundType, { src: string; rate?: number }> = {
  join: { src: '/sounds/join.mp3' },
  leave: { src: '/sounds/leave.mp3' },
  screenShare: { src: '/sounds/screen-finish.mp3' },
  screenShareStop: { src: '/sounds/screen-finish.mp3' },
  chat: { src: '/sounds/crystal-chime.mp3' },
}

const audioPool = new Map<string, HTMLAudioElement>()
let unlocked = false

function getAudio(src: string): HTMLAudioElement {
  let audio = audioPool.get(src)
  if (!audio) {
    audio = new Audio(src)
    audio.preload = 'auto'
    audioPool.set(src, audio)
  }
  return audio
}

function warmAudio(src: string) {
  const audio = getAudio(src)
  audio.volume = 0
  return audio.play().then(() => {
    audio.pause()
    audio.currentTime = 0
    audio.volume = 0.6
  }).catch(() => {})
}

function playFileSound(src: string, playbackRate = 1) {
  const audio = getAudio(src)
  try {
    audio.pause()
  } catch { /* ignore */ }
  audio.currentTime = 0
  audio.volume = 0.6
  audio.playbackRate = playbackRate
  void audio.play().catch(() => {
    void warmAudio(src).then(() => {
      audio.currentTime = 0
      audio.volume = 0.6
      void audio.play().catch(() => {})
    })
  })
}

export function areNotificationSoundsEnabled(): boolean {
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (stored === null) return true
    return stored === 'true'
  } catch {
    return true
  }
}

export function setNotificationSoundsEnabled(enabled: boolean) {
  try {
    localStorage.setItem(STORAGE_KEY, String(enabled))
  } catch { /* ignore */ }
}

/** Call after user interaction, or when joining an active board session. */
export function unlockNotificationAudio() {
  unlocked = true
  const uniqueSrcs = new Set(Object.values(SOUND_CONFIG).map((c) => c.src))
  uniqueSrcs.forEach((src) => { void warmAudio(src) })
}

export function playNotificationSound(type: NotificationSoundType) {
  if (!areNotificationSoundsEnabled()) return
  try {
    if (!unlocked) unlocked = true
    const { src, rate = 1 } = SOUND_CONFIG[type]
    playFileSound(src, rate)
  } catch { /* ignore */ }
}
