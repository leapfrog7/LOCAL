export class OperationTimeoutError extends Error {
  constructor(operation: string, timeoutMs: number) {
    super(`${operation} timed out after ${Math.round(timeoutMs / 1000)} seconds.`)
    this.name = 'OperationTimeoutError'
  }
}

export function withTimeout<T>(operation: Promise<T>, timeoutMs: number, label: string, onTimeout?: () => void) {
  return new Promise<T>((resolve, reject) => {
    const timer = globalThis.setTimeout(() => {
      try { onTimeout?.() } finally { reject(new OperationTimeoutError(label, timeoutMs)) }
    }, timeoutMs)
    operation.then(
      value => { globalThis.clearTimeout(timer); resolve(value) },
      error => { globalThis.clearTimeout(timer); reject(error) },
    )
  })
}
