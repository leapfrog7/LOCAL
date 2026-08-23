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
