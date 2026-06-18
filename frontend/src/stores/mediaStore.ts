import { create } from 'zustand'
import type { MediaParticipant } from '@/types'

interface MediaState {
  inCall: boolean
  audioEnabled: boolean
  videoEnabled: boolean
  participants: MediaParticipant[]
  remoteStreams: Map<string, MediaStream>
  localStream: MediaStream | null
  setInCall: (v: boolean) => void
  setAudioEnabled: (v: boolean) => void
  setVideoEnabled: (v: boolean) => void
  setLocalStream: (stream: MediaStream | null) => void
  setRemoteStream: (sessionId: string, stream: MediaStream | null) => void
  upsertParticipant: (p: MediaParticipant) => void
  removeParticipant: (sessionId: string) => void
  setParticipants: (list: MediaParticipant[]) => void
  reset: () => void
}

export const useMediaStore = create<MediaState>((set, get) => ({
  inCall: false,
  audioEnabled: false,
  videoEnabled: false,
  participants: [],
  remoteStreams: new Map(),
  localStream: null,

  setInCall: (v) => set({ inCall: v }),
  setAudioEnabled: (v) => set({ audioEnabled: v }),
  setVideoEnabled: (v) => set({ videoEnabled: v }),
  setLocalStream: (stream) => set({ localStream: stream }),

  setRemoteStream: (sessionId, stream) => {
    const next = new Map(get().remoteStreams)
    if (stream) next.set(sessionId, stream)
    else next.delete(sessionId)
    set({ remoteStreams: next })
  },

  upsertParticipant: (p) => {
    const list = get().participants.filter((x) => x.sessionId !== p.sessionId)
    set({ participants: [...list, p] })
  },

  removeParticipant: (sessionId) => {
    const next = new Map(get().remoteStreams)
    next.delete(sessionId)
    set({
      participants: get().participants.filter((p) => p.sessionId !== sessionId),
      remoteStreams: next,
    })
  },

  setParticipants: (list) => set({ participants: list }),

  reset: () => set({
    inCall: false,
    audioEnabled: false,
    videoEnabled: false,
    participants: [],
    remoteStreams: new Map(),
    localStream: null,
  }),
}))
