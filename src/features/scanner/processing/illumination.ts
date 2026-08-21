export function normalizeIllumination(canvas: HTMLCanvasElement, strength = 0.68) {
  const context = canvas.getContext('2d', { willReadFrequently: true }); if (!context) return
  const original = context.getImageData(0, 0, canvas.width, canvas.height)
  const backgroundCanvas = document.createElement('canvas')
  const longSide = 56, scale = longSide / Math.max(canvas.width, canvas.height)
  backgroundCanvas.width = Math.max(8, Math.round(canvas.width * scale)); backgroundCanvas.height = Math.max(8, Math.round(canvas.height * scale))
  const backgroundContext = backgroundCanvas.getContext('2d', { willReadFrequently: true }); if (!backgroundContext) return
  backgroundContext.filter = 'blur(2px)'; backgroundContext.drawImage(canvas, 0, 0, backgroundCanvas.width, backgroundCanvas.height)
  const expanded = document.createElement('canvas'); expanded.width = canvas.width; expanded.height = canvas.height
  const expandedContext = expanded.getContext('2d', { willReadFrequently: true }); if (!expandedContext) return
  expandedContext.imageSmoothingEnabled = true; expandedContext.drawImage(backgroundCanvas, 0, 0, canvas.width, canvas.height)
  const background = expandedContext.getImageData(0, 0, canvas.width, canvas.height).data
  for (let index = 0; index < original.data.length; index += 4) for (let channel = 0; channel < 3; channel += 1) {
    const corrected = original.data[index + channel] * 238 / Math.max(background[index + channel], 36)
    original.data[index + channel] = original.data[index + channel] * (1 - strength) + Math.min(255, corrected) * strength
  }
  context.putImageData(original, 0, 0)
}
