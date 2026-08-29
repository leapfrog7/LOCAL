import { describe, expect, it } from 'vitest'
import { decryptBackupPayload, encryptBackupPayload } from './backupService'

describe('encrypted LOCAL backups', () => {
  const payload = { format: 'local-backup-v1' as const, createdAt: '2026-08-22T00:00:00.000Z', documents: [] }

  it('round-trips a payload without exposing its contents', async () => {
    const encrypted = await encryptBackupPayload(payload, 'correct horse battery staple')
    expect(await encrypted.text()).not.toContain('local-backup-v1')
    await expect(decryptBackupPayload(encrypted, 'correct horse battery staple')).resolves.toEqual(payload)
  })

  it('rejects the wrong passphrase', async () => {
    const encrypted = await encryptBackupPayload(payload, 'correct horse battery staple')
    await expect(decryptBackupPayload(encrypted, 'incorrect password')).rejects.toThrow('could not be unlocked')
  })

  it('preserves empty folders in the current backup format', async () => {
    const current = { format: 'local-backup-v2' as const, createdAt: '2026-08-22T00:00:00.000Z', documents: [], folders: ['Unfiled', 'Empty folder'] }
    const encrypted = await encryptBackupPayload(current, 'correct horse battery staple')
    await expect(decryptBackupPayload(encrypted, 'correct horse battery staple')).resolves.toEqual(current)
  })

  it('preserves durable page annotations in the encrypted payload', async () => {
    const annotated = { format: 'local-backup-v2' as const, createdAt: '2026-08-28T00:00:00.000Z', folders: ['Unfiled'], documents: [{ id: 'doc', title: 'Marked', folder: 'Unfiled', createdAt: '2026-08-28T00:00:00.000Z', updatedAt: '2026-08-28T00:00:00.000Z', status: 'indexed' as const, tags: [], pages: [{ id: 'page', imageUrl: 'data:image/jpeg;base64,AA==', rotation: 0, ocrText: 'kept', ocrState: 'complete' as const, annotations: { version: 1 as const, strokes: [{ id: 'stroke', tool: 'highlighter' as const, color: '#ffee00', width: .02, points: [{ x: .1, y: .2 }, { x: .8, y: .2 }] }] } }] }] }
    const encrypted = await encryptBackupPayload(annotated, 'correct horse battery staple')
    const restored = await decryptBackupPayload(encrypted, 'correct horse battery staple')
    expect(restored.documents[0].pages[0].annotations?.strokes[0]).toMatchObject({ tool: 'highlighter', color: '#ffee00' })
    expect(restored.documents[0].pages[0].ocrText).toBe('kept')
  })
})
