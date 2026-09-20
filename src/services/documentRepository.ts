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
    const tx = db.transaction(STORE, mode)
    const request = action(tx.objectStore(STORE))
    tx.oncomplete = () => resolve(request.result)
    tx.onabort = () => reject(tx.error ?? new Error('Legacy storage transaction aborted.'))
    request.onerror = () => reject(request.error)
  }).finally(() => db.close())
}

let nativeMigration: Promise<void> | undefined
function ensureNativeMigration() {
  if (!sqliteRepository.available()) return Promise.resolve()
  if (!nativeMigration)
    nativeMigration = (async () => {
      if ((await sqliteRepository.getSetting('indexeddb_plaintext_cleaned')) === '1') return
      if ((await sqliteRepository.getSetting('indexeddb_metadata_migrated')) !== '1') {
        const records = (await transaction('readonly', (store) => store.getAll())) as VaultDocument[]
        for (const record of records) {
          const persisted = await documentStorageService.persist(record)
          await sqliteRepository.save(documentStorageService.forMetadata(persisted))
          const saved = await sqliteRepository.get(record.id)
          if (!saved || saved.pages.length !== persisted.pages.length) throw new Error('Could not verify legacy document migration.')
        }
        await sqliteRepository.setSetting('indexeddb_metadata_migrated', '1')
      }
      // Also clean installations migrated by earlier releases. Do not reimport
      // stale records: the user may since have changed or deleted those documents.
      await transaction('readwrite', store => store.clear())
      await sqliteRepository.setSetting('indexeddb_plaintext_cleaned', '1')
    })().catch(error => { nativeMigration = undefined; throw error })
  return nativeMigration
}

async function ensurePrivateStorage(record: VaultDocument) {
  if (!sqliteRepository.available() || !record.isPrivate || record.storageProtection === 'keystore-v1') return record
  const protectedRecord = await documentStorageService.persist(record)
  await sqliteRepository.save(documentStorageService.forMetadata(protectedRecord))
  return protectedRecord
}

export const documentsRepository: DocumentRepository = {
  async list() {
    if (sqliteRepository.available()) {
      await ensureNativeMigration()
      const records = await sqliteRepository.list(),
        documents: VaultDocument[] = []
      for (const record of records) documents.push(await documentStorageService.hydrate(await ensurePrivateStorage(record)))
      return documents.filter((document) => !document.deletedAt)
    }
    const records = (await transaction('readonly', (s) => s.getAll())) as VaultDocument[]
    const documents: VaultDocument[] = []
    for (const record of records) {
      const needsMigration = documentStorageService.usesNativeFiles() && record.pages.some((page) => !page.imagePath && page.imageUrl.startsWith('data:'))
      const persisted = needsMigration ? await documentStorageService.persist(record) : record
      if (needsMigration) await transaction('readwrite', (store) => store.put(documentStorageService.forMetadata(persisted)))
      documents.push(await documentStorageService.hydrate(persisted))
    }
    return documents.filter((document) => !document.deletedAt).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
  },
  async listDeleted() {
    const records = sqliteRepository.available() ? await sqliteRepository.list() : ((await transaction('readonly', (store) => store.getAll())) as VaultDocument[])
    const expiredBefore = Date.now() - 30 * 24 * 60 * 60 * 1000
    const deleted = records.filter((document) => document.deletedAt)
    for (const document of deleted.filter((document) => new Date(document.deletedAt!).getTime() < expiredBefore)) await this.remove(document.id)
    const retained = deleted.filter((document) => new Date(document.deletedAt!).getTime() >= expiredBefore)
    const hydrated: VaultDocument[] = []
    for (const document of retained) hydrated.push(await documentStorageService.hydrate(document))
    return hydrated.sort((a, b) => b.deletedAt!.localeCompare(a.deletedAt!))
  },
  async get(id) {
    if (sqliteRepository.available()) {
      await ensureNativeMigration()
      const raw = await sqliteRepository.get(id)
      const record = raw ? await ensurePrivateStorage(raw) : undefined
      return record ? documentStorageService.hydrate(record) : undefined
    }
    const record = (await transaction('readonly', (s) => s.get(id))) as VaultDocument | undefined
    if (!record) return undefined
    const needsMigration = documentStorageService.usesNativeFiles() && record.pages.some((page) => !page.imagePath && page.imageUrl.startsWith('data:'))
    const persisted = needsMigration ? await documentStorageService.persist(record) : record
    if (needsMigration) await transaction('readwrite', (store) => store.put(documentStorageService.forMetadata(persisted)))
    return documentStorageService.hydrate(persisted)
  },
  async reveal(id) {
    if (sqliteRepository.available()) {
      await ensureNativeMigration()
      const raw = await sqliteRepository.get(id)
      const record = raw ? await ensurePrivateStorage(raw) : undefined
      return record ? documentStorageService.hydrate(record, true) : undefined
    }
    return this.get(id)
  },
  async save(document) {
    const persisted = await documentStorageService.persist(document)
    Object.assign(document, persisted)
    if (sqliteRepository.available()) {
      await ensureNativeMigration()
      await sqliteRepository.save(documentStorageService.forMetadata(persisted))
      return
    }
    await transaction('readwrite', (store) => store.put(documentStorageService.forMetadata(persisted)))
  },
  async remove(id) {
    await documentStorageService.remove(id)
    if (sqliteRepository.available()) {
      await ensureNativeMigration()
      await sqliteRepository.remove(id)
      return
    }
    await transaction('readwrite', (s) => s.delete(id))
  },
  async search(query) {
    if (sqliteRepository.available()) {
      await ensureNativeMigration()
      const records = await sqliteRepository.search(query),
        documents: VaultDocument[] = []
      for (const record of records) {
        if (query.trim() && record.isPrivate) continue
        documents.push(await documentStorageService.hydrate(await ensurePrivateStorage(record)))
      }
      return documents.filter((document) => !document.deletedAt)
    }
    const terms = query.toLocaleLowerCase().trim().split(/\s+/).filter(Boolean)
    const documents = await this.list()
    if (!terms.length) return documents
    return documents.filter((doc) => {
      if (doc.isPrivate) return false
      const smart = doc.smartMetadata
      const haystack = [doc.title, doc.folder, ...doc.tags, smart?.documentType?.replaceAll('_', ' '), smart?.organization, smart?.dateLabel, smart?.amount?.display, smart?.identifier?.value, ...doc.pages.flatMap((page) => [page.ocrText, ...(page.barcodes ?? []).flatMap((code) => [code.rawValue, code.displayValue])])].filter(Boolean).join(' ').toLocaleLowerCase()
      return terms.every((term) => haystack.includes(term))
    })
  }
}
