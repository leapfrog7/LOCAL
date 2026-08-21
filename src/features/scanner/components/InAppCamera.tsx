import { useEffect, useRef, useState } from 'react'
import { Camera, Check, ImagePlus, RefreshCw, RotateCcw, X } from 'lucide-react'

export function InAppCamera({ pageCount, latestPageUrl, onCapture, onRetake, onDone, onImport, onClose }: { pageCount: number; latestPageUrl?: string; onCapture: (file: File) => Promise<void>; onRetake: () => void; onDone: () => void; onImport: () => void; onClose: () => void }) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const streamRef = useRef<MediaStream | undefined>(undefined)
  const [ready, setReady] = useState(false)
  const [capturing, setCapturing] = useState(false)
  const [error, setError] = useState('')

  const startCamera = async () => {
    setReady(false); setError('')
    streamRef.current?.getTracks().forEach(track => track.stop())
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: { ideal: 'environment' }, width: { ideal: 2560 }, height: { ideal: 1920 } } })
      streamRef.current = stream
      if (videoRef.current) { videoRef.current.srcObject = stream; await videoRef.current.play(); setReady(true) }
    } catch (reason) {
      const denied = reason instanceof DOMException && (reason.name === 'NotAllowedError' || reason.name === 'PermissionDeniedError')
      setError(denied ? 'Camera permission is off. Allow camera access for LOCAL in Android Settings, then try again.' : 'LOCAL could not open the camera hardware. You can still import photos below.')
    }
  }

  useEffect(() => {
    void startCamera()
    return () => streamRef.current?.getTracks().forEach(track => track.stop())
  }, [])

  const capture = async () => {
    const video = videoRef.current
    if (!video || !ready || !video.videoWidth) return
    setCapturing(true)
    try {
      const canvas = document.createElement('canvas')
      canvas.width = video.videoWidth; canvas.height = video.videoHeight
      const context = canvas.getContext('2d')
      if (!context) throw new Error('Camera capture is unavailable.')
      context.drawImage(video, 0, 0)
      const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(value => value ? resolve(value) : reject(new Error('Camera capture failed.')), 'image/jpeg', .94))
      await onCapture(new File([blob], `LOCAL-scan-${Date.now()}.jpg`, { type: 'image/jpeg' }))
    } catch { setError('The page could not be captured. Hold steady and try again.') }
    finally { setCapturing(false) }
  }

  return <div className="camera-screen">
    <video ref={videoRef} playsInline muted aria-label="Live rear camera viewfinder" />
    <div className="camera-shade" />
    <header className="camera-header"><button onClick={onClose} aria-label="Close camera"><X /></button><div><strong>Scan document</strong><span>{pageCount ? `${pageCount} page${pageCount === 1 ? '' : 's'} captured` : 'Keep the page inside the frame'}</span></div><button onClick={() => void startCamera()} aria-label="Restart camera"><RefreshCw /></button></header>
    <div className="camera-frame"><i /><i /><i /><i /></div>
    {!ready && !error && <div className="camera-message"><span className="button-spinner" /> Starting camera…</div>}
    {error && <div className="camera-message error" role="alert">{error}<button onClick={() => void startCamera()}>Try again</button></div>}
    <footer className="camera-controls">{latestPageUrl ? <button className="camera-preview" onClick={onRetake} aria-label="Retake last page"><img src={latestPageUrl} alt="Latest captured page" /><span><RotateCcw /> Retake</span><b>{pageCount}</b></button> : <button className="camera-import" onClick={onImport} aria-label="Import photos"><ImagePlus /><span>Photos</span></button>}<button className="shutter" onClick={() => void capture()} disabled={!ready || capturing} aria-label={pageCount ? 'Capture another page' : 'Capture page'}><span>{capturing ? <span className="button-spinner" /> : <Camera />}</span></button>{pageCount ? <button className="camera-done" onClick={onDone}><Check /> Done</button> : <div className="page-counter" />}</footer>
  </div>
}
