import type { PageCorners, RenderPreset } from '../../domain/types'

export interface DetectionResult {
  corners: PageCorners
  confidence: number
}

export interface ProcessOptions {
  corners: PageCorners
  preset: RenderPreset
  maxOutputDimension?: number
}
