import type { AnnotationStroke } from '../domain/types'

export function drawAnnotations(context: CanvasRenderingContext2D, strokes: AnnotationStroke[], width: number, height: number) {
  context.save()
  context.lineCap = 'round'; context.lineJoin = 'round'
  for (const stroke of strokes) {
    if (!stroke.points.length) continue
    const [start, end = start] = stroke.points
    if (stroke.tool === 'text') {
      context.globalAlpha = 1; context.globalCompositeOperation = 'source-over'; context.fillStyle = stroke.color
      const fontSize = Math.max(10, (stroke.fontSize ?? .03) * height)
      context.font = `600 ${fontSize}px Manrope, sans-serif`; context.textBaseline = 'top'
      for (const [index, line] of (stroke.text ?? '').split('\n').entries()) context.fillText(line, start.x * width, start.y * height + index * fontSize * 1.25)
      continue
    }
    context.beginPath()
    context.strokeStyle = stroke.color
    context.globalAlpha = stroke.tool === 'highlighter' ? .32 : 1
    context.globalCompositeOperation = stroke.tool === 'highlighter' ? 'multiply' : 'source-over'
    context.lineWidth = Math.max(1, stroke.width * Math.min(width, height))
    if (stroke.tool === 'rectangle') context.rect(Math.min(start.x, end.x) * width, Math.min(start.y, end.y) * height, Math.abs(end.x - start.x) * width, Math.abs(end.y - start.y) * height)
    else if (stroke.tool === 'ellipse') context.ellipse((start.x + end.x) / 2 * width, (start.y + end.y) / 2 * height, Math.abs(end.x - start.x) / 2 * width, Math.abs(end.y - start.y) / 2 * height, 0, 0, Math.PI * 2)
    else {
      context.moveTo(start.x * width, start.y * height)
      for (const point of stroke.points.slice(1)) context.lineTo(point.x * width, point.y * height)
    }
    if (stroke.points.length === 1) context.lineTo(stroke.points[0].x * width + .01, stroke.points[0].y * height)
    context.stroke()
    if (stroke.tool === 'arrow') {
      const angle = Math.atan2((end.y - start.y) * height, (end.x - start.x) * width), size = Math.max(8, context.lineWidth * 4)
      context.beginPath(); context.moveTo(end.x * width, end.y * height)
      context.lineTo(end.x * width - size * Math.cos(angle - Math.PI / 6), end.y * height - size * Math.sin(angle - Math.PI / 6))
      context.lineTo(end.x * width - size * Math.cos(angle + Math.PI / 6), end.y * height - size * Math.sin(angle + Math.PI / 6))
      context.closePath(); context.fillStyle = stroke.color; context.fill()
    }
  }
  context.restore()
}
