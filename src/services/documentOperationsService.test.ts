import { describe, expect, it } from 'vitest'
import type { DocumentPage, VaultDocument } from '../domain/types'
import { combineDocuments, extractPages } from './documentOperationsService'

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
})
