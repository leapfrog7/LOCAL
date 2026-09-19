import { afterEach, describe, expect, it } from 'vitest'
import { viewerStateService } from './viewerStateService'

const memoryStorage = () => {
  const values = new Map<string, string>()
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value) },
    removeItem: (key: string) => { values.delete(key) },
    clear: () => values.clear(),
    key: (index: number) => [...values.keys()][index] ?? null,
    get length() { return values.size }
  } satisfies Storage
}

afterEach(() => { Reflect.deleteProperty(globalThis, 'localStorage') })

describe('viewerStateService', () => {
  it('defaults to continuous reading while preserving an explicit saved single-page choice', () => {
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: memoryStorage() })
    expect(viewerStateService.read('new').mode).toBe('continuous')
    const state = viewerStateService.read('chosen')
    viewerStateService.write('chosen', { ...state, mode: 'single' })
    expect(viewerStateService.read('chosen').mode).toBe('single')
  })
  it('stores independent reading state for each document', () => {
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: memoryStorage() })
    const state = { version: 2 as const, page: 12, mode: 'continuous' as const, single: { scale: 2, x: 4, y: 8 }, continuous: { scale: 1.5, scrollTop: .42, scrollLeft: .1 }, theme: 'night' as const, keepAwake: true, trimMargins: true, bookmarks: [2, 12] }
    viewerStateService.write('a', state)
    expect(viewerStateService.read('a')).toEqual(state)
    expect(viewerStateService.read('b').page).toBe(0)
  })

  it('falls back safely when stored state is invalid', () => {
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: memoryStorage() })
    localStorage.setItem('local.viewer.document.bad', '{broken')
    expect(viewerStateService.read('bad')).toMatchObject({ version: 2, page: 0, mode: 'continuous' })
  })

  it('migrates the previous default without losing reading position or bookmarks', () => {
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: memoryStorage() })
    localStorage.setItem('local.viewer.document.old', JSON.stringify({ version: 1, mode: 'single', page: 4, bookmarks: [1, 4] }))
    expect(viewerStateService.read('old')).toMatchObject({ version: 2, mode: 'continuous', page: 4, bookmarks: [1, 4] })
  })
})
