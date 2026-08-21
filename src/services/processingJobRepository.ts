import type { ProcessingJob } from '../domain/processing'
import { sqliteRepository } from './sqliteRepository'

const WEB_KEY = 'local-processing-jobs-v1'
const webJobs = () => { try { return JSON.parse(localStorage.getItem(WEB_KEY) ?? '[]') as ProcessingJob[] } catch { return [] } }

export const processingJobRepository = {
  async upsert(job: ProcessingJob) {
    if (sqliteRepository.available()) return sqliteRepository.upsertJob(job)
    const jobs = webJobs(), index = jobs.findIndex(item => item.id === job.id)
    if (index >= 0) jobs[index] = job; else jobs.push(job)
    localStorage.setItem(WEB_KEY, JSON.stringify(jobs))
  },
  async pending() {
    if (sqliteRepository.available()) return sqliteRepository.pendingJobs()
    const jobs = webJobs().map(job => job.status === 'processing' ? { ...job, status: 'pending' as const } : job)
    localStorage.setItem(WEB_KEY, JSON.stringify(jobs))
    return jobs.filter(job => job.status === 'pending' || (job.status === 'error' && job.attempts < 3)).sort((a, b) => a.createdAt.localeCompare(b.createdAt))
  },
  async cancelDocument(documentId: string) {
    if (sqliteRepository.available()) return sqliteRepository.cancelJobs(documentId)
    localStorage.setItem(WEB_KEY, JSON.stringify(webJobs().map(job => job.documentId === documentId && (job.status === 'pending' || job.status === 'processing') ? { ...job, status: 'cancelled', updatedAt: new Date().toISOString() } : job)))
  },
  async isCancelled(documentId: string) {
    if (sqliteRepository.available()) return sqliteRepository.jobsCancelled(documentId)
    const relevant = webJobs().filter(job => job.documentId === documentId)
    return relevant.length > 0 && relevant.every(job => job.status === 'cancelled' || job.status === 'complete') && relevant.some(job => job.status === 'cancelled')
  },
}
