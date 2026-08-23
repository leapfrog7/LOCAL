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
  ocrWords?: OCRWord[]
  barcodes?: DetectedBarcode[]
}

export interface OCRBoundingBox { x: number; y: number; width: number; height: number }
export interface OCRWord { text: string; confidence: number; boundingBox: OCRBoundingBox }
export interface DetectedBarcode { rawValue: string; displayValue?: string; format: string; valueType: string }

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
  titleSource?: 'automatic' | 'manual'
  smartMetadata?: DocumentSmartMetadata
  folder: string
  createdAt: string
  updatedAt: string
  status: DocumentStatus
  pages: DocumentPage[]
  tags: string[]
  isPrivate?: boolean
  storageProtection?: 'keystore-v1'
  privateSessionId?: string
  privatePdfPath?: string
  pdfPasswordProtected?: boolean
  pdfPath?: string
  pdfGeneratedAt?: string
  processingStage?: 'enhancing' | 'ocr' | 'pdf' | 'indexing' | 'complete'
}

export type SmartDocumentType = 'invoice' | 'receipt' | 'electricity_bill' | 'water_bill' | 'phone_bill' | 'bank_statement' | 'prescription' | 'insurance_policy' | 'office_memorandum' | 'order' | 'circular' | 'notification' | 'letter'

export interface DocumentSmartMetadata {
  documentType?: SmartDocumentType
  organization?: string
  documentDate?: string
  dateLabel?: string
  amount?: { value: number; currency: 'INR' | 'USD' | 'EUR' | 'GBP'; display: string }
  identifier?: { type: 'invoice' | 'bill' | 'receipt' | 'order' | 'reference' | 'policy'; value: string }
}

export type Screen = { name: 'home' | 'folders' | 'settings' | 'scanner-lab' } | { name: 'viewer'; id: string; page?: number; query?: string } | { name: 'capture' }
