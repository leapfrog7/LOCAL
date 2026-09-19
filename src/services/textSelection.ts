import type { VaultDocument } from '../domain/types'

export function pageIndexes(indexes: number[], count: number) {
  return [...new Set(indexes)].filter(index => Number.isInteger(index) && index >= 0 && index < count).sort((a, b) => a - b)
}

export function parseTextPageRange(value: string, count: number): number[] {
  if (!value.trim()) return []
  const indexes: number[] = []
  for (const part of value.split(',')) {
    const match = part.trim().match(/^(\d+)(?:\s*-\s*(\d+))?$/)
    if (!match) throw new Error('Use page numbers or ranges, for example 1, 3-5.')
    const first = Number(match[1]), last = Number(match[2] ?? match[1])
    if (first < 1 || last < first || last > count) throw new Error(`Choose pages between 1 and ${count}.`)
    for (let page = first; page <= last; page++) indexes.push(page - 1)
  }
  return pageIndexes(indexes, count)
}

export function selectedPageText(document: VaultDocument, indexes: number[], format: 'txt' | 'md' = 'txt') {
  return pageIndexes(indexes, document.pages.length).map(index => {
    const text = document.pages[index].ocrText.trim() || '[No searchable text found on this page]'
    return `${format === 'md' ? '## ' : ''}Page ${index + 1}\n\n${text}`
  }).join('\n\n---\n\n')
}

export async function copyDocumentText(document: VaultDocument, indexes: number[]) {
  const selected = pageIndexes(indexes, document.pages.length)
  if (!selected.length) throw new Error('Select at least one page.')
  await navigator.clipboard.writeText(selectedPageText(document, selected))
}
