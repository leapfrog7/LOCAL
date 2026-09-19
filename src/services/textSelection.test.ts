import { describe, expect, it } from 'vitest'
import type { VaultDocument } from '../domain/types'
import { pageIndexes, parseTextPageRange, selectedPageText } from './textSelection'

const source = { pages: [{ ocrText: 'First page' }, { ocrText: '' }, { ocrText: 'Third page' }] } as VaultDocument
describe('selected document text', () => {
  it('copies non-contiguous pages in document order with original page numbers', () => {
    expect(selectedPageText(source, [2, 0, 2])).toBe('Page 1\n\nFirst page\n\n---\n\nPage 3\n\nThird page')
  })
  it('keeps a visible demarcation for a page without OCR', () => {
    expect(selectedPageText(source, [1], 'md')).toBe('## Page 2\n\n[No searchable text found on this page]')
  })
  it('parses ranges, deduplicates overlaps and validates page bounds', () => {
    expect(parseTextPageRange('1, 3-5, 4', 5)).toEqual([0, 2, 3, 4])
    for (const value of ['0', '3-1', '1-6', 'hello', '1,']) expect(() => parseTextPageRange(value, 5)).toThrow()
    expect(pageIndexes([-1, 1, 1, 1.5, 3, NaN], 3)).toEqual([1])
  })
})
