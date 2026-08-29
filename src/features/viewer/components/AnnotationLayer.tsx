import { useRef } from 'react'
import type { AnnotationPoint, AnnotationStroke } from '../../../domain/types'
import { clampAnnotationPoint, eraseStrokeAt } from '../../../services/annotationService'

export type AnnotationMode = 'pan' | 'pen' | 'highlighter' | 'eraser'

export function AnnotationLayer({ strokes, visible, mode, color, width, onChange }: { strokes: AnnotationStroke[]; visible: boolean; mode: AnnotationMode; color: string; width: number; onChange: (strokes: AnnotationStroke[]) => void }) {
  const active = useRef<AnnotationStroke | null>(null)
  const source = useRef(strokes); source.current = strokes
  const coordinate = (event: React.PointerEvent<SVGSVGElement>): AnnotationPoint => {
    const matrix = event.currentTarget.getScreenCTM()
    if (!matrix) return { x: 0, y: 0 }
    const point = new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix.inverse())
    return clampAnnotationPoint({ x: point.x, y: point.y })
  }
  const down = (event: React.PointerEvent<SVGSVGElement>) => {
    if (mode === 'pan') return
    event.stopPropagation(); event.preventDefault(); event.currentTarget.setPointerCapture(event.pointerId)
    const point = coordinate(event)
    if (mode === 'eraser') { onChange(eraseStrokeAt(source.current, point)); return }
    active.current = { id: crypto.randomUUID(), tool: mode, color, width, points: [point] }
    onChange([...source.current, active.current])
  }
  const move = (event: React.PointerEvent<SVGSVGElement>) => {
    if (mode === 'pan' || !event.currentTarget.hasPointerCapture(event.pointerId)) return
    event.stopPropagation(); event.preventDefault()
    const point = coordinate(event)
    if (mode === 'eraser') { onChange(eraseStrokeAt(source.current, point)); return }
    if (!active.current) return
    const previous = active.current.points.at(-1)!
    if (Math.hypot(point.x - previous.x, point.y - previous.y) < .002) return
    active.current = { ...active.current, points: [...active.current.points, point] }
    onChange(source.current.map(stroke => stroke.id === active.current!.id ? active.current! : stroke))
  }
  const up = (event: React.PointerEvent<SVGSVGElement>) => { if (mode !== 'pan') { event.stopPropagation(); active.current = null } }
  if (!visible && mode === 'pan') return null
  return <svg className={`annotation-layer${mode === 'pan' ? '' : ' drawing'}`} viewBox="0 0 1 1" preserveAspectRatio="none" aria-label={mode === 'pan' ? 'Page annotations' : `${mode} annotation canvas`} onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up}>
    {visible && strokes.map(stroke => <polyline key={stroke.id} points={stroke.points.map(point => `${point.x},${point.y}`).join(' ')} fill="none" stroke={stroke.color} strokeWidth={stroke.width} strokeLinecap="round" strokeLinejoin="round" opacity={stroke.tool === 'highlighter' ? .32 : 1} style={{ mixBlendMode: stroke.tool === 'highlighter' ? 'multiply' : 'normal' }} />)}
  </svg>
}
