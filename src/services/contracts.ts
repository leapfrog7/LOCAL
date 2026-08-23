import type { DocumentPage, OCRWord, VaultDocument } from '../domain/types'

export interface ScannerService { scan(): Promise<DocumentPage[]> }
export interface OCRResult { text: string; confidence: number; languages: string[]; words: OCRWord[] }
export interface OCRService { recognize(page: DocumentPage, onProgress?: (progress: number, status: string) => void): Promise<OCRResult> }
export interface PdfService { create(document: VaultDocument): Promise<Blob> }
export interface DocumentRepository {
  list(): Promise<VaultDocument[]>
  get(id: string): Promise<VaultDocument | undefined>
  save(document: VaultDocument): Promise<void>
  remove(id: string): Promise<void>
  search(query: string): Promise<VaultDocument[]>
}
export interface ShareService { share(document: VaultDocument): Promise<void> }
