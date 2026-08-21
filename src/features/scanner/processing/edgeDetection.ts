import type { PageCorners } from '../../../domain/types'
import type { DetectionResult } from '../scannerTypes'
import { createWorkingCanvas, loadImage } from './imageUtils'
import { validateDocumentGeometry } from './geometry'

const fallbackCorners: PageCorners = {
  topLeft: { x: 0.06, y: 0.05 }, topRight: { x: 0.94, y: 0.05 },
  bottomRight: { x: 0.94, y: 0.95 }, bottomLeft: { x: 0.06, y: 0.95 },
}

function strongestBoundary(scores: number[], fromStart: boolean) {
  const start = Math.floor(scores.length * 0.025)
  const end = Math.floor(scores.length * 0.4)
  let bestIndex = fromStart ? start : scores.length - start - 1
  let bestScore = -1
  for (let offset = start; offset < end; offset += 1) {
    const index = fromStart ? offset : scores.length - offset - 1
    if (scores[index] > bestScore) { bestScore = scores[index]; bestIndex = index }
  }
  return { index: bestIndex, score: bestScore }
}

export async function detectDocument(imageSource: string): Promise<DetectionResult> {
  const image = await loadImage(imageSource)
  const { canvas, context } = createWorkingCanvas(image, 640)
  const { data } = context.getImageData(0, 0, canvas.width, canvas.height)
  const vertical = new Array(canvas.width).fill(0)
  const horizontal = new Array(canvas.height).fill(0)
  const luminance = (index: number) => data[index] * 0.299 + data[index + 1] * 0.587 + data[index + 2] * 0.114

  for (let y = 2; y < canvas.height - 2; y += 3) {
    for (let x = 2; x < canvas.width - 2; x += 3) {
      const index = (y * canvas.width + x) * 4
      vertical[x] += Math.abs(luminance(index + 4) - luminance(index - 4))
      horizontal[y] += Math.abs(luminance(index + canvas.width * 4) - luminance(index - canvas.width * 4))
    }
  }
  const left = strongestBoundary(vertical, true)
  const right = strongestBoundary(vertical, false)
  const top = strongestBoundary(horizontal, true)
  const bottom = strongestBoundary(horizontal, false)
  const valid = right.index - left.index > canvas.width * 0.45 && bottom.index - top.index > canvas.height * 0.45
  if (!valid) return { corners: fallbackCorners, confidence: 0.25 }

  const mean = [...vertical, ...horizontal].reduce((sum, value) => sum + value, 0) / (vertical.length + horizontal.length)
  const strength = (left.score + right.score + top.score + bottom.score) / 4
  const confidence = Math.max(0.35, Math.min(0.88, strength / Math.max(mean * 5, 1)))
  const x1 = left.index / canvas.width, x2 = right.index / canvas.width
  const y1 = top.index / canvas.height, y2 = bottom.index / canvas.height
  const corners = { topLeft: { x: x1, y: y1 }, topRight: { x: x2, y: y1 }, bottomRight: { x: x2, y: y2 }, bottomLeft: { x: x1, y: y2 } }
  const geometry = validateDocumentGeometry(corners)
  return geometry.valid ? { corners, confidence: confidence * Math.min(1, geometry.area / .55) } : { corners: fallbackCorners, confidence: 0.3 }
}

export const defaultCorners = fallbackCorners
