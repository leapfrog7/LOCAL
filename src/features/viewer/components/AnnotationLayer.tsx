import { useRef } from 'react'
import type { AnnotationPoint, AnnotationStroke, OCRWord } from '../../../domain/types'
import { annotationTextBounds, clampAnnotationPoint, eraseStrokeParts, findStrokeAt, isShapeAnnotation, snapHighlightToWords } from '../../../services/annotationService'

export type AnnotationMode = 'pan' | 'select' | 'pen' | 'highlighter' | 'eraser' | 'line' | 'arrow' | 'rectangle' | 'ellipse' | 'text'

interface AnnotationLayerProps {
  strokes: AnnotationStroke[]; visible: boolean; mode: AnnotationMode; color: string; width: number
  selectedId?: string; ocrWords?: OCRWord[]; snapHighlights?: boolean
  onSelect?: (id?: string) => void; onEditStart?: () => void; onTextRequest?: (point: AnnotationPoint) => void; onChange: (strokes: AnnotationStroke[]) => void
}

function RenderedAnnotation({ stroke, selected = false }: { stroke: AnnotationStroke; selected?: boolean }) {
  const className = selected ? 'annotation-selection' : undefined
  const opacity = stroke.tool === 'highlighter' ? .32 : 1
  const common = { className, fill: 'none', stroke: selected ? '#0b84ff' : stroke.color, strokeWidth: selected ? stroke.width + .012 : stroke.width, opacity, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const }
  const [start, end = start] = stroke.points
  if (!start) return null
  if (stroke.tool === 'text') {
    const box = annotationTextBounds(stroke)
    if (selected) return <rect {...common} x={box.x - .008} y={box.y - .006} width={box.width + .016} height={box.height + .012} rx=".008" />
    return <text x={start.x} y={start.y} fill={stroke.color} fontSize={stroke.fontSize ?? .03} fontWeight="600" dominantBaseline="hanging">{(stroke.text ?? '').split('\n').map((line, index) => <tspan key={index} x={start.x} dy={index ? '1.25em' : 0}>{line || ' '}</tspan>)}</text>
  }
  if (stroke.tool === 'rectangle') return <rect {...common} x={Math.min(start.x, end.x)} y={Math.min(start.y, end.y)} width={Math.abs(end.x - start.x)} height={Math.abs(end.y - start.y)} />
  if (stroke.tool === 'ellipse') return <ellipse {...common} cx={(start.x + end.x) / 2} cy={(start.y + end.y) / 2} rx={Math.abs(end.x - start.x) / 2} ry={Math.abs(end.y - start.y) / 2} />
  if (stroke.tool === 'arrow') {
    const angle = Math.atan2(end.y - start.y, end.x - start.x), size = Math.max(.018, stroke.width * 3.5)
    const points = `${end.x},${end.y} ${end.x - size * Math.cos(angle - Math.PI / 6)},${end.y - size * Math.sin(angle - Math.PI / 6)} ${end.x - size * Math.cos(angle + Math.PI / 6)},${end.y - size * Math.sin(angle + Math.PI / 6)}`
    return <g><line {...common} x1={start.x} y1={start.y} x2={end.x} y2={end.y} /><polygon className={className} points={points} fill={selected ? '#0b84ff' : stroke.color} opacity={opacity} /></g>
  }
  return <polyline {...common} points={stroke.points.map(point => `${point.x},${point.y}`).join(' ')} style={{ mixBlendMode: stroke.tool === 'highlighter' ? 'multiply' : 'normal' }} />
}

export function AnnotationLayer({ strokes, visible, mode, color, width, selectedId, ocrWords = [], snapHighlights = true, onSelect, onEditStart, onTextRequest, onChange }: AnnotationLayerProps) {
  const active = useRef<AnnotationStroke | null>(null)
  const drag = useRef<{ start: AnnotationPoint; stroke: AnnotationStroke } | null>(null)
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
    if (mode === 'select') {
      const id = findStrokeAt(source.current, point)
      onSelect?.(id)
      const stroke = source.current.find(item => item.id === id)
      if (stroke) { onEditStart?.(); drag.current = { start: point, stroke } }
      return
    }
    if (mode === 'eraser') { onChange(eraseStrokeParts(source.current, point)); return }
    if (mode === 'text') { onTextRequest?.(point); return }
    active.current = { id: crypto.randomUUID(), tool: mode, color, width, points: isShapeAnnotation({ id: '', tool: mode, color, width, points: [] }) ? [point, point] : [point] }
    onChange([...source.current, active.current])
  }
  const move = (event: React.PointerEvent<SVGSVGElement>) => {
    if (mode === 'pan' || !event.currentTarget.hasPointerCapture(event.pointerId)) return
    event.stopPropagation(); event.preventDefault()
    const point = coordinate(event)
    if (mode === 'select') {
      if (!drag.current) return
      const dx = point.x - drag.current.start.x, dy = point.y - drag.current.start.y
      const moved = { ...drag.current.stroke, points: drag.current.stroke.points.map(candidate => clampAnnotationPoint({ x: candidate.x + dx, y: candidate.y + dy })) }
      onChange(source.current.map(stroke => stroke.id === moved.id ? moved : stroke))
      return
    }
    if (mode === 'eraser') { onChange(eraseStrokeParts(source.current, point)); return }
    if (!active.current) return
    if (isShapeAnnotation(active.current)) {
      active.current = { ...active.current, points: [active.current.points[0], point] }
      onChange(source.current.map(stroke => stroke.id === active.current!.id ? active.current! : stroke))
      return
    }
    const previous = active.current.points.at(-1)!
    if (Math.hypot(point.x - previous.x, point.y - previous.y) < .002) return
    active.current = { ...active.current, points: [...active.current.points, point] }
    onChange(source.current.map(stroke => stroke.id === active.current!.id ? active.current! : stroke))
  }
  const up = (event: React.PointerEvent<SVGSVGElement>) => {
    if (mode === 'pan') return
    event.stopPropagation()
    if (active.current?.tool === 'highlighter' && snapHighlights) {
      const snapped = snapHighlightToWords(active.current, ocrWords)
      if (snapped.length !== 1 || snapped[0] !== active.current) onChange(source.current.flatMap(stroke => stroke.id === active.current!.id ? snapped : [stroke]))
    }
    if (active.current && isShapeAnnotation(active.current) && Math.hypot(active.current.points[1].x - active.current.points[0].x, active.current.points[1].y - active.current.points[0].y) < .008) onChange(source.current.filter(stroke => stroke.id !== active.current!.id))
    active.current = null; drag.current = null
  }
  const cancel = (event: React.PointerEvent<SVGSVGElement>) => {
    event.stopPropagation()
    if (active.current) onChange(source.current.filter(stroke => stroke.id !== active.current!.id))
    active.current = null; drag.current = null
  }
  if (!visible && mode === 'pan') return null
  return <svg className={`annotation-layer${mode === 'pan' ? '' : ' drawing'}${mode === 'select' ? ' selecting' : ''}`} viewBox="0 0 1 1" preserveAspectRatio="none" aria-label={mode === 'pan' ? 'Page annotations' : `${mode} annotation canvas`} onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={cancel}>
    {visible && strokes.map(stroke => <g key={stroke.id}>{stroke.id === selectedId ? <RenderedAnnotation stroke={stroke} selected /> : null}<RenderedAnnotation stroke={stroke} /></g>)}
  </svg>
}
