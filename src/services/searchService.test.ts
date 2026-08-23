import { describe, expect, it } from 'vitest'
import type { VaultDocument } from '../domain/types'
import { matchesAdvancedQuery, matchesSmartFilter, pageMatches, parseAdvancedQuery, resultScore } from './searchService'

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

  it('returns each phrase occurrence with positional word indexes', () => {
    const source = document(['sanction of expenditure and later sanction of expenditure'])
    source.pages[0].ocrWords = source.pages[0].ocrText.split(' ').map((text, index) => ({ text, confidence: 90, boundingBox: { x: index / 10, y: .2, width: .08, height: .04 } }))
    const matches = pageMatches(source, 'sanction of expenditure')
    expect(matches).toHaveLength(2)
    expect(matches[0].wordIndexes).toEqual([0, 1, 2])
    expect(matches[1].wordIndexes).toEqual([5, 6, 7])
  })

  it('filters using locally extracted document metadata', () => {
    const source = document(['amount due'])
    source.smartMetadata = { documentType: 'electricity_bill', documentDate: '2026-08-12' }
    expect(matchesSmartFilter(source, 'bills')).toBe(true)
    expect(matchesSmartFilter(source, 'receipts')).toBe(false)
    expect(matchesSmartFilter(source, 'this_month', new Date('2026-08-22'))).toBe(true)
  })

  it('ranks a title match above a body-only match', () => {
    const titleMatch = document(['other text']); titleMatch.title = 'Amazon invoice'
    const bodyMatch = document(['Amazon invoice'])
    expect(resultScore(titleMatch, 'Amazon invoice', [])).toBeGreaterThan(resultScore(bodyMatch, 'Amazon invoice', pageMatches(bodyMatch, 'Amazon invoice')))
  })

  it('parses quoted advanced filters and leaves ordinary search text', () => {
    expect(parseAdvancedQuery('electricity folder:"House bills" amount:>=5000 after:2026-01')).toEqual({ text: 'electricity', folder: 'House bills', amount: { operator: '>=', value: 5000 }, after: '2026-01' })
  })

  it('matches local metadata, tags, privacy, dates and amounts', () => {
    const source = document(['paid invoice'])
    source.folder = 'Tax records'; source.tags = ['FY 2026']; source.isPrivate = true
    source.smartMetadata = { documentType: 'invoice', organization: 'Acme India', documentDate: '2026-04-18', amount: { value: 7500, currency: 'INR', display: '₹7,500' } }
    expect(matchesAdvancedQuery(source, parseAdvancedQuery('folder:tax tag:"FY 2026" type:invoice org:acme private:true after:2026-04 amount:>7000'))).toBe(true)
    expect(matchesAdvancedQuery(source, parseAdvancedQuery('amount:<7000'))).toBe(false)
  })
})
