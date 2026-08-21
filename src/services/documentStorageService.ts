import { Capacitor } from '@capacitor/core'
import { Directory, Encoding, Filesystem } from '@capacitor/filesystem'
import type { DocumentPage, VaultDocument } from '../domain/types'

const ROOT = 'LOCAL/documents'
const isDataUrl = (value?: string) => Boolean(value?.startsWith('data:'))
const base64FromDataUrl = (value: string) => value.slice(value.indexOf(',') + 1)
const extensionFor = (value: string) => value.startsWith('data:image/png') ? 'png' : 'jpg'
const pageFolder = (documentId: string) => `${ROOT}/${documentId}/pages`

const blobBase64 = (blob: Blob) => new Promise<string>((resolve, reject) => {
  const reader = new FileReader()
  reader.onload = () => resolve(String(reader.result).split(',')[1])
  reader.onerror = () => reject(reader.error)
  reader.readAsDataURL(blob)
})

async function writeImage(documentId: string, pageId: string, suffix: string, value: string) {
  const path = `${pageFolder(documentId)}/${pageId}-${suffix}.${extensionFor(value)}`
  await Filesystem.writeFile({ path, data: base64FromDataUrl(value), directory: Directory.Data, recursive: true })
  return path
}

async function displayUrl(path?: string) {
  if (!path) return ''
  const result = await Filesystem.getUri({ path, directory: Directory.Data })
  return Capacitor.convertFileSrc(result.uri)
}

async function persistPage(documentId: string, page: DocumentPage): Promise<DocumentPage> {
  const stored = { ...page }
  if (!stored.originalImagePath && isDataUrl(stored.originalImageUrl)) stored.originalImagePath = await writeImage(documentId, page.id, 'original', stored.originalImageUrl!)
  if (!stored.imagePath && isDataUrl(stored.imageUrl)) stored.imagePath = await writeImage(documentId, page.id, 'processed', stored.imageUrl)
  if (!stored.ocrImagePath && isDataUrl(stored.ocrImageUrl)) stored.ocrImagePath = await writeImage(documentId, page.id, 'ocr', stored.ocrImageUrl!)
  if (!stored.thumbnailPath && isDataUrl(stored.thumbnailUrl)) {
    stored.thumbnailPath = stored.thumbnailUrl === stored.imageUrl && stored.imagePath
      ? stored.imagePath
      : await writeImage(documentId, page.id, 'thumbnail', stored.thumbnailUrl!)
  }
  return stored
}

export const documentStorageService = {
  usesNativeFiles: () => Capacitor.isNativePlatform(),

  async persist(document: VaultDocument): Promise<VaultDocument> {
    if (!Capacitor.isNativePlatform()) return document
    const pages: DocumentPage[] = []
    for (const page of document.pages) pages.push(await persistPage(document.id, page))
    const stored = { ...document, storageVersion: 1, pages }
    const metadata = this.forMetadata(stored)
    await Filesystem.writeFile({ path: `${ROOT}/${document.id}/metadata.json`, data: JSON.stringify(metadata, null, 2), directory: Directory.Data, encoding: Encoding.UTF8, recursive: true })
    return stored
  },

  async hydrate(document: VaultDocument): Promise<VaultDocument> {
    if (!Capacitor.isNativePlatform()) return document
    const pages: DocumentPage[] = []
    for (const page of document.pages) pages.push({
      ...page,
      imageUrl: page.imagePath ? await displayUrl(page.imagePath) : page.imageUrl,
      originalImageUrl: page.originalImagePath ? await displayUrl(page.originalImagePath) : page.originalImageUrl,
      thumbnailUrl: page.thumbnailPath ? await displayUrl(page.thumbnailPath) : page.thumbnailUrl,
      ocrImageUrl: page.ocrImagePath ? await displayUrl(page.ocrImagePath) : page.ocrImageUrl,
    })
    return { ...document, pages }
  },

  async persistPdf(documentId: string, blob: Blob) {
    if (!Capacitor.isNativePlatform()) return undefined
    const path = `${ROOT}/${documentId}/document.pdf`
    await Filesystem.writeFile({ path, data: await blobBase64(blob), directory: Directory.Data, recursive: true })
    return path
  },

  async nativeUri(path: string) {
    return (await Filesystem.getUri({ path, directory: Directory.Data })).uri
  },

  forMetadata(document: VaultDocument): VaultDocument {
    return {
      ...document,
      pages: document.pages.map(page => ({
        ...page,
        imageUrl: page.imagePath ? '' : page.imageUrl,
        originalImageUrl: page.originalImagePath ? undefined : page.originalImageUrl,
        thumbnailUrl: page.thumbnailPath ? undefined : page.thumbnailUrl,
        ocrImageUrl: page.ocrImagePath ? undefined : page.ocrImageUrl,
      })),
    }
  },

  async remove(documentId: string) {
    if (!Capacitor.isNativePlatform()) return
    try { await Filesystem.rmdir({ path: `${ROOT}/${documentId}`, directory: Directory.Data, recursive: true }) }
    catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      if (!/not found|does not exist/i.test(message)) throw error
    }
  },
}
