import type { AnnotationStroke } from '../domain/types'
import { Capacitor } from '@capacitor/core'
import { sqliteRepository } from './sqliteRepository'

interface StoredAnnotationDraft {
  version: 1
  documentUpdatedAt: string
  savedAt: string
  pages: Record<string, AnnotationStroke[]>
}

const keyFor = (documentId: string) => `local.annotation-draft.${documentId}`
const nativeKeyFor = (documentId: string) => `annotation_draft:${documentId}`

const validStroke = (value: unknown): value is AnnotationStroke => {
  if (!value || typeof value !== 'object') return false
  const stroke = value as Partial<AnnotationStroke>
  return typeof stroke.id === 'string'
    && ['pen', 'highlighter', 'line', 'arrow', 'rectangle', 'ellipse', 'text'].includes(stroke.tool ?? '')
    && typeof stroke.color === 'string'
    && typeof stroke.width === 'number'
    && Number.isFinite(stroke.width)
    && Array.isArray(stroke.points)
    && stroke.points.every(point => point && Number.isFinite(point.x) && Number.isFinite(point.y))
    && (stroke.tool !== 'text' || typeof stroke.text === 'string')
}

export const annotationDraftService = {
  async read(documentId: string, documentUpdatedAt: string): Promise<Record<string, AnnotationStroke[]> | undefined> {
    try {
      const raw = Capacitor.isNativePlatform() ? await sqliteRepository.getSetting(nativeKeyFor(documentId)) : localStorage.getItem(keyFor(documentId))
      const stored = JSON.parse(raw ?? '') as StoredAnnotationDraft
      if (stored.version !== 1 || stored.documentUpdatedAt !== documentUpdatedAt || !stored.pages || typeof stored.pages !== 'object') return undefined
      const pages = Object.fromEntries(Object.entries(stored.pages).filter(([, strokes]) => Array.isArray(strokes) && strokes.every(validStroke)))
      return pages
    } catch { return undefined }
  },
  async write(documentId: string, documentUpdatedAt: string, pages: Record<string, AnnotationStroke[]>) {
    try {
      const payload: StoredAnnotationDraft = { version: 1, documentUpdatedAt, savedAt: new Date().toISOString(), pages }
      if (Capacitor.isNativePlatform()) await sqliteRepository.setSetting(nativeKeyFor(documentId), JSON.stringify(payload))
      else localStorage.setItem(keyFor(documentId), JSON.stringify(payload))
      return true
    } catch { return false }
  },
  async clear(documentId: string) {
    try {
      if (Capacitor.isNativePlatform()) await sqliteRepository.setSetting(nativeKeyFor(documentId), '')
      else localStorage.removeItem(keyFor(documentId))
    } catch { /* Draft cleanup is best effort. */ }
  }
}
