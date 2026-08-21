import type { VaultDocument } from '../domain/types'
import { documentsRepository } from './documentRepository'

export interface PageSearchMatch { pageIndex: number; snippet: string }
export interface DocumentSearchResult { document: VaultDocument; pageMatches: PageSearchMatch[] }

const normalise = (value: string) => value.replace(/\s+/g, ' ').trim()

export function pageMatches(document: VaultDocument, query: string): PageSearchMatch[] {
  const terms = normalise(query).toLocaleLowerCase().split(' ').filter(Boolean)
  if (!terms.length) return []
  return document.pages.flatMap((page, pageIndex) => {
    const plain = normalise(page.ocrText)
    const lower = plain.toLocaleLowerCase()
    if (!terms.every(term => lower.includes(term))) return []
    const hit = Math.min(...terms.map(term => lower.indexOf(term)).filter(index => index >= 0))
    const start = Math.max(0, hit - 42)
    const end = Math.min(plain.length, hit + 92)
    return [{ pageIndex, snippet: `${start ? '…' : ''}${plain.slice(start, end)}${end < plain.length ? '…' : ''}` }]
  })
}

export const searchService = {
  async search(query: string): Promise<DocumentSearchResult[]> {
    const documents = await documentsRepository.search(query)
    return documents.map(document => ({ document, pageMatches: pageMatches(document, query) }))
  },
}
