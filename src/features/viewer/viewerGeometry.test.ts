import { describe, expect, it } from 'vitest'
import { boundPageView, focalPageView } from './viewerGeometry'

describe('page pan boundaries', () => {
  it('centres a page smaller than its viewport at any zoom', () => {
    expect(boundPageView({ scale: .5, x: 999, y: -999 }, { width: 300, height: 500 }, { width: 400, height: 700 })).toEqual({ scale: .5, x: 0, y: 0 })
  })
  it('prevents an enlarged page being dragged beyond its edges', () => {
    expect(boundPageView({ scale: 2, x: 9999, y: -9999 }, { width: 300, height: 500 }, { width: 400, height: 700 })).toEqual({ scale: 2, x: 100, y: -150 })
  })
  it('uses rotated page dimensions and resets offsets after zooming out', () => {
    expect(boundPageView({ scale: 2, x: -999, y: 999 }, { width: 300, height: 500 }, { width: 400, height: 700 }, 90)).toEqual({ scale: 2, x: -300, y: 0 })
  })
  it('keeps the touched point beneath a moving pinch centre', () => {
    expect(focalPageView({ scale: 1, x: 10, y: 20 }, 2, { x: 30, y: 40 }, { x: 50, y: 60 })).toEqual({ scale: 2, x: 10, y: 20 })
  })
})
