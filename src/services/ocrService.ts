import type Tesseract from 'tesseract.js'
import type { OCRService } from './contracts'

let workerPromise: Promise<Tesseract.Worker> | undefined
let progressListener: ((progress: number, status: string) => void) | undefined

async function getWorker() {
  if (!workerPromise) workerPromise = (async () => {
    const { createWorker, OEM, PSM } = await import('tesseract.js')
    const assets = new URL('ocr/', document.baseURI).href
    const worker = await createWorker(['eng', 'hin'], OEM.LSTM_ONLY, {
      workerPath: `${assets}worker.min.js`, corePath: `${assets}core`, langPath: `${assets}lang`,
      gzip: true, cacheMethod: 'none', workerBlobURL: false,
      logger: message => progressListener?.(message.progress, message.status),
    })
    await worker.setParameters({ tessedit_pageseg_mode: PSM.AUTO, preserve_interword_spaces: '1', user_defined_dpi: '300' })
    return worker
  })()
  try { return await workerPromise }
  catch (error) { workerPromise = undefined; throw error }
}

// All runtime, WASM core variants, and English/Hindi traineddata are packaged under public/ocr.
export const ocrService: OCRService = {
  async recognize(page, onProgress) {
    progressListener = onProgress
    try {
      const worker = await getWorker()
      const result = await worker.recognize(page.ocrImageUrl || page.imageUrl)
      return { text: result.data.text.trim(), confidence: result.data.confidence, languages: ['eng', 'hin'] }
    } finally { progressListener = undefined }
  },
}

export async function disposeOCRWorker() {
  if (!workerPromise) return
  try { const worker = await workerPromise; await worker.terminate() }
  finally { workerPromise = undefined }
}
