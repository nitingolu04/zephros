import { useEffect, useRef, useCallback, useState } from 'react'
import { toast } from 'sonner'
import { MediaEvent, SocketEvent } from '@/types'
import type { MediaParticipant } from '@/types'
import { socketService } from '@/services/socket'
import { useMediaStore } from '@/stores/mediaStore'
import { useBoardStore } from '@/stores/boardStore'
import { WEBRTC_ICE_SERVERS } from '@/lib/webrtc'
import {
  addScreenTrackToPeer,
  isScreenTrack,
  removeScreenTrackFromPeer,
  waitForSignalingStable,
} from '@/lib/webrtcPeers'

function mergeRemoteTrack(remoteId: string, track: MediaStreamTrack) {
  const store = useMediaStore.getState()
  const existing = store.remoteStreams.get(remoteId)
  const tracks = existing ? [...existing.getTracks()] : []
  const withoutKind = tracks.filter((t) => t.kind !== track.kind)
  store.setRemoteStream(remoteId, new MediaStream([...withoutKind, track]))
}

function createPeer() {
  return new RTCPeerConnection({
    iceServers: WEBRTC_ICE_SERVERS,
    iceCandidatePoolSize: 10,
    // max-bundle fails when negotiating before mic/camera tracks are added.
    bundlePolicy: 'balanced',
  })
}

