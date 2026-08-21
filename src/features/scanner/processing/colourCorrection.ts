export function correctWhiteBalance(data: Uint8ClampedArray) {
  const samples: { brightness: number; r: number; g: number; b: number }[] = []
  const stride = Math.max(4, Math.floor(data.length / 4 / 18000) * 4)
  for (let index = 0; index < data.length; index += stride) {
    const r = data[index], g = data[index + 1], b = data[index + 2]
    samples.push({ brightness: r + g + b, r, g, b })
  }
  samples.sort((a, b) => b.brightness - a.brightness)
  const bright = samples.slice(0, Math.max(40, Math.floor(samples.length * 0.12)))
  const mean = bright.reduce((sum, sample) => ({ r: sum.r + sample.r, g: sum.g + sample.g, b: sum.b + sample.b }), { r: 0, g: 0, b: 0 })
  mean.r /= bright.length; mean.g /= bright.length; mean.b /= bright.length
  const neutral = (mean.r + mean.g + mean.b) / 3
  const scales = [neutral / Math.max(mean.r, 1), neutral / Math.max(mean.g, 1), neutral / Math.max(mean.b, 1)]
  for (let index = 0; index < data.length; index += 4) {
    data[index] = Math.min(255, data[index] * scales[0])
    data[index + 1] = Math.min(255, data[index + 1] * scales[1])
    data[index + 2] = Math.min(255, data[index + 2] * scales[2])
  }
}
