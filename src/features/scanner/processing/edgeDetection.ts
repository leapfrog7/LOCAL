import type { PageCorners, Point } from '../../../domain/types'
import type { DetectionResult } from '../scannerTypes'
import { createWorkingCanvas, loadImage } from './imageUtils'
import { validateDocumentGeometry } from './geometry'

const fallbackCorners: PageCorners = { topLeft: { x: .06, y: .05 }, topRight: { x: .94, y: .05 }, bottomRight: { x: .94, y: .95 }, bottomLeft: { x: .06, y: .95 } }
const luminance = (data: Uint8ClampedArray, pixel: number) => data[pixel * 4] * .299 + data[pixel * 4 + 1] * .587 + data[pixel * 4 + 2] * .114

function smoothGray(data: Uint8ClampedArray, width: number, height: number) {
  const gray = new Float32Array(width * height), blurred = new Float32Array(width * height)
  for (let i = 0; i < gray.length; i += 1) gray[i] = luminance(data, i)
  for (let y = 2; y < height - 2; y += 1) for (let x = 2; x < width - 2; x += 1) {
    let sum = 0
    for (let dy = -2; dy <= 2; dy += 1) for (let dx = -2; dx <= 2; dx += 1) sum += gray[(y + dy) * width + x + dx]
    blurred[y * width + x] = sum / 25
  }
  return blurred
}

function createEdges(gray: Float32Array, width: number, height: number) {
  const edges = new Float32Array(width * height), values: number[] = []
  for (let y = 2; y < height - 2; y += 1) for (let x = 2; x < width - 2; x += 1) {
    const i = y * width + x, strength = Math.hypot(gray[i + 1] - gray[i - 1], gray[i + width] - gray[i - width])
    edges[i] = strength; if (!(x % 2) && !(y % 2)) values.push(strength)
  }
  values.sort((a, b) => a - b)
  return { edges, threshold: Math.max(12, values[Math.floor(values.length * .82)] || 12) }
}

function extreme(points: Point[], score: (point: Point) => number, largest: boolean) {
  return points.reduce((best, point) => (largest ? score(point) > score(best) : score(point) < score(best)) ? point : best)
}

interface Line { slope: number; intercept: number; support: number }
function regression(samples: { independent: number; dependent: number; weight: number }[]): Line | null {
  if (samples.length < 12) return null
  let weight = 0, x = 0, y = 0
  for (const sample of samples) { weight += sample.weight; x += sample.independent * sample.weight; y += sample.dependent * sample.weight }
  x /= weight; y /= weight
  let numerator = 0, denominator = 0
  for (const sample of samples) { numerator += sample.weight * (sample.independent - x) * (sample.dependent - y); denominator += sample.weight * (sample.independent - x) ** 2 }
  const slope = denominator ? numerator / denominator : 0
  return { slope, intercept: y - slope * x, support: Math.min(1, samples.length / 80) }
}

function intersection(vertical: Line, horizontal: Line): Point {
  const denominator = 1 - vertical.slope * horizontal.slope
  const x = (vertical.slope * horizontal.intercept + vertical.intercept) / (Math.abs(denominator) < .0001 ? .0001 : denominator)
  return { x, y: horizontal.slope * x + horizontal.intercept }
}

export function fitDocumentBoundary(edges: Float32Array, width: number, height: number, threshold: number, inset = .03): PageCorners | null {
  const left: { independent: number; dependent: number; weight: number }[] = [], right: typeof left = [], top: typeof left = [], bottom: typeof left = []
  const xStart = Math.round(width * inset), xEnd = Math.round(width * (1 - inset)), yStart = Math.round(height * inset), yEnd = Math.round(height * (1 - inset))
  for (let y = yStart; y < yEnd; y += 2) {
    let lx = xStart, rx = xEnd - 1, ls = 0, rs = 0
    for (let x = xStart; x < width * .48; x += 2) if (edges[y * width + x] > ls) { ls = edges[y * width + x]; lx = x }
    for (let x = Math.round(width * .52); x < xEnd; x += 2) if (edges[y * width + x] > rs) { rs = edges[y * width + x]; rx = x }
    if (ls >= threshold) left.push({ independent: y / height, dependent: lx / width, weight: Math.min(3, ls / threshold) })
    if (rs >= threshold) right.push({ independent: y / height, dependent: rx / width, weight: Math.min(3, rs / threshold) })
  }
  for (let x = xStart; x < xEnd; x += 2) {
    let ty = yStart, by = yEnd - 1, ts = 0, bs = 0
    for (let y = yStart; y < height * .48; y += 2) if (edges[y * width + x] > ts) { ts = edges[y * width + x]; ty = y }
    for (let y = Math.round(height * .52); y < yEnd; y += 2) if (edges[y * width + x] > bs) { bs = edges[y * width + x]; by = y }
    if (ts >= threshold) top.push({ independent: x / width, dependent: ty / height, weight: Math.min(3, ts / threshold) })
    if (bs >= threshold) bottom.push({ independent: x / width, dependent: by / height, weight: Math.min(3, bs / threshold) })
  }
  const leftLine = regression(left), rightLine = regression(right), topLine = regression(top), bottomLine = regression(bottom)
  if (!leftLine || !rightLine || !topLine || !bottomLine) return null
  return { topLeft: intersection(leftLine, topLine), topRight: intersection(rightLine, topLine), bottomRight: intersection(rightLine, bottomLine), bottomLeft: intersection(leftLine, bottomLine) }
}

