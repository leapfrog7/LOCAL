import type { DocumentPage } from '../domain/types'
import { preparePage } from '../features/scanner/services/scannerProcessingService'

const toDataUrl = (file: File) => new Promise<string>((resolve, reject) => {
  const reader = new FileReader()
  reader.onload = () => resolve(String(reader.result))
  reader.onerror = () => reject(reader.error)
  reader.readAsDataURL(file)
})

export async function filesToPages(files: FileList | File[]): Promise<DocumentPage[]> {
  const pages: DocumentPage[] = []
  for (const file of Array.from(files)) {
    const originalImageUrl = await toDataUrl(file)
    pages.push(await preparePage(crypto.randomUUID(), originalImageUrl))
  }
  return pages
}
