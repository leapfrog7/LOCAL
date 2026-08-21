import type { RenderPreset } from '../../../domain/types'
import { correctWhiteBalance } from './colourCorrection'
import { enhanceContrast } from './contrast'
import { reduceNoise, sharpenConservatively } from './denoise'
import { normalizeIllumination } from './illumination'

function grayscaleValue(r: number, g: number, b: number) { return r * 0.299 + g * 0.587 + b * 0.114 }

function adaptiveBlackWhite(data: Uint8ClampedArray, width: number, height: number) {
  const gray = new Uint8Array(width * height)
  for (let pixel = 0; pixel < gray.length; pixel += 1) { const i = pixel * 4; gray[pixel] = grayscaleValue(data[i], data[i + 1], data[i + 2]) }
  const integral = new Float64Array((width + 1) * (height + 1))
  for (let y = 1; y <= height; y += 1) { let row = 0; for (let x = 1; x <= width; x += 1) { row += gray[(y - 1) * width + x - 1]; integral[y * (width + 1) + x] = integral[(y - 1) * (width + 1) + x] + row } }
  const radius = Math.max(8, Math.round(Math.min(width, height) / 40))
  for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) {
    const x1 = Math.max(0, x - radius), y1 = Math.max(0, y - radius), x2 = Math.min(width - 1, x + radius), y2 = Math.min(height - 1, y + radius)
    const area = (x2 - x1 + 1) * (y2 - y1 + 1)
    const sum = integral[(y2 + 1) * (width + 1) + x2 + 1] - integral[y1 * (width + 1) + x2 + 1] - integral[(y2 + 1) * (width + 1) + x1] + integral[y1 * (width + 1) + x1]
    const value = gray[y * width + x] < sum / area - 10 ? 18 : 248, index = (y * width + x) * 4
    data[index] = data[index + 1] = data[index + 2] = value
  }
}

export function renderPreset(canvas: HTMLCanvasElement, preset: RenderPreset) {
  const context = canvas.getContext('2d', { willReadFrequently: true }); if (!context) throw new Error('Rendering is unavailable.')
  normalizeIllumination(canvas, preset === 'clean-colour' ? .58 : .72)
  reduceNoise(canvas)
  const image = context.getImageData(0, 0, canvas.width, canvas.height), { data } = image
  correctWhiteBalance(data)
  if (preset !== 'clean-colour') for (let index = 0; index < data.length; index += 4) data[index] = data[index + 1] = data[index + 2] = grayscaleValue(data[index], data[index + 1], data[index + 2])
  enhanceContrast(data, preset === 'clean-colour' ? .55 : .72)
  if (preset === 'black-white') adaptiveBlackWhite(data, canvas.width, canvas.height)
  context.putImageData(image, 0, 0)
  if (preset !== 'black-white') sharpenConservatively(canvas)
  return canvas
}

export function renderOcrOptimized(canvas: HTMLCanvasElement) {
  const context = canvas.getContext('2d', { willReadFrequently: true }); if (!context) throw new Error('OCR rendering is unavailable.')
  normalizeIllumination(canvas, .76); reduceNoise(canvas)
  const image = context.getImageData(0, 0, canvas.width, canvas.height), { data } = image
  for (let index = 0; index < data.length; index += 4) data[index] = data[index + 1] = data[index + 2] = grayscaleValue(data[index], data[index + 1], data[index + 2])
  enhanceContrast(data, .76); context.putImageData(image, 0, 0); sharpenConservatively(canvas)
  return canvas
}
