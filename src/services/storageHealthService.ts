import type { DocumentPage } from '../domain/types'

const base64Bytes = (value?: string) => value?.startsWith('data:') ? Math.ceil((value.length - value.indexOf(',') - 1) * .75) : 0

export interface StoragePreflight { ok: boolean; requiredBytes: number; availableBytes?: number; message?: string }

export async function checkDocumentStorage(pages: DocumentPage[]): Promise<StoragePreflight> {
  const sourceBytes = pages.reduce((total, page) => total + base64Bytes(page.originalImageUrl) + base64Bytes(page.imageUrl) + base64Bytes(page.ocrImageUrl) + base64Bytes(page.thumbnailUrl), 0)
  const requiredBytes = Math.max(12 * 1024 * 1024, Math.ceil(sourceBytes * 1.35))
  if (!navigator.storage?.estimate) return { ok: true, requiredBytes }
  const estimate = await navigator.storage.estimate()
  if (estimate.quota == null || estimate.usage == null) return { ok: true, requiredBytes }
  const availableBytes = Math.max(0, estimate.quota - estimate.usage)
  return {
    ok: availableBytes >= requiredBytes,
    requiredBytes,
    availableBytes,
    message: availableBytes < requiredBytes ? `Not enough free app storage. Free at least ${Math.ceil((requiredBytes - availableBytes) / 1048576)} MB and try again.` : undefined,
  }
}
