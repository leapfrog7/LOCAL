import { describe, expect, it } from 'vitest'
import { validateDocumentGeometry } from './geometry'

describe('document geometry scoring', () => {
  it('accepts a plausible perspective-skewed page', () => {
    const result = validateDocumentGeometry({ topLeft: { x: .14, y: .08 }, topRight: { x: .83, y: .13 }, bottomRight: { x: .9, y: .91 }, bottomLeft: { x: .08, y: .87 } })
    expect(result.valid).toBe(true)
    expect(result.area).toBeGreaterThan(.5)
    expect(result.rectangularity).toBeGreaterThan(.7)
  })

  it('rejects a crossed or tiny crop', () => {
    expect(validateDocumentGeometry({ topLeft: { x: .1, y: .1 }, topRight: { x: .2, y: .2 }, bottomRight: { x: .1, y: .2 }, bottomLeft: { x: .2, y: .1 } }).valid).toBe(false)
  })
})
