import type { PageCorners, Point } from '../../../domain/types'
import { loadImage } from './imageUtils'

const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y)
export function projectiveMapper(topLeft: Point, topRight: Point, bottomRight: Point, bottomLeft: Point) {
  const dx1 = topRight.x - bottomRight.x, dx2 = bottomLeft.x - bottomRight.x, dx3 = topLeft.x - topRight.x + bottomRight.x - bottomLeft.x
  const dy1 = topRight.y - bottomRight.y, dy2 = bottomLeft.y - bottomRight.y, dy3 = topLeft.y - topRight.y + bottomRight.y - bottomLeft.y
  const denominator = dx1 * dy2 - dx2 * dy1
  const g = Math.abs(denominator) < .000001 ? 0 : (dx3 * dy2 - dx2 * dy3) / denominator
  const h = Math.abs(denominator) < .000001 ? 0 : (dx1 * dy3 - dx3 * dy1) / denominator
  const a = topRight.x - topLeft.x + g * topRight.x, b = bottomLeft.x - topLeft.x + h * bottomLeft.x, c = topLeft.x
  const d = topRight.y - topLeft.y + g * topRight.y, e = bottomLeft.y - topLeft.y + h * bottomLeft.y, f = topLeft.y
  return (u: number, v: number): Point => { const scale = g * u + h * v + 1; return { x: (a * u + b * v + c) / scale, y: (d * u + e * v + f) / scale } }
}

function drawTriangle(context: CanvasRenderingContext2D, image: HTMLImageElement, source: Point[], target: Point[]) {
  const [s0, s1, s2] = source, [d0, d1, d2] = target
  const denominator = s0.x * (s2.y - s1.y) + s1.x * (s0.y - s2.y) + s2.x * (s1.y - s0.y)
  if (Math.abs(denominator) < 0.001) return
  const a = (d0.x * (s2.y - s1.y) + d1.x * (s0.y - s2.y) + d2.x * (s1.y - s0.y)) / denominator
  const b = (d0.y * (s2.y - s1.y) + d1.y * (s0.y - s2.y) + d2.y * (s1.y - s0.y)) / denominator
  const c = (d0.x * (s1.x - s2.x) + d1.x * (s2.x - s0.x) + d2.x * (s0.x - s1.x)) / denominator
  const d = (d0.y * (s1.x - s2.x) + d1.y * (s2.x - s0.x) + d2.y * (s0.x - s1.x)) / denominator
  const e = (d0.x * (s2.x * s1.y - s1.x * s2.y) + d1.x * (s0.x * s2.y - s2.x * s0.y) + d2.x * (s1.x * s0.y - s0.x * s1.y)) / denominator
  const f = (d0.y * (s2.x * s1.y - s1.x * s2.y) + d1.y * (s0.x * s2.y - s2.x * s0.y) + d2.y * (s1.x * s0.y - s0.x * s1.y)) / denominator
  const center = { x: (d0.x + d1.x + d2.x) / 3, y: (d0.y + d1.y + d2.y) / 3 }
  const expand = (point: Point) => { const length = Math.hypot(point.x - center.x, point.y - center.y) || 1; return { x: center.x + (point.x - center.x) * (length + 1.25) / length, y: center.y + (point.y - center.y) * (length + 1.25) / length } }
  const [c0, c1, c2] = target.map(expand)
  context.save()
  context.beginPath(); context.moveTo(c0.x, c0.y); context.lineTo(c1.x, c1.y); context.lineTo(c2.x, c2.y); context.closePath(); context.clip()
  context.setTransform(a, b, c, d, e, f); context.drawImage(image, 0, 0); context.restore()
}

export async function correctPerspective(imageSource: string, corners: PageCorners, maxDimension = 1800) {
  const image = await loadImage(imageSource)
  const points = {
    topLeft: { x: corners.topLeft.x * image.naturalWidth, y: corners.topLeft.y * image.naturalHeight },
    topRight: { x: corners.topRight.x * image.naturalWidth, y: corners.topRight.y * image.naturalHeight },
    bottomRight: { x: corners.bottomRight.x * image.naturalWidth, y: corners.bottomRight.y * image.naturalHeight },
    bottomLeft: { x: corners.bottomLeft.x * image.naturalWidth, y: corners.bottomLeft.y * image.naturalHeight },
  }
  const rawWidth = Math.max(distance(points.topLeft, points.topRight), distance(points.bottomLeft, points.bottomRight))
  const rawHeight = Math.max(distance(points.topLeft, points.bottomLeft), distance(points.topRight, points.bottomRight))
  const scale = Math.min(1, maxDimension / Math.max(rawWidth, rawHeight))
  const width = Math.max(320, Math.round(rawWidth * scale)), height = Math.max(320, Math.round(rawHeight * scale))
  const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height
  const context = canvas.getContext('2d'); if (!context) throw new Error('Perspective correction is unavailable.')
  const sourceAt = projectiveMapper(points.topLeft, points.topRight, points.bottomRight, points.bottomLeft)
  const steps = Math.max(16, Math.min(32, Math.ceil(Math.max(width, height) / 80)))
  for (let row = 0; row < steps; row += 1) for (let column = 0; column < steps; column += 1) {
    const u0 = column / steps, u1 = (column + 1) / steps, v0 = row / steps, v1 = (row + 1) / steps
    const s00 = sourceAt(u0, v0), s10 = sourceAt(u1, v0), s11 = sourceAt(u1, v1), s01 = sourceAt(u0, v1)
    const d00 = { x: u0 * width, y: v0 * height }, d10 = { x: u1 * width, y: v0 * height }, d11 = { x: u1 * width, y: v1 * height }, d01 = { x: u0 * width, y: v1 * height }
    drawTriangle(context, image, [s00, s10, s11], [d00, d10, d11]); drawTriangle(context, image, [s00, s11, s01], [d00, d11, d01])
  }
  return canvas
}
