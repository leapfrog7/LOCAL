import type { DocumentPage, PageCorners, RenderPreset } from '../../../domain/types'
import { detectDocument } from '../processing/edgeDetection'
import { canvasToJpeg } from '../processing/imageUtils'
import { correctPerspective } from '../processing/perspective'
import { renderOcrOptimized, renderPreset } from '../processing/renderPresets'

function cloneCanvas(source: HTMLCanvasElement) {
  const canvas = document.createElement('canvas'); canvas.width = source.width; canvas.height = source.height
  canvas.getContext('2d')?.drawImage(source, 0, 0); return canvas
}

export async function processImage(originalImageUrl: string, corners: PageCorners, preset: RenderPreset) {
  const corrected = await correctPerspective(originalImageUrl, corners)
  renderPreset(corrected, preset)
  return canvasToJpeg(corrected, 0.9)
}

export async function processPageImages(originalImageUrl: string, corners: PageCorners, preset: RenderPreset) {
  const corrected = await correctPerspective(originalImageUrl, corners)
  const visible = cloneCanvas(corrected), ocr = cloneCanvas(corrected)
  renderPreset(visible, preset); renderOcrOptimized(ocr)
  const thumbnail = document.createElement('canvas')
  const scale = Math.min(1, 320 / Math.max(visible.width, visible.height))
  thumbnail.width = Math.max(1, Math.round(visible.width * scale)); thumbnail.height = Math.max(1, Math.round(visible.height * scale))
  thumbnail.getContext('2d')?.drawImage(visible, 0, 0, thumbnail.width, thumbnail.height)
  return { imageUrl: canvasToJpeg(visible, 0.9), thumbnailUrl: canvasToJpeg(thumbnail, 0.76), ocrImageUrl: canvasToJpeg(ocr, 0.86) }
}

export async function preparePage(id: string, originalImageUrl: string): Promise<DocumentPage> {
  const detection = await detectDocument(originalImageUrl)
  const preset: RenderPreset = 'clean-colour'
  const { imageUrl, thumbnailUrl, ocrImageUrl } = await processPageImages(originalImageUrl, detection.corners, preset)
  return {
    id, originalImageUrl, imageUrl, thumbnailUrl, ocrImageUrl, corners: detection.corners,
    detectionConfidence: detection.confidence, renderPreset: preset,
    processingState: detection.confidence < 0.5 ? 'needs_review' : 'processed',
    rotation: 0, ocrText: '', ocrState: 'pending',
  }
}
