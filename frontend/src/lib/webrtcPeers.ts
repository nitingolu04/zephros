/** Screen-share tracks are tagged so they don't collide with camera video */
export const SCREEN_TRACK_HINT = 'detail'

export function isScreenTrack(track: MediaStreamTrack): boolean {
  if (track.kind !== 'video') return false
  if (track.contentHint === SCREEN_TRACK_HINT) return true
  const label = track.label.toLowerCase()
  return (
    label.includes('screen')
    || label.includes('window')
    || label.includes('display')
    || label.includes('monitor')
    || label.includes('web-contents')
    || label.includes('capture')
  )
}

export function tagScreenTrack(track: MediaStreamTrack) {
  track.contentHint = SCREEN_TRACK_HINT
}

export function addScreenTrackToPeer(pc: RTCPeerConnection, stream: MediaStream) {
  const track = stream.getVideoTracks()[0]
  if (!track) return
  tagScreenTrack(track)
  const existing = pc.getSenders().find((s) => s.track && isScreenTrack(s.track))
  if (existing) {
    void existing.replaceTrack(track)
  } else {
    pc.addTrack(track, stream)
  }
}

export function removeScreenTrackFromPeer(pc: RTCPeerConnection) {
  for (const sender of [...pc.getSenders()]) {
    if (sender.track && isScreenTrack(sender.track)) {
      pc.removeTrack(sender)
    }
  }
}

export async function waitForSignalingStable(pc: RTCPeerConnection, timeoutMs = 8000) {
  if (pc.signalingState === 'stable' || pc.signalingState === 'closed') return
  await new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, timeoutMs)
    const check = () => {
      if (pc.signalingState === 'stable' || pc.signalingState === 'closed') {
        clearTimeout(timer)
        pc.removeEventListener('signalingstatechange', check)
        resolve()
      }
    }
    pc.addEventListener('signalingstatechange', check)
  })
}
