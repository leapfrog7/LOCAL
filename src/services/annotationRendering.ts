import type { AnnotationStroke } from '../domain/types'

export function drawAnnotations(context: CanvasRenderingContext2D, strokes: AnnotationStroke[], width: number, height: number) {
  context.save()
  context.lineCap = 'round'; context.lineJoin = 'round'
  for (const stroke of strokes) {
    if (!stroke.points.length) continue
    context.beginPath()
    context.strokeStyle = stroke.color
    context.globalAlpha = stroke.tool === 'highlighter' ? .32 : 1
    context.globalCompositeOperation = stroke.tool === 'highlighter' ? 'multiply' : 'source-over'
    context.lineWidth = Math.max(1, stroke.width * Math.min(width, height))
    context.moveTo(stroke.points[0].x * width, stroke.points[0].y * height)
    for (const point of stroke.points.slice(1)) context.lineTo(point.x * width, point.y * height)
    if (stroke.points.length === 1) context.lineTo(stroke.points[0].x * width + .01, stroke.points[0].y * height)
    context.stroke()
  }
  context.restore()
}
