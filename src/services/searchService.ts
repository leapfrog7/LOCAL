import type { VaultDocument } from '../domain/types'
import { documentsRepository } from './documentRepository'

export interface PageSearchMatch { pageIndex: number; snippet: string; wordIndexes: number[] }
export type SmartSearchFilter = 'all' | 'bills' | 'invoices' | 'receipts' | 'prescriptions' | 'statements' | 'this_month' | 'needs_attention'
export interface DocumentSearchResult { document: VaultDocument; pageMatches: PageSearchMatch[]; score: number }
type AmountOperator = '>' | '>=' | '<' | '<=' | '='
export interface AdvancedSearchQuery {
  text: string
  folder?: string
  tag?: string
  type?: string
  organization?: string
  private?: boolean
  after?: string
  before?: string
  amount?: { operator: AmountOperator; value: number }
}

const normalise = (value: string) => value.replace(/\s+/g, ' ').trim()
const token = (value: string) => value.toLocaleLowerCase().replace(/[^\p{L}\p{N}]/gu, '')
const ADVANCED_TOKEN = /\b(folder|tag|type|org|private|after|before|amount):(?:"([^"]+)"|(\S+))/gi

export function parseAdvancedQuery(query: string): AdvancedSearchQuery {
  const parsed: AdvancedSearchQuery = { text: '' }
  const remaining = query.replace(ADVANCED_TOKEN, (_match, rawKey: string, quoted: string | undefined, plain: string | undefined) => {
    const key = rawKey.toLocaleLowerCase(), value = normalise(quoted ?? plain ?? '')
    if (key === 'folder') parsed.folder = value
    else if (key === 'tag') parsed.tag = value
    else if (key === 'type') parsed.type = value.toLocaleLowerCase().replace(/[\s-]+/g, '_')
    else if (key === 'org') parsed.organization = value
    else if (key === 'private' && /^(true|yes|private|1)$/i.test(value)) parsed.private = true
    else if (key === 'private' && /^(false|no|public|0)$/i.test(value)) parsed.private = false
    else if (key === 'after' && /^\d{4}-\d{2}(?:-\d{2})?$/.test(value)) parsed.after = value
    else if (key === 'before' && /^\d{4}-\d{2}(?:-\d{2})?$/.test(value)) parsed.before = value
    else if (key === 'amount') {
      const amount = value.replaceAll(',', '').match(/^(>=|<=|>|<|=)?\s*(\d+(?:\.\d+)?)$/)
      if (amount) parsed.amount = { operator: (amount[1] || '=') as AmountOperator, value: Number(amount[2]) }
      else return _match
    } else return _match
    return ' '
  })
  parsed.text = normalise(remaining)
  return parsed
}

const includes = (source: string | undefined, expected: string) => Boolean(source?.toLocaleLowerCase().includes(expected.toLocaleLowerCase()))
export function matchesAdvancedQuery(document: VaultDocument, query: AdvancedSearchQuery) {
  if (query.folder && !includes(document.folder, query.folder)) return false
  if (query.tag && !document.tags.some(tag => includes(tag, query.tag!))) return false
  if (query.type && document.smartMetadata?.documentType !== query.type) return false
  if (query.organization && !includes(document.smartMetadata?.organization, query.organization)) return false
  if (query.private !== undefined && Boolean(document.isPrivate) !== query.private) return false
  const date = (document.smartMetadata?.documentDate ?? document.createdAt).slice(0, 10)
  if (query.after && date < query.after.padEnd(10, '-00')) return false
  if (query.before && date > query.before.padEnd(10, '-99')) return false
  if (query.amount) {
    const value = document.smartMetadata?.amount?.value
    if (value === undefined) return false
    const { operator, value: expected } = query.amount
    if (operator === '>' && !(value > expected)) return false
    if (operator === '>=' && !(value >= expected)) return false
    if (operator === '<' && !(value < expected)) return false
    if (operator === '<=' && !(value <= expected)) return false
    if (operator === '=' && value !== expected) return false
  }
  return true
}
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
  // Recency means when the user added the file to LOCAL. The date printed in an
  // invoice or statement can legitimately be much older than the scan.
  const date = new Date(document.createdAt)
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
    const advanced = parseAdvancedQuery(query)
    const documents = await documentsRepository.search(advanced.text)
    const terms = normalise(advanced.text).toLocaleLowerCase().split(' ').filter(Boolean)
    return documents.filter(document => (!document.isPrivate || (!query.trim() && filter === 'all')) && matchesSmartFilter(document, filter) && matchesAdvancedQuery(document, advanced)).map(document => {
      const matches = pageMatches(document, advanced.text)
      return { document, pageMatches: matches, score: resultScore(document, advanced.text, matches) }
    }).filter(result => {
      const metadata = [result.document.title, result.document.folder, ...result.document.tags, metadataText(result.document)].join(' ').toLocaleLowerCase()
      return !terms.length || result.pageMatches.length > 0 || terms.every(term => metadata.includes(term))
    }).sort((a, b) => b.score - a.score)
  },
}
