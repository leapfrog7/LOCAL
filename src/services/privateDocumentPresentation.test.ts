import { describe, expect, it, vi } from 'vitest'
import type { VaultDocument } from '../domain/types'
import { privateDocumentPresentation } from './privateDocumentPresentation'
import { documentsRepository } from './documentRepository'
import { searchService } from './searchService'

const secret: VaultDocument = {
  id: 'private', title: 'Secret diagnosis', folder: 'Unfiled', tags: ['sensitive'], isPrivate: true,
  createdAt: '2026-09-20', updatedAt: '2026-09-20', status: 'indexed',
  pages: [{ id: 'page', rotation: 0, imageUrl: 'private-image', thumbnailUrl: 'private-thumb', imagePath: 'private-path', ocrText: 'confidential diagnosis', ocrState: 'complete' }],
}

describe('private information boundary', () => {
  it('redacts tool previews even when a previously revealed document is in memory', () => {
    const presented = privateDocumentPresentation(secret)
    expect(presented.title).toBe('Private document')
    expect(presented.tags).toEqual([])
    expect(presented.pages[0]).toMatchObject({ imageUrl: '', ocrText: '', imagePath: undefined, thumbnailUrl: undefined })
    expect(secret.title).toBe('Secret diagnosis')
    expect(secret.pages[0].ocrText).toBe('confidential diagnosis')
  })
  it('does not expose private matches through text or advanced queries', async () => {
    const spy = vi.spyOn(documentsRepository, 'search').mockResolvedValue([secret])
    try {
      for (const query of ['diagnosis', 'tag:sensitive', 'private:true', 'type:invoice']) {
        expect(await searchService.search(query)).toEqual([])
      }
      expect(await searchService.search('')).toHaveLength(1)
    } finally { spy.mockRestore() }
  })
  it('retains normal public search', async () => {
    const spy = vi.spyOn(documentsRepository, 'search').mockResolvedValue([{ ...secret, isPrivate: false }])
    try { expect(await searchService.search('diagnosis')).toHaveLength(1) } finally { spy.mockRestore() }
  })
})
