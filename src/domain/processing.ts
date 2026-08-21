export type ProcessingJobType = 'ocr' | 'index'
export type ProcessingJobStatus = 'pending' | 'processing' | 'complete' | 'error' | 'cancelled'

export interface ProcessingJob {
  id: string
  documentId: string
  pageId?: string
  type: ProcessingJobType
  status: ProcessingJobStatus
  attempts: number
  progress: number
  error?: string
  createdAt: string
  updatedAt: string
}
