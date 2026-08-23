import { Capacitor } from '@capacitor/core'
import { Directory, Filesystem } from '@capacitor/filesystem'
import { Share } from '@capacitor/share'
import type { DocumentPage, VaultDocument } from '../domain/types'
import { documentsRepository } from './documentRepository'
import { documentStorageService } from './documentStorageService'

const FORMAT = 'local-encrypted-backup-v1'
const ITERATIONS = 250_000
interface BackupPayload { format: 'local-backup-v1'; createdAt: string; documents: VaultDocument[] }
interface EncryptedEnvelope { format: typeof FORMAT; createdAt: string; kdf: 'PBKDF2-SHA256'; iterations: number; salt: string; iv: string; ciphertext: string }

const bytesToBase64 = (bytes: Uint8Array) => {
  let binary = ''
  for (let index = 0; index < bytes.length; index += 0x8000) binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000))
  return btoa(binary)
}
const base64ToBytes = (value: string) => Uint8Array.from(atob(value), character => character.charCodeAt(0))
const blobToDataUrl = (blob: Blob) => new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = () => reject(reader.error); reader.readAsDataURL(blob) })
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
    imagePath: undefined, originalImagePath: undefined, thumbnailPath: undefined, ocrImagePath: undefined,
  }
}

async function portableDocument(document: VaultDocument) {
  const pages: DocumentPage[] = []
  for (const page of document.pages) pages.push(await portablePage(page))
  return { ...document, pages, pdfPath: undefined, pdfGeneratedAt: undefined }
}

async function keyFor(passphrase: string, salt: Uint8Array, usage: KeyUsage[]) {
  const material = await crypto.subtle.importKey('raw', new TextEncoder().encode(passphrase), 'PBKDF2', false, ['deriveKey'])
  return crypto.subtle.deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt: salt as BufferSource, iterations: ITERATIONS }, material, { name: 'AES-GCM', length: 256 }, false, usage)
}

export async function encryptBackupPayload(payload: BackupPayload, passphrase: string) {
  if (passphrase.length < 8) throw new Error('Use a passphrase of at least 8 characters.')
  const salt = crypto.getRandomValues(new Uint8Array(16)), iv = crypto.getRandomValues(new Uint8Array(12))
  const key = await keyFor(passphrase, salt, ['encrypt'])
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(JSON.stringify(payload)))
  const envelope: EncryptedEnvelope = { format: FORMAT, createdAt: payload.createdAt, kdf: 'PBKDF2-SHA256', iterations: ITERATIONS, salt: bytesToBase64(salt), iv: bytesToBase64(iv), ciphertext: bytesToBase64(new Uint8Array(ciphertext)) }
  return new Blob([JSON.stringify(envelope)], { type: 'application/vnd.local.backup+json' })
}

export async function decryptBackupPayload(source: string | Blob, passphrase: string): Promise<BackupPayload> {
  try {
    const envelope = JSON.parse(typeof source === 'string' ? source : await source.text()) as EncryptedEnvelope
    if (envelope.format !== FORMAT || envelope.kdf !== 'PBKDF2-SHA256') throw new Error('Unsupported backup format.')
    const salt = base64ToBytes(envelope.salt), iv = base64ToBytes(envelope.iv), key = await keyFor(passphrase, salt, ['decrypt'])
    const plaintext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, base64ToBytes(envelope.ciphertext))
    const payload = JSON.parse(new TextDecoder().decode(plaintext)) as BackupPayload
    if (payload.format !== 'local-backup-v1' || !Array.isArray(payload.documents)) throw new Error('Invalid backup contents.')
    return payload
  } catch (error) {
    if (error instanceof Error && /unsupported|invalid backup/i.test(error.message)) throw error
    throw new Error('This backup could not be unlocked. Check the passphrase and file.')
  }
}

async function deliverBackup(blob: Blob, filename: string) {
  if (!Capacitor.isNativePlatform()) {
    const url = URL.createObjectURL(blob), anchor = window.document.createElement('a')
    anchor.href = url; anchor.download = filename; anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 1500)
    return
  }
  const path = `backups/${filename}`
  await Filesystem.writeFile({ path, data: await blobToBase64(blob), directory: Directory.Cache, recursive: true })
  const uri = (await Filesystem.getUri({ path, directory: Directory.Cache })).uri
  await Share.share({ title: 'LOCAL encrypted backup', text: 'Save this encrypted LOCAL backup somewhere safe.', files: [uri], dialogTitle: 'Save LOCAL backup' })
}

export const backupService = {
  async create(passphrase: string) {
    const source = await documentsRepository.list(), documents: VaultDocument[] = []
    for (const document of source) documents.push(await portableDocument(document))
    const createdAt = new Date().toISOString(), blob = await encryptBackupPayload({ format: 'local-backup-v1', createdAt, documents }, passphrase)
    const filename = `LOCAL-backup-${createdAt.slice(0, 10)}.localbackup`
    await deliverBackup(blob, filename)
    return { count: documents.length, filename }
  },

  async restore(file: File, passphrase: string) {
    const payload = await decryptBackupPayload(file, passphrase)
    for (const document of payload.documents) {
      const cleanDocument = { ...document, pdfPath: undefined, pdfGeneratedAt: undefined, pages: document.pages.map(page => ({ ...page, imagePath: undefined, originalImagePath: undefined, thumbnailPath: undefined, ocrImagePath: undefined })) }
      await documentsRepository.save(cleanDocument)
    }
    return { count: payload.documents.length, createdAt: payload.createdAt }
  },
}
