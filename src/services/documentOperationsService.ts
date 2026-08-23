import type { DocumentPage, VaultDocument } from '../domain/types'

const asDataUrl = async (source: string | undefined, cache: Map<string, Promise<string>>) => {
  if (!source || source.startsWith('data:')) return source
  const existing = cache.get(source)
  if (existing) return existing
  const conversion = (async () => {
    const response = await fetch(source)
    if (!response.ok) throw new Error('A source page could not be copied.')
    const blob = await response.blob()
    return new Promise<string>((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve(String(reader.result))
      reader.onerror = () => reject(reader.error)
      reader.readAsDataURL(blob)
    })
  })()
  cache.set(source, conversion)
  return conversion
}

export async function copyDocumentPages(pages: DocumentPage[]) {
  const copies: DocumentPage[] = []
  const cache = new Map<string, Promise<string>>()
  for (const page of pages) copies.push({
    ...page,
    id: crypto.randomUUID(),
    imageUrl: (await asDataUrl(page.imageUrl, cache))!,
    originalImageUrl: await asDataUrl(page.originalImageUrl || page.imageUrl, cache),
    thumbnailUrl: await asDataUrl(page.thumbnailUrl || page.imageUrl, cache),
    ocrImageUrl: await asDataUrl(page.ocrImageUrl || page.imageUrl, cache),
    imagePath: undefined,
    originalImagePath: undefined,
    thumbnailPath: undefined,
    ocrImagePath: undefined,
  })
  return copies
}

function derivedDocument(title: string, pages: DocumentPage[], isPrivate = false): VaultDocument {
  const now = new Date().toISOString()
  const searchable = pages.every(page => page.ocrState === 'complete')
  return {
    id: crypto.randomUUID(), title, titleSource: 'manual', folder: 'Unfiled', createdAt: now, updatedAt: now,
    status: searchable ? 'ocr_processing' : 'ocr_pending', processingStage: searchable ? 'pdf' : 'ocr', pages, tags: [], isPrivate,
  }
}

export async function combineDocuments(documents: VaultDocument[]) {
  if (documents.length < 2) throw new Error('Choose at least two documents to combine.')
  const pages: DocumentPage[] = []
  for (const document of documents) pages.push(...await copyDocumentPages(document.pages))
  return derivedDocument(`Combined PDF · ${documents.length} documents`, pages, documents.some(document => document.isPrivate))
}

export async function extractPages(document: VaultDocument, pageIndexes: number[]) {
  const selected = new Set(pageIndexes)
  const pages = await copyDocumentPages(document.pages.filter((_, index) => selected.has(index)))
  if (!pages.length) throw new Error('Choose at least one page to extract.')
  if (pages.length === document.pages.length) throw new Error('Leave at least one page in the original document.')
  return derivedDocument(`${document.title} · Extracted pages`, pages, Boolean(document.isPrivate))
}

export async function reorderDocumentPages(document: VaultDocument, pageIndexes: number[]) {
  if (pageIndexes.length !== document.pages.length || new Set(pageIndexes).size !== document.pages.length) throw new Error('Every page must appear exactly once.')
  const pages = await copyDocumentPages(pageIndexes.map(index => document.pages[index]).filter(Boolean))
  return derivedDocument(`${document.title} · Reordered`, pages, Boolean(document.isPrivate))
}

export async function insertDocumentPages(target: VaultDocument, source: VaultDocument, sourcePageIndexes: number[], insertionIndex: number) {
  const selected = new Set(sourcePageIndexes)
  const inserted = source.pages.filter((_, index) => selected.has(index))
  if (!inserted.length) throw new Error('Choose at least one page to insert.')
  const at = Math.max(0, Math.min(target.pages.length, insertionIndex))
  const pages = await copyDocumentPages([...target.pages.slice(0, at), ...inserted, ...target.pages.slice(at)])
  return { ...derivedDocument(`${target.title} · Pages inserted`, pages, Boolean(target.isPrivate || source.isPrivate)), folder: target.folder, tags: [...target.tags] }
}

export async function removeDocumentPages(document: VaultDocument, pageIndexes: number[]) {
  const removed = new Set(pageIndexes)
  if (!removed.size) throw new Error('Choose at least one blank or duplicate page to remove.')
  const remaining = document.pages.filter((_, index) => !removed.has(index))
  if (!remaining.length) throw new Error('A document must keep at least one page.')
  const pages = await copyDocumentPages(remaining)
  return { ...derivedDocument(`${document.title} · Cleaned`, pages, Boolean(document.isPrivate)), folder: document.folder, tags: [...document.tags] }
}

export type PageCleanupAnalysis = { blank: number[]; duplicates: number[] }
export function analyseDocumentPages(document: VaultDocument): PageCleanupAnalysis {
  const blank: number[] = [], duplicates: number[] = []
  const fingerprints = new Map<string, number>()
  document.pages.forEach((page, index) => {
    const text = page.ocrText.replace(/\s+/g, ' ').trim().toLocaleLowerCase()
    if (page.ocrState === 'complete' && !text) blank.push(index)
    const fingerprint = text.length >= 20 ? text : ''
    if (fingerprint) {
      if (fingerprints.has(fingerprint)) duplicates.push(index)
      else fingerprints.set(fingerprint, index)
    }
  })
  return { blank, duplicates }
}
