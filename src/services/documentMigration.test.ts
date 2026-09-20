import { beforeEach, afterEach, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({ settings: new Map<string, string>(), saved: new Map<string, any>(), failSave: false }))
vi.mock('./sqliteRepository', () => ({ sqliteRepository: {
  available: () => true,
  getSetting: async (key: string) => state.settings.get(key),
  setSetting: async (key: string, value: string) => { state.settings.set(key, value) },
  save: async (doc: any) => { if (state.failSave) throw new Error('disk full'); state.saved.set(doc.id, structuredClone(doc)) },
  get: async (id: string) => state.saved.get(id),
  list: async () => [...state.saved.values()],
} }))
vi.mock('./documentStorageService', () => ({ documentStorageService: {
  persist: async (doc: any) => doc, forMetadata: (doc: any) => doc, hydrate: async (doc: any) => doc,
} }))

let legacy: any[]
let abortClear: boolean
beforeEach(() => {
  vi.resetModules()
  state.settings.clear(); state.saved.clear(); state.failSave = false; abortClear = false
  legacy = [{ id: 'old', pages: [{ id: 'p', imageUrl: 'plaintext image' }] }]
  // Minimal asynchronous IDB adapter, including transaction abort after request
  // success. Cleanup must wait for commit, not merely the clear request.
  vi.stubGlobal('indexedDB', { open: () => {
    const request: any = {}
    request.result = { close() {}, transaction: () => {
      const tx: any = {}
      const run = (clear: boolean) => {
        const result: any = { result: clear ? undefined : structuredClone(legacy) }
        setTimeout(() => {
          result.onsuccess?.()
          if (clear && abortClear) { tx.error = new Error('cleanup aborted'); tx.onabort?.() }
          else { if (clear) legacy = []; tx.oncomplete?.() }
        }, 0)
        return result
      }
      tx.objectStore = () => ({ getAll: () => run(false), clear: () => run(true) })
      return tx
    } }
    setTimeout(() => request.onsuccess?.(), 0)
    return request
  } })
})
afterEach(() => vi.unstubAllGlobals())

it('removes plaintext only after a successful verified migration', async () => {
  const { documentsRepository } = await import('./documentRepository')
  await documentsRepository.list()
  expect(state.saved.get('old').pages[0].imageUrl).toBe('plaintext image')
  expect(legacy).toEqual([])
  expect(state.settings.get('indexeddb_plaintext_cleaned')).toBe('1')
})
it('retains source records on migration failure and supports retry', async () => {
  state.failSave = true
  const { documentsRepository } = await import('./documentRepository')
  await expect(documentsRepository.list()).rejects.toThrow('disk full')
  expect(legacy).toHaveLength(1)
  expect(state.settings.has('indexeddb_metadata_migrated')).toBe(false)
  state.failSave = false
  await documentsRepository.list()
  expect(legacy).toEqual([])
})
it('cleans earlier releases without resurrecting deleted legacy documents', async () => {
  state.settings.set('indexeddb_metadata_migrated', '1')
  const { documentsRepository } = await import('./documentRepository')
  await documentsRepository.list()
  expect(state.saved.size).toBe(0)
  expect(legacy).toEqual([])
})
it('does not mark aborted cleanup complete and retries on the next call', async () => {
  state.settings.set('indexeddb_metadata_migrated', '1'); abortClear = true
  const { documentsRepository } = await import('./documentRepository')
  await expect(documentsRepository.list()).rejects.toThrow('cleanup aborted')
  expect(state.settings.has('indexeddb_plaintext_cleaned')).toBe(false)
  expect(legacy).toHaveLength(1)
  abortClear = false
  await documentsRepository.list()
  expect(legacy).toEqual([])
})
