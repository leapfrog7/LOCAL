import { useRef, useState } from 'react'
import { Maximize2, Minus, Plus } from 'lucide-react'
import type { OCRBoundingBox } from '../../../domain/types'

const MIN_SCALE = .25
const MAX_SCALE = 4
const clamp = (value: number) => Math.min(MAX_SCALE, Math.max(MIN_SCALE, value))

export function ZoomablePage({ src, alt, rotation, highlights = [], onNavigate }: { src: string; alt: string; rotation: number; highlights?: OCRBoundingBox[]; onNavigate?: (direction: -1 | 1) => void }) {
  const [view, setView] = useState({ scale: 1, x: 0, y: 0 })
  const pointers = useRef(new Map<number, { x: number; y: number }>())
  const gesture = useRef({ distance: 0, scale: 1 })
  const swipe = useRef<{ id: number; x: number; y: number } | null>(null)
  const reset = () => setView({ scale: 1, x: 0, y: 0 })
  const zoom = (delta: number) => setView(current => {
    const scale = clamp(current.scale + delta)
    return scale <= 1 ? { scale, x: 0, y: 0 } : { ...current, scale }
  })
  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    event.currentTarget.setPointerCapture(event.pointerId)
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY })
    if (view.scale <= 1 && !(event.target as HTMLElement).closest('button')) swipe.current = { id: event.pointerId, x: event.clientX, y: event.clientY }
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()]
      gesture.current = { distance: Math.hypot(a.x - b.x, a.y - b.y), scale: view.scale }
    }
  }
  const onPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const previous = pointers.current.get(event.pointerId)
    if (!previous) return
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY })
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()]
      const distance = Math.hypot(a.x - b.x, a.y - b.y)
      setView(current => ({ ...current, scale: clamp(gesture.current.scale * distance / Math.max(1, gesture.current.distance)) }))
    } else if (view.scale > 1) {
      setView(current => ({ ...current, x: current.x + event.clientX - previous.x, y: current.y + event.clientY - previous.y }))
    }
  }
  const onPointerUp = (event: React.PointerEvent<HTMLDivElement>) => {
    const start = swipe.current
    if (start?.id === event.pointerId && pointers.current.size === 1 && view.scale <= 1) {
      const dx = event.clientX - start.x
      const dy = event.clientY - start.y
      if (Math.abs(dx) >= 52 && Math.abs(dx) > Math.abs(dy) * 1.25) onNavigate?.(dx < 0 ? 1 : -1)
    }
    if (start?.id === event.pointerId) swipe.current = null
    pointers.current.delete(event.pointerId)
  }

  return <div className="zoom-page" onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp} onDoubleClick={() => view.scale === 1 ? zoom(1) : reset()}>
    <div className="zoom-page-content" style={{ transform: `translate3d(${view.x}px, ${view.y}px, 0) scale(${view.scale}) rotate(${rotation}deg)` }}><img src={src} alt={alt} draggable={false} />{highlights.map((box, index) => <mark key={`${box.x}-${box.y}-${index}`} className="ocr-highlight" style={{ left: `${box.x * 100}%`, top: `${box.y * 100}%`, width: `${box.width * 100}%`, height: `${box.height * 100}%` }} aria-hidden="true" />)}</div>
    <div className="zoom-controls" aria-label="Page zoom controls">
      <button onClick={() => zoom(view.scale <= 1 ? -.25 : -.5)} disabled={view.scale <= MIN_SCALE} aria-label="Zoom out"><Minus /></button>
      <button onClick={reset} aria-label="Reset zoom"><Maximize2 /><span>{Math.round(view.scale * 100)}%</span></button>
      <button onClick={() => zoom(view.scale < 1 ? .25 : .5)} disabled={view.scale >= MAX_SCALE} aria-label="Zoom in"><Plus /></button>
    </div>
  </div>
}
