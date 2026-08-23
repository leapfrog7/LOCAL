import { describe, expect, it } from 'vitest'
import type { VaultDocument } from '../domain/types'
import { mergeNativeOcrPages } from './processingQueue'

const document = (): VaultDocument => ({
  id: 'document-1', title: 'Scan', folder: 'Unfiled', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
  status: 'ocr_processing', processingStage: 'ocr', tags: [],
  pages: [
    { id: 'page-1', imageUrl: 'one.jpg', rotation: 0, ocrText: '', ocrState: 'processing' },
    { id: 'page-2', imageUrl: 'two.jpg', rotation: 0, ocrText: '', ocrState: 'pending' },
  ],
})

describe('native WorkManager OCR reconciliation', () => {
  it('merges incremental page results without failing unfinished pages', () => {
    const merged = mergeNativeOcrPages(document(), {
      state: 'running', pages: [{ pageId: 'page-1', text: 'Invoice 42', confidence: 96, languages: ['en'], words: [], barcodes: [{ rawValue: 'INV-42-QR', format: 'QR_CODE', valueType: 'TEXT' }] }],
    }, '2026-01-02T00:00:00.000Z')

    expect(merged.status).toBe('ocr_processing')
    expect(merged.pages[0]).toMatchObject({ ocrState: 'complete', ocrText: 'Invoice 42', ocrConfidence: 96 })
    expect(merged.pages[0].barcodes?.[0].rawValue).toBe('INV-42-QR')
    expect(merged.pages[1].ocrState).toBe('pending')
    expect(merged.updatedAt).toBe('2026-01-02T00:00:00.000Z')
  })

  it('preserves completed work and marks remaining pages after a terminal failure', () => {
    const source = document()
    source.pages[0] = { ...source.pages[0], ocrState: 'complete', ocrText: 'Already safe' }
    const merged = mergeNativeOcrPages(source, { state: 'failed', errors: [{ pageId: 'page-2', message: 'Unreadable' }] })

    expect(merged.status).toBe('error')
    expect(merged.pages[0]).toMatchObject({ ocrState: 'complete', ocrText: 'Already safe' })
    expect(merged.pages[1].ocrState).toBe('error')
  })
})
