import { useEffect, useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent } from 'react'
import { Camera, Check, ImagePlus, RefreshCw, RotateCcw, X, Zap, ZapOff } from 'lucide-react'
import type { PageCorners } from '../../../domain/types'
import { cornerMovement, estimateBrightness, estimateSharpness, isAutoCaptureReady, needsAutoFlash, supportsTorchCapability, viewportPointToCameraPoint } from '../cameraQuality'
import { detectDocument } from '../processing/edgeDetection'

type Proposal = { corners: PageCorners; confidence: number; capturedAt?: number }
type FocusFeedback = 'idle' | 'focusing' | 'set' | 'unsupported'
type FlashMode = 'off' | 'auto' | 'on'
type CameraCapabilities = { tapFocus: boolean; torch: boolean; stillPhoto: boolean }
type ExtendedCapabilities = MediaTrackCapabilities & { exposureMode?: string[]; focusMode?: string[]; torch?: boolean | boolean[] }
type ExtendedSupportedConstraints = MediaTrackSupportedConstraints & { pointsOfInterest?: boolean }
type ExtendedConstraintSet = MediaTrackConstraintSet & { exposureMode?: string; focusMode?: string; pointsOfInterest?: Array<{ x: number; y: number }>; torch?: boolean }
type PhotoCapabilities = { imageHeight?: { max: number }; imageWidth?: { max: number } }
type StillCapture = { getPhotoCapabilities?: () => Promise<PhotoCapabilities>; takePhoto: (settings?: { imageHeight?: number; imageWidth?: number }) => Promise<Blob> }
type StillCaptureConstructor = new (track: MediaStreamTrack) => StillCapture

const stillCaptureConstructor = () => (globalThis as typeof globalThis & { ImageCapture?: StillCaptureConstructor }).ImageCapture
const applyAdvancedConstraints = (track: MediaStreamTrack, constraints: ExtendedConstraintSet) => track.applyConstraints({ advanced: [constraints as MediaTrackConstraintSet] })
const cameraRequests: MediaStreamConstraints[] = [
  { audio: false, video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } } },
  { audio: false, video: { facingMode: { ideal: 'environment' } } },
  { audio: false, video: true },
]

async function openCameraStream() {
  let lastError: unknown
  for (const constraints of cameraRequests) {
    try {
      return await navigator.mediaDevices.getUserMedia(constraints)
    } catch (reason) {
      lastError = reason
      const name = reason instanceof DOMException ? reason.name : 'UnknownError'
      console.warn('[camera] open attempt failed', { name, message: reason instanceof Error ? reason.message : String(reason), constraints })
      if (name === 'NotAllowedError' || name === 'PermissionDeniedError' || name === 'SecurityError') break
    }
  }
  throw lastError ?? new Error('No camera stream was returned.')
}
const smoothCorners = (previous: PageCorners, next: PageCorners, amount = .22): PageCorners => ({
  topLeft: { x: previous.topLeft.x * (1 - amount) + next.topLeft.x * amount, y: previous.topLeft.y * (1 - amount) + next.topLeft.y * amount },
  topRight: { x: previous.topRight.x * (1 - amount) + next.topRight.x * amount, y: previous.topRight.y * (1 - amount) + next.topRight.y * amount },
  bottomRight: { x: previous.bottomRight.x * (1 - amount) + next.bottomRight.x * amount, y: previous.bottomRight.y * (1 - amount) + next.bottomRight.y * amount },
  bottomLeft: { x: previous.bottomLeft.x * (1 - amount) + next.bottomLeft.x * amount, y: previous.bottomLeft.y * (1 - amount) + next.bottomLeft.y * amount },
})

