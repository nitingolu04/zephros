import { useCallback, useRef, useState } from 'react'
import { toast } from 'sonner'
import { uploadToGoogleDrive, isDriveConfigured } from '@/lib/googleDrive'

export function useRecorder(stageContainerRef: React.RefObject<HTMLElement | null>) {
  const [recording, setRecording] = useState(false)
  const [elapsed, setElapsed] = useState(0)
  const recorderRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const stopRecording = useCallback(() => {
    recorderRef.current?.stop()
    recorderRef.current = null
    if (timerRef.current) clearInterval(timerRef.current)
    setRecording(false)
  }, [])

  const startRecording = useCallback(async () => {
    try {
      const canvas = stageContainerRef.current?.querySelector('canvas') as HTMLCanvasElement | null
      if (!canvas) {
        toast.error('Canvas not ready for recording')
        return
      }

      const canvasStream = canvas.captureStream(30)
      let combinedStream: MediaStream = canvasStream

      try {
        const mic = await navigator.mediaDevices.getUserMedia({ audio: true, video: false })
        const audioCtx = new AudioContext()
        const dest = audioCtx.createMediaStreamDestination()
        mic.getAudioTracks().forEach((t) => {
          const src = audioCtx.createMediaStreamSource(new MediaStream([t]))
          src.connect(dest)
        })
        combinedStream = new MediaStream([
          ...canvasStream.getVideoTracks(),
          ...dest.stream.getAudioTracks(),
        ])
      } catch {
        // mic optional
      }

      const mime = MediaRecorder.isTypeSupported('video/webm;codecs=vp9')
        ? 'video/webm;codecs=vp9'
        : 'video/webm'
      const recorder = new MediaRecorder(combinedStream, { mimeType: mime })
      chunksRef.current = []
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data)
      }
      recorder.onstop = async () => {
        const blob = new Blob(chunksRef.current, { type: 'video/webm' })
        const filename = `Zephros-recording-${Date.now()}.webm`

        if (isDriveConfigured()) {
          try {
            const link = await uploadToGoogleDrive(blob, filename)
            toast.success('Recording saved to Google Drive', {
              action: { label: 'Open', onClick: () => window.open(link, '_blank') },
            })
          } catch {
            downloadBlob(blob, filename)
            toast.info('Drive upload failed — downloaded locally instead')
          }
        } else {
          downloadBlob(blob, filename)
          toast.success('Recording downloaded')
        }
        combinedStream.getTracks().forEach((t) => t.stop())
      }

      recorderRef.current = recorder
      recorder.start(1000)
      setRecording(true)
      setElapsed(0)
      timerRef.current = setInterval(() => setElapsed((e) => e + 1), 1000)
      toast.success('Recording started')
    } catch {
      toast.error('Could not start recording')
    }
  }, [stageContainerRef])

  const toggleRecording = useCallback(() => {
    if (recording) stopRecording()
    else void startRecording()
  }, [recording, startRecording, stopRecording])

  return { recording, elapsed, toggleRecording }
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}
