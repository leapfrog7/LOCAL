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
})
