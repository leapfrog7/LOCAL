import { Capacitor, registerPlugin, type PluginListenerHandle } from '@capacitor/core'
import type { DetectedBarcode, OCRWord, VaultDocument } from '../domain/types'

export type NativeWorkState = 'absent' | 'enqueued' | 'running' | 'succeeded' | 'failed' | 'blocked' | 'cancelled'
export interface NativeOcrPageResult {
  pageId: string
  text: string
  confidence: number
  languages: string[]
  words: OCRWord[]
  barcodes?: DetectedBarcode[]
}
export interface NativeOcrError { pageId?: string; message: string }
export interface NativeOcrResult {
  documentId?: string
  state: 'absent' | 'running' | 'succeeded' | 'failed'
  pages?: NativeOcrPageResult[]
  errors?: NativeOcrError[]
  error?: string
  completedPages?: number
  totalPages?: number
  updatedAt?: string
}

type BackgroundProcessingPlugin = {
  enqueue(options: { documentId: string; replace?: boolean; pages: { id: string; imagePath?: string; ocrImagePath?: string; rotation: number }[] }): Promise<{ workId: string; state: NativeWorkState }>
  cancel(options: { documentId: string }): Promise<{ state: NativeWorkState }>
  status(options: { documentId: string }): Promise<{ workId?: string; state: NativeWorkState }>
  result(options: { documentId: string }): Promise<NativeOcrResult>
  clearResult(options: { documentId: string }): Promise<void>
  addListener(eventName: 'backgroundProcessingChanged', listener: (event: { documentId: string; state: NativeWorkState }) => void): Promise<PluginListenerHandle>
}

const nativeBackgroundProcessing = registerPlugin<BackgroundProcessingPlugin>('BackgroundProcessing')
const available = () => Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android'

export const backgroundProcessingService = {
  available,
  async enqueue(document: VaultDocument, replace = false) {
    if (!available()) return { state: 'absent' as const }
    const pages = document.pages.filter(page => page.ocrState !== 'complete').map(page => ({ id: page.id, imagePath: page.imagePath, ocrImagePath: page.ocrImagePath, rotation: page.rotation }))
    return nativeBackgroundProcessing.enqueue({ documentId: document.id, replace, pages })
  },
  async cancel(documentId: string) {
    if (!available()) return
    await nativeBackgroundProcessing.cancel({ documentId })
  },
  async status(documentId: string) {
    if (!available()) return { state: 'absent' as const }
    return nativeBackgroundProcessing.status({ documentId })
  },
  async result(documentId: string) {
    if (!available()) return { state: 'absent' as const }
    return nativeBackgroundProcessing.result({ documentId })
  },
  async clearResult(documentId: string) {
    if (available()) await nativeBackgroundProcessing.clearResult({ documentId })
  },
  async onChange(listener: (documentId: string, state: NativeWorkState) => void) {
    if (!available()) return () => {}
    const handle = await nativeBackgroundProcessing.addListener('backgroundProcessingChanged', event => listener(event.documentId, event.state))
    return () => { void handle.remove() }
  },
}