function scoreCandidate(corners: PageCorners, edges: Float32Array, width: number, height: number, threshold: number) {
  const geometry = validateDocumentGeometry(corners)
  if (!geometry.valid) return null
  const ordered = [corners.topLeft, corners.topRight, corners.bottomRight, corners.bottomLeft]
  let strong = 0, samples = 0
  for (let side = 0; side < 4; side += 1) for (let step = 0; step <= 80; step += 1) {
    const amount = step / 80, a = ordered[side], b = ordered[(side + 1) % 4]
    const x = Math.max(1, Math.min(width - 2, Math.round((a.x + (b.x - a.x) * amount) * width)))
    const y = Math.max(1, Math.min(height - 2, Math.round((a.y + (b.y - a.y) * amount) * height)))
    let local = 0
    for (let dy = -1; dy <= 1; dy += 1) for (let dx = -1; dx <= 1; dx += 1) local = Math.max(local, edges[(y + dy) * width + x + dx])
    strong += Math.min(1, local / Math.max(threshold, 1)); samples += 1
  }
  const edgeStrength = strong / samples, areaScore = Math.max(0, 1 - Math.abs(geometry.area - .62) / .62)
  const ratioScore = geometry.aspectRatio > .48 && geometry.aspectRatio < 1.55 ? 1 : .55
  const borderDistance = Math.min(...ordered.flatMap(point => [point.x, point.y, 1 - point.x, 1 - point.y]))
  const borderPenalty = borderDistance < .012 ? .3 : borderDistance < .025 ? .12 : 0
  const score = edgeStrength * .4 + geometry.rectangularity * .23 + areaScore * .22 + ratioScore * .15 - borderPenalty
  return { score, edgeStrength, rectangularity: geometry.rectangularity, areaRatio: geometry.area, borderPenalty }
}

export async function detectDocument(imageSource: string): Promise<DetectionResult> {
  const image = await loadImage(imageSource), { canvas, context } = createWorkingCanvas(image, 720)
  const gray = smoothGray(context.getImageData(0, 0, canvas.width, canvas.height).data, canvas.width, canvas.height)
  const { edges, threshold } = createEdges(gray, canvas.width, canvas.height), points: Point[] = []
  for (let y = 3; y < canvas.height - 3; y += 2) for (let x = 3; x < canvas.width - 3; x += 2) if (edges[y * canvas.width + x] >= threshold) points.push({ x: x / canvas.width, y: y / canvas.height })
  if (points.length < 80) return { corners: fallbackCorners, confidence: .2 }
  const candidates: PageCorners[] = []
  for (const inset of [0, .03, .07, .12]) {
    const usable = points.filter(point => point.x > inset && point.y > inset && point.x < 1 - inset && point.y < 1 - inset)
    if (usable.length < 20) continue
    candidates.push({ topLeft: extreme(usable, p => p.x + p.y, false), topRight: extreme(usable, p => p.x - p.y, true), bottomRight: extreme(usable, p => p.x + p.y, true), bottomLeft: extreme(usable, p => p.x - p.y, false) })
    const fitted = fitDocumentBoundary(edges, canvas.width, canvas.height, threshold, inset)
    if (fitted) candidates.push(fitted)
  }
  const scored = candidates.map(corners => ({ corners, metrics: scoreCandidate(corners, edges, canvas.width, canvas.height, threshold) })).filter(item => item.metrics).sort((a, b) => b.metrics!.score - a.metrics!.score)
  const best = scored[0]
  if (!best?.metrics || best.metrics.score < .32) return { corners: fallbackCorners, confidence: .25 }
  return { corners: best.corners, confidence: Math.max(.3, Math.min(.94, best.metrics.score)), diagnostics: best.metrics }
}

export const defaultCorners = fallbackCorners
