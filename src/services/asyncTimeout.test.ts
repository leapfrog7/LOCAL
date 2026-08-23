import { afterEach, describe, expect, it, vi } from 'vitest'
import { OperationTimeoutError, withTimeout } from './asyncTimeout'

afterEach(() => vi.useRealTimers())

describe('withTimeout', () => {
  it('returns an operation that finishes in time', async () => {
    await expect(withTimeout(Promise.resolve('ready'), 100, 'Test operation')).resolves.toBe('ready')
  })

  it('rejects and invokes recovery when an operation stalls', async () => {
    vi.useFakeTimers()
    const recover = vi.fn()
    const result = withTimeout(new Promise<string>(() => undefined), 5000, 'Text recognition', recover)
    const assertion = expect(result).rejects.toEqual(expect.any(OperationTimeoutError))
    await vi.advanceTimersByTimeAsync(5000)
    await assertion
    expect(recover).toHaveBeenCalledOnce()
  })
})
