import { Capacitor } from '@capacitor/core'
import { Directory, Filesystem } from '@capacitor/filesystem'
import type { DocumentPage, VaultDocument } from '../domain/types'
import { privateStorageService } from './privateStorageService'

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
  if (!stored.imagePath && isDataUrl(stored.imageUrl)) stored.imagePath = stored.imageUrl === stored.originalImageUrl && stored.originalImagePath ? stored.originalImagePath : await writeImage(documentId, page.id, 'processed', stored.imageUrl)
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

  async size(document: VaultDocument) {
    const paths = [...new Set([...document.pages.flatMap(page => [page.imagePath, page.originalImagePath, page.thumbnailPath, page.ocrImagePath]), document.pdfPath].filter((path): path is string => Boolean(path)))]
    if (Capacitor.isNativePlatform()) {
      const sizes = await Promise.all(paths.map(async path => { try { return Number((await Filesystem.stat({ path, directory: Directory.Data })).size || 0) } catch { return 0 } }))
      return sizes.reduce((total, value) => total + value, 0)
    }
    const urls = [...new Set(document.pages.flatMap(page => [page.imageUrl, page.originalImageUrl, page.thumbnailUrl, page.ocrImageUrl]).filter((url): url is string => Boolean(url?.startsWith('data:'))))]
    return urls.reduce((total, url) => total + Math.floor(base64FromDataUrl(url).length * .75), 0)
  },

  async persist(document: VaultDocument): Promise<VaultDocument> {
    if (!Capacitor.isNativePlatform()) return document
    const pages: DocumentPage[] = []
    for (const page of document.pages) pages.push(await persistPage(document.id, page))
    let stored: VaultDocument = { ...document, storageVersion: 2, pages }
    if (stored.isPrivate) stored = await privateStorageService.protect(stored)
    else if (stored.storageProtection === 'keystore-v1' || stored.pages.some(page => privateStorageService.isEncryptedPath(page.imagePath)) || privateStorageService.isEncryptedPath(stored.pdfPath)) stored = await privateStorageService.unprotect(stored)
    await this.removeFile(`${ROOT}/${document.id}/metadata.json`)
    return stored
  },

  async hydrate(document: VaultDocument, revealPrivate = false): Promise<VaultDocument> {
    if (!Capacitor.isNativePlatform()) return document
    if (document.isPrivate && !revealPrivate) return { ...document, privateSessionId: undefined, pages: document.pages.map(page => ({ ...page, imageUrl: '', originalImageUrl: undefined, thumbnailUrl: undefined, ocrImageUrl: undefined })) }
    const revealed = revealPrivate ? await privateStorageService.revealPaths(document) : { sessionId: undefined, paths: {} as Record<string, string> }
    const visiblePath = (path?: string) => path ? revealed.paths[path] ?? path : undefined
    const pages: DocumentPage[] = []
    for (const page of document.pages) pages.push({
      ...page,
      imageUrl: page.imagePath ? await displayUrl(visiblePath(page.imagePath)) : page.imageUrl,
      originalImageUrl: page.originalImagePath ? await displayUrl(visiblePath(page.originalImagePath)) : page.originalImageUrl,
      thumbnailUrl: page.thumbnailPath ? await displayUrl(visiblePath(page.thumbnailPath)) : page.thumbnailUrl,
      ocrImageUrl: page.ocrImagePath ? await displayUrl(visiblePath(page.ocrImagePath)) : page.ocrImageUrl,
    })
    return { ...document, privateSessionId: revealed.sessionId, privatePdfPath: document.pdfPath ? revealed.paths[document.pdfPath] : undefined, pages }
  },

  async persistPdf(documentId: string, blob: Blob) {
    if (!Capacitor.isNativePlatform()) return undefined
    const path = `${ROOT}/${documentId}/document.pdf`
    await Filesystem.writeFile({ path, data: await blobBase64(blob), directory: Directory.Data, recursive: true })
    return path
  },

  async persistTemporaryPdf(blob: Blob) {
    if (!Capacitor.isNativePlatform()) return undefined
    const path = `${ROOT}/exports/${crypto.randomUUID()}.pdf`
    await Filesystem.writeFile({ path, data: await blobBase64(blob), directory: Directory.Data, recursive: true })
    return path
  },

  async removeFile(path?: string) {
    if (!path || !Capacitor.isNativePlatform()) return
    try { await Filesystem.deleteFile({ path, directory: Directory.Data }) } catch { /* Best-effort cleanup. */ }
  },

  async nativeUri(path: string) {
    return (await Filesystem.getUri({ path, directory: Directory.Data })).uri
  },

  forMetadata(document: VaultDocument): VaultDocument {
    return {
      ...document,
      privateSessionId: undefined,
      privatePdfPath: undefined,
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
