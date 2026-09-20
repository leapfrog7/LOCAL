import type { VaultDocument } from '../domain/types'

/** Display-only projection. Never persist this object or use it for operations. */
export function privateDocumentPresentation(document: VaultDocument): VaultDocument {
  if (!document.isPrivate) return document
  return {
    ...document, title: 'Private document', tags: [], smartMetadata: undefined,
    privateSessionId: undefined, privatePdfPath: undefined, pdfPath: undefined,
    pages: document.pages.map(page => ({
      ...page, imageUrl: '', originalImageUrl: undefined, thumbnailUrl: undefined, ocrImageUrl: undefined,
      imagePath: undefined, originalImagePath: undefined, thumbnailPath: undefined, ocrImagePath: undefined,
      ocrText: '', ocrWords: [], barcodes: [], annotations: undefined,
    })),
  }
}
