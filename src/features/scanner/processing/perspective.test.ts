import { describe, expect, it } from 'vitest'
import { projectiveMapper } from './perspective'

describe('projective mapping', () => {
  it('maps every output corner exactly onto the selected source corner', () => {
    const corners = [{ x: 12, y: 8 }, { x: 190, y: 24 }, { x: 172, y: 258 }, { x: 3, y: 221 }] as const
    const map = projectiveMapper(...corners)
    for (const [u, v, expected] of [[0, 0, corners[0]], [1, 0, corners[1]], [1, 1, corners[2]], [0, 1, corners[3]]] as const) {
      expect(map(u, v).x).toBeCloseTo(expected.x, 8)
      expect(map(u, v).y).toBeCloseTo(expected.y, 8)
    }
  })
})
