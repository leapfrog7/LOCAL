import type { AnnotationPoint, AnnotationStroke, DocumentPage, VaultDocument } from '../domain/types'
import { copyDocumentPages } from './documentOperationsService'
import { pdfService } from './pdfService'
import { documentStorageService } from './documentStorageService'
import { drawAnnotations } from './annotationRendering'

export const clampAnnotationPoint = (point: AnnotationPoint): AnnotationPoint => ({
  x: Math.min(1, Math.max(0, point.x)),
  y: Math.min(1, Math.max(0, point.y))
})

export function pointToSource(point: AnnotationPoint, rotation: number): AnnotationPoint {
  const normalized = ((rotation % 360) + 360) % 360
  if (normalized === 90) return { x: point.y, y: 1 - point.x }
  if (normalized === 180) return { x: 1 - point.x, y: 1 - point.y }
  if (normalized === 270) return { x: 1 - point.y, y: point.x }
  return point
}

const segmentDistance = (point: AnnotationPoint, a: AnnotationPoint, b: AnnotationPoint) => {
  const dx = b.x - a.x, dy = b.y - a.y
  const lengthSquared = dx * dx + dy * dy
  const t = lengthSquared ? Math.min(1, Math.max(0, ((point.x - a.x) * dx + (point.y - a.y) * dy) / lengthSquared)) : 0
  return Math.hypot(point.x - (a.x + t * dx), point.y - (a.y + t * dy))
}

export function eraseStrokeAt(strokes: AnnotationStroke[], point: AnnotationPoint, radius = .025) {
  for (let index = strokes.length - 1; index >= 0; index--) {
    const stroke = strokes[index]
    if (stroke.points.some((candidate, pointIndex) => pointIndex === 0
      ? Math.hypot(candidate.x - point.x, candidate.y - point.y) <= radius
      : segmentDistance(point, stroke.points[pointIndex - 1], candidate) <= radius + stroke.width / 2))
      return strokes.filter((_, candidate) => candidate !== index)
  }
  return strokes
}

const loadImage = (source: string) => new Promise<HTMLImageElement>((resolve, reject) => {
  const image = new Image(); image.onload = () => resolve(image); image.onerror = () => reject(new Error('A page image could not be opened.')); image.src = source
})

export async function annotatedThumbnail(page: DocumentPage) {
  const image = await loadImage(page.imageUrl)
  const max = 420, scale = Math.min(1, max / Math.max(image.width, image.height))
  const canvas = window.document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(image.width * scale)); canvas.height = Math.max(1, Math.round(image.height * scale))
  const context = canvas.getContext('2d')
  if (!context) throw new Error('Thumbnail generation is unavailable.')
  context.drawImage(image, 0, 0, canvas.width, canvas.height)
  drawAnnotations(context, page.annotations?.strokes ?? [], canvas.width, canvas.height)
  return canvas.toDataURL('image/jpeg', .78)
}

export async function finalizeAnnotations(document: VaultDocument) {
  const pages = []
  for (const page of document.pages) pages.push({ ...page, thumbnailUrl: await annotatedThumbnail(page), thumbnailPath: undefined })
  const updated = { ...document, pages, pdfPath: undefined, privatePdfPath: undefined, pdfGeneratedAt: undefined, pdfPasswordProtected: false, updatedAt: new Date().toISOString() }
  const blob = await pdfService.create(updated)
  const pdfPath = await documentStorageService.persistVersionedPdf(updated.id, blob)
  return { ...updated, pdfPath, pdfGeneratedAt: new Date().toISOString() }
}

export async function annotationCopy(document: VaultDocument) {
  const pages = await copyDocumentPages(document.pages)
  const now = new Date().toISOString()
  return finalizeAnnotations({ ...document, id: crypto.randomUUID(), title: `${document.title} (annotated copy)`, titleSource: 'manual', createdAt: now, updatedAt: now, pages, pdfPath: undefined, privatePdfPath: undefined, pdfGeneratedAt: undefined, storageProtection: undefined, privateSessionId: undefined })
}

export async function createAnnotatedPdfForTest(document: VaultDocument) { return pdfService.create(document) }
