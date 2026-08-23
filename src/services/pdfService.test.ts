import { describe, expect, it } from 'vitest'
import { addOcrTextLayer, rotatedBox } from './pdfService'

describe('searchable PDF word placement', () => {
  it('maps normalized OCR boxes through page rotation', () => {
    const clockwise = rotatedBox({ x: .1, y: .2, width: .3, height: .1 }, 90)
    expect(clockwise.x).toBeCloseTo(.7); expect(clockwise.y).toBeCloseTo(.1); expect(clockwise.width).toBeCloseTo(.1); expect(clockwise.height).toBeCloseTo(.3)
    const upsideDown = rotatedBox({ x: .1, y: .2, width: .3, height: .1 }, 180)
    expect(upsideDown.x).toBeCloseTo(.6); expect(upsideDown.y).toBeCloseTo(.7)
  })
  it('writes each OCR word using invisible PDF text rendering', () => {
    const calls: unknown[][] = [], pdf = { setFontSize: () => undefined, text: (...args: unknown[]) => calls.push(args), splitTextToSize: () => [] }
    addOcrTextLayer(pdf, { id: 'p', imageUrl: '', rotation: 0, ocrText: 'Department', ocrState: 'complete', ocrWords: [{ text: 'Department', confidence: 91, boundingBox: { x: .1, y: .2, width: .2, height: .04 } }] }, 1000, 1400)
    expect(calls[0][0]).toBe('Department')
    expect(calls[0][3]).toMatchObject({ renderingMode: 'invisible' })
  })
})
