import type { PageCorners } from '../../domain/types'

export type NormalizedPoint = { x: number; y: number }

const clamp = (value: number) => Math.min(1, Math.max(0, value))

export function viewportPointToCameraPoint(
  point: { x: number; y: number },
  viewport: { width: number; height: number },
  video: { width: number; height: number },
): NormalizedPoint {
  const scale = Math.max(viewport.width / video.width, viewport.height / video.height)
  const displayedWidth = video.width * scale
  const displayedHeight = video.height * scale
  const cropX = (displayedWidth - viewport.width) / 2
  const cropY = (displayedHeight - viewport.height) / 2

  return {
    x: clamp((point.x + cropX) / displayedWidth),
    y: clamp((point.y + cropY) / displayedHeight),
  }
}

export function estimateSharpness(data: Uint8ClampedArray, width: number, height: number) {
  if (width < 3 || height < 3 || data.length < width * height * 4) return 0

  const luminance = (index: number) => data[index] * .299 + data[index + 1] * .587 + data[index + 2] * .114
  let total = 0
  let samples = 0
  const step = Math.max(1, Math.floor(Math.min(width, height) / 180))

  for (let y = step; y < height - step; y += step) {
    for (let x = step; x < width - step; x += step) {
      const center = (y * width + x) * 4
      const left = (y * width + x - step) * 4
      const right = (y * width + x + step) * 4
      const top = ((y - step) * width + x) * 4
      const bottom = ((y + step) * width + x) * 4
      total += Math.abs(4 * luminance(center) - luminance(left) - luminance(right) - luminance(top) - luminance(bottom))
      samples += 1
    }
  }

  return samples ? total / samples : 0
}

export function estimateBrightness(data: Uint8ClampedArray) {
  if (data.length < 4) return 0
  let total = 0
  let samples = 0
  const pixelCount = Math.floor(data.length / 4)
  const step = Math.max(1, Math.floor(pixelCount / 12000))
  for (let pixel = 0; pixel < pixelCount; pixel += step) {
    const index = pixel * 4
    total += data[index] * .299 + data[index + 1] * .587 + data[index + 2] * .114
    samples += 1
  }
  return samples ? total / samples : 0
}

export function needsAutoFlash(brightness: number) {
  return brightness < 72
}

export function supportsTorchCapability(value: boolean | boolean[] | undefined) {
  return value === true || Array.isArray(value) && value.includes(true)
}

export function cornerMovement(previous: PageCorners, next: PageCorners) {
  const keys = ['topLeft', 'topRight', 'bottomRight', 'bottomLeft'] as const
  return keys.reduce((total, key) => {
    const dx = previous[key].x - next[key].x
    const dy = previous[key].y - next[key].y
    return total + Math.hypot(dx, dy)
  }, 0) / keys.length
}

export function isAutoCaptureReady({ enabled, armed, confidence, movement, sharpness }: { enabled: boolean; armed: boolean; confidence: number; movement: number; sharpness: number }) {
  return enabled && armed && confidence >= .72 && movement >= 0 && movement < .025 && sharpness >= 3.25
}
