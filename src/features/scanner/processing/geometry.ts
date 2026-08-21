import type { PageCorners, Point } from '../../../domain/types'

const ordered = (corners: PageCorners) => [corners.topLeft, corners.topRight, corners.bottomRight, corners.bottomLeft]
const cross = (a: Point, b: Point, c: Point) => (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x)
const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y)

export function validateDocumentGeometry(corners: PageCorners) {
  const points = ordered(corners)
  const area = Math.abs(points.reduce((sum, point, index) => { const next = points[(index + 1) % points.length]; return sum + point.x * next.y - next.x * point.y }, 0) / 2)
  const turns = points.map((point, index) => cross(point, points[(index + 1) % 4], points[(index + 2) % 4]))
  const convex = turns.every(value => value >= 0) || turns.every(value => value <= 0)
  const width = (distance(points[0], points[1]) + distance(points[3], points[2])) / 2
  const height = (distance(points[0], points[3]) + distance(points[1], points[2])) / 2
  const aspectRatio = width / Math.max(height, .001)
  const plausibleAspect = aspectRatio > .38 && aspectRatio < 1.8
  const angles = points.map((point, index) => {
    const previous = points[(index + 3) % 4], next = points[(index + 1) % 4]
    const ax = previous.x - point.x, ay = previous.y - point.y, bx = next.x - point.x, by = next.y - point.y
    return Math.acos(Math.max(-1, Math.min(1, (ax * bx + ay * by) / Math.max(distance(previous, point) * distance(next, point), .0001)))) * 180 / Math.PI
  })
  const rectangularity = Math.max(0, 1 - angles.reduce((sum, angle) => sum + Math.abs(90 - angle), 0) / 180)
  return { valid: convex && area > .12 && plausibleAspect, area, convex, aspectRatio, angles, rectangularity }
}
