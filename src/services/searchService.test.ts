import { describe, expect, it } from 'vitest'
import type { VaultDocument } from '../domain/types'
import { pageMatches } from './searchService'

const document = (texts: string[]): VaultDocument => ({
  id: 'doc', title: 'Example', folder: 'Office', createdAt: '2026-01-01', updatedAt: '2026-01-01', status: 'indexed', tags: [],
  pages: texts.map((ocrText, index) => ({ id: String(index), imageUrl: '', rotation: 0, ocrText, ocrState: 'complete' })),
})

describe('pageMatches', () => {
  it('returns the matching page and a compact snippet', () => {
    const matches = pageMatches(document(['unrelated page', `prefix ${'word '.repeat(20)}invoice total 4500 due now`]), 'invoice 4500')
    expect(matches).toHaveLength(1)
    expect(matches[0].pageIndex).toBe(1)
    expect(matches[0].snippet).toContain('invoice total 4500')
  })

  it('requires every search term on the same page', () => {
    expect(pageMatches(document(['invoice only', 'total only']), 'invoice total')).toEqual([])
  })
})
