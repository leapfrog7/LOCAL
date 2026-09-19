import type { BackupPayload } from './backupService'

/** Backup contents are untrusted, even when their encryption tag is valid. */
export function validateBackupPayload(value: unknown): asserts value is BackupPayload {
  const fail = (): never => { throw new Error('Invalid backup contents. No documents were restored.') }
  const object = (item: unknown): Record<string, unknown> => item && typeof item === 'object' && !Array.isArray(item) ? item as Record<string, unknown> : fail()
  const text = (item: unknown) => typeof item === 'string'
  const id = (item: unknown) => text(item) && /^[A-Za-z0-9_-]{1,128}$/.test(item as string)
  const strings = (item: unknown) => Array.isArray(item) && item.every(text)
  const payload = object(value)
  if (!['local-backup-v1', 'local-backup-v2'].includes(payload.format as string) || !text(payload.createdAt) || !Array.isArray(payload.documents)) fail()
  if (payload.folders !== undefined && !strings(payload.folders)) fail()
  const ids = new Set<string>()
  for (const item of payload.documents as unknown[]) {
    const document = object(item)
    if (!id(document.id) || ids.has(document.id as string) || !text(document.title) || !text(document.folder) || !strings(document.tags) || !Array.isArray(document.pages) || !text(document.createdAt) || !text(document.updatedAt)) fail()
    ids.add(document.id as string)
    if (!['saved', 'ocr_pending', 'ocr_processing', 'indexed', 'error'].includes(document.status as string)) fail()
    if (document.isPrivate !== undefined && typeof document.isPrivate !== 'boolean') fail()
    const pageIds = new Set<string>()
    for (const item of document.pages as unknown[]) {
      const page = object(item)
      if (!id(page.id) || pageIds.has(page.id as string) || !text(page.ocrText) || ![0, 90, 180, 270].includes(page.rotation as number) || !['pending', 'processing', 'complete', 'error'].includes(page.ocrState as string)) fail()
      pageIds.add(page.id as string)
      for (const field of ['imageUrl', 'originalImageUrl', 'thumbnailUrl', 'ocrImageUrl']) {
        const image = page[field]
        if (image === undefined && field !== 'imageUrl') continue
        // Never restore a URL that could load remote content or refer to another
        // document's files. Paths are stripped separately before persistence.
        if (typeof image !== 'string' || !/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/]*={0,2}$/.test(image)) fail()
      }
    }
  }
}
