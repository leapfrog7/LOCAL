import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { annotationDraftService } from './annotationDraftService'

const memoryStorage = () => {
  const values = new Map<string, string>()
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
    clear: () => values.clear(),
    key: (index: number) => [...values.keys()][index] ?? null,
    get length() { return values.size }
  }
}

describe('annotation draft recovery', () => {
  beforeEach(() => Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: memoryStorage() }))
  afterEach(() => Reflect.deleteProperty(globalThis, 'localStorage'))

  it('restores only a draft for the current document revision', async () => {
    const pages = { page: [{ id: 'mark', tool: 'pen' as const, color: '#111111', width: .006, points: [{ x: .2, y: .3 }] }] }
    expect(await annotationDraftService.write('document', 'revision-1', pages)).toBe(true)
    expect(await annotationDraftService.read('document', 'revision-1')).toEqual(pages)
    expect(await annotationDraftService.read('document', 'revision-2')).toBeUndefined()
  })

  it('removes a completed or discarded draft', async () => {
    await annotationDraftService.write('document', 'revision-1', {})
    await annotationDraftService.clear('document')
    expect(await annotationDraftService.read('document', 'revision-1')).toBeUndefined()
  })

  it('retains typed note content in a recoverable draft', async () => {
    const pages = { page: [{ id: 'note', tool: 'text' as const, color: '#1565c0', width: .006, fontSize: .03, text: 'Follow up', points: [{ x: .2, y: .3 }] }] }
    await annotationDraftService.write('document', 'revision-1', pages)
    expect(await annotationDraftService.read('document', 'revision-1')).toEqual(pages)
  })
})
