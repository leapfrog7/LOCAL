import { boundPageView, focalPageView } from '../viewerGeometry'
import { useZoomMotion } from '../useZoomMotion'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Maximize2, Minus, Plus } from 'lucide-react'
import type { DocumentPage, OCRBoundingBox } from '../../../domain/types'
import type { AnnotationStroke } from '../../../domain/types'
import { AnnotationLayer, type AnnotationMode } from './AnnotationLayer'

const MIN_SCALE = .25
const MAX_SCALE = 4
const clamp = (value: number) => Math.min(MAX_SCALE, Math.max(MIN_SCALE, value))

export interface PageViewState { scale: number; x: number; y: number }
export interface ContinuousViewState { scale: number; scrollTop: number; scrollLeft: number }
export interface FittedPageSize { width: number; height: number }

export function fitPageWithin(sourceWidth: number, sourceHeight: number, containerWidth: number, containerHeight: number, rotation: number): FittedPageSize {
  if (sourceWidth <= 0 || sourceHeight <= 0 || containerWidth <= 0 || containerHeight <= 0) return { width: 0, height: 0 }
  const quarterTurn = Math.abs(rotation % 180) === 90
  const rotatedWidth = quarterTurn ? sourceHeight : sourceWidth
  const rotatedHeight = quarterTurn ? sourceWidth : sourceHeight
  const scale = Math.min(containerWidth / rotatedWidth, containerHeight / rotatedHeight)
  return { width: sourceWidth * scale, height: sourceHeight * scale }
}

