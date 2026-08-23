import type Tesseract from 'tesseract.js'
import { Capacitor, registerPlugin } from '@capacitor/core'
import type { OCRResult, OCRService } from './contracts'
import type { OCRWord } from '../domain/types'
import { withTimeout } from './asyncTimeout'

let workerPromise: Promise<Tesseract.Worker> | undefined
let progressListener: ((progress: number, status: string) => void) | undefined
const WORKER_START_TIMEOUT_MS = 45_000
const IMAGE_DECODE_TIMEOUT_MS = 12_000
const RECOGNITION_TIMEOUT_MS = 75_000
const NATIVE_RECOGNITION_TIMEOUT_MS = 30_000
type NativeOcrPlugin = { recognize(options: { sourcePath?: string; base64?: string; rotation: number }): Promise<OCRResult> }
const nativeOcr = registerPlugin<NativeOcrPlugin>('MlKitOcr')
const usesNativeMlKit = () => Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android'
const assetBase = () => new URL(`${import.meta.env.BASE_URL.replace(/^\//, '')}ocr/`, document.baseURI).href
const imageSize = (source: string) => new Promise<{ width: number; height: number }>((resolve, reject) => { const image = new Image(); image.onload = () => resolve({ width: image.naturalWidth, height: image.naturalHeight }); image.onerror = () => reject(new Error('OCR input image could not be decoded.')); image.src = source })
function positionalWords(blocks: Tesseract.Block[] | null, width: number, height: number): OCRWord[] {
  if (!blocks) return []
  return blocks.flatMap(block => block.paragraphs.flatMap(paragraph => paragraph.lines.flatMap(line => line.words))).filter(word => word.text.trim()).map(word => ({
    text: word.text.trim(), confidence: word.confidence,
    boundingBox: { x: word.bbox.x0 / width, y: word.bbox.y0 / height, width: (word.bbox.x1 - word.bbox.x0) / width, height: (word.bbox.y1 - word.bbox.y0) / height },
  }))
}

const clamp = (value: number, minimum: number, maximum: number) => Math.max(minimum, Math.min(maximum, Number.isFinite(value) ? value : minimum))
export function normalizeNativeOcrResult(result: OCRResult): OCRResult {
  return {
    text: String(result.text ?? '').trim(),
    confidence: clamp(Number(result.confidence), 0, 100),
    languages: Array.from(new Set((result.languages ?? []).filter(value => typeof value === 'string' && value.trim()).map(value => value.trim()))),
    words: (result.words ?? []).filter(word => word && typeof word.text === 'string' && word.text.trim()).map(word => {
      const x = clamp(Number(word.boundingBox?.x), 0, 1)
      const y = clamp(Number(word.boundingBox?.y), 0, 1)
      return {
        text: word.text.trim(),
        confidence: clamp(Number(word.confidence), 0, 100),
        boundingBox: { x, y, width: clamp(Number(word.boundingBox?.width), 0, 1 - x), height: clamp(Number(word.boundingBox?.height), 0, 1 - y) },
      }
    }),
  }
}

async function recognizeWithNativeMlKit(page: Parameters<OCRService['recognize']>[0], onProgress?: (progress: number, status: string) => void) {
  const sourcePath = page.ocrImagePath || page.imagePath || page.originalImagePath
  const source = page.ocrImageUrl || page.imageUrl
  const base64 = !sourcePath && source?.startsWith('data:') ? source : undefined
  if (!sourcePath && !base64) throw new Error('ML Kit OCR received no stored page image.')
  const started = performance.now()
  console.info('[ocr] ML Kit page recognition started', { pageId: page.id, sourcePath, rotation: page.rotation })
  onProgress?.(.15, 'Preparing on-device text recognition')
  const result = await withTimeout(nativeOcr.recognize({ sourcePath, base64, rotation: page.rotation }), NATIVE_RECOGNITION_TIMEOUT_MS, 'ML Kit text recognition')
  onProgress?.(1, 'Text recognized')
  const normalized = normalizeNativeOcrResult(result)
  console.info('[ocr] ML Kit page recognition completed', { pageId: page.id, durationMs: Math.round(performance.now() - started), confidence: normalized.confidence, words: normalized.words.length })
  return normalized
}

