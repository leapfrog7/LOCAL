import { Capacitor } from '@capacitor/core'
import { Share } from '@capacitor/share'
import type { VaultDocument } from '../domain/types'
import type { PdfService } from './contracts'
import { documentStorageService } from './documentStorageService'

const loadImage = (source: string) => new Promise<HTMLImageElement>((resolve, reject) => {
  const image = new Image()
  image.onload = () => resolve(image)
  image.onerror = () => reject(new Error('A scanned page could not be read.'))
  image.src = source
})

const safeFilename = (title: string) => `${title.trim().replace(/[<>:"/\\|?*\u0000-\u001f]/g, '-').replace(/\s+/g, ' ') || 'LOCAL document'}.pdf`

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
      if (page.ocrText.trim()) {
        pdf.setFontSize(Math.max(8, Math.round(width / 90)))
        pdf.text(pdf.splitTextToSize(page.ocrText, width - 32), 16, 24, { baseline: 'top', renderingMode: 'invisible' })
      }
    }
    return pdf!.output('blob')
  },
}

export async function persistSearchablePdf(vaultDocument: VaultDocument): Promise<VaultDocument> {
  const blob = await pdfService.create(vaultDocument)
  const pdfPath = await documentStorageService.persistPdf(vaultDocument.id, blob)
  return { ...vaultDocument, pdfPath, pdfGeneratedAt: new Date().toISOString() }
}

export async function exportPdf(vaultDocument: VaultDocument): Promise<VaultDocument> {
  const filename = safeFilename(vaultDocument.title)
  if (!Capacitor.isNativePlatform()) {
    const blob = await pdfService.create(vaultDocument)
    const url = URL.createObjectURL(blob)
    const anchor = window.document.createElement('a')
    anchor.href = url
    anchor.download = filename
    anchor.click()
    setTimeout(() => URL.revokeObjectURL(url), 1500)
    return vaultDocument
  }
  const ready = vaultDocument.pdfPath ? vaultDocument : await persistSearchablePdf(vaultDocument)
  await Share.share({ title: filename, text: 'Scanned with LOCAL', files: [await documentStorageService.nativeUri(ready.pdfPath!)], dialogTitle: 'Save or share PDF' })
  return ready
}
