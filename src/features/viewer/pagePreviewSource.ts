import { Capacitor } from '@capacitor/core'
import type { DocumentPage } from '../../domain/types'

/**
 * Desktop page tools display previews large enough to inspect, so use the
 * stored page image there. Native controls stay on the lightweight thumbnail.
 */
export function pagePreviewSource(page: DocumentPage) {
  if (!Capacitor.isNativePlatform()) return page.imageUrl || page.thumbnailUrl
  return page.thumbnailUrl || page.imageUrl
}
