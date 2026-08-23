import type { VaultDocument } from '../domain/types'
import type { DocumentRepository } from './contracts'
import { documentStorageService } from './documentStorageService'
import { sqliteRepository } from './sqliteRepository'

const DB_NAME = 'local-vault'
const STORE = 'documents'

function openDatabase(): Promise<IDBDatabase> {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1)
    request.onupgradeneeded = () => request.result.createObjectStore(STORE, { keyPath: 'id' })
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

async function transaction<T>(mode: IDBTransactionMode, action: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await openDatabase()
  return new Promise<T>((resolve, reject) => {
    const request = action(db.transaction(STORE, mode).objectStore(STORE))
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  }).finally(() => db.close())
}

let nativeMigration: Promise<void> | undefined
function ensureNativeMigration() {
  if (!sqliteRepository.available()) return Promise.resolve()
  if (!nativeMigration) nativeMigration = (async () => {
    if (await sqliteRepository.getSetting('indexeddb_metadata_migrated') === '1') return
    const records = await transaction('readonly', store => store.getAll()) as VaultDocument[]
    for (const record of records) {
      const persisted = await documentStorageService.persist(record)
      await sqliteRepository.save(documentStorageService.forMetadata(persisted))
    }
    await sqliteRepository.setSetting('indexeddb_metadata_migrated', '1')
  })()
  return nativeMigration
}

export const documentsRepository: DocumentRepository = {
  async list() {
    if (sqliteRepository.available()) {
      await ensureNativeMigration()
      const records = await sqliteRepository.list(), documents: VaultDocument[] = []
      for (const record of records) documents.push(await documentStorageService.hydrate(record))
      return documents
    }
    const records = await transaction('readonly', s => s.getAll()) as VaultDocument[]
    const documents: VaultDocument[] = []
    for (const record of records) {
      const needsMigration = documentStorageService.usesNativeFiles() && record.pages.some(page => !page.imagePath && page.imageUrl.startsWith('data:'))
      const persisted = needsMigration ? await documentStorageService.persist(record) : record
      if (needsMigration) await transaction('readwrite', store => store.put(documentStorageService.forMetadata(persisted)))
      documents.push(await documentStorageService.hydrate(persisted))
    }
    return documents.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
  },
  async get(id) {
    if (sqliteRepository.available()) {
      await ensureNativeMigration()
      const record = await sqliteRepository.get(id)
      return record ? documentStorageService.hydrate(record) : undefined
    }
    const record = await transaction('readonly', s => s.get(id)) as VaultDocument | undefined
    if (!record) return undefined
    const needsMigration = documentStorageService.usesNativeFiles() && record.pages.some(page => !page.imagePath && page.imageUrl.startsWith('data:'))
    const persisted = needsMigration ? await documentStorageService.persist(record) : record
    if (needsMigration) await transaction('readwrite', store => store.put(documentStorageService.forMetadata(persisted)))
    return documentStorageService.hydrate(persisted)
  },
  async save(document) {
    const persisted = await documentStorageService.persist(document)
    if (sqliteRepository.available()) { await ensureNativeMigration(); await sqliteRepository.save(documentStorageService.forMetadata(persisted)); return }
    await transaction('readwrite', store => store.put(documentStorageService.forMetadata(persisted)))
  },
  async remove(id) {
    await documentStorageService.remove(id)
    if (sqliteRepository.available()) { await ensureNativeMigration(); await sqliteRepository.remove(id); return }
    await transaction('readwrite', s => s.delete(id))
  },
  async search(query) {
    if (sqliteRepository.available()) {
      await ensureNativeMigration()
      const records = await sqliteRepository.search(query), documents: VaultDocument[] = []
      for (const record of records) documents.push(await documentStorageService.hydrate(record))
      return documents
    }
    const terms = query.toLocaleLowerCase().trim().split(/\s+/).filter(Boolean)
    const documents = await this.list()
    if (!terms.length) return documents
    return documents.filter(doc => {
      const smart = doc.smartMetadata
      const haystack = [doc.title, doc.folder, ...doc.tags, smart?.documentType?.replaceAll('_', ' '), smart?.organization, smart?.dateLabel, smart?.amount?.display, smart?.identifier?.value, ...doc.pages.flatMap(page => [page.ocrText, ...(page.barcodes ?? []).flatMap(code => [code.rawValue, code.displayValue])])].filter(Boolean).join(' ').toLocaleLowerCase()
      return terms.every(term => haystack.includes(term))
    })
  },
}
