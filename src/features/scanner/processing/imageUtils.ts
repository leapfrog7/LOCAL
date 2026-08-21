export const loadImage = (source: string) => new Promise<HTMLImageElement>((resolve, reject) => {
  const image = new Image()
  image.onload = () => resolve(image)
  image.onerror = () => reject(new Error('The captured image could not be opened.'))
  image.src = source
})

export function createWorkingCanvas(image: HTMLImageElement, maxDimension = 1200) {
  const scale = Math.min(1, maxDimension / Math.max(image.naturalWidth, image.naturalHeight))
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(image.naturalWidth * scale))
  canvas.height = Math.max(1, Math.round(image.naturalHeight * scale))
  const context = canvas.getContext('2d', { willReadFrequently: true })
  if (!context) throw new Error('Image processing is unavailable on this device.')
  context.drawImage(image, 0, 0, canvas.width, canvas.height)
  return { canvas, context, scale }
}

export const canvasToJpeg = (canvas: HTMLCanvasElement, quality = 0.9) => canvas.toDataURL('image/jpeg', quality)
