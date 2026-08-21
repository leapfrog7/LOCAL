import { afterEach, describe, expect, it, vi } from 'vitest'
import type { DocumentPage } from '../domain/types'
import { checkDocumentStorage } from './storageHealthService'

const page: DocumentPage = { id: 'page', imageUrl: 'data:image/jpeg;base64,AAAA', rotation: 0, ocrText: '', ocrState: 'pending' }

describe('checkDocumentStorage', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('allows a scan when storage estimate is unavailable', async () => {
    vi.stubGlobal('navigator', {})
    expect((await checkDocumentStorage([page])).ok).toBe(true)
  })

  it('blocks a scan when the available quota is below the safety floor', async () => {
    vi.stubGlobal('navigator', { storage: { estimate: async () => ({ quota: 20_000_000, usage: 19_000_000 }) } })
    const result = await checkDocumentStorage([page])
    expect(result.ok).toBe(false)
    expect(result.message).toContain('Not enough free app storage')
  })
})
