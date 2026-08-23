import { Capacitor, registerPlugin } from '@capacitor/core'
import type { VaultDocument } from '../domain/types'

interface PathResult { paths: Record<string, string> }
interface VaultEncryptionNative {
  encryptDocument(options: { documentId: string; paths: string[] }): Promise<PathResult>
  decryptDocument(options: { documentId: string; paths: string[] }): Promise<PathResult>
  revealDocument(options: { documentId: string; sessionId: string; paths: string[] }): Promise<PathResult>
  clearSession(options: { sessionId: string }): Promise<void>
  clearAllSessions(): Promise<void>
}

const nativeVault = registerPlugin<VaultEncryptionNative>('VaultEncryption')
const encryptedSuffix = '.localenc'

function documentPaths(document: VaultDocument) {
  return [...new Set([
    ...document.pages.flatMap(page => [page.imagePath, page.originalImagePath, page.thumbnailPath, page.ocrImagePath]),
    document.pdfPath,
  ].filter((path): path is string => Boolean(path)))]
}

function remap(document: VaultDocument, paths: Record<string, string>): VaultDocument {
  const mapped = (path?: string) => path ? paths[path] ?? path : undefined
  return {
    ...document,
    pdfPath: mapped(document.pdfPath),
    pages: document.pages.map(page => ({
      ...page,
      imagePath: mapped(page.imagePath),
      originalImagePath: mapped(page.originalImagePath),
      thumbnailPath: mapped(page.thumbnailPath),
      ocrImagePath: mapped(page.ocrImagePath),
    })),
  }
}

async function transformSafely(document: VaultDocument, encrypting: boolean) {
  const sourcePaths = documentPaths(document).filter(path => encrypting ? !path.endsWith(encryptedSuffix) : path.endsWith(encryptedSuffix))
  const completed: Record<string, string> = {}
  try {
    for (const path of sourcePaths) {
      const result = encrypting
        ? await nativeVault.encryptDocument({ documentId: document.id, paths: [path] })
        : await nativeVault.decryptDocument({ documentId: document.id, paths: [path] })
      Object.assign(completed, result.paths)
    }
  } catch (error) {
    const rollbackPaths = Object.values(completed)
    for (const path of rollbackPaths.reverse()) {
      try {
        if (encrypting) await nativeVault.decryptDocument({ documentId: document.id, paths: [path] })
        else await nativeVault.encryptDocument({ documentId: document.id, paths: [path] })
      } catch { /* Preserve the original failure; a later retry can finish mixed paths safely. */ }
    }
    throw error
  }
  return remap(document, completed)
}

export const privateStorageService = {
  isAvailable: () => Capacitor.isNativePlatform(),
  isEncryptedPath: (path?: string) => Boolean(path?.endsWith(encryptedSuffix)),

  async protect(document: VaultDocument) {
    if (!Capacitor.isNativePlatform()) return document
    const protectedDocument = await transformSafely(document, true)
    return { ...protectedDocument, storageProtection: 'keystore-v1' as const }
  },

  async unprotect(document: VaultDocument) {
    if (!Capacitor.isNativePlatform()) return { ...document, storageProtection: undefined }
    const plainDocument = await transformSafely(document, false)
    return { ...plainDocument, storageProtection: undefined }
  },

  async revealPaths(document: VaultDocument) {
    const encrypted = documentPaths(document).filter(path => path.endsWith(encryptedSuffix))
    if (!Capacitor.isNativePlatform() || !encrypted.length) return { sessionId: undefined, paths: {} as Record<string, string> }
    const sessionId = crypto.randomUUID()
    const result = await nativeVault.revealDocument({ documentId: document.id, sessionId, paths: encrypted })
    return { sessionId, paths: result.paths }
  },

  async clearSession(sessionId?: string) {
    if (!Capacitor.isNativePlatform() || !sessionId) return
    try { await nativeVault.clearSession({ sessionId }) } catch { /* Best-effort cleanup on navigation or lock. */ }
  },

  async clearAllSessions() {
    if (!Capacitor.isNativePlatform()) return
    try { await nativeVault.clearAllSessions() } catch { /* A stale session should never block app startup. */ }
  },
}
