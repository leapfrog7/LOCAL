function cloneCanvas(source: HTMLCanvasElement) {
  const canvas = document.createElement('canvas'); canvas.width = source.width; canvas.height = source.height
  canvas.getContext('2d')?.drawImage(source, 0, 0); return canvas
}

export function reduceNoise(canvas: HTMLCanvasElement, strength = .2) {
  const context = canvas.getContext('2d'); if (!context) return
  const source = cloneCanvas(canvas)
  context.save(); context.globalAlpha = Math.max(0, Math.min(.55, strength)); context.filter = 'blur(0.45px)'; context.drawImage(source, 0, 0); context.restore()
}

export function sharpenConservatively(canvas: HTMLCanvasElement, strength = .28) {
  const context = canvas.getContext('2d'); if (!context) return
  const original = context.getImageData(0, 0, canvas.width, canvas.height)
  const blurredCanvas = cloneCanvas(canvas), blurredContext = blurredCanvas.getContext('2d', { willReadFrequently: true }); if (!blurredContext) return
  blurredContext.filter = 'blur(1px)'; blurredContext.drawImage(canvas, 0, 0)
  const blurred = blurredContext.getImageData(0, 0, canvas.width, canvas.height).data
  for (let index = 0; index < original.data.length; index += 4) for (let channel = 0; channel < 3; channel += 1) {
    const detail = original.data[index + channel] - blurred[index + channel]
    original.data[index + channel] = Math.max(0, Math.min(255, original.data[index + channel] + detail * Math.max(0, Math.min(.65, strength))))
  }
  context.putImageData(original, 0, 0)
}