async function captureStill(track: MediaStreamTrack, video: HTMLVideoElement) {
  const ImageCapture = stillCaptureConstructor()
  if (ImageCapture) {
    const imageCapture = new ImageCapture(track)
    let capabilities: PhotoCapabilities | undefined
    try {
      capabilities = await imageCapture.getPhotoCapabilities?.()
    } catch (reason) {
      console.debug('Photo capabilities were unavailable; using camera defaults.', reason)
    }
    if (capabilities?.imageWidth?.max && capabilities.imageHeight?.max) {
      try {
        return { blob: await imageCapture.takePhoto({ imageWidth: capabilities.imageWidth.max, imageHeight: capabilities.imageHeight.max }), photographic: true }
      } catch (reason) {
        console.debug('Maximum-resolution still settings were unavailable; using camera defaults.', reason)
      }
    }
    try {
      return { blob: await imageCapture.takePhoto(), photographic: true }
    } catch (reason) {
      console.debug('Photographic capture was unavailable; using the live camera frame.', reason)
    }
  }

  const canvas = document.createElement('canvas')
  canvas.width = video.videoWidth
  canvas.height = video.videoHeight
  const context = canvas.getContext('2d')
  if (!context) throw new Error('Camera capture is unavailable.')
  context.drawImage(video, 0, 0)
  const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(value => value ? resolve(value) : reject(new Error('Camera capture failed.')), 'image/jpeg', .96))
  return { blob, photographic: false }
}

async function stillMatchesPreview(blob: Blob, video: HTMLVideoElement) {
  try {
    const bitmap = await createImageBitmap(blob)
    const previewRatio = video.videoWidth / video.videoHeight
    const stillRatio = bitmap.width / bitmap.height
    bitmap.close()
    return Math.abs(previewRatio - stillRatio) / previewRatio < .025
  } catch {
    return false
  }
}

