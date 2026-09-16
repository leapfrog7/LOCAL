import { describe, expect, it } from 'vitest'
import { fitPageWithin } from './ZoomablePage'

describe('fitPageWithin', () => {
  it('fits a portrait page entirely inside a landscape canvas', () => {
    expect(fitPageWithin(1200, 2000, 1400, 700, 0)).toEqual({ width: 420, height: 700 })
  })

  it('fits a landscape page without cropping', () => {
    expect(fitPageWithin(2000, 1200, 900, 700, 0)).toEqual({ width: 900, height: 540 })
  })

  it('uses the rotated bounds for quarter-turn pages', () => {
    expect(fitPageWithin(1200, 2000, 900, 700, 90)).toEqual({ width: 540, height: 900 })
    expect(fitPageWithin(1200, 2000, 900, 700, 270)).toEqual({ width: 540, height: 900 })
  })

  it('returns an empty size until both source and canvas are measurable', () => {
    expect(fitPageWithin(0, 2000, 900, 700, 0)).toEqual({ width: 0, height: 0 })
  })
})
