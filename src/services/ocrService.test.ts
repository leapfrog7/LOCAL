import { describe, expect, it } from 'vitest'
import { normalizeNativeOcrResult } from './ocrService'

describe('ML Kit OCR result normalization', () => {
  it('normalizes confidence, languages and word boxes for LOCAL', () => {
    const result = normalizeNativeOcrResult({
      text: '  Invoice कुल  ', confidence: 103, languages: ['en', 'hi', 'en'],
      words: [
        { text: ' Invoice ', confidence: 98, boundingBox: { x: .1, y: .2, width: .3, height: .05 } },
        { text: 'कुल', confidence: -2, boundingBox: { x: .92, y: .3, width: .2, height: .08 } },
      ],
    })
    expect(result.text).toBe('Invoice कुल')
    expect(result.confidence).toBe(100)
    expect(result.languages).toEqual(['en', 'hi'])
    expect(result.words[0].text).toBe('Invoice')
    expect(result.words[1].confidence).toBe(0)
    expect(result.words[1].boundingBox.width).toBeCloseTo(.08)
  })
})
