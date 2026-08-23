import type { VaultDocument } from '../domain/types'
import { documentsRepository } from './documentRepository'
import { disposeOCRWorker, ocrService } from './ocrService'
import { processingJobRepository } from './processingJobRepository'
import type { ProcessingJob } from '../domain/processing'
import { persistSearchablePdf } from './pdfService'
import { suggestDocumentTitle } from './documentTitleService'
import { backgroundProcessingService, type NativeOcrResult } from './backgroundProcessingService'

const active = new Set<string>()

async function enqueueOcrJobs(document: VaultDocument) {
  const now = new Date().toISOString()
  for (const page of document.pages) if (page.ocrState !== 'complete') {
    const job: ProcessingJob = { id: `ocr:${document.id}:${page.id}`, documentId: document.id, pageId: page.id, type: 'ocr', status: 'pending', attempts: 0, progress: 0, createdAt: now, updatedAt: now }
    await processingJobRepository.upsert(job)
  }
}

async function finalizeDocument(document: VaultDocument, onProgress?: (document: VaultDocument) => void) {
  const suggestion = suggestDocumentTitle(document)
  document.smartMetadata = suggestion.metadata
  if (document.titleSource === 'automatic' || /^scanned document\b/i.test(document.title)) { document.title = suggestion.title; document.titleSource = 'automatic' }
  document.processingStage = 'pdf'; await documentsRepository.save(document); onProgress?.({ ...document })
  try {
    const withPdf = await persistSearchablePdf(document)
    Object.assign(document, withPdf); document.processingStage = 'indexing'; await documentsRepository.save(document); onProgress?.({ ...document })
    document.status = 'indexed'; document.processingStage = 'complete'; await documentsRepository.save(document); onProgress?.({ ...document })
  } catch (error) {
    document.status = 'error'; document.processingStage = 'pdf'; await documentsRepository.save(document); onProgress?.({ ...document }); console.error('Searchable PDF generation failed.', error)
  }
}

export function mergeNativeOcrPages(document: VaultDocument, result: NativeOcrResult, now = new Date().toISOString()): VaultDocument {
  const pageResults = new Map((result.pages ?? []).map(page => [page.pageId, page]))
  const pageErrors = new Set((result.errors ?? []).flatMap(error => error.pageId ? [error.pageId] : []))
  const pages = document.pages.map(page => {
    const recognized = pageResults.get(page.id)
    if (recognized) return { ...page, ocrText: recognized.text, ocrConfidence: recognized.confidence, ocrLanguages: recognized.languages, ocrWords: recognized.words, barcodes: recognized.barcodes ?? [], ocrState: 'complete' as const }
    if (pageErrors.has(page.id) || (result.state === 'failed' && page.ocrState !== 'complete')) return { ...page, ocrState: 'error' as const }
    return page
  })
  return {
    ...document,
    pages,
    updatedAt: now,
    processingStage: 'ocr',
    status: result.state === 'failed' || pages.some(page => page.ocrState === 'error') ? 'error' : 'ocr_processing',
  }
}

async function applyNativeResult(document: VaultDocument, result: NativeOcrResult, onProgress?: (document: VaultDocument) => void) {
  const pageErrors = new Map((result.errors ?? []).filter(error => error.pageId).map(error => [error.pageId!, error.message]))
  const now = new Date().toISOString()
  const merged = mergeNativeOcrPages(document, result, now)
  Object.assign(document, merged)
  for (const page of merged.pages) {
    if (page.ocrState === 'complete') {
      await processingJobRepository.upsert({ id: `ocr:${document.id}:${page.id}`, documentId: document.id, pageId: page.id, type: 'ocr', status: 'complete', attempts: 1, progress: 1, createdAt: now, updatedAt: now })
    } else if (page.ocrState === 'error') {
      await processingJobRepository.upsert({ id: `ocr:${document.id}:${page.id}`, documentId: document.id, pageId: page.id, type: 'ocr', status: 'error', attempts: 1, progress: 0, error: pageErrors.get(page.id), createdAt: now, updatedAt: now })
    }
  }
  await documentsRepository.save(document)
  onProgress?.({ ...document })
  if (result.state === 'running') return
  if (document.status !== 'error' && document.pages.every(page => page.ocrState === 'complete')) await finalizeDocument(document, onProgress)
  await backgroundProcessingService.clearResult(document.id)
}

async function reconcileNativeDocument(id: string, onProgress?: (document: VaultDocument) => void) {
  if (active.has(id)) return
  active.add(id)
  try {
    const document = await documentsRepository.get(id)
    if (!document) return
    if (document.processingStage === 'pdf' && document.status !== 'error' && document.pages.every(page => page.ocrState === 'complete')) {
      await finalizeDocument(document, onProgress)
      return
    }
    const result = await backgroundProcessingService.result(id)
    if (result.state === 'running' || result.state === 'succeeded' || result.state === 'failed') {
      await applyNativeResult(document, result, onProgress)
      return
    }
    const work = await backgroundProcessingService.status(id)
    if (work.state === 'failed' && document.status !== 'saved') {
      document.status = 'error'; document.processingStage = 'ocr'
      document.pages.forEach(page => { if (page.ocrState !== 'complete') page.ocrState = 'error' })
      await documentsRepository.save(document); onProgress?.({ ...document })
    } else if ((work.state === 'absent' || work.state === 'cancelled') && (document.status === 'ocr_pending' || document.status === 'ocr_processing')) {
      await backgroundProcessingService.enqueue(id, false)
      document.status = 'ocr_processing'; await documentsRepository.save(document); onProgress?.({ ...document })
    }
  } finally { active.delete(id) }
}

