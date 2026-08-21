import type { VaultDocument } from '../domain/types'
import { documentsRepository } from './documentRepository'
import { disposeOCRWorker, ocrService } from './ocrService'
import { processingJobRepository } from './processingJobRepository'
import type { ProcessingJob } from '../domain/processing'
import { persistSearchablePdf } from './pdfService'

const active = new Set<string>()

export async function processDocument(id: string, onProgress?: (document: VaultDocument) => void, enqueue = true) {
  if (active.has(id)) return
  active.add(id)
  try {
    const document = await documentsRepository.get(id)
    if (!document) return
    if (enqueue) {
      const now = new Date().toISOString()
      for (const page of document.pages) if (page.ocrState !== 'complete') {
        const job: ProcessingJob = { id: `ocr:${document.id}:${page.id}`, documentId: document.id, pageId: page.id, type: 'ocr', status: 'pending', attempts: 0, progress: 0, createdAt: now, updatedAt: now }
        await processingJobRepository.upsert(job)
      }
    }
    document.status = 'ocr_processing'
    await documentsRepository.save(document)
    onProgress?.({ ...document })
    const jobs = (await processingJobRepository.pending()).filter(job => job.documentId === document.id && job.type === 'ocr')
    for (const job of jobs) {
      if (await processingJobRepository.isCancelled(document.id)) break
      const page = document.pages.find(item => item.id === job.pageId)
      if (!page || page.ocrState === 'complete') {
        await processingJobRepository.upsert({ ...job, status: 'complete', progress: 1, updatedAt: new Date().toISOString() }); continue
      }
      page.ocrState = 'processing'
      await processingJobRepository.upsert({ ...job, status: 'processing', attempts: job.attempts + 1, progress: 0, error: undefined, updatedAt: new Date().toISOString() })
      onProgress?.({ ...document })
      try {
        const result = await ocrService.recognize(page, progress => { job.progress = progress })
        if (await processingJobRepository.isCancelled(document.id)) { page.ocrState = 'pending'; await documentsRepository.save(document); break }
        if (!result.text.trim()) throw new Error('No readable text was detected on this page.')
        page.ocrText = result.text; page.ocrConfidence = result.confidence; page.ocrLanguages = result.languages; page.ocrState = 'complete'
        await processingJobRepository.upsert({ ...job, status: 'complete', attempts: job.attempts + 1, progress: 1, updatedAt: new Date().toISOString() })
      } catch (error) {
        if (await processingJobRepository.isCancelled(document.id)) { page.ocrState = 'pending'; await documentsRepository.save(document); break }
        page.ocrState = 'error'
        await processingJobRepository.upsert({ ...job, status: 'error', attempts: job.attempts + 1, progress: job.progress, error: error instanceof Error ? error.message : String(error), updatedAt: new Date().toISOString() })
      }
      await documentsRepository.save(document)
      onProgress?.({ ...document })
    }
    const cancelled = await processingJobRepository.isCancelled(document.id)
    document.status = cancelled ? 'saved' : document.pages.some(p => p.ocrState === 'error') ? 'error' : 'indexed'
    document.updatedAt = new Date().toISOString()
    await documentsRepository.save(document)
    onProgress?.({ ...document })
    if (document.status === 'indexed') {
      try {
        const withPdf = await persistSearchablePdf(document)
        await documentsRepository.save(withPdf)
        onProgress?.({ ...withPdf })
      } catch (error) { console.warn('Searchable PDF generation will be retried on export.', error) }
    }
  } finally { active.delete(id) }
}

export async function cancelProcessing(id: string, onProgress?: (document: VaultDocument) => void) {
  await processingJobRepository.cancelDocument(id)
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
  const jobs = await processingJobRepository.pending()
  for (const documentId of [...new Set(jobs.map(job => job.documentId))]) await processDocument(documentId, onProgress, false)
}
