export type DocumentStatus = 'saved' | 'ocr_pending' | 'ocr_processing' | 'indexed' | 'error'

export interface DocumentPage {
  id: string
  imageUrl: string
  imagePath?: string
  originalImageUrl?: string
  originalImagePath?: string
  thumbnailUrl?: string
  thumbnailPath?: string
  ocrImageUrl?: string
  ocrImagePath?: string
  corners?: PageCorners
  detectionConfidence?: number
  renderPreset?: RenderPreset
  adjustments?: ProcessingAdjustments
  processingState?: PageProcessingState
  rotation: number
  ocrText: string
  ocrState: 'pending' | 'processing' | 'complete' | 'error'
  ocrConfidence?: number
  ocrLanguages?: string[]
}

export type RenderPreset = 'original' | 'auto' | 'clean-colour' | 'document' | 'grayscale' | 'black-white' | 'photocopy'
export interface ProcessingAdjustments {
  brightness: number
  contrast: number
  whites: number
  shadows: number
  warmth: number
  sharpness: number
  noiseReduction: number
}
export type PageProcessingState = 'captured' | 'detecting' | 'needs_review' | 'processing' | 'processed' | 'error'
export interface Point { x: number; y: number }
export interface PageCorners { topLeft: Point; topRight: Point; bottomRight: Point; bottomLeft: Point }

export interface VaultDocument {
  id: string
  storageVersion?: number
  title: string
  folder: string
  createdAt: string
  updatedAt: string
  status: DocumentStatus
  pages: DocumentPage[]
  tags: string[]
  pdfPath?: string
  pdfGeneratedAt?: string
}

export type Screen = { name: 'home' | 'folders' | 'settings' | 'scanner-lab' } | { name: 'viewer'; id: string; page?: number; query?: string } | { name: 'capture' }
