import type { PageCorners, ProcessingAdjustments, RenderPreset } from '../../domain/types'

export interface DetectionResult {
  corners: PageCorners
  confidence: number
  diagnostics?: { edgeStrength: number; rectangularity: number; areaRatio: number; borderPenalty: number }
}

export interface ProcessOptions {
  corners: PageCorners
  preset: RenderPreset
  adjustments?: ProcessingAdjustments
  maxOutputDimension?: number
}
