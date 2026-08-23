import { useEffect, useRef, useState } from 'react'
import { ArrowLeft, RefreshCw, ScanLine } from 'lucide-react'
import { nativeDocumentScannerService } from '../../../services/nativeDocumentScannerService'

export function NativeDocumentScanner({ onComplete, onCancel }: { onComplete: (files: File[]) => Promise<void>; onCancel: () => void }) {
  const launchedRef = useRef(false)
  const completeRef = useRef(onComplete)
  const cancelRef = useRef(onCancel)
  completeRef.current = onComplete
  cancelRef.current = onCancel
  const [error, setError] = useState('')
  const [attempt, setAttempt] = useState(0)
  const [phase, setPhase] = useState<'launching' | 'preparing'>('launching')

  useEffect(() => {
    if (launchedRef.current) return
    launchedRef.current = true
    let active = true
    void nativeDocumentScannerService.scan().then(async result => {
      if (!active) return
      if (result.cancelled) { console.info('[scanner] ML Kit scanner cancelled'); cancelRef.current(); return }
      console.info('[scanner] ML Kit pages returned', { pageCount: result.files.length })
      setPhase('preparing')
      await completeRef.current(result.files)
      console.info('[scanner] returned pages accepted by capture screen', { pageCount: result.files.length })
    }).catch(reason => {
      if (!active) return
      console.error('[scanner] ML Kit flow failed', reason)
      setError(reason instanceof Error ? reason.message : 'The document scanner could not start.')
    })
    return () => { active = false }
  }, [attempt])

  const retry = () => {
    launchedRef.current = false
    setError('')
    setPhase('launching')
    setAttempt(value => value + 1)
  }

  return <div className="full-screen native-scanner-launcher">
    {error ? <section role="alert"><ScanLine /><h2>Scanner unavailable</h2><p>{error}</p><button className="primary-button" onClick={retry}><RefreshCw /> Try again</button><button className="secondary-button" onClick={onCancel}><ArrowLeft /> Go back</button></section>
      : <section aria-live="polite" aria-busy="true"><span className="button-spinner" /><h2>{phase === 'launching' ? 'Opening document scanner…' : 'Preparing scanned pages…'}</h2><p>{phase === 'launching' ? 'The first launch may take a moment while Android prepares the on-device scanner.' : 'Your confirmed pages are being returned safely to LOCAL.'}</p></section>}
  </div>
}
