import type { ProcessingAdjustments, RenderPreset } from '../../../domain/types'
import { correctWhiteBalance } from './colourCorrection'
import { enhanceContrast } from './contrast'
import { reduceNoise, sharpenConservatively } from './denoise'
import { normalizeIllumination } from './illumination'
import { reduceShadows } from './shadowCorrection'

export const defaultAdjustments: ProcessingAdjustments = { brightness: 0, contrast: 0, whites: 0, shadows: 0, warmth: 0, sharpness: 0, noiseReduction: 0 }
const grayValue = (r: number, g: number, b: number) => r * .299 + g * .587 + b * .114
const clamp = (value: number) => Math.max(0, Math.min(255, value))

function adaptiveBlackWhite(data: Uint8ClampedArray, width: number, height: number, offset = 9) {
  const gray = new Uint8Array(width * height), integral = new Float64Array((width + 1) * (height + 1))
  for (let pixel = 0; pixel < gray.length; pixel += 1) { const i = pixel * 4; gray[pixel] = grayValue(data[i], data[i + 1], data[i + 2]) }
  for (let y = 1; y <= height; y += 1) { let row = 0; for (let x = 1; x <= width; x += 1) { row += gray[(y - 1) * width + x - 1]; integral[y * (width + 1) + x] = integral[(y - 1) * (width + 1) + x] + row } }
  const radius = Math.max(10, Math.round(Math.min(width, height) / 34))
  for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) {
    const x1 = Math.max(0, x - radius), y1 = Math.max(0, y - radius), x2 = Math.min(width - 1, x + radius), y2 = Math.min(height - 1, y + radius)
    const area = (x2 - x1 + 1) * (y2 - y1 + 1), sum = integral[(y2 + 1) * (width + 1) + x2 + 1] - integral[y1 * (width + 1) + x2 + 1] - integral[(y2 + 1) * (width + 1) + x1] + integral[y1 * (width + 1) + x1]
    const value = gray[y * width + x] < sum / area - offset ? 16 : 249, index = (y * width + x) * 4
    data[index] = data[index + 1] = data[index + 2] = value
  }
}

function analyze(data: Uint8ClampedArray) {
  let brightness = 0, saturation = 0, warmth = 0, samples = 0
  for (let i = 0; i < data.length; i += 64) { const r = data[i], g = data[i + 1], b = data[i + 2]; brightness += grayValue(r, g, b); saturation += Math.max(r, g, b) - Math.min(r, g, b); warmth += r - b; samples += 1 }
  return { brightness: brightness / samples, saturation: saturation / samples, warmth: warmth / samples }
}

function applyAdjustments(data: Uint8ClampedArray, adjustments: ProcessingAdjustments) {
  const contrast = 1 + adjustments.contrast / 100, brightness = adjustments.brightness * 1.5
  for (let i = 0; i < data.length; i += 4) for (let channel = 0; channel < 3; channel += 1) {
    let value = (data[i + channel] - 128) * contrast + 128 + brightness
    if (value > 170) value += adjustments.whites * (value - 170) / 85
    if (value < 110) value += adjustments.shadows * (110 - value) / 110
    if (channel === 0) value += adjustments.warmth; else if (channel === 2) value -= adjustments.warmth
    data[i + channel] = clamp(value)
  }
}

export function renderPreset(canvas: HTMLCanvasElement, requested: RenderPreset, adjustments = defaultAdjustments) {
  const context = canvas.getContext('2d', { willReadFrequently: true }); if (!context) throw new Error('Rendering is unavailable.')
  if (requested === 'original') return canvas
  const initial = context.getImageData(0, 0, canvas.width, canvas.height), metrics = analyze(initial.data)
  const preset: RenderPreset = requested === 'auto' ? (metrics.saturation > 25 ? 'clean-colour' : metrics.brightness < 155 ? 'photocopy' : 'document') : requested
  const illumination = preset === 'clean-colour' ? .62 : preset === 'photocopy' ? .84 : .76
  normalizeIllumination(canvas, illumination)
  reduceShadows(canvas, preset === 'clean-colour' ? .34 : .48)
  reduceNoise(canvas, (preset === 'photocopy' ? .28 : .18) + adjustments.noiseReduction / 180)
  const image = context.getImageData(0, 0, canvas.width, canvas.height), { data } = image
  correctWhiteBalance(data)
  if (preset === 'document') for (let i = 0; i < data.length; i += 4) { const gray = grayValue(data[i], data[i + 1], data[i + 2]); data[i] = gray * .82 + data[i] * .18; data[i + 1] = gray * .82 + data[i + 1] * .18; data[i + 2] = gray * .82 + data[i + 2] * .18 }
  if (preset === 'grayscale' || preset === 'black-white' || preset === 'photocopy') for (let i = 0; i < data.length; i += 4) data[i] = data[i + 1] = data[i + 2] = grayValue(data[i], data[i + 1], data[i + 2])
  enhanceContrast(data, preset === 'clean-colour' ? .52 : preset === 'photocopy' ? .86 : .72)
  if (preset === 'photocopy') for (let i = 0; i < data.length; i += 4) { const value = data[i] > 180 ? Math.min(255, data[i] + 24) : data[i] < 145 ? data[i] * .88 : data[i]; data[i] = data[i + 1] = data[i + 2] = value }
  if (preset === 'black-white') adaptiveBlackWhite(data, canvas.width, canvas.height)
  applyAdjustments(data, adjustments); context.putImageData(image, 0, 0)
  if (preset !== 'black-white') sharpenConservatively(canvas, (preset === 'document' || preset === 'photocopy' ? .34 : .25) + adjustments.sharpness / 160)
  return canvas
}

export function renderOcrOptimized(canvas: HTMLCanvasElement) {
  const context = canvas.getContext('2d', { willReadFrequently: true }); if (!context) throw new Error('OCR rendering is unavailable.')
  normalizeIllumination(canvas, .82); reduceShadows(canvas, .44); reduceNoise(canvas, .16)
  const image = context.getImageData(0, 0, canvas.width, canvas.height), { data } = image
  for (let i = 0; i < data.length; i += 4) data[i] = data[i + 1] = data[i + 2] = grayValue(data[i], data[i + 1], data[i + 2])
  enhanceContrast(data, .72); context.putImageData(image, 0, 0); sharpenConservatively(canvas, .2)
  return canvas
}
