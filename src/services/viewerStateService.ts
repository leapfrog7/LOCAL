export type ViewerReadingMode = 'single' | 'continuous' | 'facing' | 'text'

export interface ViewerReadingState {
  version: 2
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
  version: 2,
  page: 0,
  mode: 'continuous',
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
      const stored = JSON.parse(localStorage.getItem(keyFor(documentId)) ?? '') as Partial<Omit<ViewerReadingState, 'version'>> & { version?: number }
      if (stored.version !== 1 && stored.version !== 2) return fallback
      return {
        version: 2,
        page: Math.max(0, Math.floor(finite(stored.page, 0))),
        // Version 1 wrote the old single-page default even without a user choice.
        mode: stored.mode === 'single' && stored.version === 2 ? 'single' : stored.mode === 'facing' || stored.mode === 'text' ? stored.mode : 'continuous',
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
