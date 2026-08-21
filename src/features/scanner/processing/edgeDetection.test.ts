import { describe, expect, it } from 'vitest'
import { fitDocumentBoundary } from './edgeDetection'

function drawLine(edges: Float32Array, width: number, height: number, from: [number, number], to: [number, number]) {
  const steps = Math.ceil(Math.hypot(to[0] - from[0], to[1] - from[1]))
  for (let step = 0; step <= steps; step += 1) {
    const x = Math.round(from[0] + (to[0] - from[0]) * step / steps), y = Math.round(from[1] + (to[1] - from[1]) * step / steps)
    for (let dy = -1; dy <= 1; dy += 1) for (let dx = -1; dx <= 1; dx += 1) if (x + dx >= 0 && x + dx < width && y + dy >= 0 && y + dy < height) edges[(y + dy) * width + x + dx] = 80
  }
}

describe('fitted document boundary', () => {
  it('recovers a perspective-skewed quadrilateral from its edge map', () => {
    const width = 200, height = 260, edges = new Float32Array(width * height)
    const points: [number, number][] = [[30, 20], [170, 30], [180, 235], [20, 225]]
    for (let side = 0; side < 4; side += 1) drawLine(edges, width, height, points[side], points[(side + 1) % 4])
    const result = fitDocumentBoundary(edges, width, height, 20)
    expect(result).not.toBeNull()
    expect(result!.topLeft.x).toBeCloseTo(.15, 1)
    expect(result!.topLeft.y).toBeCloseTo(.08, 1)
    expect(result!.bottomRight.x).toBeCloseTo(.9, 1)
    expect(result!.bottomRight.y).toBeCloseTo(.9, 1)
  })
})