export function useWebRTC(boardId: string) {
  const peersRef = useRef<Map<string, RTCPeerConnection>>(new Map())
  const pendingIceRef = useRef<Map<string, RTCIceCandidateInit[]>>(new Map())
  const screenStreamRef = useRef<MediaStream | null>(null)
  const isSharingRef = useRef(false)
  const boardIdRef = useRef(boardId)
  boardIdRef.current = boardId

  const [localScreenStream, setLocalScreenStream] = useState<MediaStream | null>(null)

  const screenSharer = useBoardStore((s) => s.screenSharer)
  const remoteScreenStream = useBoardStore((s) => s.remoteScreenStream)
  const setRemoteScreenStream = useBoardStore((s) => s.setRemoteScreenStream)

  const {
    audioEnabled, videoEnabled,
    setInCall, setAudioEnabled, setVideoEnabled, setLocalStream,
    setRemoteStream, upsertParticipant, removeParticipant, reset,
  } = useMediaStore()

  const sessionId = socketService.sessionId
  const username = socketService.username
  const color = socketService.color
  const registeredRef = useRef(false)
  const leftCallRef = useRef(false)
  const registerInRoomRef = useRef<() => void>(() => {})

  const isLocalSharing = screenSharer?.sessionId === sessionId
  const isViewing = Boolean(screenSharer && !isLocalSharing)

  const flushPendingIce = async (peerId: string, pc: RTCPeerConnection) => {
    const pending = pendingIceRef.current.get(peerId) || []
    pendingIceRef.current.delete(peerId)
    for (const candidate of pending) {
      try {
        await pc.addIceCandidate(new RTCIceCandidate(candidate))
      } catch { /* ignore */ }
    }
  }

  const queueIce = (peerId: string, candidate: RTCIceCandidateInit) => {
    const list = pendingIceRef.current.get(peerId) || []
    list.push(candidate)
    pendingIceRef.current.set(peerId, list)
  }

  const sendOffer = useCallback(async (remoteId: string) => {
    const pc = peersRef.current.get(remoteId)
    if (!pc) return
    try {
      if (pc.signalingState !== 'stable') {
        await waitForSignalingStable(pc)
      }
      const offer = await pc.createOffer()
      await pc.setLocalDescription(offer)
      socketService.emitWebRTCOffer(boardIdRef.current, remoteId, offer)
    } catch (err) {
      console.error('[WebRTC] sendOffer failed:', err)
    }
  }, [])

  const renegotiateAllPeers = useCallback(async () => {
    for (const remoteId of peersRef.current.keys()) {
      await sendOffer(remoteId)
    }
  }, [sendOffer])

  const wirePeer = useCallback((pc: RTCPeerConnection, remoteId: string) => {
    pc.ontrack = (ev) => {
      const track = ev.track
      if (!track) return

      const sharer = useBoardStore.getState().screenSharer
      const participant = useMediaStore.getState().participants.find((p) => p.sessionId === remoteId)

      if (
        track.kind === 'video'
        && (isScreenTrack(track) || (sharer?.sessionId === remoteId && !participant?.videoEnabled))
      ) {
        const stream = new MediaStream([track])
        setRemoteScreenStream(stream)
        track.onended = () => setRemoteScreenStream(null)
        track.onunmute = () => setRemoteScreenStream(new MediaStream([track]))
        return
      }

      mergeRemoteTrack(remoteId, track)
    }

    pc.onicecandidate = (ev) => {
      if (ev.candidate) {
        socketService.emitIceCandidate(boardIdRef.current, remoteId, ev.candidate)
      }
    }

    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'failed' || pc.connectionState === 'disconnected') {
        pc.close()
        peersRef.current.delete(remoteId)
        setRemoteStream(remoteId, null)
      }
    }
  }, [setRemoteStream, setRemoteScreenStream])

  const ensurePeer = useCallback(async (remoteId: string, initiator: boolean) => {
    if (remoteId === sessionId) return null

    let pc = peersRef.current.get(remoteId)
    if (pc && (pc.connectionState === 'failed' || pc.signalingState === 'closed')) {
      pc.close()
      peersRef.current.delete(remoteId)
      pc = undefined
    }

    if (!pc) {
      const stream = useMediaStore.getState().localStream
      pc = createPeer()
      peersRef.current.set(remoteId, pc)
      wirePeer(pc, remoteId)

      stream?.getTracks().forEach((track) => {
        if (!isScreenTrack(track)) pc!.addTrack(track, stream)
      })

      if (isSharingRef.current && screenStreamRef.current) {
        addScreenTrackToPeer(pc, screenStreamRef.current)
      }

      if (initiator) {
        await sendOffer(remoteId)
      }
    }

    return pc
  }, [sessionId, wirePeer, sendOffer])

  const publishScreenToPeer = useCallback(async (remoteId: string) => {
    if (!isSharingRef.current || !screenStreamRef.current || remoteId === sessionId) return
    const pc = await ensurePeer(remoteId, true)
    if (!pc) return
    addScreenTrackToPeer(pc, screenStreamRef.current)
    await sendOffer(remoteId)
  }, [sessionId, ensurePeer, sendOffer])

  const publishScreenToAll = useCallback(async (viewerIds: string[]) => {
    for (const id of viewerIds) {
      await publishScreenToPeer(id)
    }
  }, [publishScreenToPeer])

  const stopSharing = useCallback(async () => {
    screenStreamRef.current?.getTracks().forEach((t) => t.stop())
    screenStreamRef.current = null
    setLocalScreenStream(null)
    isSharingRef.current = false

    for (const pc of peersRef.current.values()) {
      removeScreenTrackFromPeer(pc)
    }
    await renegotiateAllPeers()

    socketService.emitScreenShareStop(boardIdRef.current)
    useBoardStore.getState().setScreenSharer(null)
    setRemoteScreenStream(null)
  }, [renegotiateAllPeers, setRemoteScreenStream])

  const leaveCall = useCallback(async () => {
    if (isSharingRef.current) await stopSharing()

    if (registeredRef.current) {
      socketService.emitCallLeave(boardIdRef.current, sessionId)
      registeredRef.current = false
    }

    peersRef.current.forEach((pc) => pc.close())
    peersRef.current.clear()
    pendingIceRef.current.clear()
    useMediaStore.getState().localStream?.getTracks().forEach((t) => t.stop())
    setRemoteScreenStream(null)
    reset()
    leftCallRef.current = true
  }, [sessionId, stopSharing, setRemoteScreenStream, reset])

  const startSharing = useCallback(async () => {
    if (isSharingRef.current) return
    leftCallRef.current = false
    registerInRoomRef.current()
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false })
      screenStreamRef.current = stream
      setLocalScreenStream(stream)
      isSharingRef.current = true

      stream.getVideoTracks()[0].onended = () => { void stopSharing() }

      useBoardStore.getState().setScreenSharer({
        sessionId,
        username,
      })
      socketService.emitScreenShareStart(boardIdRef.current)
      const viewers = useMediaStore.getState().participants
        .map((p) => p.sessionId)
        .filter((id) => id !== sessionId)
      if (viewers.length > 0) {
        await publishScreenToAll(viewers)
      }
      toast.success('Screen sharing started')
    } catch {
      toast.error('Screen share cancelled or denied')
      void stopSharing()
    }
  }, [sessionId, username, stopSharing, publishScreenToAll])

  const toggleShare = useCallback(() => {
    if (isSharingRef.current) void stopSharing()
    else void startSharing()
  }, [startSharing, stopSharing])

  const acquireTracks = useCallback(async (wantAudio: boolean, wantVideo: boolean) => {
    const store = useMediaStore.getState()
    let stream = store.localStream

    if (!wantAudio && !wantVideo) return stream

    const needAudio = wantAudio && !stream?.getAudioTracks().some((t) => t.readyState === 'live')
    const needVideo = wantVideo && !stream?.getVideoTracks().some((t) => t.readyState === 'live')

    if (!needAudio && !needVideo) {
      stream?.getAudioTracks().forEach((t) => { t.enabled = wantAudio })
      stream?.getVideoTracks().forEach((t) => { t.enabled = wantVideo })
      return stream
    }

    try {
      const constraints: MediaStreamConstraints = {}
      if (needAudio) constraints.audio = true
      if (needVideo) constraints.video = { facingMode: 'user' }

      const fresh = await navigator.mediaDevices.getUserMedia(constraints)

      if (!stream) {
        stream = new MediaStream()
        setLocalStream(stream)
      }

      fresh.getTracks().forEach((track) => {
        const existing = stream!.getTracks().find((t) => t.kind === track.kind)
        if (existing) {
          existing.stop()
          stream!.removeTrack(existing)
        }
        track.enabled = track.kind === 'audio' ? wantAudio : wantVideo
        stream!.addTrack(track)
      })

      setLocalStream(new MediaStream(stream.getTracks()))
      return useMediaStore.getState().localStream
    } catch {
      toast.error('Could not access microphone/camera. Check browser permissions.')
      return null
    }
  }, [setLocalStream])

  const syncTracksToPeers = useCallback((stream: MediaStream | null) => {
    peersRef.current.forEach((pc) => {
      if (!stream) {
        pc.getSenders().forEach((s) => {
          if (s.track && !isScreenTrack(s.track)) pc.removeTrack(s)
        })
        return
      }
      stream.getTracks().forEach((track) => {
        const sender = pc.getSenders().find(
          (s) => s.track?.kind === track.kind && !isScreenTrack(s.track!),
        )
        if (sender) void sender.replaceTrack(track)
        else pc.addTrack(track, stream)
      })
    })
  }, [])

  const emitCallJoin = useCallback(() => {
    const state = useMediaStore.getState()
    socketService.emitCallJoin(boardIdRef.current, {
      sessionId,
      username,
      color,
      audioEnabled: state.audioEnabled,
      videoEnabled: state.videoEnabled,
    })
  }, [sessionId, username, color])

  const registerInRoom = useCallback(() => {
    if (leftCallRef.current) return
    if (!registeredRef.current) {
      registeredRef.current = true
      setInCall(true)
      setAudioEnabled(false)
      setVideoEnabled(false)
      upsertParticipant({
        sessionId, username, color,
        audioEnabled: false, videoEnabled: false, isLocal: true,
      })
    }
    emitCallJoin()
  }, [sessionId, username, color, setInCall, setAudioEnabled, setVideoEnabled, upsertParticipant, emitCallJoin])

  registerInRoomRef.current = registerInRoom

  const broadcastMediaState = useCallback((audio: boolean, video: boolean) => {
    upsertParticipant({
      sessionId, username, color,
      audioEnabled: audio, videoEnabled: video, isLocal: true,
    })
    socketService.emitMediaState(boardIdRef.current, {
      sessionId, audioEnabled: audio, videoEnabled: video,
    })
  }, [sessionId, username, color, upsertParticipant])

  const toggleAudio = useCallback(async () => {
    leftCallRef.current = false
    registerInRoom()
    const next = !audioEnabled
    if (next) {
      const stream = await acquireTracks(true, videoEnabled)
      if (!stream) return
      syncTracksToPeers(stream)
      if (peersRef.current.size > 0) await renegotiateAllPeers()
    } else {
      useMediaStore.getState().localStream?.getAudioTracks().forEach((t) => { t.enabled = false })
    }
    setAudioEnabled(next)
    broadcastMediaState(next, videoEnabled)
  }, [audioEnabled, videoEnabled, registerInRoom, acquireTracks, syncTracksToPeers, renegotiateAllPeers, setAudioEnabled, broadcastMediaState])

  const toggleVideo = useCallback(async () => {
    leftCallRef.current = false
    registerInRoom()
    const next = !videoEnabled
    if (next) {
      const stream = await acquireTracks(audioEnabled, true)
      if (!stream) return
      syncTracksToPeers(stream)
      if (peersRef.current.size > 0) await renegotiateAllPeers()
    } else {
      useMediaStore.getState().localStream?.getVideoTracks().forEach((t) => {
        t.stop()
        useMediaStore.getState().localStream?.removeTrack(t)
      })
    }
    setVideoEnabled(next)
    broadcastMediaState(audioEnabled, next)
  }, [audioEnabled, videoEnabled, registerInRoom, acquireTracks, syncTracksToPeers, renegotiateAllPeers, setVideoEnabled, broadcastMediaState])

  const handlersRef = useRef({
    ensurePeer, publishScreenToPeer, publishScreenToAll,
    stopSharing, setRemoteScreenStream, sendOffer, flushPendingIce,
  })
  handlersRef.current = {
    ensurePeer, publishScreenToPeer, publishScreenToAll,
    stopSharing, setRemoteScreenStream, sendOffer, flushPendingIce,
  }

  useEffect(() => {
    if (!boardId) return
    const tryRegister = () => {
      if (socketService.isConnected) registerInRoom()
    }
    tryRegister()
    const socket = socketService.getSocket()
    socket?.on('connect', tryRegister)
    return () => { socket?.off('connect', tryRegister) }
  }, [boardId, registerInRoom])

  useEffect(() => {
    const attach = () => {
      const socket = socketService.getSocket()
      if (!socket) return

      const onParticipants = async ({ participants }: { participants: MediaParticipant[] }) => {
        participants.forEach((p) => upsertParticipant(p))
        for (const p of participants) {
          await handlersRef.current.ensurePeer(p.sessionId, true)
        }
      }

      const onUserJoined = async (p: MediaParticipant) => {
        upsertParticipant(p)
        await handlersRef.current.ensurePeer(p.sessionId, false)
      }

      const onUserLeft = ({ sessionId: leftId }: { sessionId: string }) => {
        peersRef.current.get(leftId)?.close()
        peersRef.current.delete(leftId)
        removeParticipant(leftId)
      }

      const onMediaState = (data: {
        sessionId: string; audioEnabled: boolean; videoEnabled: boolean
        username?: string; color?: string
      }) => {
        const existing = useMediaStore.getState().participants.find((p) => p.sessionId === data.sessionId)
        upsertParticipant({
          sessionId: data.sessionId,
          username: data.username || existing?.username || 'User',
          color: data.color || existing?.color || '#6366F1',
          audioEnabled: data.audioEnabled,
          videoEnabled: data.videoEnabled,
          isLocal: data.sessionId === sessionId,
        })
      }

      const onOffer = async (data: {
        fromSessionId: string; offer: RTCSessionDescriptionInit; targetSessionId?: string
      }) => {
        if (data.targetSessionId && data.targetSessionId !== socketService.sessionId) return
        try {
          const pc = await handlersRef.current.ensurePeer(data.fromSessionId, false)
          if (!pc) return

          if (pc.signalingState !== 'stable' && pc.signalingState !== 'closed') {
            try {
              await pc.setLocalDescription({ type: 'rollback' })
            } catch { /* ignore */ }
          }

          await pc.setRemoteDescription(new RTCSessionDescription(data.offer))
          await handlersRef.current.flushPendingIce(data.fromSessionId, pc)
          const answer = await pc.createAnswer()
          await pc.setLocalDescription(answer)
          socketService.emitWebRTCAnswer(boardIdRef.current, data.fromSessionId, answer)
        } catch (err) {
          console.error('[WebRTC] offer failed:', err)
        }
      }

      const onAnswer = async (data: {
        fromSessionId: string; answer: RTCSessionDescriptionInit; targetSessionId?: string
      }) => {
        if (data.targetSessionId && data.targetSessionId !== socketService.sessionId) return
        const pc = peersRef.current.get(data.fromSessionId)
        if (!pc) return
        try {
          await pc.setRemoteDescription(new RTCSessionDescription(data.answer))
          await handlersRef.current.flushPendingIce(data.fromSessionId, pc)
        } catch (err) {
          console.error('[WebRTC] answer failed:', err)
        }
      }

      const onIce = async (data: {
        fromSessionId: string; candidate: RTCIceCandidateInit; targetSessionId?: string
      }) => {
        if (data.targetSessionId && data.targetSessionId !== socketService.sessionId) return
        if (!data.candidate) return
        const pc = peersRef.current.get(data.fromSessionId)
        if (!pc || !pc.remoteDescription) {
          queueIce(data.fromSessionId, data.candidate)
          return
        }
        try {
          await pc.addIceCandidate(new RTCIceCandidate(data.candidate))
        } catch { /* ignore */ }
      }

      const onScreenStart = (data: { sessionId: string; username: string }) => {
        useBoardStore.getState().setScreenSharer(data)
        if (!isSharingRef.current && data.sessionId !== socketService.sessionId) {
          socketService.emitScreenShareRequestOffer(boardIdRef.current)
        }
      }

      const onScreenViewers = (data: { viewers: string[] }) => {
        if (!isSharingRef.current) return
        void handlersRef.current.publishScreenToAll(data.viewers)
      }

      const onScreenViewerJoined = (data: { viewerSessionId: string }) => {
        if (!isSharingRef.current) return
        void handlersRef.current.publishScreenToPeer(data.viewerSessionId)
      }

      const onScreenStop = () => {
        handlersRef.current.setRemoteScreenStream(null)
        if (!isSharingRef.current) {
          useBoardStore.getState().setScreenSharer(null)
        }
      }

      const onForceMute = () => {
        useMediaStore.getState().localStream?.getAudioTracks().forEach((t) => { t.enabled = false })
        setAudioEnabled(false)
        broadcastMediaState(false, useMediaStore.getState().videoEnabled)
        toast.info('You were muted by the board host')
      }

      socket.off(MediaEvent.CALL_PARTICIPANTS, onParticipants)
      socket.off(MediaEvent.USER_CALL_JOINED, onUserJoined)
      socket.off(MediaEvent.USER_CALL_LEFT, onUserLeft)
      socket.off(MediaEvent.MEDIA_STATE, onMediaState)
      socket.off(MediaEvent.WEBRTC_OFFER, onOffer)
      socket.off(MediaEvent.WEBRTC_ANSWER, onAnswer)
      socket.off(MediaEvent.ICE_CANDIDATE, onIce)
      socket.off(SocketEvent.SCREEN_SHARE_START, onScreenStart)
      socket.off('SCREEN_SHARE_VIEWERS', onScreenViewers)
      socket.off('SCREEN_SHARE_VIEWER_JOINED', onScreenViewerJoined)
      socket.off(SocketEvent.SCREEN_SHARE_STOP, onScreenStop)
      socket.off(SocketEvent.FORCE_MUTE, onForceMute)

      socket.on(MediaEvent.CALL_PARTICIPANTS, onParticipants)
      socket.on(MediaEvent.USER_CALL_JOINED, onUserJoined)
      socket.on(MediaEvent.USER_CALL_LEFT, onUserLeft)
      socket.on(MediaEvent.MEDIA_STATE, onMediaState)
      socket.on(MediaEvent.WEBRTC_OFFER, onOffer)
      socket.on(MediaEvent.WEBRTC_ANSWER, onAnswer)
      socket.on(MediaEvent.ICE_CANDIDATE, onIce)
      socket.on(SocketEvent.SCREEN_SHARE_START, onScreenStart)
      socket.on('SCREEN_SHARE_VIEWERS', onScreenViewers)
      socket.on('SCREEN_SHARE_VIEWER_JOINED', onScreenViewerJoined)
      socket.on(SocketEvent.SCREEN_SHARE_STOP, onScreenStop)
      socket.on(SocketEvent.FORCE_MUTE, onForceMute)
    }

    attach()
    const socket = socketService.getSocket()
    const onConnect = () => {
      attach()
      if (!leftCallRef.current) emitCallJoin()
    }
    socket?.on('connect', onConnect)
    return () => { socket?.off('connect', onConnect) }
  }, [sessionId, upsertParticipant, removeParticipant, emitCallJoin, queueIce])

  useEffect(() => {
    if (!isViewing || remoteScreenStream) return
    const retry = () => socketService.emitScreenShareRequestOffer(boardIdRef.current)
    retry()
    const timer = setInterval(retry, 2500)
    return () => clearInterval(timer)
  }, [isViewing, remoteScreenStream])

  useEffect(() => {
    return () => {
      if (registeredRef.current) {
        socketService.emitCallLeave(boardIdRef.current, sessionId)
      }
      registeredRef.current = false
      if (isSharingRef.current) void stopSharing()
      peersRef.current.forEach((pc) => pc.close())
      peersRef.current.clear()
      pendingIceRef.current.clear()
      useMediaStore.getState().localStream?.getTracks().forEach((t) => t.stop())
      reset()
    }
  }, [sessionId, reset, stopSharing])

  return {
    audioEnabled,
    videoEnabled,
    toggleAudio,
    toggleVideo,
    toggleShare,
    stopSharing,
    leaveCall,
    isLocalSharing,
    isViewing,
    screenSharer,
    localScreenStream,
    remoteScreenStream,
  }
}
