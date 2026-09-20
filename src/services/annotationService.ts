import type { AnnotationPoint, AnnotationStroke, DocumentPage, OCRWord, VaultDocument } from '../domain/types'
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

const shapeTools = new Set(['line', 'arrow', 'rectangle', 'ellipse'])
export const isShapeAnnotation = (stroke: AnnotationStroke) => shapeTools.has(stroke.tool)

export function annotationTextBounds(stroke: AnnotationStroke) {
  const start = stroke.points[0] ?? { x: 0, y: 0 }
  const fontSize = stroke.fontSize ?? .03
  const lines = (stroke.text ?? '').split('\n')
  return { x: start.x, y: start.y, width: Math.min(.82, Math.max(.08, Math.max(...lines.map(line => line.length), 1) * fontSize * .56)), height: Math.max(fontSize * 1.25, lines.length * fontSize * 1.25) }
}

function strokeHit(stroke: AnnotationStroke, point: AnnotationPoint, radius: number) {
  if (stroke.tool === 'text') {
    const box = annotationTextBounds(stroke)
    return point.x >= box.x - radius && point.x <= box.x + box.width + radius && point.y >= box.y - radius && point.y <= box.y + box.height + radius
  }
  const [a, b] = stroke.points
  if ((stroke.tool === 'line' || stroke.tool === 'arrow') && a && b) return segmentDistance(point, a, b) <= radius + stroke.width / 2
  if (stroke.tool === 'rectangle' && a && b) {
    const topLeft = { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y) }, bottomRight = { x: Math.max(a.x, b.x), y: Math.max(a.y, b.y) }
    const topRight = { x: bottomRight.x, y: topLeft.y }, bottomLeft = { x: topLeft.x, y: bottomRight.y }
    return [[topLeft, topRight], [topRight, bottomRight], [bottomRight, bottomLeft], [bottomLeft, topLeft]].some(([start, end]) => segmentDistance(point, start, end) <= radius + stroke.width / 2)
  }
  if (stroke.tool === 'ellipse' && a && b) {
    const rx = Math.abs(b.x - a.x) / 2, ry = Math.abs(b.y - a.y) / 2
    if (!rx || !ry) return false
    const cx = (a.x + b.x) / 2, cy = (a.y + b.y) / 2
    return Math.abs(Math.hypot((point.x - cx) / rx, (point.y - cy) / ry) - 1) * Math.min(rx, ry) <= radius + stroke.width / 2
  }
  return stroke.points.some((candidate, pointIndex) => pointIndex === 0
    ? Math.hypot(candidate.x - point.x, candidate.y - point.y) <= radius + stroke.width / 2
    : segmentDistance(point, stroke.points[pointIndex - 1], candidate) <= radius + stroke.width / 2)
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

export function findStrokeAt(strokes: AnnotationStroke[], point: AnnotationPoint, radius = .025) {
  for (let index = strokes.length - 1; index >= 0; index--) {
    const stroke = strokes[index]
    if (strokeHit(stroke, point, radius)) return stroke.id
  }
  return undefined
}

const sampledPoints = (points: AnnotationPoint[], spacing: number) => points.flatMap((point, index) => {
  if (!index) return [point]
  const previous = points[index - 1]
  const distance = Math.hypot(point.x - previous.x, point.y - previous.y)
  const count = Math.max(1, Math.ceil(distance / spacing))
  return Array.from({ length: count }, (_, step) => ({
    x: previous.x + (point.x - previous.x) * ((step + 1) / count),
    y: previous.y + (point.y - previous.y) * ((step + 1) / count)
  }))
})

/** Removes only the touched part of a stroke and keeps the remaining segments editable. */
export function eraseStrokeParts(strokes: AnnotationStroke[], point: AnnotationPoint, radius = .025) {
  let changed = false
  const result: AnnotationStroke[] = []
  for (const stroke of strokes) {
    const effectiveRadius = radius + stroke.width / 2
    if (stroke.tool === 'text' || isShapeAnnotation(stroke)) {
      if (strokeHit(stroke, point, radius)) changed = true
      else result.push(stroke)
      continue
    }
    const points = sampledPoints(stroke.points, Math.max(.0025, effectiveRadius / 3))
    if (!points.some(candidate => Math.hypot(candidate.x - point.x, candidate.y - point.y) <= effectiveRadius)) {
      result.push(stroke); continue
    }
    changed = true
    let segment: AnnotationPoint[] = []
    let part = 0
    const flush = () => {
      if (segment.length) result.push({ ...stroke, id: `${stroke.id}-part-${part++}`, points: segment })
      segment = []
    }
    for (const candidate of points) {
      if (Math.hypot(candidate.x - point.x, candidate.y - point.y) <= effectiveRadius) flush()
      else segment.push(candidate)
    }
    flush()
  }
  return changed ? result : strokes
}

const boxesIntersect = (a: { x: number; y: number; width: number; height: number }, b: { x: number; y: number; width: number; height: number }) =>
  a.x <= b.x + b.width && a.x + a.width >= b.x && a.y <= b.y + b.height && a.y + a.height >= b.y

/** Converts a rough highlighter drag into clean line highlights using existing OCR word bounds. */
export function snapHighlightToWords(stroke: AnnotationStroke, words: OCRWord[]) {
  if (stroke.tool !== 'highlighter' || stroke.points.length < 2 || !words.length) return [stroke]
  const xs = stroke.points.map(item => item.x), ys = stroke.points.map(item => item.y)
  const padding = Math.max(.012, stroke.width)
  const selection = { x: Math.min(...xs) - padding, y: Math.min(...ys) - padding, width: Math.max(...xs) - Math.min(...xs) + padding * 2, height: Math.max(...ys) - Math.min(...ys) + padding * 2 }
  const selected = words.filter(word => word.text.trim() && boxesIntersect(selection, word.boundingBox)).sort((a, b) => a.boundingBox.y - b.boundingBox.y || a.boundingBox.x - b.boundingBox.x)
  if (!selected.length) return [stroke]
  const lines: OCRWord[][] = []
  for (const word of selected) {
    const centre = word.boundingBox.y + word.boundingBox.height / 2
    const line = lines.find(candidate => {
      const first = candidate[0].boundingBox
      return Math.abs(centre - (first.y + first.height / 2)) <= Math.max(first.height, word.boundingBox.height) * .65
    })
    if (line) line.push(word); else lines.push([word])
  }
  return lines.map((line, index) => {
    const left = Math.min(...line.map(word => word.boundingBox.x))
    const right = Math.max(...line.map(word => word.boundingBox.x + word.boundingBox.width))
    const top = Math.min(...line.map(word => word.boundingBox.y))
    const bottom = Math.max(...line.map(word => word.boundingBox.y + word.boundingBox.height))
    const y = (top + bottom) / 2
    return { ...stroke, id: `${stroke.id}-text-${index}`, width: Math.max(stroke.width, Math.min(.035, (bottom - top) * .72)), points: [{ x: left, y }, { x: right, y }] }
  })
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