export function InAppCamera({ pageCount, latestPageUrl, onCapture, onRetake, onDone, onImport, onClose }: { pageCount: number; latestPageUrl?: string; onCapture: (file: File, proposed?: Proposal) => Promise<void>; onRetake: () => void; onDone: () => void; onImport: () => void; onClose: () => void }) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const streamRef = useRef<MediaStream | undefined>(undefined)
  const detectingRef = useRef(false)
  const proposalRef = useRef<Proposal | undefined>(undefined)
  const stableRef = useRef<PageCorners | undefined>(undefined)
  const softFramesRef = useRef(0)
  const consistentFramesRef = useRef(0)
  const missedFramesRef = useRef(0)
  const autoStableFramesRef = useRef(0)
  const autoArmedRef = useRef(true)
  const captureLockRef = useRef(false)
  const lowLightRef = useRef(false)
  const torchOnRef = useRef(false)
  const flashModeRef = useRef<FlashMode>('auto')
  const captureActionRef = useRef<(source?: 'manual' | 'auto') => Promise<void>>(async () => undefined)
  const focusTimerRef = useRef(0)
  const [ready, setReady] = useState(false)
  const [capturing, setCapturing] = useState(false)
  const [error, setError] = useState('')
  const [proposal, setProposal] = useState<Proposal | undefined>(undefined)
  const [qualityHint, setQualityHint] = useState('')
  const [focusFeedback, setFocusFeedback] = useState<FocusFeedback>('idle')
  const [focusPoint, setFocusPoint] = useState<{ x: number; y: number } | undefined>(undefined)
  const [capabilities, setCapabilities] = useState<CameraCapabilities>({ tapFocus: false, torch: false, stillPhoto: false })
  const [flashMode, setFlashMode] = useState<FlashMode>('auto')
  const [flashMenuOpen, setFlashMenuOpen] = useState(false)
  const [captureFeedback, setCaptureFeedback] = useState(false)
  const [autoCapture, setAutoCapture] = useState(true)
  const [autoProgress, setAutoProgress] = useState(0)
  const [awaitingNextPage, setAwaitingNextPage] = useState(false)
  const [viewport, setViewport] = useState({ width: window.innerWidth, height: window.innerHeight })

  const setTorchEnabled = async (next: boolean) => {
    const track = streamRef.current?.getVideoTracks()[0]
    if (!track) return false
    try {
      await applyAdvancedConstraints(track, { torch: next })
      torchOnRef.current = next
      setQualityHint('')
      return true
    } catch (reason) {
      console.debug('Torch control is not implemented by this camera.', reason)
      torchOnRef.current = false
      setCapabilities(current => ({ ...current, torch: false }))
      setQualityHint('Flash is unavailable while this camera is active')
      return false
    }
  }

  const startCamera = async () => {
    setReady(false)
    setError('')
    setProposal(undefined)
    setQualityHint('')
    setFocusFeedback('idle')
    setFocusPoint(undefined)
    torchOnRef.current = false
    setCapabilities({ tapFocus: false, torch: false, stillPhoto: false })
    proposalRef.current = undefined
    stableRef.current = undefined
    softFramesRef.current = 0
    consistentFramesRef.current = 0
    missedFramesRef.current = 0
    autoStableFramesRef.current = 0
    autoArmedRef.current = true
    captureLockRef.current = false
    setAutoProgress(0)
    setAwaitingNextPage(false)
    streamRef.current?.getTracks().forEach(track => track.stop())
    try {
      if (!navigator.mediaDevices?.getUserMedia) throw new Error('This Android WebView does not expose camera access.')
      const stream = await openCameraStream()
      streamRef.current = stream
      const track = stream.getVideoTracks()[0]
      const video = videoRef.current
      if (!track || !video) throw new Error('Camera opened without a usable video track.')
      video.srcObject = stream
      await video.play()
      setReady(true)
      console.info('[camera] preview started', { settings: track.getSettings() })

      try {
        const trackCapabilities = track.getCapabilities() as ExtendedCapabilities
        const supported = navigator.mediaDevices.getSupportedConstraints() as ExtendedSupportedConstraints
        const focusModes = trackCapabilities.focusMode ?? []
        const nextCapabilities = {
          tapFocus: Boolean(supported.pointsOfInterest),
          torch: supportsTorchCapability(trackCapabilities.torch),
          stillPhoto: Boolean(stillCaptureConstructor()),
        }
        setCapabilities(nextCapabilities)
        console.info('[camera] optional capabilities', { ...nextCapabilities, rawTorch: trackCapabilities.torch })
        if (nextCapabilities.torch && flashModeRef.current === 'on') await setTorchEnabled(true)
        if (focusModes.includes('continuous')) void applyAdvancedConstraints(track, { focusMode: 'continuous' }).catch(() => undefined)
      } catch (reason) {
        console.warn('[camera] optional capability detection failed; preview remains available', reason)
        setCapabilities({ tapFocus: false, torch: false, stillPhoto: Boolean(stillCaptureConstructor()) })
      }
    } catch (reason) {
      streamRef.current?.getTracks().forEach(track => track.stop())
      streamRef.current = undefined
      console.error('[camera] startup failed', { name: reason instanceof DOMException ? reason.name : 'UnknownError', message: reason instanceof Error ? reason.message : String(reason) })
      const denied = reason instanceof DOMException && (reason.name === 'NotAllowedError' || reason.name === 'PermissionDeniedError')
      setError(denied ? 'Camera permission is off. Allow camera access for LOCAL in Android Settings, then try again.' : 'LOCAL could not open the camera hardware. You can still import photos below.')
    }
  }

  useEffect(() => {
    void startCamera()
    const resize = () => setViewport({ width: window.innerWidth, height: window.innerHeight })
    window.addEventListener('resize', resize)
    return () => {
      window.removeEventListener('resize', resize)
      window.clearTimeout(focusTimerRef.current)
      streamRef.current?.getTracks().forEach(track => track.stop())
    }
  }, [])

  useEffect(() => {
    if (!ready) return
    let cancelled = false
    let timer = 0
    const inspect = async () => {
      const video = videoRef.current
      if (!cancelled && video?.videoWidth && !detectingRef.current) {
        detectingRef.current = true
        try {
          const canvas = document.createElement('canvas')
          const scale = Math.min(1, 480 / video.videoWidth)
          canvas.width = Math.round(video.videoWidth * scale)
          canvas.height = Math.round(video.videoHeight * scale)
          const context = canvas.getContext('2d', { willReadFrequently: true })
          context?.drawImage(video, 0, 0, canvas.width, canvas.height)
          const frame = context?.getImageData(0, 0, canvas.width, canvas.height)
          const sharpness = frame ? estimateSharpness(frame.data, canvas.width, canvas.height) : 0
          lowLightRef.current = frame ? needsAutoFlash(estimateBrightness(frame.data)) : false
          const detected = await detectDocument(canvas.toDataURL('image/jpeg', .64))
          if (detected.confidence >= .5) {
            const movement = stableRef.current ? cornerMovement(stableRef.current, detected.corners) : 0
            const corners = stableRef.current && movement < .12 ? smoothCorners(stableRef.current, detected.corners) : detected.corners
            stableRef.current = corners
            const next = { corners, confidence: detected.confidence, capturedAt: Date.now() }
            consistentFramesRef.current = movement && movement < .055 ? consistentFramesRef.current + 1 : stableRef.current ? 1 : 0
            const stableEnough = detected.confidence >= .58 && consistentFramesRef.current >= 2
            if (stableEnough) { missedFramesRef.current = 0; setProposal(next) }
            else { missedFramesRef.current += 1; if (missedFramesRef.current >= 2) { setProposal(undefined); proposalRef.current = undefined } }
            if (detected.confidence >= .66 && consistentFramesRef.current >= 2) proposalRef.current = next
            softFramesRef.current = sharpness < 3.25 ? softFramesRef.current + 1 : 0
            setQualityHint(movement > .045 ? 'Hold steady' : softFramesRef.current >= 2 ? capabilities.tapFocus ? 'Image looks soft — tap the page to focus' : 'Image looks soft — hold steady' : '')
            if (movement > .1) {
              autoArmedRef.current = true
              setAwaitingNextPage(false)
            }
            const readyForAutoCapture = isAutoCaptureReady({ enabled: autoCapture, armed: autoArmedRef.current, confidence: detected.confidence, movement, sharpness })
            autoStableFramesRef.current = readyForAutoCapture ? autoStableFramesRef.current + 1 : 0
            setAutoProgress(readyForAutoCapture ? Math.min(1, autoStableFramesRef.current / 4) : 0)
            if (autoStableFramesRef.current >= 4 && !captureLockRef.current) {
              autoArmedRef.current = false
              autoStableFramesRef.current = 0
              setAutoProgress(0)
              setAwaitingNextPage(true)
              void captureActionRef.current('auto')
            }
          } else {
            softFramesRef.current = 0
            consistentFramesRef.current = 0
            missedFramesRef.current += 1
            autoStableFramesRef.current = 0
            setAutoProgress(0)
            if (missedFramesRef.current >= 2) {
              setProposal(undefined); proposalRef.current = undefined; stableRef.current = undefined
              autoArmedRef.current = true
              setAwaitingNextPage(false)
            }
            setQualityHint('')
          }
        } catch (reason) {
          console.debug('Live boundary detection skipped a frame', reason)
        } finally {
          detectingRef.current = false
        }
      }
      if (!cancelled) timer = window.setTimeout(inspect, 650)
    }
    void inspect()
    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [ready, capabilities.tapFocus, autoCapture])

  const requestFocus = async (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!ready || capturing || (event.target as HTMLElement).closest('button')) return
    if (event.clientY < 76 || event.clientY > viewport.height - 124) return
    setFocusPoint({ x: event.clientX, y: event.clientY })
    window.clearTimeout(focusTimerRef.current)
    if (!capabilities.tapFocus) {
      setFocusFeedback('unsupported')
      focusTimerRef.current = window.setTimeout(() => setFocusFeedback('idle'), 1400)
      return
    }

    const video = videoRef.current
    const track = streamRef.current?.getVideoTracks()[0]
    if (!video?.videoWidth || !track) return
    const point = viewportPointToCameraPoint({ x: event.clientX, y: event.clientY }, viewport, { width: video.videoWidth, height: video.videoHeight })
    const trackCapabilities = track.getCapabilities() as ExtendedCapabilities
    const focusMode = trackCapabilities.focusMode?.includes('single-shot') ? 'single-shot' : trackCapabilities.focusMode?.includes('continuous') ? 'continuous' : undefined
    const exposureMode = trackCapabilities.exposureMode?.includes('single-shot') ? 'single-shot' : trackCapabilities.exposureMode?.includes('continuous') ? 'continuous' : undefined
    setFocusFeedback('focusing')
    try {
      await applyAdvancedConstraints(track, { pointsOfInterest: [point], ...(focusMode ? { focusMode } : {}), ...(exposureMode ? { exposureMode } : {}) })
      setFocusFeedback('set')
      setQualityHint('')
    } catch (reason) {
      console.debug('Tap-to-focus is not implemented by this camera.', reason)
      setFocusFeedback('unsupported')
      setCapabilities(current => ({ ...current, tapFocus: false }))
    }
    focusTimerRef.current = window.setTimeout(() => setFocusFeedback('idle'), 1600)
  }

  const chooseFlashMode = async (mode: FlashMode) => {
    if (!capabilities.torch) { setFlashMenuOpen(false); setQualityHint('Flash is unavailable on this camera'); return }
    flashModeRef.current = mode
    setFlashMode(mode)
    setFlashMenuOpen(false)
    await setTorchEnabled(mode === 'on')
  }

  const capture = async (source: 'manual' | 'auto' = 'manual') => {
    const video = videoRef.current
    const track = streamRef.current?.getVideoTracks()[0]
    if (!video || !track || !ready || !video.videoWidth || captureLockRef.current) return
    captureLockRef.current = true
    autoArmedRef.current = false
    autoStableFramesRef.current = 0
    setAutoProgress(0)
    setCapturing(true)
    setError('')
    let temporaryAutoFlash = false
    try {
      if (flashModeRef.current === 'auto' && lowLightRef.current && capabilities.torch && !torchOnRef.current) {
        temporaryAutoFlash = await setTorchEnabled(true)
        if (temporaryAutoFlash) await new Promise(resolve => window.setTimeout(resolve, 240))
      }
      const { blob, photographic } = await captureStill(track, video)
      const extension = blob.type === 'image/png' ? 'png' : blob.type === 'image/webp' ? 'webp' : 'jpg'
      const latest = proposalRef.current
      const canReuseLiveBoundary = !photographic || await stillMatchesPreview(blob, video)
      await onCapture(new File([blob], `LOCAL-scan-${Date.now()}.${extension}`, { type: blob.type || 'image/jpeg' }), canReuseLiveBoundary && latest?.capturedAt && Date.now() - latest.capturedAt < 1600 ? latest : undefined)
      navigator.vibrate?.(35)
      setCaptureFeedback(true)
      if (autoCapture) setAwaitingNextPage(true)
      window.setTimeout(() => setCaptureFeedback(false), 950)
    } catch {
      setError('The page could not be captured. Hold steady and try again.')
      if (source === 'auto') {
        autoArmedRef.current = true
        setAwaitingNextPage(false)
      }
    } finally {
      if (temporaryAutoFlash) await setTorchEnabled(false)
      captureLockRef.current = false
      setCapturing(false)
    }
  }
  captureActionRef.current = capture

  const chooseCaptureMode = (automatic: boolean) => {
    setAutoCapture(automatic)
    autoStableFramesRef.current = 0
    autoArmedRef.current = true
    setAutoProgress(0)
    setAwaitingNextPage(false)
  }

  const overlayCoordinates = proposal && videoRef.current?.videoWidth ? Object.values(proposal.corners).map(point => {
    const scale = Math.max(viewport.width / videoRef.current!.videoWidth, viewport.height / videoRef.current!.videoHeight)
    const width = videoRef.current!.videoWidth * scale
    const height = videoRef.current!.videoHeight * scale
    const x = ((width - viewport.width) / -2 + point.x * width) / viewport.width * 100
    const y = ((height - viewport.height) / -2 + point.y * height) / viewport.height * 100
    return { x: Math.max(2.5, Math.min(97.5, x)), y: Math.max(2.5, Math.min(97.5, y)) }
  }) : []
  const overlayPoints = overlayCoordinates.map(point => `${point.x},${point.y}`).join(' ')

  const guidance = focusFeedback === 'focusing' ? 'Adjusting focus and exposure…'
    : focusFeedback === 'set' ? 'Focus point set'
      : focusFeedback === 'unsupported' ? 'Continuous autofocus is active'
        : qualityHint || (awaitingNextPage ? 'Captured — move to the next page' : autoCapture && autoProgress > 0 ? 'Hold still — capturing automatically' : proposal ? proposal.confidence >= .58 ? autoCapture ? 'Page detected — hold steady' : 'Page detected — tap the shutter' : 'Finding page edges…' : ready && capabilities.tapFocus ? 'Tap the page to focus' : pageCount ? `${pageCount} page${pageCount === 1 ? '' : 's'} captured` : 'Point the camera at a document')

  return <div className="camera-screen" onPointerDown={event => void requestFocus(event)}>
    <video ref={videoRef} playsInline muted aria-label="Live rear camera viewfinder" />
    <div className="camera-shade" />
    {overlayPoints ? <><svg className={`live-boundary ${proposal!.confidence >= .58 ? 'stable' : ''}`} viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true"><polygon points={overlayPoints} /></svg>{overlayCoordinates.map((point, index) => <span key={index} className="live-corner-dot" style={{ left: `${point.x}%`, top: `${point.y}%` }} aria-hidden="true" />)}</> : null}
    {focusPoint && focusFeedback !== 'idle' ? <span className={`focus-reticle ${focusFeedback}`} style={{ left: focusPoint.x, top: focusPoint.y }} aria-hidden="true"><i /><i /></span> : null}
    <header className="camera-header">
      <button onClick={onClose} aria-label="Close camera"><X /></button>
      <div className="camera-title"><strong>Scan document</strong><span>{guidance}</span></div>
      <div className="camera-actions">
        <div className="flash-control">
          <button className={!capabilities.torch ? 'unavailable' : ''} onClick={() => capabilities.torch ? setFlashMenuOpen(open => !open) : setQualityHint('Flash is unavailable on this camera')} aria-label={`Flash: ${capabilities.torch ? flashMode : 'unavailable'}`} aria-expanded={flashMenuOpen} aria-pressed={flashMode === 'on'}>{flashMode === 'off' ? <ZapOff /> : <Zap />}<span className="flash-mode-label">{flashMode === 'auto' ? 'A' : flashMode === 'on' ? 'ON' : 'OFF'}</span></button>
          {flashMenuOpen ? <div className="flash-menu" role="radiogroup" aria-label="Flash mode">{(['off', 'auto', 'on'] as const).map(mode => <button key={mode} role="radio" aria-checked={flashMode === mode} className={flashMode === mode ? 'active' : ''} onClick={() => void chooseFlashMode(mode)}>{mode === 'off' ? <ZapOff /> : <Zap />}<span>{mode === 'auto' ? 'Auto' : mode === 'on' ? 'Always on' : 'Off'}</span>{flashMode === mode ? <Check /> : null}</button>)}</div> : null}
        </div>
        <button onClick={() => void startCamera()} aria-label="Restart camera"><RefreshCw /></button>
      </div>
    </header>
    <div className="camera-mode-toggle" role="group" aria-label="Capture mode">
      <button className={autoCapture ? 'active' : ''} aria-pressed={autoCapture} onClick={() => chooseCaptureMode(true)}>Auto</button>
      <button className={!autoCapture ? 'active' : ''} aria-pressed={!autoCapture} onClick={() => chooseCaptureMode(false)}>Manual</button>
    </div>
    {capabilities.stillPhoto && ready ? <span className="photo-quality-badge">Full-resolution capture</span> : null}
    {captureFeedback ? <div className="capture-confirmation" role="status"><Check /> Page captured</div> : null}
    {!ready && !error ? <div className="camera-message"><span className="button-spinner" /> Starting camera…</div> : null}
    {error ? <div className="camera-message error" role="alert">{error}<button onClick={() => void startCamera()}>Try again</button></div> : null}
    <footer className="camera-controls">
      {latestPageUrl ? <button className="camera-preview" onClick={onRetake} aria-label="Retake last page"><img src={latestPageUrl} alt="Latest captured page" /><span><RotateCcw /> Retake</span><b>{pageCount}</b></button> : <button className="camera-import" onClick={onImport} aria-label="Import photos"><ImagePlus /><span>Photos</span></button>}
      <button className={`shutter${autoProgress > 0 ? ' auto-ready' : ''}`} onClick={() => void capture('manual')} disabled={!ready || capturing} aria-label={pageCount ? 'Capture another page' : 'Capture page'}><span>{capturing ? <span className="button-spinner" /> : <Camera />}</span>{autoProgress > 0 ? <i className="auto-progress" style={{ transform: `scaleX(${autoProgress})` }} /> : null}</button>
      {pageCount ? <button className="camera-done" onClick={onDone}><Check /> Done</button> : <div className="page-counter" />}
    </footer>
  </div>
}
