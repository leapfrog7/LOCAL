import { describe, expect, it } from 'vitest'
import type { DocumentPage, VaultDocument } from '../domain/types'
import { analyseDocumentPages, combineDocuments, extractPages, insertDocumentPages, removeDocumentPages, reorderDocumentPages } from './documentOperationsService'

const page = (id: string): DocumentPage => ({ id, imageUrl: 'data:image/jpeg;base64,YQ==', rotation: 0, ocrText: id, ocrState: 'complete' })
const document = (id: string, pages: DocumentPage[], isPrivate = false): VaultDocument => ({ id, title: id, folder: 'Office', createdAt: '2026-01-01', updatedAt: '2026-01-01', status: 'indexed', pages, tags: [], isPrivate })

describe('document PDF operations', () => {
  it('combines documents in selection order with independent page identities', async () => {
    const combined = await combineDocuments([document('first', [page('a')]), document('second', [page('b')], true)])
    expect(combined.pages.map(item => item.ocrText)).toEqual(['a', 'b'])
    expect(combined.pages.map(item => item.id)).not.toEqual(['a', 'b'])
    expect(combined.isPrivate).toBe(true)
    expect(combined.processingStage).toBe('pdf')
  })

  it('extracts selected pages without changing their order', async () => {
    const extracted = await extractPages(document('source', [page('a'), page('b'), page('c')]), [2, 0])
    expect(extracted.pages.map(item => item.ocrText)).toEqual(['a', 'c'])
  })

  it('refuses to extract every page', async () => {
    await expect(extractPages(document('source', [page('a')]), [0])).rejects.toThrow('Leave at least one page')
  })

  it('creates an independent reordered copy and requires every page once', async () => {
    const reordered = await reorderDocumentPages(document('source', [page('a'), page('b'), page('c')]), [2, 0, 1])
    expect(reordered.pages.map(item => item.ocrText)).toEqual(['c', 'a', 'b'])
    expect(reordered.pages.map(item => item.id)).not.toEqual(['c', 'a', 'b'])
    await expect(reorderDocumentPages(document('source', [page('a'), page('b')]), [0, 0])).rejects.toThrow('exactly once')
  })

  it('inserts selected source pages at the requested boundary', async () => {
    const inserted = await insertDocumentPages(document('target', [page('a'), page('b')]), document('source', [page('x'), page('y')], true), [1], 1)
    expect(inserted.pages.map(item => item.ocrText)).toEqual(['a', 'y', 'b'])
    expect(inserted.folder).toBe('Office')
    expect(inserted.isPrivate).toBe(true)
  })

  it('removes reviewed pages into a copy but never removes every page', async () => {
    const cleaned = await removeDocumentPages(document('source', [page('a'), page('b'), page('c')]), [1])
    expect(cleaned.pages.map(item => item.ocrText)).toEqual(['a', 'c'])
    await expect(removeDocumentPages(document('source', [page('a')]), [0])).rejects.toThrow('keep at least one page')
  })

  it('suggests OCR-confirmed blank and repeated-text pages for review', () => {
    const repeated = 'This is the same sufficiently long page content'
    const result = analyseDocumentPages(document('source', [{ ...page('blank'), ocrText: '' }, { ...page('one'), ocrText: repeated }, { ...page('two'), ocrText: repeated }]))
    expect(result).toEqual({ blank: [0], duplicates: [2] })
  })
})
