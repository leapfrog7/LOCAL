import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { VaultDocument } from '../domain/types'

const native = vi.hoisted(() => ({ getUri: vi.fn() }))
vi.mock('@capacitor/core', () => ({ Capacitor: { isNativePlatform: () => true, convertFileSrc: (uri: string) => uri.replace('file://', 'https://localhost/_capacitor_file_') } }))
vi.mock('@capacitor/filesystem', () => ({ Directory: { Data: 'DATA' }, Filesystem: native }))
vi.mock('./privateStorageService', () => ({ privateStorageService: { revealPaths: vi.fn() } }))

const document = (): VaultDocument => ({
  id: 'test', title: 'Test', folder: 'Unfiled', tags: [], status: 'indexed', createdAt: '2026-09-16', updatedAt: '2026-09-16',
  pages: Array.from({ length: 40 }, (_, index) => ({ id: String(index), imageUrl: '', imagePath: `LOCAL/documents/test/pages/${index}.jpg`, thumbnailPath: `LOCAL/documents/test/pages/${index}-thumb.jpg`, rotation: 0, ocrText: '', ocrState: 'complete' })),
})

describe('native image URL resolution', () => {
  beforeEach(() => { vi.resetModules(); native.getUri.mockReset(); native.getUri.mockResolvedValue({ uri: 'file:///data/user/0/local/files' }) })

  it('loads a 40-page document using one native directory lookup', async () => {
    const { documentStorageService } = await import('./documentStorageService')
    const hydrated = await documentStorageService.hydrate(document())
    expect(native.getUri).toHaveBeenCalledTimes(1)
    expect(hydrated.pages[39].thumbnailUrl).toBe('https://localhost/_capacitor_file_/data/user/0/local/files/LOCAL/documents/test/pages/39-thumb.jpg')
    await documentStorageService.hydrate(document())
    expect(native.getUri).toHaveBeenCalledTimes(1)
  })

  it('keeps private previews hidden without resolving their paths', async () => {
    const { documentStorageService } = await import('./documentStorageService')
    const hydrated = await documentStorageService.hydrate({ ...document(), isPrivate: true })
    expect(native.getUri).not.toHaveBeenCalled()
    expect(hydrated.pages.every(page => !page.imageUrl && !page.thumbnailUrl)).toBe(true)
  })

  it('retries directory resolution after a bridge failure', async () => {
    native.getUri.mockRejectedValueOnce(new Error('bridge unavailable'))
    const { documentStorageService } = await import('./documentStorageService')
    await expect(documentStorageService.hydrate(document())).rejects.toThrow('bridge unavailable')
    await expect(documentStorageService.hydrate(document())).resolves.toMatchObject({ id: 'test' })
    expect(native.getUri).toHaveBeenCalledTimes(2)
  })
})
