import type { VaultDocument } from '../domain/types'
import { documentsRepository } from './documentRepository'

export interface PageSearchMatch { pageIndex: number; snippet: string; wordIndexes: number[] }
export type SmartSearchFilter = 'all' | 'bills' | 'invoices' | 'receipts' | 'prescriptions' | 'statements' | 'this_month' | 'needs_attention'
export interface DocumentSearchResult { document: VaultDocument; pageMatches: PageSearchMatch[]; score: number }

const normalise = (value: string) => value.replace(/\s+/g, ' ').trim()
const token = (value: string) => value.toLocaleLowerCase().replace(/[^\p{L}\p{N}]/gu, '')
function snippetFor(text: string, query: string) {
  const plain = normalise(text), lower = plain.toLocaleLowerCase(), hit = lower.indexOf(normalise(query).toLocaleLowerCase())
  const fallback = hit >= 0 ? hit : Math.min(...normalise(query).toLocaleLowerCase().split(' ').map(term => lower.indexOf(term)).filter(index => index >= 0))
  const start = Math.max(0, (Number.isFinite(fallback) ? fallback : 0) - 58), end = Math.min(plain.length, (Number.isFinite(fallback) ? fallback : 0) + query.length + 110)
  return `${start ? '…' : ''}${plain.slice(start, end)}${end < plain.length ? '…' : ''}`
}

export function pageMatches(document: VaultDocument, query: string): PageSearchMatch[] {
  const terms = normalise(query).split(' ').map(token).filter(Boolean)
  if (!terms.length) return []
  return document.pages.flatMap((page, pageIndex) => {
    const words = page.ocrWords ?? [], wordTokens = words.map(word => token(word.text)), matches: PageSearchMatch[] = []
    if (words.length) for (let start = 0; start <= words.length - terms.length; start += 1) {
      if (terms.every((term, offset) => wordTokens[start + offset] === term)) matches.push({ pageIndex, snippet: snippetFor(page.ocrText, query), wordIndexes: terms.map((_, offset) => start + offset) })
    }
    if (matches.length) return matches
    const lower = normalise(page.ocrText).toLocaleLowerCase()
    const barcodeTokens = (page.barcodes ?? []).flatMap(code => [code.rawValue, code.displayValue ?? '']).map(token)
    if (!terms.every(term => lower.includes(term) || barcodeTokens.some(value => value.includes(term)))) return []
    const indexes = words.flatMap((word, index) => terms.some(term => token(word.text) === term) ? [index] : [])
    return [{ pageIndex, snippet: snippetFor(page.ocrText, query), wordIndexes: indexes }]
  })
}

const BILL_TYPES = new Set(['electricity_bill', 'water_bill', 'phone_bill'])
export function matchesSmartFilter(document: VaultDocument, filter: SmartSearchFilter, now = new Date()) {
  const type = document.smartMetadata?.documentType
  if (filter === 'all') return true
  if (filter === 'bills') return Boolean(type && BILL_TYPES.has(type))
  if (filter === 'invoices') return type === 'invoice'
  if (filter === 'receipts') return type === 'receipt'
  if (filter === 'prescriptions') return type === 'prescription'
  if (filter === 'statements') return type === 'bank_statement'
  if (filter === 'needs_attention') return document.status === 'error' || document.pages.some(page => page.processingState === 'needs_review')
  const date = new Date(document.smartMetadata?.documentDate ?? document.createdAt)
  return date.getFullYear() === now.getFullYear() && date.getMonth() === now.getMonth()
}

function metadataText(document: VaultDocument) {
  const metadata = document.smartMetadata
  if (!metadata) return ''
  return [metadata.documentType?.replaceAll('_', ' '), metadata.organization, metadata.dateLabel, metadata.amount?.display, metadata.identifier?.value].filter(Boolean).join(' ').toLocaleLowerCase()
}

export function resultScore(document: VaultDocument, query: string, matches: PageSearchMatch[]) {
  const phrase = normalise(query).toLocaleLowerCase(), terms = phrase.split(' ').filter(Boolean)
  if (!terms.length) return new Date(document.updatedAt).getTime() / 1e12
  const title = document.title.toLocaleLowerCase(), metadata = metadataText(document), labels = [document.folder, ...document.tags].join(' ').toLocaleLowerCase()
  let score = title === phrase ? 160 : title.includes(phrase) ? 100 : terms.every(term => title.includes(term)) ? 70 : 0
  if (terms.every(term => metadata.includes(term))) score += 55
  if (terms.every(term => labels.includes(term))) score += 35
  score += Math.min(matches.length, 5) * 8
  return score + new Date(document.updatedAt).getTime() / 1e14
}

export const searchService = {
  async search(query: string, filter: SmartSearchFilter = 'all'): Promise<DocumentSearchResult[]> {
    const documents = await documentsRepository.search(query)
    const terms = normalise(query).toLocaleLowerCase().split(' ').filter(Boolean)
    return documents.filter(document => matchesSmartFilter(document, filter)).map(document => {
      const matches = pageMatches(document, query)
      return { document, pageMatches: matches, score: resultScore(document, query, matches) }
    }).filter(result => {
      const metadata = [result.document.title, result.document.folder, ...result.document.tags, metadataText(result.document)].join(' ').toLocaleLowerCase()
      return !terms.length || result.pageMatches.length > 0 || terms.every(term => metadata.includes(term))
    }).sort((a, b) => b.score - a.score)
  },
}
