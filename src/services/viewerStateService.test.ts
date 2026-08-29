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
  it('stores independent reading state for each document', () => {
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: memoryStorage() })
    const state = { version: 1 as const, page: 12, mode: 'continuous' as const, single: { scale: 2, x: 4, y: 8 }, continuous: { scale: 1.5, scrollTop: .42, scrollLeft: .1 }, theme: 'night' as const, keepAwake: true, trimMargins: true, bookmarks: [2, 12] }
    viewerStateService.write('a', state)
    expect(viewerStateService.read('a')).toEqual(state)
    expect(viewerStateService.read('b').page).toBe(0)
  })

  it('falls back safely when stored state is invalid', () => {
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: memoryStorage() })
    localStorage.setItem('local.viewer.document.bad', '{broken')
    expect(viewerStateService.read('bad')).toMatchObject({ version: 1, page: 0, mode: 'single' })
  })
})
