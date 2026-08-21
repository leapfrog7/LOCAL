export function enhanceContrast(data: Uint8ClampedArray, strength = 0.86) {
  const histogram = new Uint32Array(256)
  let pixels = 0
  for (let index = 0; index < data.length; index += 16) {
    histogram[Math.round(data[index] * .299 + data[index + 1] * .587 + data[index + 2] * .114)] += 1; pixels += 1
  }
  const percentile = (target: number) => { let total = 0; for (let value = 0; value < 256; value += 1) { total += histogram[value]; if (total >= pixels * target) return value } return target < .5 ? 0 : 255 }
  const low = percentile(.025), high = Math.max(low + 35, percentile(.985)), scale = 255 / (high - low)
  for (let index = 0; index < data.length; index += 4) for (let channel = 0; channel < 3; channel += 1) {
    const stretched = Math.max(0, Math.min(255, (data[index + channel] - low) * scale))
    data[index + channel] = data[index + channel] * (1 - strength) + stretched * strength
  }
}
