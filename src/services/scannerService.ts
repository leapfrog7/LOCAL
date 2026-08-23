import type { DocumentPage, PageCorners } from '../domain/types'
import { prepareNativeScannedPage, preparePage } from '../features/scanner/services/scannerProcessingService'

const toDataUrl = (file: File) => new Promise<string>((resolve, reject) => {
  const reader = new FileReader()
  reader.onload = () => resolve(String(reader.result))
  reader.onerror = () => reject(reader.error)
  reader.readAsDataURL(file)
})

export async function filesToPages(files: FileList | File[], proposed?: { corners: PageCorners; confidence: number }): Promise<DocumentPage[]> {
  const pages: DocumentPage[] = []
  for (const file of Array.from(files)) {
    const originalImageUrl = await toDataUrl(file)
    pages.push(await preparePage(crypto.randomUUID(), originalImageUrl, files.length === 1 ? proposed : undefined))
  }
  return pages
}

export async function nativeScansToPages(files: File[]): Promise<DocumentPage[]> {
  return Promise.all(files.map(async file => prepareNativeScannedPage(crypto.randomUUID(), await toDataUrl(file))))
}
