import { Capacitor } from '@capacitor/core'
import { Share } from '@capacitor/share'
import type { VaultDocument } from '../domain/types'

const safeName = (value: string) => value.trim().replace(/[<>:"/\\|?*\u0000-\u001f]/g, '-').replace(/\s+/g, ' ') || 'LOCAL document'

export async function exportOcrText(document: VaultDocument, format: 'txt' | 'md') {
  const sections = document.pages.map((page, index) => {
    const text = page.ocrText.trim() || '[No searchable text found on this page]'
    return format === 'md' ? `## Page ${index + 1}\n\n${text}` : `Page ${index + 1}\n${text}`
  })
  const content = format === 'md' ? `# ${document.title}\n\n${sections.join('\n\n---\n\n')}\n` : `${document.title}\n\n${sections.join('\n\n----------------\n\n')}\n`
  if (Capacitor.isNativePlatform()) {
    await Share.share({ title: `${document.title}.${format}`, text: content, dialogTitle: 'Export OCR text' })
    return
  }
  const url = URL.createObjectURL(new Blob([content], { type: format === 'md' ? 'text/markdown' : 'text/plain' }))
  const anchor = Object.assign(globalThis.document.createElement('a'), { href: url, download: `${safeName(document.title)}.${format}` })
  anchor.click(); URL.revokeObjectURL(url)
}
