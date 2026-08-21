import type { DocumentPage, PageCorners, ProcessingAdjustments, RenderPreset } from '../../../domain/types'
import { correctWhiteBalance } from '../processing/colourCorrection'
import { reduceNoise } from '../processing/denoise'
import { detectDocument } from '../processing/edgeDetection'
import { canvasToJpeg } from '../processing/imageUtils'
import { normalizeIllumination } from '../processing/illumination'
import { correctPerspective } from '../processing/perspective'
import { renderOcrOptimized, renderPreset } from '../processing/renderPresets'
import { reduceShadows } from '../processing/shadowCorrection'

function cloneCanvas(source: HTMLCanvasElement) {
  const canvas = document.createElement('canvas'); canvas.width = source.width; canvas.height = source.height
  canvas.getContext('2d')?.drawImage(source, 0, 0); return canvas
}
const releaseCanvas = (canvas: HTMLCanvasElement) => { canvas.width = 1; canvas.height = 1 }

export async function processImage(originalImageUrl: string, corners: PageCorners, preset: RenderPreset, adjustments?: ProcessingAdjustments) {
  const corrected = await correctPerspective(originalImageUrl, corners)
  renderPreset(corrected, preset, adjustments)
  const result = canvasToJpeg(corrected, .9); releaseCanvas(corrected); return result
}

export async function processPageImages(originalImageUrl: string, corners: PageCorners, preset: RenderPreset, adjustments?: ProcessingAdjustments) {
  const corrected = await correctPerspective(originalImageUrl, corners), visible = cloneCanvas(corrected), ocr = cloneCanvas(corrected)
  renderPreset(visible, preset, adjustments); renderOcrOptimized(ocr)
  const thumbnail = document.createElement('canvas'), scale = Math.min(1, 320 / Math.max(visible.width, visible.height))
  thumbnail.width = Math.max(1, Math.round(visible.width * scale)); thumbnail.height = Math.max(1, Math.round(visible.height * scale)); thumbnail.getContext('2d')?.drawImage(visible, 0, 0, thumbnail.width, thumbnail.height)
  const result = { imageUrl: canvasToJpeg(visible, .9), thumbnailUrl: canvasToJpeg(thumbnail, .76), ocrImageUrl: canvasToJpeg(ocr, .86) }
  releaseCanvas(corrected); releaseCanvas(visible); releaseCanvas(ocr); releaseCanvas(thumbnail)
  return result
}

export async function generatePipelineStages(originalImageUrl: string, corners: PageCorners) {
  const corrected = await correctPerspective(originalImageUrl, corners, 1400), stages: Record<string, string> = { 'Perspective corrected': canvasToJpeg(corrected, .88) }
  const balanced = cloneCanvas(corrected), balancedContext = balanced.getContext('2d', { willReadFrequently: true })
  if (!balancedContext) throw new Error('Pipeline diagnostics are unavailable.')
  const balancedImage = balancedContext.getImageData(0, 0, balanced.width, balanced.height); correctWhiteBalance(balancedImage.data); balancedContext.putImageData(balancedImage, 0, 0); stages['White balanced'] = canvasToJpeg(balanced, .88)
  const illuminated = cloneCanvas(balanced); normalizeIllumination(illuminated, .68); stages['Illumination corrected'] = canvasToJpeg(illuminated, .88)
  const shadowCorrected = cloneCanvas(illuminated); reduceShadows(shadowCorrected, .45); stages['Shadow corrected'] = canvasToJpeg(shadowCorrected, .88)
  const denoised = cloneCanvas(shadowCorrected); reduceNoise(denoised, .2); stages.Denoised = canvasToJpeg(denoised, .88)
  const ocr = cloneCanvas(corrected); renderOcrOptimized(ocr); stages['OCR input'] = canvasToJpeg(ocr, .86)
  releaseCanvas(corrected); releaseCanvas(balanced); releaseCanvas(illuminated); releaseCanvas(shadowCorrected); releaseCanvas(denoised); releaseCanvas(ocr)
  return stages
}

export async function preparePage(id: string, originalImageUrl: string): Promise<DocumentPage> {
  const detection = await detectDocument(originalImageUrl), preset: RenderPreset = 'document'
  const { imageUrl, thumbnailUrl, ocrImageUrl } = await processPageImages(originalImageUrl, detection.corners, preset)
  return { id, originalImageUrl, imageUrl, thumbnailUrl, ocrImageUrl, corners: detection.corners, detectionConfidence: detection.confidence, renderPreset: preset, processingState: detection.confidence < .5 ? 'needs_review' : 'processed', rotation: 0, ocrText: '', ocrState: 'pending' }
}
