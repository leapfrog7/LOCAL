export function reduceShadows(canvas: HTMLCanvasElement, strength = .55) {
  const context = canvas.getContext('2d', { willReadFrequently: true }); if (!context) return
  const image = context.getImageData(0, 0, canvas.width, canvas.height)
  const field = document.createElement('canvas'), scale = 72 / Math.max(canvas.width, canvas.height)
  field.width = Math.max(12, Math.round(canvas.width * scale)); field.height = Math.max(12, Math.round(canvas.height * scale))
  const fieldContext = field.getContext('2d', { willReadFrequently: true }); if (!fieldContext) return
  fieldContext.filter = 'blur(3px)'; fieldContext.drawImage(canvas, 0, 0, field.width, field.height)
  const expanded = document.createElement('canvas'); expanded.width = canvas.width; expanded.height = canvas.height
  const expandedContext = expanded.getContext('2d', { willReadFrequently: true }); if (!expandedContext) return
  expandedContext.drawImage(field, 0, 0, canvas.width, canvas.height)
  const background = expandedContext.getImageData(0, 0, canvas.width, canvas.height).data
  for (let i = 0; i < image.data.length; i += 4) {
    const local = background[i] * .299 + background[i + 1] * .587 + background[i + 2] * .114
    const lift = Math.max(0, 222 - local) * strength
    for (let channel = 0; channel < 3; channel += 1) image.data[i + channel] = Math.min(255, image.data[i + channel] + lift * (image.data[i + channel] / Math.max(local, 24)))
  }
  context.putImageData(image, 0, 0)
}
