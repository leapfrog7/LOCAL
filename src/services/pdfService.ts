import { Capacitor, registerPlugin } from '@capacitor/core'
import { Share } from '@capacitor/share'
import type { DocumentPage, VaultDocument } from '../domain/types'
import { drawAnnotations } from './annotationRendering'
import type { PdfRenderOptions, PdfService } from './contracts'
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
  openPdf(options?: { sourcePath?: string }): Promise<void>
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
  async create(vaultDocument, options: PdfRenderOptions = {}) {
    if (!vaultDocument.pages.length) throw new Error('This document has no pages.')
    const { jsPDF } = await import('jspdf')
    let pdf: InstanceType<typeof jsPDF> | undefined

    for (const [index, page] of vaultDocument.pages.entries()) {
      const image = await loadImage(page.imageUrl)
      const sideways = page.rotation % 180 !== 0
      const naturalWidth = sideways ? image.height : image.width
      const naturalHeight = sideways ? image.width : image.height
      const scale = options.maxPageDimension ? Math.min(1, options.maxPageDimension / Math.max(naturalWidth, naturalHeight)) : 1
      const width = Math.max(1, Math.round(naturalWidth * scale))
      const height = Math.max(1, Math.round(naturalHeight * scale))
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
      context.drawImage(image, -image.width * scale / 2, -image.height * scale / 2, image.width * scale, image.height * scale)
      context.translate(-image.width * scale / 2, -image.height * scale / 2)
      drawAnnotations(context, page.annotations?.strokes ?? [], image.width * scale, image.height * scale)
      pdf.addImage(canvas.toDataURL('image/jpeg', options.jpegQuality ?? 0.88), 'JPEG', 0, 0, width, height, `page-${index}`, 'FAST')
      addOcrTextLayer(pdf, page, width, height)
    }
    return pdf!.output('blob')
  },
}

export async function persistSearchablePdf(vaultDocument: VaultDocument): Promise<VaultDocument> {
  const blob = await pdfService.create(vaultDocument)
  const pdfPath = await documentStorageService.persistPdf(vaultDocument.id, blob)
  return { ...vaultDocument, pdfPath, privatePdfPath: undefined, pdfGeneratedAt: new Date().toISOString() }
}

async function ensurePersistedPdf(vaultDocument: VaultDocument) {
  if (vaultDocument.pdfPasswordProtected && !vaultDocument.pdfPath) throw new Error('The protected PDF is missing. Add its password again before exporting.')
  return vaultDocument.pdfPath ? vaultDocument : persistSearchablePdf(vaultDocument)
}

export type PdfCompressionLevel = 'high-quality' | 'balanced' | 'small'
export const PDF_COMPRESSION: Record<PdfCompressionLevel, { label: string; description: string; jpegQuality: number; maxPageDimension: number }> = {
  'high-quality': { label: 'High quality', description: 'Clear text with a modest size reduction', jpegQuality: .82, maxPageDimension: 2400 },
  balanced: { label: 'Balanced', description: 'Good for email and everyday sharing', jpegQuality: .66, maxPageDimension: 1800 },
  small: { label: 'Small size', description: 'Strong compression for messaging apps', jpegQuality: .48, maxPageDimension: 1280 },
}

export async function downloadCompressedPdf(vaultDocument: VaultDocument, level: PdfCompressionLevel) {
  if (vaultDocument.pdfPasswordProtected) throw new Error('Compression creates an unlocked PDF. Remove PDF password protection explicitly before using compression, or share the protected original.')
  const settings = PDF_COMPRESSION[level]
  const blob = await pdfService.create(vaultDocument, settings)
  const filename = safeFilename(`${vaultDocument.title} - compressed`)
  if (!Capacitor.isNativePlatform()) {
    const url = URL.createObjectURL(blob)
    const anchor = window.document.createElement('a'); anchor.href = url; anchor.download = filename; anchor.click()
    setTimeout(() => URL.revokeObjectURL(url), 1500)
    return { bytes: blob.size, filename }
  }
  const path = await documentStorageService.persistTemporaryPdf(blob)
  try {
    if (!path) throw new Error('Could not prepare the compressed PDF.')
    await nativePdfDownload.savePdf({ sourcePath: path, filename })
    return { bytes: blob.size, filename }
  } finally { await documentStorageService.removeFile(path) }
}

export async function passwordProtectPdf(vaultDocument: VaultDocument, password: string): Promise<VaultDocument> {
  if (!Capacitor.isNativePlatform()) throw new Error('PDF password protection is available in the Android app.')
  if (password.length < 8) throw new Error('Use a PDF password of at least 8 characters.')
  const blob = await pdfService.create(vaultDocument)
  const path = await documentStorageService.persistVersionedPdf(vaultDocument.id, blob)
  if (!path) throw new Error('Could not prepare the PDF for password protection.')
  try {
    await nativePdfDownload.protectPdf({ sourcePath: path, password })
    return { ...vaultDocument, pdfPath: path, privatePdfPath: undefined, pdfGeneratedAt: new Date().toISOString(), pdfPasswordProtected: true, updatedAt: new Date().toISOString() }
  } catch (error) { await documentStorageService.removeFile(path); throw error }
}

export async function removePdfPassword(vaultDocument: VaultDocument): Promise<VaultDocument> {
  const blob = await pdfService.create(vaultDocument)
  const pdfPath = await documentStorageService.persistVersionedPdf(vaultDocument.id, blob)
  const unprotected = { ...vaultDocument, pdfPath, privatePdfPath: undefined, pdfGeneratedAt: new Date().toISOString() }
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
  const result = await nativePdfDownload.savePdf({ sourcePath: ready.privatePdfPath ?? ready.pdfPath!, filename })
  console.info('[pdf] saved to Android Downloads')
  return ready
}

export async function openDownloadedPdf() {
  if (!Capacitor.isNativePlatform()) throw new Error('Open the PDF from your browser downloads.')
  await nativePdfDownload.openPdf()
}

export async function openPdfExternally(vaultDocument: VaultDocument): Promise<VaultDocument> {
  if (!Capacitor.isNativePlatform()) throw new Error('Use your browser download to open this PDF in another app.')
  const ready = await ensurePersistedPdf(vaultDocument)
  await nativePdfDownload.openPdf({ sourcePath: ready.privatePdfPath ?? ready.pdfPath! })
  return ready
}

export async function sharePdf(vaultDocument: VaultDocument): Promise<VaultDocument> {
  const filename = safeFilename(vaultDocument.title)
  console.info('[pdf] share started', { native: Capacitor.isNativePlatform(), hasPersistedPdf: Boolean(vaultDocument.pdfPath) })
  if (!Capacitor.isNativePlatform()) {
    const blob = await pdfService.create(vaultDocument)
    const file = new File([blob], filename, { type: 'application/pdf' })
    if (!navigator.share || (navigator.canShare && !navigator.canShare({ files: [file] }))) throw new Error('PDF file sharing is unavailable in this browser.')
    await navigator.share({ title: filename, text: 'Scanned with LOCAL', files: [file] })
    return vaultDocument
  }
  const ready = await ensurePersistedPdf(vaultDocument)
  const uri = await documentStorageService.nativeUri(ready.privatePdfPath ?? ready.pdfPath!)
  console.info('[pdf] opening Android share dialog')
  try { await Share.share({ title: filename, text: 'Scanned with LOCAL', files: [uri], dialogTitle: 'Share PDF' }) }
  catch (error) { console.error('[pdf] Android share dialog failed', { error: error instanceof Error ? error.message : String(error) }); throw error }
  console.info('[pdf] share completed')
  return ready
}
