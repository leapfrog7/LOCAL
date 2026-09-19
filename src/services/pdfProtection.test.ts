import { afterEach, describe, expect, it, vi } from 'vitest'
import type { VaultDocument } from '../domain/types'

const mocks = vi.hoisted(() => ({ protectPdf: vi.fn(), persistVersionedPdf: vi.fn(), removeFile: vi.fn() }))
vi.mock('@capacitor/core', () => ({ Capacitor: { isNativePlatform: () => true }, registerPlugin: () => ({ protectPdf: mocks.protectPdf }) }))
vi.mock('./documentStorageService', () => ({ documentStorageService: mocks }))
import { downloadCompressedPdf, passwordProtectPdf, pdfService } from './pdfService'
const document = { id: 'test', title: 'Protected', pdfPath: 'LOCAL/documents/test/original.pdf', pdfPasswordProtected: true, pages: [] } as unknown as VaultDocument

describe('PDF password export safety', () => {
  afterEach(() => vi.restoreAllMocks())
  it('does not overwrite the existing protected PDF if encryption fails', async () => {
    vi.spyOn(pdfService, 'create').mockResolvedValue(new Blob(['new PDF']))
    mocks.persistVersionedPdf.mockResolvedValue('LOCAL/documents/test/new.pdf')
    mocks.protectPdf.mockRejectedValue(new Error('encryption failed'))
    await expect(passwordProtectPdf(document, 'new password')).rejects.toThrow('encryption failed')
    expect(document.pdfPath).toBe('LOCAL/documents/test/original.pdf')
    expect(mocks.removeFile).toHaveBeenCalledWith('LOCAL/documents/test/new.pdf')
    expect(mocks.removeFile).not.toHaveBeenCalledWith(document.pdfPath)
  })
  it('blocks compression from silently exporting an unlocked protected document', async () => {
    const create = vi.spyOn(pdfService, 'create')
    await expect(downloadCompressedPdf(document, 'balanced')).rejects.toThrow('unlocked PDF')
    expect(create).not.toHaveBeenCalled()
  })
})
