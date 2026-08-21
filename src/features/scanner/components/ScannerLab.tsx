import { useRef, useState } from 'react'
import { ArrowLeft, Check, Download, FlaskConical, Upload } from 'lucide-react'
import type { PageCorners, RenderPreset } from '../../../domain/types'
import { detectDocument } from '../processing/edgeDetection'
import { processImage } from '../services/scannerProcessingService'
import { CornerEditor } from './CornerEditor'

const presetNames: Record<RenderPreset, string> = { 'clean-colour': 'Clean Colour', grayscale: 'Grayscale', 'black-white': 'B&W' }
const toDataUrl = (file: File) => new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = () => reject(reader.error); reader.readAsDataURL(file) })

export function ScannerLab({ onBack }: { onBack: () => void }) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [original, setOriginal] = useState('')
  const [corners, setCorners] = useState<PageCorners | null>(null)
  const [confidence, setConfidence] = useState(0)
  const [results, setResults] = useState<Partial<Record<RenderPreset, string>>>({})
  const [processing, setProcessing] = useState(false)
  const [message, setMessage] = useState('Choose one representative office document.')

  const choose = async (file?: File) => {
    if (!file) return
    setProcessing(true); setResults({}); setMessage('Detecting document edges…')
    try {
      const source = await toDataUrl(file), detection = await detectDocument(source)
      setOriginal(source); setCorners(detection.corners); setConfidence(detection.confidence)
      setMessage(detection.confidence < .5 ? 'Low confidence — adjust all four corners.' : 'Boundary detected. Adjust if needed, then compare.')
    } catch { setMessage('This image could not be opened.') }
    finally { setProcessing(false) }
  }

  const compare = async () => {
    if (!original || !corners) return
    setProcessing(true); setResults({}); setMessage('Processing three local variations…')
    try {
      const next: Partial<Record<RenderPreset, string>> = {}
      for (const preset of Object.keys(presetNames) as RenderPreset[]) { next[preset] = await processImage(original, corners, preset); setResults({ ...next }) }
      setMessage('Compare paper neutrality, shadows, faint text, signatures, and stamps.')
    } catch { setMessage('Processing failed. The source image was not changed.') }
    finally { setProcessing(false) }
  }

  const download = (preset: RenderPreset, url: string) => { const anchor = document.createElement('a'); anchor.href = url; anchor.download = `LOCAL-${preset}.jpg`; anchor.click() }
  return <div className="scanner-lab-screen">
    <header className="top-bar"><button onClick={onBack} aria-label="Back to settings"><ArrowLeft /></button><div><strong>Scanner Lab</strong><span>On-device quality comparison</span></div><div className="lab-private"><Check /> Offline</div></header>
    {!original ? <main className="lab-empty"><div><FlaskConical /></div><h1>Test a real document</h1><p>Use a photo with shadows, an angle, a stamp, signature, faint text, or Hindi content.</p><button className="primary-button" onClick={() => inputRef.current?.click()}><Upload /> Choose test photo</button></main> : <main className="lab-workspace">
      <section className="lab-source"><div className="lab-heading"><div><strong>1. Confirm the page</strong><span>{Math.round(confidence * 100)}% detection confidence</span></div><button onClick={() => inputRef.current?.click()}>Replace</button></div>{corners && <CornerEditor imageUrl={original} corners={corners} onChange={setCorners} />}<button className="process-page-button" onClick={() => void compare()} disabled={processing}>{processing ? <span className="button-spinner" /> : <FlaskConical />} {processing ? 'Processing…' : 'Compare all presets'}</button></section>
      {Object.keys(results).length > 0 && <section className="lab-results"><div className="lab-heading"><div><strong>2. Compare results</strong><span>Tap an image to inspect it closely</span></div></div>{(Object.entries(results) as [RenderPreset, string][]).map(([preset, url]) => <article key={preset}><div><strong>{presetNames[preset]}</strong><button onClick={() => download(preset, url)} aria-label={`Download ${presetNames[preset]} result`}><Download /></button></div><a href={url} target="_blank" rel="noreferrer"><img src={url} alt={`${presetNames[preset]} processing result`} /></a></article>)}</section>}
    </main>}
    <div className="lab-status" aria-live="polite">{processing && <span className="button-spinner" />}{message}</div>
    <input ref={inputRef} className="hidden-input" type="file" accept="image/*" onChange={event => void choose(event.target.files?.[0])} />
  </div>
}
