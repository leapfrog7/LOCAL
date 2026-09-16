import { Capacitor, registerPlugin } from '@capacitor/core'
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import type { DocumentPage } from '../domain/types'
import { nativeScansToPages } from './scannerService'

type ImportedPage = { uri: string; name: string }
type ImportResult = { cancelled: boolean; title?: string; pages: ImportedPage[] }
type PdfImportPlugin = { pick(): Promise<ImportResult> }

const importer = registerPlugin<PdfImportPlugin>('PdfImport')

function chooseBrowserPdf() {
  return new Promise<File | null>((resolve) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = 'application/pdf,.pdf'
    input.hidden = true
    const finish = (file: File | null) => {
      input.remove()
      resolve(file)
    }
    input.addEventListener('change', () => finish(input.files?.[0] ?? null), { once: true })
    input.addEventListener('cancel', () => finish(null), { once: true })
    document.body.append(input)
    input.click()
  })
}

async function renderBrowserPdf(file: File) {
  const { GlobalWorkerOptions, getDocument } = await import('pdfjs-dist')
  GlobalWorkerOptions.workerSrc = pdfWorkerUrl
  const task = getDocument({ data: await file.arrayBuffer() })
  const pdf = await task.promise
  const pages: File[] = []
  try {
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
      const page = await pdf.getPage(pageNumber)
      const original = page.getViewport({ scale: 1 })
      const scale = Math.min(2, 1800 / Math.max(original.width, original.height))
      const viewport = page.getViewport({ scale })
      const canvas = document.createElement('canvas')
      canvas.width = Math.max(1, Math.round(viewport.width))
      canvas.height = Math.max(1, Math.round(viewport.height))
      const context = canvas.getContext('2d', { alpha: false })
      if (!context) throw new Error('This browser could not prepare the PDF pages.')
      context.fillStyle = '#ffffff'
      context.fillRect(0, 0, canvas.width, canvas.height)
      await page.render({ canvas, canvasContext: context, viewport }).promise
      const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(value => value ? resolve(value) : reject(new Error('A PDF page could not be rendered.')), 'image/jpeg', .92))
      pages.push(new File([blob], `page-${String(pageNumber).padStart(3, '0')}.jpg`, { type: 'image/jpeg' }))
      page.cleanup()
    }
  } finally {
    await pdf.cleanup()
    await task.destroy()
  }
  return pages
}

async function pageFile(page: ImportedPage) {
  const response = await fetch(Capacitor.convertFileSrc(page.uri))
  if (!response.ok) throw new Error(`Could not read ${page.name}.`)
  const blob = await response.blob()
  return new File([blob], page.name, { type: 'image/jpeg' })
}

export const pdfImportService = {
  available: () => Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android',

  async pick(): Promise<{ cancelled: boolean; title: string; pages: DocumentPage[] }> {
    if (!this.available()) {
      const file = await chooseBrowserPdf()
      if (!file) return { cancelled: true, title: '', pages: [] }
      const rendered = await renderBrowserPdf(file)
      if (!rendered.length) throw new Error('The selected PDF contains no pages.')
      return { cancelled: false, title: file.name.replace(/\.pdf$/i, '').trim() || 'Imported PDF', pages: await nativeScansToPages(rendered) }
    }
    const result = await importer.pick()
    if (result.cancelled) return { cancelled: true, title: '', pages: [] }
    if (!result.pages.length) throw new Error('The selected PDF contains no pages.')
    const files: File[] = []
    for (const page of result.pages) files.push(await pageFile(page))
    return { cancelled: false, title: result.title?.trim() || 'Imported PDF', pages: await nativeScansToPages(files) }
  },
}
