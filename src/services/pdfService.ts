import { Capacitor, registerPlugin } from '@capacitor/core'
import { Share } from '@capacitor/share'
import type { DocumentPage, VaultDocument } from '../domain/types'
import type { PdfService } from './contracts'
import { documentStorageService } from './documentStorageService'

const loadImage = (source: string) => new Promise<HTMLImageElement>((resolve, reject) => {
  const image = new Image()
  image.onload = () => resolve(image)
  image.onerror = () => reject(new Error('A scanned page could not be read.'))
  image.src = source
})

const safeFilename = (title: string) => `${title.trim().replace(/[<>:"/\\|?*\u0000-\u001f]/g, '-').replace(/\s+/g, ' ') || 'LOCAL document'}.pdf`
type PdfDownloadPlugin = {
  savePdf(options: { sourcePath: string; filename: string }): Promise<{ location: string; uri: string }>
  openPdf(): Promise<void>
  protectPdf(options: { sourcePath: string; password: string }): Promise<{ algorithm: 'AES-256' }>
}
const nativePdfDownload = registerPlugin<PdfDownloadPlugin>('PdfDownload')
export function rotatedBox(box: { x: number; y: number; width: number; height: number }, rotation: number) {
  if (rotation === 90) return { x: 1 - box.y - box.height, y: box.x, width: box.height, height: box.width }
  if (rotation === 180) return { x: 1 - box.x - box.width, y: 1 - box.y - box.height, width: box.width, height: box.height }
  if (rotation === 270) return { x: box.y, y: 1 - box.x - box.width, width: box.height, height: box.width }
  return box
}
type PdfTextLayer = { setFontSize(size: number): unknown; text(value: string | string[], x: number, y: number, options: Record<string, unknown>): unknown; splitTextToSize(value: string, width: number): string[] }
export function addOcrTextLayer(pdf: PdfTextLayer, page: DocumentPage, width: number, height: number) {
  if (page.ocrWords?.length) for (const word of page.ocrWords) {
    const box = rotatedBox(word.boundingBox, page.rotation); pdf.setFontSize(Math.max(3, box.height * height * .82)); pdf.text(word.text, box.x * width, (box.y + box.height * .82) * height, { renderingMode: 'invisible', maxWidth: Math.max(2, box.width * width) })
  }
  else if (page.ocrText.trim()) { pdf.setFontSize(Math.max(8, Math.round(width / 90))); pdf.text(pdf.splitTextToSize(page.ocrText, width - 32), 16, 24, { baseline: 'top', renderingMode: 'invisible' }) }
}

export const pdfService: PdfService = {
  async create(vaultDocument) {
    if (!vaultDocument.pages.length) throw new Error('This document has no pages.')
    const { jsPDF } = await import('jspdf')
    let pdf: InstanceType<typeof jsPDF> | undefined

    for (const [index, page] of vaultDocument.pages.entries()) {
      const image = await loadImage(page.imageUrl)
      const sideways = page.rotation % 180 !== 0
      const width = sideways ? image.height : image.width
      const height = sideways ? image.width : image.height
      const orientation = width > height ? 'landscape' : 'portrait'
      if (!pdf) pdf = new jsPDF({ orientation, unit: 'px', format: [width, height], hotfixes: ['px_scaling'] })
      else pdf.addPage([width, height], orientation)

      const canvas = window.document.createElement('canvas')
      canvas.width = width
      canvas.height = height
      const context = canvas.getContext('2d')
      if (!context) throw new Error('PDF generation is unavailable on this device.')
      context.translate(width / 2, height / 2)
      context.rotate(page.rotation * Math.PI / 180)
      context.drawImage(image, -image.width / 2, -image.height / 2)
      pdf.addImage(canvas.toDataURL('image/jpeg', 0.88), 'JPEG', 0, 0, width, height, `page-${index}`, 'FAST')
      addOcrTextLayer(pdf, page, width, height)
    }
    return pdf!.output('blob')
  },
}

