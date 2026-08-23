import { Capacitor, registerPlugin } from '@capacitor/core'
import type { DocumentPage } from '../domain/types'
import { nativeScansToPages } from './scannerService'

type ImportedPage = { uri: string; name: string }
type ImportResult = { cancelled: boolean; title?: string; pages: ImportedPage[] }
type PdfImportPlugin = { pick(): Promise<ImportResult> }

const importer = registerPlugin<PdfImportPlugin>('PdfImport')

async function pageFile(page: ImportedPage) {
  const response = await fetch(Capacitor.convertFileSrc(page.uri))
  if (!response.ok) throw new Error(`Could not read ${page.name}.`)
  const blob = await response.blob()
  return new File([blob], page.name, { type: 'image/jpeg' })
}

export const pdfImportService = {
  available: () => Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android',

  async pick(): Promise<{ cancelled: boolean; title: string; pages: DocumentPage[] }> {
    if (!this.available()) throw new Error('PDF import is available in the Android app.')
    const result = await importer.pick()
    if (result.cancelled) return { cancelled: true, title: '', pages: [] }
    if (!result.pages.length) throw new Error('The selected PDF contains no pages.')
    const files: File[] = []
    for (const page of result.pages) files.push(await pageFile(page))
    return { cancelled: false, title: result.title?.trim() || 'Imported PDF', pages: await nativeScansToPages(files) }
  },
}