export async function processDocument(id: string, onProgress?: (document: VaultDocument) => void, enqueue = true) {
  if (active.has(id)) return
  active.add(id)
  console.info('[processing] document started', { documentId: id, enqueue })
  try {
    const document = await documentsRepository.get(id)
    if (!document) return
    if (enqueue) await enqueueOcrJobs(document)
    document.status = 'ocr_processing'; document.processingStage = 'ocr'
    await documentsRepository.save(document)
    onProgress?.({ ...document })
    if (backgroundProcessingService.available()) {
      await backgroundProcessingService.enqueue(id, enqueue)
      return
    }
    const jobs = (await processingJobRepository.pending()).filter(job => job.documentId === document.id && job.type === 'ocr')
    for (const job of jobs) {
      if (await processingJobRepository.isCancelled(document.id)) break
      const page = document.pages.find(item => item.id === job.pageId)
      if (!page || page.ocrState === 'complete') {
        await processingJobRepository.upsert({ ...job, status: 'complete', progress: 1, updatedAt: new Date().toISOString() }); continue
      }
      page.ocrState = 'processing'
      console.info('[processing] OCR job started', { documentId: document.id, pageId: page.id, attempt: job.attempts + 1 })
      await processingJobRepository.upsert({ ...job, status: 'processing', attempts: job.attempts + 1, progress: 0, error: undefined, updatedAt: new Date().toISOString() })
      onProgress?.({ ...document })
      try {
        const result = await ocrService.recognize(page, progress => { job.progress = progress })
        if (await processingJobRepository.isCancelled(document.id)) { page.ocrState = 'pending'; await documentsRepository.save(document); break }
        if (!result.text.trim()) throw new Error('No readable text was detected on this page.')
        page.ocrText = result.text; page.ocrConfidence = result.confidence; page.ocrLanguages = result.languages; page.ocrWords = result.words; page.ocrState = 'complete'
        await processingJobRepository.upsert({ ...job, status: 'complete', attempts: job.attempts + 1, progress: 1, updatedAt: new Date().toISOString() })
        console.info('[processing] OCR job completed', { documentId: document.id, pageId: page.id, confidence: result.confidence })
      } catch (error) {
        if (await processingJobRepository.isCancelled(document.id)) { page.ocrState = 'pending'; await documentsRepository.save(document); break }
        page.ocrState = 'error'
        await processingJobRepository.upsert({ ...job, status: 'error', attempts: job.attempts + 1, progress: job.progress, error: error instanceof Error ? error.message : String(error), updatedAt: new Date().toISOString() })
        console.error('[processing] OCR job failed', { documentId: document.id, pageId: page.id, error: error instanceof Error ? error.message : String(error) })
      }
      await documentsRepository.save(document)
      onProgress?.({ ...document })
    }
    const cancelled = await processingJobRepository.isCancelled(document.id)
    document.status = cancelled ? 'saved' : document.pages.some(p => p.ocrState === 'error') ? 'error' : 'ocr_processing'
    document.updatedAt = new Date().toISOString()
    await documentsRepository.save(document)
    onProgress?.({ ...document })
    if (!cancelled && !document.pages.some(p => p.ocrState === 'error')) await finalizeDocument(document, onProgress)
  } finally { active.delete(id); console.info('[processing] document stopped', { documentId: id }) }
}

export async function cancelProcessing(id: string, onProgress?: (document: VaultDocument) => void) {
  await processingJobRepository.cancelDocument(id)
  await backgroundProcessingService.cancel(id)
  await disposeOCRWorker()
  const document = await documentsRepository.get(id)
  if (!document) return
  document.status = 'saved'
  document.pages.forEach(page => { if (page.ocrState === 'processing') page.ocrState = 'pending' })
  await documentsRepository.save(document)
  onProgress?.({ ...document })
}

export async function retryProcessing(id: string, onProgress?: (document: VaultDocument) => void) {
  const document = await documentsRepository.get(id)
  if (!document) return
  document.pages.forEach(page => { if (page.ocrState !== 'complete') page.ocrState = 'pending' })
  document.status = 'ocr_pending'; document.pdfPath = undefined; document.pdfGeneratedAt = undefined
  await documentsRepository.save(document)
  onProgress?.({ ...document })
  await processDocument(id, onProgress, true)
}

export async function resumePendingProcessing(onProgress?: (document: VaultDocument) => void) {
  if (backgroundProcessingService.available()) {
    const documents = (await documentsRepository.list()).filter(document => document.status === 'ocr_pending' || document.status === 'ocr_processing' || (document.processingStage === 'pdf' && document.status !== 'error'))
    for (const document of documents) await reconcileNativeDocument(document.id, onProgress)
    return
  }
  const jobs = await processingJobRepository.pending()
  const jobDocuments = new Set(jobs.map(job => job.documentId))
  for (const documentId of jobDocuments) await processDocument(documentId, onProgress, false)
  const interrupted = (await documentsRepository.list()).filter(document => (document.status === 'ocr_pending' || document.status === 'ocr_processing') && !jobDocuments.has(document.id))
  for (const document of interrupted) await processDocument(document.id, onProgress, document.status === 'ocr_pending' || document.pages.some(page => page.ocrState !== 'complete'))
}
