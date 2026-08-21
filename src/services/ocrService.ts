import type Tesseract from 'tesseract.js'
import type { OCRService } from './contracts'

let workerPromise: Promise<Tesseract.Worker> | undefined
let progressListener: ((progress: number, status: string) => void) | undefined
const assetBase = () => new URL(`${import.meta.env.BASE_URL.replace(/^\//, '')}ocr/`, document.baseURI).href

async function getWorker() {
  if (!workerPromise) workerPromise = (async () => {
    const { createWorker, OEM, PSM } = await import('tesseract.js')
    const assets = assetBase()
    const worker = await createWorker(['eng', 'hin'], OEM.LSTM_ONLY, {
      workerPath: `${assets}worker.min.js`, corePath: `${assets}core`, langPath: `${assets}lang`,
      gzip: true, cacheMethod: 'none', workerBlobURL: false,
      logger: message => progressListener?.(message.progress, message.status),
    })
    await worker.setParameters({ tessedit_pageseg_mode: PSM.AUTO, preserve_interword_spaces: '1', user_defined_dpi: '300' })
    return worker
  })()
  try { return await workerPromise }
  catch (error) { workerPromise = undefined; console.error('LOCAL OCR worker initialization failed', { assetBase: assetBase(), error }); throw new Error(`OCR worker initialization failed: ${error instanceof Error ? error.message : String(error)}`) }
}

// All runtime, WASM core variants, and English/Hindi traineddata are packaged under public/ocr.
export const ocrService: OCRService = {
  async recognize(page, onProgress) {
    progressListener = onProgress
    try {
      const worker = await getWorker()
      const source = page.ocrImageUrl || page.imageUrl
      if (!source) throw new Error('OCR received no readable page image.')
      const result = await worker.recognize(source)
      return { text: result.data.text.trim(), confidence: result.data.confidence, languages: ['eng', 'hin'] }
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
    const worker = await getWorker(); result.worker = 'loaded'; result.wasm = 'loaded'; result.english = 'loaded'; result.hindi = 'loaded'
    const recognized = await worker.recognize(imageSource)
    result.confidence = recognized.data.confidence; result.text = recognized.data.text.trim()
  } catch (error) { result.error = error instanceof Error ? error.message : String(error); console.error('LOCAL OCR diagnostic failed', error) }
  result.processingMs = Math.round(performance.now() - started)
  return result
}

export async function disposeOCRWorker() {
  if (!workerPromise) return
  try { const worker = await workerPromise; await worker.terminate() }
  finally { workerPromise = undefined }
}
