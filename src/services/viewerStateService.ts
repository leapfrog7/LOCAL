export type ViewerReadingMode = 'single' | 'continuous' | 'facing' | 'text'

export interface ViewerReadingState {
  version: 1
  page: number
  mode: ViewerReadingMode
  single: { scale: number; x: number; y: number }
  continuous: { scale: number; scrollTop: number; scrollLeft: number }
  theme: 'original' | 'sepia' | 'night'
  keepAwake: boolean
  trimMargins: boolean
  bookmarks: number[]
}

const keyFor = (documentId: string) => `local.viewer.document.${documentId}`
const defaults = (): ViewerReadingState => ({
  version: 1,
  page: 0,
  mode: 'single',
  single: { scale: 1, x: 0, y: 0 },
  continuous: { scale: 1, scrollTop: 0, scrollLeft: 0 },
  theme: 'original',
  keepAwake: false,
  trimMargins: false,
  bookmarks: []
})
const finite = (value: unknown, fallback: number) => typeof value === 'number' && Number.isFinite(value) ? value : fallback

export const viewerStateService = {
  read(documentId: string): ViewerReadingState {
    const fallback = defaults()
    try {
      const stored = JSON.parse(localStorage.getItem(keyFor(documentId)) ?? '') as Partial<ViewerReadingState>
      if (stored.version !== 1) return fallback
      return {
        version: 1,
        page: Math.max(0, Math.floor(finite(stored.page, 0))),
        mode: stored.mode === 'continuous' || stored.mode === 'facing' || stored.mode === 'text' ? stored.mode : 'single',
        single: {
          scale: finite(stored.single?.scale, 1),
          x: finite(stored.single?.x, 0),
          y: finite(stored.single?.y, 0)
        },
        continuous: {
          scale: finite(stored.continuous?.scale, 1),
          scrollTop: finite(stored.continuous?.scrollTop, 0),
          scrollLeft: finite(stored.continuous?.scrollLeft, 0)
        },
        theme: stored.theme === 'sepia' || stored.theme === 'night' ? stored.theme : 'original',
        keepAwake: stored.keepAwake === true,
        trimMargins: stored.trimMargins === true,
        bookmarks: Array.isArray(stored.bookmarks) ? [...new Set(stored.bookmarks.map(value => Math.max(0, Math.floor(finite(value, 0)))))] : []
      }
    } catch {
      return fallback
    }
  },
  write(documentId: string, state: ViewerReadingState) {
    try { localStorage.setItem(keyFor(documentId), JSON.stringify(state)) } catch { /* Reading state is helpful, never essential. */ }
  }
}
