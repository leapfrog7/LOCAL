import { useRef, useState } from 'react'
import type { PageCorners, Point } from '../../../domain/types'

type CornerKey = keyof PageCorners
const orderedKeys: CornerKey[] = ['topLeft', 'topRight', 'bottomRight', 'bottomLeft']

export function CornerEditor({ imageUrl, corners, onChange }: { imageUrl: string; corners: PageCorners; onChange: (corners: PageCorners) => void }) {
  const frameRef = useRef<HTMLDivElement>(null)
  const [dragging, setDragging] = useState<CornerKey | null>(null)
  const [imageRatio, setImageRatio] = useState(0.75)

  const move = (clientX: number, clientY: number, key: CornerKey) => {
    const frame = frameRef.current
    if (!frame) return
    const bounds = frame.getBoundingClientRect()
    const point: Point = {
      x: Math.max(0.01, Math.min(0.99, (clientX - bounds.left) / bounds.width)),
      y: Math.max(0.01, Math.min(0.99, (clientY - bounds.top) / bounds.height)),
    }
    onChange({ ...corners, [key]: point })
  }

  const points = orderedKeys.map(key => `${corners[key].x * 100},${corners[key].y * 100}`).join(' ')
  return <div className="corner-editor" ref={frameRef} style={{ aspectRatio: imageRatio, maxWidth: `min(100%, calc((100dvh - 220px) * ${imageRatio}))` }} onPointerMove={event => dragging && move(event.clientX, event.clientY, dragging)} onPointerUp={() => setDragging(null)} onPointerCancel={() => setDragging(null)}>
    <img src={imageUrl} alt="Original page with adjustable crop boundary" draggable={false} onLoad={event => setImageRatio(event.currentTarget.naturalWidth / event.currentTarget.naturalHeight)} />
    <svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true"><polygon points={points} /></svg>
    {orderedKeys.map(key => <button key={key} type="button" className={`corner-handle ${key}`} style={{ left: `${corners[key].x * 100}%`, top: `${corners[key].y * 100}%` }} aria-label={`Adjust ${key.replace(/([A-Z])/g, ' $1').toLowerCase()} corner`} onPointerDown={event => { event.currentTarget.setPointerCapture(event.pointerId); setDragging(key); move(event.clientX, event.clientY, key) }} />)}
  </div>
}