export function ZoomablePage({ src, alt, rotation, highlights = [], annotations = [], annotationsVisible = true, annotationMode = 'pan', annotationColor = '#d32f2f', annotationWidth = .006, initialView, trimMargins = false, onAnnotationsChange, onViewChange, onNavigate }: { src: string; alt: string; rotation: number; highlights?: OCRBoundingBox[]; annotations?: AnnotationStroke[]; annotationsVisible?: boolean; annotationMode?: AnnotationMode; annotationColor?: string; annotationWidth?: number; initialView?: PageViewState; trimMargins?: boolean; onAnnotationsChange?: (strokes: AnnotationStroke[]) => void; onViewChange?: (view: PageViewState) => void; onNavigate?: (direction: -1 | 1) => void }) {
  const [view, setView] = useState<PageViewState>(() => initialView ?? { scale: 1, x: 0, y: 0 })
  const [sourceSize, setSourceSize] = useState<FittedPageSize>({ width: 0, height: 0 })
  const [fittedSize, setFittedSize] = useState<FittedPageSize>({ width: 0, height: 0 })
  const containerRef = useRef<HTMLDivElement>(null)
  const pointers = useRef(new Map<number, { x: number; y: number }>())
  const gesture = useRef({ distance: 0, view: { scale: 1, x: 0, y: 0 }, focal: { x: 0, y: 0 } })
  const viewRef = useRef(view)
  const viewFrame = useRef(0)
  const dragged = useRef(false)
  const motion = useZoomMotion()
  const bound = (next: PageViewState) => boundPageView(next, fittedSize, { width: containerRef.current?.clientWidth ?? 0, height: containerRef.current?.clientHeight ?? 0 }, rotation, trimMargins ? 1.08 : 1)
  const commitView = (next: PageViewState) => {
    viewRef.current = bound(next)
    if (!viewFrame.current) viewFrame.current = requestAnimationFrame(() => { viewFrame.current = 0; setView(viewRef.current) })
  }
  useEffect(() => () => cancelAnimationFrame(viewFrame.current), [])
  useEffect(() => { if (fittedSize.width) commitView(viewRef.current) }, [fittedSize.width, fittedSize.height, rotation, trimMargins])
  const animateView = (target: PageViewState) => {
    const start = viewRef.current, end = bound(target)
    motion.animate(progress => commitView({ scale: start.scale + (end.scale - start.scale) * progress, x: start.x + (end.x - start.x) * progress, y: start.y + (end.y - start.y) * progress }))
  }
  const swipe = useRef<{ id: number; x: number; y: number } | null>(null)
  const lastTap = useRef<{ time: number; x: number; y: number } | null>(null)
  useEffect(() => { onViewChange?.(view) }, [view, onViewChange])
  useEffect(() => {
    const container = containerRef.current
    if (!container || !sourceSize.width || !sourceSize.height) return
    const update = () => {
      const next = fitPageWithin(sourceSize.width, sourceSize.height, container.clientWidth, container.clientHeight, rotation)
      setFittedSize(current => current.width === next.width && current.height === next.height ? current : next)
    }
    update()
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(update)
    observer?.observe(container)
    window.addEventListener('resize', update)
    return () => { observer?.disconnect(); window.removeEventListener('resize', update) }
  }, [rotation, sourceSize.height, sourceSize.width])
  const reset = () => animateView({ scale: 1, x: 0, y: 0 })
  const zoom = (delta: number) => animateView(focalPageView(viewRef.current, clamp(viewRef.current.scale + delta), { x: 0, y: 0 }))
  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (annotationMode !== 'pan' || (event.target as HTMLElement).closest('button')) return
    motion.stop()
    if (!pointers.current.size) dragged.current = false
    event.currentTarget.setPointerCapture(event.pointerId)
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY })
    if (pointers.current.size === 1) swipe.current = { id: event.pointerId, x: event.clientX, y: event.clientY }
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()]
      const rect = event.currentTarget.getBoundingClientRect()
      gesture.current = { distance: Math.hypot(a.x - b.x, a.y - b.y), view: viewRef.current, focal: { x: (a.x + b.x) / 2 - rect.left - rect.width / 2, y: (a.y + b.y) / 2 - rect.top - rect.height / 2 } }
      swipe.current = null; dragged.current = true
    }
  }
  const onPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if (annotationMode !== 'pan') return
    const previous = pointers.current.get(event.pointerId)
    if (!previous) return
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY })
    if (swipe.current && Math.hypot(event.clientX - swipe.current.x, event.clientY - swipe.current.y) > 8) dragged.current = true
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()]
      const distance = Math.hypot(a.x - b.x, a.y - b.y)
      const rect = event.currentTarget.getBoundingClientRect()
      const next = clamp(gesture.current.view.scale * distance / Math.max(1, gesture.current.distance))
      commitView(focalPageView(gesture.current.view, next, gesture.current.focal, { x: (a.x + b.x) / 2 - rect.left - rect.width / 2, y: (a.y + b.y) / 2 - rect.top - rect.height / 2 }))
    } else if (viewRef.current.scale > 1) {
      commitView({ ...viewRef.current, x: viewRef.current.x + event.clientX - previous.x, y: viewRef.current.y + event.clientY - previous.y })
    }
  }
  const onPointerUp = (event: React.PointerEvent<HTMLDivElement>) => {
    const start = swipe.current
    if (start?.id === event.pointerId && pointers.current.size === 1 && event.type !== 'pointercancel') {
      const dx = event.clientX - start.x
      const dy = event.clientY - start.y
      if (viewRef.current.scale <= 1 && Math.abs(dx) >= 52 && Math.abs(dx) > Math.abs(dy) * 1.25) onNavigate?.(dx < 0 ? 1 : -1)
      else if (Math.hypot(dx, dy) < 12) {
        const previous = lastTap.current
        const now = Date.now()
        if (previous && now - previous.time < 330 && Math.hypot(event.clientX - previous.x, event.clientY - previous.y) < 42) {
          smartZoom(event.clientX, event.clientY, event.currentTarget)
          lastTap.current = null
        } else lastTap.current = { time: now, x: event.clientX, y: event.clientY }
      }
    }
    if (start?.id === event.pointerId) swipe.current = null
    pointers.current.delete(event.pointerId)
  }
  const smartZoom = (clientX: number, clientY: number, target: HTMLDivElement) => {
    const bounds = target.getBoundingClientRect()
    const focalX = clientX - bounds.left - bounds.width / 2
    const focalY = clientY - bounds.top - bounds.height / 2
    animateView(viewRef.current.scale > 1.05 ? { scale: 1, x: 0, y: 0 } : focalPageView(viewRef.current, 2, { x: focalX, y: focalY }))
  }

  return <div ref={containerRef} className="zoom-page" onClickCapture={event => { if (dragged.current) { event.stopPropagation(); event.preventDefault(); dragged.current = false } }} onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp}>
    <div className="zoom-page-content" style={{ transform: `translate3d(${view.x}px, ${view.y}px, 0) scale(${view.scale})` }}><div className={`zoom-page-document${fittedSize.width ? ' fitted' : ''}`} style={{ width: fittedSize.width || 1, height: fittedSize.height || 1, transform: `rotate(${rotation}deg) scale(${trimMargins ? 1.08 : 1})` }}><img src={src} alt={alt} draggable={false} onLoad={event => { const image = event.currentTarget; setSourceSize({ width: image.naturalWidth, height: image.naturalHeight }) }} /><AnnotationLayer strokes={annotations} visible={annotationsVisible} mode={annotationMode} color={annotationColor} width={annotationWidth} onChange={strokes => onAnnotationsChange?.(strokes)} />{highlights.map((box, index) => <mark key={`${box.x}-${box.y}-${index}`} className="ocr-highlight" style={{ left: `${box.x * 100}%`, top: `${box.y * 100}%`, width: `${box.width * 100}%`, height: `${box.height * 100}%` }} aria-hidden="true" />)}</div></div>
    <div className="zoom-controls" aria-label="Page zoom controls">
      <button onClick={() => zoom(view.scale <= 1 ? -.25 : -.5)} disabled={view.scale <= MIN_SCALE} aria-label="Zoom out"><Minus /></button>
      <button onClick={reset} aria-label="Fit page"><Maximize2 /><span>{Math.abs(view.scale - 1) < .01 ? 'Fit' : `${Math.round(view.scale * 100)}%`}</span></button>
      <button onClick={() => zoom(view.scale < 1 ? .25 : .5)} disabled={view.scale >= MAX_SCALE} aria-label="Zoom in"><Plus /></button>
    </div>
  </div>
}

