import { describe, expect, it } from 'vitest'
import { cornerMovement, estimateBrightness, estimateSharpness, isAutoCaptureReady, needsAutoFlash, supportsTorchCapability, viewportPointToCameraPoint } from './cameraQuality'

const pixels = (width: number, height: number, valueAt: (x: number, y: number) => number) => {
  const data = new Uint8ClampedArray(width * height * 4)
  for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) {
    const index = (y * width + x) * 4
    data[index] = data[index + 1] = data[index + 2] = valueAt(x, y)
    data[index + 3] = 255
  }
  return data
}

describe('camera quality helpers', () => {
  it('maps an object-cover viewport tap back to normalized camera coordinates', () => {
    expect(viewportPointToCameraPoint({ x: 500, y: 250 }, { width: 1000, height: 500 }, { width: 1000, height: 1000 })).toEqual({ x: .5, y: .5 })
    expect(viewportPointToCameraPoint({ x: 0, y: 250 }, { width: 1000, height: 500 }, { width: 1000, height: 1000 })).toEqual({ x: 0, y: .5 })
  })

  it('scores hard edges above a flat frame', () => {
    const flat = pixels(20, 20, () => 180)
    const checker = pixels(20, 20, (x, y) => (x + y) % 2 ? 255 : 0)
    expect(estimateSharpness(checker, 20, 20)).toBeGreaterThan(estimateSharpness(flat, 20, 20))
  })

  it('detects when the preview is dark enough to need automatic flash', () => {
    expect(estimateBrightness(pixels(20, 20, () => 30))).toBeCloseTo(30)
    expect(estimateBrightness(pixels(20, 20, () => 180))).toBeCloseTo(180)
    expect(needsAutoFlash(45)).toBe(true)
    expect(needsAutoFlash(120)).toBe(false)
  })

  it('recognises Android WebView torch capabilities in boolean and legacy array forms', () => {
    expect(supportsTorchCapability(true)).toBe(true)
    expect(supportsTorchCapability([false, true])).toBe(true)
    expect(supportsTorchCapability(false)).toBe(false)
    expect(supportsTorchCapability(undefined)).toBe(false)
  })

  it('measures average normalized corner movement', () => {
    const first = { topLeft: { x: .1, y: .1 }, topRight: { x: .9, y: .1 }, bottomRight: { x: .9, y: .9 }, bottomLeft: { x: .1, y: .9 } }
    const next = { topLeft: { x: .12, y: .1 }, topRight: { x: .92, y: .1 }, bottomRight: { x: .92, y: .9 }, bottomLeft: { x: .12, y: .9 } }
    expect(cornerMovement(first, next)).toBeCloseTo(.02)
  })

  it('only arms automatic capture for sharp, confident, steady frames', () => {
    const stable = { enabled: true, armed: true, confidence: .8, movement: .012, sharpness: 4.2 }
    expect(isAutoCaptureReady(stable)).toBe(true)
    expect(isAutoCaptureReady({ ...stable, movement: 0 })).toBe(true)
    expect(isAutoCaptureReady({ ...stable, confidence: .7 })).toBe(false)
    expect(isAutoCaptureReady({ ...stable, movement: .04 })).toBe(false)
    expect(isAutoCaptureReady({ ...stable, sharpness: 2.8 })).toBe(false)
    expect(isAutoCaptureReady({ ...stable, armed: false })).toBe(false)
  })
})
