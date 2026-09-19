import { Capacitor, registerPlugin } from '@capacitor/core'
import { Directory, Filesystem } from '@capacitor/filesystem'
import { Share } from '@capacitor/share'
import type { DocumentPage, VaultDocument } from '../domain/types'
import { documentsRepository } from './documentRepository'
import { documentStorageService } from './documentStorageService'
import { appLockService } from './appLockService'
import { privateStorageService } from './privateStorageService'
import { folderService } from './folderService'
import { validateBackupPayload } from './backupValidation'

const FORMAT = 'local-encrypted-backup-v1'
const ITERATIONS = 250_000
const nativeBackup = registerPlugin<{
  begin(options: { key: string; iv: string; header: string }): Promise<{ session: string }>
  append(options: { session: string; text: string }): Promise<void>
  finish(options: { session: string; filename: string }): Promise<{ cancelled: boolean }>
  abort(options: { session: string }): Promise<void>
}>('BackupExport')
export interface BackupPayload {
  format: 'local-backup-v1' | 'local-backup-v2'
  createdAt: string
  documents: VaultDocument[]
  folders?: string[]
}
export type RestoreConflictPolicy = 'keep' | 'replace' | 'copy'
interface EncryptedEnvelope {
  format: typeof FORMAT
  createdAt: string
  kdf: 'PBKDF2-SHA256'
  iterations: number
  salt: string
  iv: string
  ciphertext: string
}

const bytesToBase64 = (bytes: Uint8Array) => {
  let binary = ''
  for (let index = 0; index < bytes.length; index += 0x8000) binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000))
  return btoa(binary)
}
const base64ToBytes = (value: string) => Uint8Array.from(atob(value), (character) => character.charCodeAt(0))
const blobToDataUrl = (blob: Blob) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(blob)
  })
const blobToBase64 = async (blob: Blob) => bytesToBase64(new Uint8Array(await blob.arrayBuffer()))

async function dataUrl(value?: string) {
  if (!value || value.startsWith('data:')) return value
  const response = await fetch(value)
  if (!response.ok) throw new Error('A stored page image could not be read for backup.')
  return blobToDataUrl(await response.blob())
}

async function portablePage(page: DocumentPage): Promise<DocumentPage> {
  return {
    ...page,
    imageUrl: (await dataUrl(page.imageUrl)) ?? '',
    originalImageUrl: await dataUrl(page.originalImageUrl),
    thumbnailUrl: await dataUrl(page.thumbnailUrl),
    ocrImageUrl: await dataUrl(page.ocrImageUrl),
    imagePath: undefined,
    originalImagePath: undefined,
    thumbnailPath: undefined,
    ocrImagePath: undefined
  }
}

async function portableDocument(document: VaultDocument) {
  const pages: DocumentPage[] = []
  for (const page of document.pages) pages.push(await portablePage(page))
  return {
    ...document,
    pages,
    pdfPath: undefined,
    pdfPasswordProtected: false,
    pdfGeneratedAt: undefined,
    storageProtection: undefined,
    privateSessionId: undefined,
    privatePdfPath: undefined
  }
}

// Keep only one page's images in JS memory; native code streams authenticated
// ciphertext to disk. The format remains compatible with existing restores.
export async function writeBackupJson(source: VaultDocument[], createdAt: string, folders: string[], write: (text: string) => Promise<void>, onProgress?: (done: number, total: number) => void) {
  await write(`{"format":"local-backup-v2","createdAt":${JSON.stringify(createdAt)},"folders":${JSON.stringify(folders)},"documents":[`)
  for (const [index, document] of source.entries()) {
    const visible = document.isPrivate ? await documentsRepository.reveal(document.id) : document
    if (!visible) throw new Error('A private document could not be opened for backup.')
    try {
      const metadata = await portableDocument({ ...visible, pages: [] })
      const { pages: _pages, ...fields } = metadata
      await write(`${index ? ',' : ''}${JSON.stringify(fields).slice(0, -1)},"pages":[`)
      for (const [pageIndex, page] of visible.pages.entries()) {
        await write(`${pageIndex ? ',' : ''}${JSON.stringify(await portablePage(page))}`)
      }
      await write(']}')
      onProgress?.(index + 1, source.length)
    } finally { await privateStorageService.clearSession(visible.privateSessionId) }
  }
  await write(']}')
}