async function getWorker() {
  if (!workerPromise) workerPromise = (async () => {
    const started = performance.now()
    console.info('[ocr] worker initialization started', { assetBase: assetBase() })
    const { createWorker, OEM, PSM } = await import('tesseract.js')
    const assets = assetBase()
    const gzip = !Capacitor.isNativePlatform()
    const worker = await createWorker(['eng', 'hin'], OEM.LSTM_ONLY, {
      workerPath: `${assets}worker.min.js`, corePath: `${assets}core`, langPath: `${assets}lang`,
      gzip, cacheMethod: 'none', workerBlobURL: false,
      logger: message => progressListener?.(message.progress, message.status),
    })
    await worker.setParameters({ tessedit_pageseg_mode: PSM.AUTO, preserve_interword_spaces: '1', user_defined_dpi: '300' })
    console.info('[ocr] worker initialization completed', { durationMs: Math.round(performance.now() - started) })
    return worker
  })()
  const pending = workerPromise
  try { return await withTimeout(pending, WORKER_START_TIMEOUT_MS, 'OCR engine startup', () => abandonOCRWorker(pending)) }
  catch (error) { if (workerPromise === pending) workerPromise = undefined; console.error('LOCAL OCR worker initialization failed', { assetBase: assetBase(), error }); throw new Error(`OCR worker initialization failed: ${error instanceof Error ? error.message : String(error)}`) }
}

function abandonOCRWorker(pending = workerPromise) {
  if (!pending) return
  if (workerPromise === pending) workerPromise = undefined
  progressListener = undefined
  void pending.then(worker => worker.terminate()).catch(() => undefined)
}

// Browser builds retain packaged Tesseract assets; Android uses bundled ML Kit OCR.
export const ocrService: OCRService = {
  async recognize(page, onProgress) {
    if (usesNativeMlKit()) return recognizeWithNativeMlKit(page, onProgress)
    progressListener = onProgress
    const started = performance.now()
    console.info('[ocr] page recognition started', { pageId: page.id })
    try {
      const worker = await getWorker()
      const source = page.ocrImageUrl || page.imageUrl
      if (!source) throw new Error('OCR received no readable page image.')
      const dimensions = await withTimeout(imageSize(source), IMAGE_DECODE_TIMEOUT_MS, 'OCR image decoding')
      let result: Awaited<ReturnType<typeof worker.recognize>>
      try { result = await withTimeout(worker.recognize(source, {}, { blocks: true }), RECOGNITION_TIMEOUT_MS, 'Text recognition', () => abandonOCRWorker()) }
      catch (error) { abandonOCRWorker(); throw error }
      console.info('[ocr] page recognition completed', { pageId: page.id, durationMs: Math.round(performance.now() - started), confidence: result.data.confidence })
      return { text: result.data.text.trim(), confidence: result.data.confidence, languages: ['eng', 'hin'], words: positionalWords(result.data.blocks, dimensions.width, dimensions.height) }
    } finally { progressListener = undefined }
  },
}

export interface OCRDiagnostics {
  worker: 'loaded' | 'failed'
  wasm: 'loaded' | 'failed'
  english: 'loaded' | 'failed'
  hindi: 'loaded' | 'failed'
  inputSize: string
  processingMs: number
  confidence?: number
  text?: string
  error?: string
}

export async function runOCRDiagnostics(imageSource: string): Promise<OCRDiagnostics> {
  const started = performance.now(), result: OCRDiagnostics = { worker: 'failed', wasm: 'failed', english: 'failed', hindi: 'failed', inputSize: 'unknown', processingMs: 0 }
  try {
    const image = new Image()
    await new Promise<void>((resolve, reject) => { image.onload = () => resolve(); image.onerror = () => reject(new Error('Diagnostic input image could not be decoded.')); image.src = imageSource })
    result.inputSize = `${image.naturalWidth} × ${image.naturalHeight}`
    if (usesNativeMlKit()) {
      const recognized = normalizeNativeOcrResult(await withTimeout(nativeOcr.recognize({ base64: imageSource, rotation: 0 }), NATIVE_RECOGNITION_TIMEOUT_MS, 'ML Kit OCR diagnostic'))
      result.worker = 'loaded'; result.wasm = 'loaded'; result.english = 'loaded'; result.hindi = 'loaded'; result.confidence = recognized.confidence; result.text = recognized.text
      result.processingMs = Math.round(performance.now() - started)
      return result
    }
    const worker = await getWorker(); result.worker = 'loaded'; result.wasm = 'loaded'; result.english = 'loaded'; result.hindi = 'loaded'
    const recognized = await worker.recognize(imageSource, {}, { blocks: true })
    result.confidence = recognized.data.confidence; result.text = recognized.data.text.trim()
  } catch (error) { result.error = error instanceof Error ? error.message : String(error); console.error('LOCAL OCR diagnostic failed', error) }
  result.processingMs = Math.round(performance.now() - started)
  return result
}

export async function disposeOCRWorker() {
  abandonOCRWorker()
}
