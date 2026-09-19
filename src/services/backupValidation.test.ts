import { describe, expect, it } from 'vitest'
import { validateBackupPayload } from './backupValidation'
import { writeBackupJson } from './backupService'

const document = () => ({ id: 'doc', title: 'हिन्दी 🔒', folder: 'Unfiled', createdAt: '2026-09-19', updatedAt: '2026-09-19', status: 'indexed' as const, tags: [], pdfPasswordProtected: true, pages: [{ id: 'page', imageUrl: 'data:image/jpeg;base64,AA==', rotation: 0, ocrText: 'Test', ocrState: 'complete' as const }] })
const payload = () => ({ format: 'local-backup-v2' as const, createdAt: '2026-09-19', documents: [document()] })

describe('backup input and streaming serialization', () => {
  it('rejects traversal IDs before storage can be modified', () => {
    const value = payload(); value.documents[0].id = '../other-document'
    expect(() => validateBackupPayload(value)).toThrow('Invalid backup')
  })
  it('rejects remote image URLs and duplicate document IDs', () => {
    const remote = payload(); remote.documents[0].pages[0].imageUrl = 'https://example.com/tracker.jpg'
    expect(() => validateBackupPayload(remote)).toThrow('Invalid backup')
    const duplicate = payload(); duplicate.documents.push(document())
    expect(() => validateBackupPayload(duplicate)).toThrow('Invalid backup')
  })
  it('streams valid portable JSON and clears nonportable PDF password state', async () => {
    const chunks: string[] = []
    await writeBackupJson([document()], '2026-09-19', ['Unfiled', 'Empty'], async chunk => { chunks.push(chunk) })
    const restored = JSON.parse(chunks.join(''))
    validateBackupPayload(restored)
    expect(restored.documents[0].pages).toEqual(document().pages)
    expect(restored.documents[0].title).toBe('हिन्दी 🔒')
    expect(restored.documents[0].pdfPasswordProtected).toBe(false)
    expect(chunks.length).toBeGreaterThan(3)
  })
  it('stops serialization when the output fails', async () => {
    await expect(writeBackupJson([document()], '2026-09-19', [], async () => { throw new Error('disk full') })).rejects.toThrow('disk full')
  })
})