export async function persistSearchablePdf(vaultDocument: VaultDocument): Promise<VaultDocument> {
  const blob = await pdfService.create(vaultDocument)
  const pdfPath = await documentStorageService.persistPdf(vaultDocument.id, blob)
  return { ...vaultDocument, pdfPath, pdfGeneratedAt: new Date().toISOString() }
}

async function ensurePersistedPdf(vaultDocument: VaultDocument) {
  return vaultDocument.pdfPath ? vaultDocument : persistSearchablePdf(vaultDocument)
}

export async function passwordProtectPdf(vaultDocument: VaultDocument, password: string): Promise<VaultDocument> {
  if (!Capacitor.isNativePlatform()) throw new Error('PDF password protection is available in the Android app.')
  if (password.length < 8) throw new Error('Use a PDF password of at least 8 characters.')
  const unprotected = await persistSearchablePdf({ ...vaultDocument, pdfPasswordProtected: false })
  await nativePdfDownload.protectPdf({ sourcePath: unprotected.pdfPath!, password })
  return { ...unprotected, pdfPasswordProtected: true, updatedAt: new Date().toISOString() }
}

export async function removePdfPassword(vaultDocument: VaultDocument): Promise<VaultDocument> {
  const unprotected = await persistSearchablePdf({ ...vaultDocument, pdfPasswordProtected: false })
  return { ...unprotected, pdfPasswordProtected: false, updatedAt: new Date().toISOString() }
}

export async function downloadPdf(vaultDocument: VaultDocument): Promise<VaultDocument> {
  const filename = safeFilename(vaultDocument.title)
  console.info('[pdf] download started', { documentId: vaultDocument.id, native: Capacitor.isNativePlatform(), hasPersistedPdf: Boolean(vaultDocument.pdfPath) })
  if (!Capacitor.isNativePlatform()) {
    const blob = await pdfService.create(vaultDocument)
    const url = URL.createObjectURL(blob)
    const anchor = window.document.createElement('a')
    anchor.href = url
    anchor.download = filename
    anchor.click()
    setTimeout(() => URL.revokeObjectURL(url), 1500)
    console.info('[pdf] browser download started', { documentId: vaultDocument.id, filename })
    return vaultDocument
  }
  const ready = await ensurePersistedPdf(vaultDocument)
  const result = await nativePdfDownload.savePdf({ sourcePath: ready.pdfPath!, filename })
  console.info('[pdf] saved to Android Downloads', { documentId: vaultDocument.id, location: result.location })
  return ready
}

export async function openDownloadedPdf() {
  if (!Capacitor.isNativePlatform()) throw new Error('Open the PDF from your browser downloads.')
  await nativePdfDownload.openPdf()
}

export async function sharePdf(vaultDocument: VaultDocument): Promise<VaultDocument> {
  const filename = safeFilename(vaultDocument.title)
  console.info('[pdf] share started', { documentId: vaultDocument.id, native: Capacitor.isNativePlatform(), hasPersistedPdf: Boolean(vaultDocument.pdfPath) })
  if (!Capacitor.isNativePlatform()) {
    const blob = await pdfService.create(vaultDocument)
    const file = new File([blob], filename, { type: 'application/pdf' })
    if (!navigator.share || (navigator.canShare && !navigator.canShare({ files: [file] }))) throw new Error('PDF file sharing is unavailable in this browser.')
    await navigator.share({ title: filename, text: 'Scanned with LOCAL', files: [file] })
    return vaultDocument
  }
  const ready = await ensurePersistedPdf(vaultDocument)
  const uri = await documentStorageService.nativeUri(ready.pdfPath!)
  console.info('[pdf] opening Android share dialog', { documentId: vaultDocument.id, pdfPath: ready.pdfPath })
  try { await Share.share({ title: filename, text: 'Scanned with LOCAL', files: [uri], dialogTitle: 'Share PDF' }) }
  catch (error) { console.error('[pdf] Android share dialog failed', { documentId: vaultDocument.id, pdfPath: ready.pdfPath, error: error instanceof Error ? error.message : String(error) }); throw error }
  console.info('[pdf] share completed', { documentId: vaultDocument.id })
  return ready
}