const CONTINUOUS_MIN_SCALE = .5
const CONTINUOUS_MAX_SCALE = 3
const continuousClamp = (value: number) => Math.min(CONTINUOUS_MAX_SCALE, Math.max(CONTINUOUS_MIN_SCALE, value))

export function ContinuousPages({ pages, currentPage, initialView, trimMargins = false, facing = false, annotationsVisible = true, onViewChange, onPage }: { pages: DocumentPage[]; currentPage: number; initialView?: ContinuousViewState; trimMargins?: boolean; facing?: boolean; annotationsVisible?: boolean; onViewChange?: (view: ContinuousViewState) => void; onPage: (page: number) => void }) {
  const [scale, setScale] = useState(() => continuousClamp(initialView?.scale ?? 1))
  const scaleRef = useRef(scale)
  const motion = useZoomMotion()
  const scaleFrame = useRef(0)
  const pendingScale = useRef<{ scale: number; x: number; y: number; contentX: number; contentY: number } | null>(null)
  const dragged = useRef(false)
  const scrollRef = useRef<HTMLDivElement>(null)
  const pointers = useRef(new Map<number, { x: number; y: number }>())
  const pinch = useRef<{ distance: number; scale: number; contentX: number; contentY: number } | null>(null)
  const inertiaFrame = useRef(0)
  const velocity = useRef({ x: 0, y: 0, time: 0 })
  useEffect(() => () => cancelAnimationFrame(inertiaFrame.current), [])
  const tap = useRef<{ id: number; x: number; y: number; moved: boolean } | null>(null)
  const lastTap = useRef<{ time: number; x: number; y: number } | null>(null)
  const pageRefs = useRef(new Map<number, HTMLButtonElement>())
  const frame = useRef(0)
  const restored = useRef(false)
  const reportedPage = useRef(currentPage)
  const [rendered, setRendered] = useState(() => ({ start: Math.max(0, currentPage - 2), end: Math.min(pages.length - 1, currentPage + 2) }))
  const [ratios, setRatios] = useState<Record<string, number>>({})
  const reportPosition = () => {
    const scroller = scrollRef.current
    if (!scroller) return
    onViewChange?.({
      scale: scaleRef.current,
      scrollTop: scroller.scrollTop / Math.max(1, scroller.scrollHeight - scroller.clientHeight),
      scrollLeft: scroller.scrollLeft / Math.max(1, scroller.scrollWidth - scroller.clientWidth)
    })
  }
  const updateViewport = () => {
    const scroller = scrollRef.current
    if (!scroller) return
    const bounds = scroller.getBoundingClientRect()
    const buffer = bounds.height * 2
    let first = pages.length - 1
    let last = 0
    let closest = currentPage
    let closestDistance = Number.POSITIVE_INFINITY
    pageRefs.current.forEach((element, index) => {
      const rect = element.getBoundingClientRect()
      if (rect.bottom >= bounds.top - buffer && rect.top <= bounds.bottom + buffer) {
        first = Math.min(first, index)
        last = Math.max(last, index)
      }
      const distance = Math.abs((rect.top + rect.bottom) / 2 - (bounds.top + bounds.bottom) / 2)
      if (rect.bottom >= bounds.top && rect.top <= bounds.bottom && distance < closestDistance) { closest = index; closestDistance = distance }
    })
    if (first <= last) setRendered(current => current.start === first && current.end === last ? current : { start: first, end: last })
    if (closest !== currentPage && !pinch.current) { reportedPage.current = closest; onPage(closest) }
    reportPosition()
  }
  const scheduleViewportUpdate = () => {
    cancelAnimationFrame(frame.current)
    frame.current = requestAnimationFrame(updateViewport)
  }
  useEffect(() => {
    const scroller = scrollRef.current
    if (!scroller || restored.current) return
    restored.current = true
    requestAnimationFrame(() => requestAnimationFrame(() => {
      scroller.scrollTop = (initialView?.scrollTop ?? 0) * Math.max(0, scroller.scrollHeight - scroller.clientHeight)
      scroller.scrollLeft = (initialView?.scrollLeft ?? 0) * Math.max(0, scroller.scrollWidth - scroller.clientWidth)
      if (!initialView?.scrollTop && currentPage > 0) pageRefs.current.get(currentPage)?.scrollIntoView({ block: 'start', inline: 'nearest' })
      updateViewport()
    }))
    return () => cancelAnimationFrame(frame.current)
  }, [])
  useEffect(() => {
    if (!restored.current || currentPage === reportedPage.current) return
    motion.stop(); cancelAnimationFrame(inertiaFrame.current)
    reportedPage.current = currentPage
    pageRefs.current.get(currentPage)?.scrollIntoView({ block: 'center', inline: 'center' })
    setRendered({ start: Math.max(0, currentPage - 2), end: Math.min(pages.length - 1, currentPage + 2) })
  }, [currentPage, pages.length])
  const applyScale = (requested: number, focalX?: number, focalY?: number, anchor?: { contentX: number; contentY: number }) => {
    const next = continuousClamp(requested), scroller = scrollRef.current
    if (!scroller) return
    const previous = scaleRef.current
    const x = focalX ?? scroller.clientWidth / 2, y = focalY ?? scroller.clientHeight / 2
    const previousInset = Math.max(0, scroller.clientWidth * (1 - previous) / 2)
    pendingScale.current = { scale: next, x, y, contentX: anchor?.contentX ?? (scroller.scrollLeft + x - previousInset) / previous, contentY: anchor?.contentY ?? (scroller.scrollTop + y) / previous }
    if (!scaleFrame.current) scaleFrame.current = requestAnimationFrame(() => {
      scaleFrame.current = 0
      if (pendingScale.current) setScale(pendingScale.current.scale)
    })
  }
  useLayoutEffect(() => {
    const pending = pendingScale.current, scroller = scrollRef.current
    scaleRef.current = scale
    if (!pending || !scroller) return
    const inset = Math.max(0, scroller.clientWidth * (1 - scale) / 2)
    scroller.scrollLeft = Math.max(0, Math.min(scroller.scrollWidth - scroller.clientWidth, pending.contentX * scale + inset - pending.x))
    scroller.scrollTop = Math.max(0, Math.min(scroller.scrollHeight - scroller.clientHeight, pending.contentY * scale - pending.y))
    pendingScale.current = null
    scheduleViewportUpdate()
  }, [scale])
  useEffect(() => () => cancelAnimationFrame(scaleFrame.current), [])
  const animateScale = (requested: number, x?: number, y?: number) => {
    const start = scaleRef.current, target = continuousClamp(requested)
    motion.animate(progress => applyScale(start + (target - start) * progress, x, y))
  }
  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if ((event.target as HTMLElement).closest('.zoom-controls')) return
    motion.stop()
    cancelAnimationFrame(inertiaFrame.current)
    cancelAnimationFrame(scaleFrame.current); scaleFrame.current = 0; pendingScale.current = null
    velocity.current = { x: 0, y: 0, time: performance.now() }
    if (!pointers.current.size) dragged.current = false
    event.currentTarget.setPointerCapture(event.pointerId)
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY })
    if (pointers.current.size === 1 && !(event.target as HTMLElement).closest('.zoom-controls')) tap.current = { id: event.pointerId, x: event.clientX, y: event.clientY, moved: false }
    else { tap.current = null; dragged.current = true }
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()]
      const scroller = event.currentTarget, bounds = scroller.getBoundingClientRect()
      const scale = scaleRef.current, inset = Math.max(0, scroller.clientWidth * (1 - scale) / 2)
      pinch.current = { distance: Math.hypot(a.x - b.x, a.y - b.y), scale, contentX: (scroller.scrollLeft + (a.x + b.x) / 2 - bounds.left - inset) / scale, contentY: (scroller.scrollTop + (a.y + b.y) / 2 - bounds.top) / scale }
    }
  }
  const onPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const previous = pointers.current.get(event.pointerId)
    const scroller = scrollRef.current
    if (!previous || !scroller) return
    event.preventDefault()
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY })
    if (tap.current?.id === event.pointerId && Math.hypot(event.clientX - tap.current.x, event.clientY - tap.current.y) > 10) { tap.current.moved = true; dragged.current = true }
    if (pointers.current.size >= 2) {
      const [a, b] = [...pointers.current.values()]
      const distance = Math.hypot(a.x - b.x, a.y - b.y)
      if (!pinch.current) return
      velocity.current = { x: 0, y: 0, time: performance.now() }
      const bounds = scroller.getBoundingClientRect()
      applyScale(pinch.current.scale * distance / Math.max(1, pinch.current.distance), (a.x + b.x) / 2 - bounds.left, (a.y + b.y) / 2 - bounds.top, pinch.current)
      return
    }
    const now = performance.now(), dt = Math.max(8, now - velocity.current.time)
    const dx = previous.x - event.clientX, dy = previous.y - event.clientY
    velocity.current = { x: .4 * velocity.current.x + .6 * dx / dt, y: .4 * velocity.current.y + .6 * dy / dt, time: now }
    scroller.scrollLeft += dx
    scroller.scrollTop += dy
  }
  const onPointerUp = (event: React.PointerEvent<HTMLDivElement>) => {
    const candidate = tap.current
    if (candidate?.id === event.pointerId && !candidate.moved && pointers.current.size === 1 && event.type !== 'pointercancel') {
      const previous = lastTap.current
      const now = Date.now()
      if (previous && now - previous.time < 330 && Math.hypot(event.clientX - previous.x, event.clientY - previous.y) < 42) {
        smartZoom(event.clientX, event.clientY, event.currentTarget)
        lastTap.current = null
      } else lastTap.current = { time: now, x: event.clientX, y: event.clientY }
    }
    if (candidate?.id === event.pointerId) tap.current = null
    pointers.current.delete(event.pointerId)
    if (pointers.current.size < 2) pinch.current = null
    if (!pointers.current.size && candidate?.moved && event.type !== 'pointercancel' && performance.now() - velocity.current.time < 100 && !window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
      let last = performance.now()
      const glide = (now: number) => {
        const scroller = scrollRef.current
        if (!scroller) return
        const dt = Math.min(32, now - last); last = now
        const beforeX = scroller.scrollLeft, beforeY = scroller.scrollTop
        scroller.scrollLeft += velocity.current.x * dt
        scroller.scrollTop += velocity.current.y * dt
        const decay = Math.exp(-dt / 220)
        velocity.current.x *= decay; velocity.current.y *= decay
        if ((Math.abs(velocity.current.x) + Math.abs(velocity.current.y) > .015) && (scroller.scrollLeft !== beforeX || scroller.scrollTop !== beforeY)) inertiaFrame.current = requestAnimationFrame(glide)
      }
      inertiaFrame.current = requestAnimationFrame(glide)
    }
  }
  const smartZoom = (clientX: number, clientY: number, target: HTMLDivElement) => {
    const bounds = target.getBoundingClientRect()
    animateScale(scaleRef.current > 1.05 ? 1 : 2, clientX - bounds.left, clientY - bounds.top)
  }

  return <div className="continuous-viewer">
    <div ref={scrollRef} className="continuous-scroll" onClickCapture={event => { if (dragged.current) { event.stopPropagation(); event.preventDefault(); dragged.current = false } }} onScroll={scheduleViewportUpdate} onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp}>
      <div className={`continuous-pages${facing ? ' facing-pages' : ''}`} style={{ width: `${scale * 100}%` }}>
        {pages.map((page, index) => {
          const sourceRatio = ratios[page.id] ?? .707
          const ratio = page.rotation % 180 === 0 ? sourceRatio : 1 / sourceRatio
          const shouldRender = index >= rendered.start && index <= rendered.end
          return <button ref={(element) => { if (element) pageRefs.current.set(index, element); else pageRefs.current.delete(index) }} key={page.id} className={shouldRender ? '' : 'page-placeholder'} style={{ aspectRatio: ratio }} onClick={() => onPage(index)} aria-label={`Page ${index + 1}`} aria-current={index === currentPage ? 'page' : undefined}><span>Page {index + 1}</span>{shouldRender ? <div className="continuous-page-document" style={{ inset: 'auto', left: '50%', top: '50%', width: `${page.rotation % 180 === 0 ? 100 : 100 / ratio}%`, height: `${page.rotation % 180 === 0 ? 100 : ratio * 100}%`, transform: `translate(-50%, -50%) rotate(${page.rotation}deg) scale(${trimMargins ? 1.06 : 1})` }}><img src={page.imageUrl} alt={`Page ${index + 1}`} draggable={false} onLoad={(event) => { const image = event.currentTarget; const next = image.naturalWidth / Math.max(1, image.naturalHeight); setRatios(current => current[page.id] === next ? current : { ...current, [page.id]: next }) }} /><AnnotationLayer strokes={page.annotations?.strokes ?? []} visible={annotationsVisible} mode="pan" color="#000000" width={.006} onChange={() => undefined} /></div> : <i aria-hidden="true" />}</button>
        })}
      </div>
    </div>
    <div className="zoom-controls continuous-zoom-controls" aria-label="Continuous view zoom controls">
      <button onClick={() => animateScale(scale <= 1 ? scale - .25 : scale - .5)} disabled={scale <= CONTINUOUS_MIN_SCALE} aria-label="Zoom out"><Minus /></button>
      <button onClick={() => animateScale(1)} aria-label="Reset zoom"><Maximize2 /><span>{Math.round(scale * 100)}%</span></button>
      <button onClick={() => animateScale(scale < 1 ? scale + .25 : scale + .5)} disabled={scale >= CONTINUOUS_MAX_SCALE} aria-label="Zoom in"><Plus /></button>
    </div>
  </div>
}
