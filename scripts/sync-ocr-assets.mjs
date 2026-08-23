import { copyFileSync, existsSync, mkdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const publicRoot = join(projectRoot, 'public', 'ocr')
const copies = [
  ['node_modules/tesseract.js/dist/worker.min.js', 'worker.min.js'],
  ['node_modules/tesseract.js-core/tesseract-core-lstm.js', 'core/tesseract-core-lstm.js'],
  ['node_modules/tesseract.js-core/tesseract-core-lstm.wasm', 'core/tesseract-core-lstm.wasm'],
  ['node_modules/tesseract.js-core/tesseract-core-lstm.wasm.js', 'core/tesseract-core-lstm.wasm.js'],
  ['node_modules/tesseract.js-core/tesseract-core-simd-lstm.js', 'core/tesseract-core-simd-lstm.js'],
  ['node_modules/tesseract.js-core/tesseract-core-simd-lstm.wasm', 'core/tesseract-core-simd-lstm.wasm'],
  ['node_modules/tesseract.js-core/tesseract-core-simd-lstm.wasm.js', 'core/tesseract-core-simd-lstm.wasm.js'],
  ['node_modules/tesseract.js-core/tesseract-core-relaxedsimd-lstm.js', 'core/tesseract-core-relaxedsimd-lstm.js'],
  ['node_modules/tesseract.js-core/tesseract-core-relaxedsimd-lstm.wasm', 'core/tesseract-core-relaxedsimd-lstm.wasm'],
  ['node_modules/tesseract.js-core/tesseract-core-relaxedsimd-lstm.wasm.js', 'core/tesseract-core-relaxedsimd-lstm.wasm.js'],
  ['node_modules/@tesseract.js-data/eng/4.0.0/eng.traineddata.gz', 'lang/eng.traineddata.gz'],
  ['node_modules/@tesseract.js-data/hin/4.0.0/hin.traineddata.gz', 'lang/hin.traineddata.gz'],
]

for (const [sourceRelative, destinationRelative] of copies) {
  const source = join(projectRoot, ...sourceRelative.split('/'))
  const destination = join(publicRoot, ...destinationRelative.split('/'))
  if (!existsSync(source)) throw new Error(`Required OCR runtime asset is missing: ${sourceRelative}`)
  mkdirSync(dirname(destination), { recursive: true })
  copyFileSync(source, destination)
}

console.log(`Synchronized ${copies.length} OCR runtime assets from installed Tesseract packages.`)
