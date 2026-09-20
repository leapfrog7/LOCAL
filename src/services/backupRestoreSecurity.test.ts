import { expect, it, vi } from 'vitest'
import type { VaultDocument } from '../domain/types'
import { backupService } from './backupService'
import { documentsRepository } from './documentRepository'

it('restores using fresh page identities even when incoming IDs match an existing private page', async () => {
  const existing: VaultDocument = { id: 'victim', title: 'Private', isPrivate: true, createdAt: '2026-09-20', updatedAt: '2026-09-20', status: 'indexed', folder: 'Unfiled', tags: [], pages: [{ id: 'known-page', imageUrl: 'data:image/png;base64,AA==', rotation: 0, ocrText: 'original', ocrState: 'complete' }] }
  const list = vi.spyOn(documentsRepository, 'list').mockResolvedValue([existing])
  const save = vi.spyOn(documentsRepository, 'save').mockResolvedValue(undefined)
  try {
    await backupService.restorePayload({ format: 'local-backup-v2', createdAt: '2026-09-20', documents: [{ ...existing, id: 'incoming', isPrivate: false }] }, 'keep')
    expect(save).toHaveBeenCalledTimes(1)
    const restored = save.mock.calls[0][0]
    expect(restored.id).toBe('incoming')
    expect(restored.pages[0].id).not.toBe('known-page')
    expect(restored.pages[0].id).toMatch(/^[0-9a-f-]{36}$/)
    expect(existing.pages[0].id).toBe('known-page')
  } finally { list.mockRestore(); save.mockRestore() }
})