async function createNativeBackup(source: VaultDocument[], passphrase: string, onProgress?: (done: number, total: number) => void) {
  if (passphrase.length < 8) throw new Error('Use a passphrase of at least 8 characters.')
  const createdAt = new Date().toISOString(), filename = `LOCAL-backup-${createdAt.slice(0, 10)}.localbackup`
  const salt = crypto.getRandomValues(new Uint8Array(16)), iv = crypto.getRandomValues(new Uint8Array(12))
  const material = await crypto.subtle.importKey('raw', new TextEncoder().encode(passphrase), 'PBKDF2', false, ['deriveBits'])
  const key = new Uint8Array(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: ITERATIONS }, material, 256))
  const header = JSON.stringify({ format: FORMAT, createdAt, kdf: 'PBKDF2-SHA256', iterations: ITERATIONS, salt: bytesToBase64(salt), iv: bytesToBase64(iv) }).slice(0, -1) + ',"ciphertext":"'
  let session: string | undefined
  try {
    session = (await nativeBackup.begin({ key: bytesToBase64(key), iv: bytesToBase64(iv), header })).session
    key.fill(0)
    const write = async (text: string) => {
      for (let offset = 0; offset < text.length;) {
        let end = Math.min(offset + 65536, text.length)
        // Do not divide a UTF-16 surrogate pair across independently encoded chunks.
        if (end < text.length && /[\uD800-\uDBFF]/.test(text[end - 1])) end--
        await nativeBackup.append({ session: session!, text: text.slice(offset, end) })
        offset = end
      }
    }
    await writeBackupJson(source, createdAt, await folderService.list(source), write, onProgress)
    const result = await nativeBackup.finish({ session, filename })
    return { count: source.length, filename, cancelled: result.cancelled }
  } finally {
    key.fill(0)
    if (session) await nativeBackup.abort({ session }).catch(() => undefined)
  }
}

async function keyFor(passphrase: string, salt: Uint8Array, usage: KeyUsage[]) {
  const material = await crypto.subtle.importKey('raw', new TextEncoder().encode(passphrase), 'PBKDF2', false, ['deriveKey'])
  return crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      hash: 'SHA-256',
      salt: salt as BufferSource,
      iterations: ITERATIONS
    },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    usage
  )
}

export async function encryptBackupPayload(payload: BackupPayload, passphrase: string) {
  if (passphrase.length < 8) throw new Error('Use a passphrase of at least 8 characters.')
  const salt = crypto.getRandomValues(new Uint8Array(16)),
    iv = crypto.getRandomValues(new Uint8Array(12))
  const key = await keyFor(passphrase, salt, ['encrypt'])
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(JSON.stringify(payload)))
  const envelope: EncryptedEnvelope = {
    format: FORMAT,
    createdAt: payload.createdAt,
    kdf: 'PBKDF2-SHA256',
    iterations: ITERATIONS,
    salt: bytesToBase64(salt),
    iv: bytesToBase64(iv),
    ciphertext: bytesToBase64(new Uint8Array(ciphertext))
  }
  return new Blob([JSON.stringify(envelope)], {
    type: 'application/vnd.local.backup+json'
  })
}

export async function decryptBackupPayload(source: string | Blob, passphrase: string): Promise<BackupPayload> {
  try {
    const envelope = JSON.parse(typeof source === 'string' ? source : await source.text()) as EncryptedEnvelope
    if (envelope.format !== FORMAT || envelope.kdf !== 'PBKDF2-SHA256' || envelope.iterations !== ITERATIONS) throw new Error('Unsupported backup format.')
    const salt = base64ToBytes(envelope.salt),
      iv = base64ToBytes(envelope.iv),
      key = await keyFor(passphrase, salt, ['decrypt'])
    const plaintext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, base64ToBytes(envelope.ciphertext))
    const payload = JSON.parse(new TextDecoder().decode(plaintext)) as BackupPayload
    validateBackupPayload(payload)
    return payload
  } catch (error) {
    if (error instanceof Error && /unsupported|invalid backup/i.test(error.message)) throw error
    throw new Error('This backup could not be unlocked. Check the passphrase and file.')
  }
}

async function deliverBackup(blob: Blob, filename: string) {
  if (!Capacitor.isNativePlatform()) {
    const url = URL.createObjectURL(blob),
      anchor = window.document.createElement('a')
    anchor.href = url
    anchor.download = filename
    anchor.click()
    setTimeout(() => URL.revokeObjectURL(url), 1500)
    return
  }
  const path = `backups/${filename}`
  await Filesystem.writeFile({
    path,
    data: await blobToBase64(blob),
    directory: Directory.Cache,
    recursive: true
  })
  const uri = (await Filesystem.getUri({ path, directory: Directory.Cache })).uri
  await Share.share({
    title: 'LOCAL encrypted backup',
    text: 'Save this encrypted LOCAL backup somewhere safe.',
    files: [uri],
    dialogTitle: 'Save LOCAL backup'
  })
}

