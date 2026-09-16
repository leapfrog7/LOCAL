import { describe, expect, it } from 'vitest'
import { LatestRequest } from './latestRequest'

describe('latest search request', () => {
  it('does not let a slow unfiltered refresh overwrite a newer search', async () => {
    const requests = new LatestRequest()
    let visible: string[] = []
    let finishOld!: (value: string[]) => void
    const oldResults = new Promise<string[]>(resolve => { finishOld = resolve })
    const oldIsCurrent = requests.begin()
    const oldRun = oldResults.then(results => { if (oldIsCurrent()) visible = results })
    const newIsCurrent = requests.begin()
    await Promise.resolve(['invoice']).then(results => { if (newIsCurrent()) visible = results })
    finishOld(['invoice', 'unrelated document'])
    await oldRun
    expect(visible).toEqual(['invoice'])
  })

  it('invalidates a pending response during the next search debounce or unmount', () => {
    const requests = new LatestRequest()
    const isCurrent = requests.begin()
    requests.invalidate()
    expect(isCurrent()).toBe(false)
    expect(requests.begin()()).toBe(true)
  })
})
