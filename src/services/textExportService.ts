import { Capacitor } from '@capacitor/core'
import { Share } from '@capacitor/share'
import { pageIndexes, selectedPageText } from './textSelection'
import type { VaultDocument } from '../domain/types'

const safeName = (value: string) => value.trim().replace(/[<>:"/\\|?*\u0000-\u001f]/g, '-').replace(/\s+/g, ' ') || 'LOCAL document'

export async function exportOcrText(document: VaultDocument, format: 'txt' | 'md', indexes = document.pages.map((_, index) => index)) {
  const selected = pageIndexes(indexes, document.pages.length)
  if (!selected.length) throw new Error('Select at least one page.')
  const content = `${format === 'md' ? '# ' : ''}${document.title}\n\n${selectedPageText(document, selected, format)}\n`
  if (Capacitor.isNativePlatform()) {
    await Share.share({ title: `${document.title}.${format}`, text: content, dialogTitle: 'Export OCR text' })
    return
  }
  const url = URL.createObjectURL(new Blob([content], { type: format === 'md' ? 'text/markdown' : 'text/plain' }))
  const anchor = Object.assign(globalThis.document.createElement('a'), { href: url, download: `${safeName(document.title)}.${format}` })
  anchor.click(); URL.revokeObjectURL(url)
}