export const backupService = {
  async summary() {
    const documents = await documentsRepository.list()
    return {
      documents: documents.length,
      pages: documents.reduce((total, document) => total + document.pages.length, 0),
      privateDocuments: documents.filter((document) => document.isPrivate).length,
      folders: await folderService.list(documents)
    }
  },

  async create(passphrase: string, onProgress?: (completed: number, total: number) => void) {
    const source = await documentsRepository.list(),
      documents: VaultDocument[] = []
    if (source.some((document) => document.isPrivate)) await appLockService.authenticate()
    if (Capacitor.isNativePlatform()) return createNativeBackup(source, passphrase, onProgress)
    for (const document of source) {
      const visible = document.isPrivate ? await documentsRepository.reveal(document.id) : document
      if (!visible) throw new Error('A private document could not be opened for backup.')
      try {
        documents.push(await portableDocument(visible))
        onProgress?.(documents.length, source.length)
      } finally {
        await privateStorageService.clearSession(visible.privateSessionId)
      }
    }
    const createdAt = new Date().toISOString(),
      folders = await folderService.list(source),
      blob = await encryptBackupPayload({ format: 'local-backup-v2', createdAt, documents, folders }, passphrase)
    const filename = `LOCAL-backup-${createdAt.slice(0, 10)}.localbackup`
    await deliverBackup(blob, filename)
    return { count: documents.length, filename, cancelled: false }
  },

  async inspect(file: File, passphrase: string) {
    const payload = await decryptBackupPayload(file, passphrase),
      existing = await documentsRepository.list()
    const ids = new Set(existing.map((document) => document.id))
    return {
      payload,
      createdAt: payload.createdAt,
      documents: payload.documents.length,
      pages: payload.documents.reduce((total, document) => total + document.pages.length, 0),
      folders: payload.folders ?? [...new Set(payload.documents.map((document) => document.folder))],
      conflicts: payload.documents.filter((document) => ids.has(document.id)).length
    }
  },

  async restorePayload(payload: BackupPayload, policy: RestoreConflictPolicy, onProgress?: (completed: number, total: number) => void) {
    validateBackupPayload(payload)
    const existing = await documentsRepository.list(),
      existingById = new Map(existing.map((document) => [document.id, document]))
    const snapshots: VaultDocument[] = [],
      createdIds: string[] = [],
      restored: VaultDocument[] = []
    let processed = 0
    if (policy === 'replace' && payload.documents.some((document) => existingById.get(document.id)?.isPrivate)) await appLockService.authenticate()
    try {
      for (const folder of payload.folders ?? []) {
        try {
          await folderService.create(folder, [...existing, ...restored])
        } catch (error) {
          if (!(error instanceof Error && /already exists/i.test(error.message))) throw error
        }
      }
      for (const source of payload.documents) {
        const conflict = existingById.get(source.id)
        if (conflict && policy === 'keep') {
          processed += 1
          onProgress?.(processed, payload.documents.length)
          continue
        }
        const copy = Boolean(conflict && policy === 'copy'),
          id = copy ? crypto.randomUUID() : source.id
        if (conflict && policy === 'replace') snapshots.push(conflict.isPrivate ? ((await documentsRepository.reveal(conflict.id)) ?? conflict) : conflict)
        const cleanDocument: VaultDocument = {
          ...source,
          id,
          title: copy ? `${source.title} (restored copy)` : source.title,
          deletedAt: undefined,
          storageProtection: undefined,
          privateSessionId: undefined,
          privatePdfPath: undefined,
          pdfPath: undefined,
          pdfPasswordProtected: false,
          pdfGeneratedAt: undefined,
          pages: source.pages.map((page) => ({
            ...page,
            id: copy ? crypto.randomUUID() : page.id,
            imagePath: undefined,
            originalImagePath: undefined,
            thumbnailPath: undefined,
            ocrImagePath: undefined
          }))
        }
        await documentsRepository.save(cleanDocument)
        if (!conflict || copy) createdIds.push(id)
        restored.push(cleanDocument)
        processed += 1
        onProgress?.(processed, payload.documents.length)
      }
      return {
        count: restored.length,
        skipped: policy === 'keep' ? payload.documents.length - restored.length : 0,
        createdAt: payload.createdAt
      }
    } catch (error) {
      await Promise.all(createdIds.map((id) => documentsRepository.remove(id)))
      await Promise.all(snapshots.map((document) => documentsRepository.save(document)))
      throw new Error(error instanceof Error ? `Restore was rolled back: ${error.message}` : 'Restore failed and was rolled back.')
    }
  }
}
