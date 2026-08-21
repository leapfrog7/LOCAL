import { useRef, useState } from 'react'
import { ArrowLeft, Check, Download, FlaskConical, Upload } from 'lucide-react'
import type { PageCorners, RenderPreset } from '../../../domain/types'
import { runOCRDiagnostics, type OCRDiagnostics } from '../../../services/ocrService'
import { detectDocument } from '../processing/edgeDetection'
import { generatePipelineStages, processImage } from '../services/scannerProcessingService'
import { CornerEditor } from './CornerEditor'

const presets: [RenderPreset, string][] = [['original', 'Original'], ['auto', 'Auto'], ['clean-colour', 'Clean Colour'], ['document', 'Document'], ['grayscale', 'Grayscale'], ['black-white', 'B&W'], ['photocopy', 'Photocopy']]
const toDataUrl = (file: File) => new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = () => reject(reader.error); reader.readAsDataURL(file) })

export function ScannerLab({ onBack }: { onBack: () => void }) {
  const inputRef = useRef<HTMLInputElement>(null), [original, setOriginal] = useState(''), [corners, setCorners] = useState<PageCorners | null>(null)
  const [confidence, setConfidence] = useState(0), [detectionDetails, setDetectionDetails] = useState(''), [results, setResults] = useState<Partial<Record<RenderPreset | 'ocr-input', string>>>({})
  const [stages, setStages] = useState<Record<string, string>>({})
  const [diagnostics, setDiagnostics] = useState<OCRDiagnostics | null>(null), [processing, setProcessing] = useState(false), [message, setMessage] = useState('Choose one representative office document.')

  const choose = async (file?: File) => {
    if (!file) return
    setProcessing(true); setResults({}); setStages({}); setDiagnostics(null); setMessage('Detecting document edges…')
    try { const source = await toDataUrl(file), detection = await detectDocument(source); setOriginal(source); setCorners(detection.corners); setConfidence(detection.confidence); setDetectionDetails(detection.diagnostics ? `Edge ${Math.round(detection.diagnostics.edgeStrength * 100)}% · rectangle ${Math.round(detection.diagnostics.rectangularity * 100)}% · area ${Math.round(detection.diagnostics.areaRatio * 100)}%` : 'Fallback crop'); setMessage(detection.confidence < .5 ? 'Low confidence — manual crop remains available.' : 'Boundary detected. Adjust if needed, then compare.') }
    catch (error) { console.error(error); setMessage(`Image failed: ${error instanceof Error ? error.message : String(error)}`) } finally { setProcessing(false) }
  }
  const compare = async () => {
    if (!original || !corners) return
    setProcessing(true); setResults({}); setStages({}); setDiagnostics(null); setMessage('Rendering local pipeline stages…')
    try { const pipelineStages = await generatePipelineStages(original, corners); setStages(pipelineStages); const next: Partial<Record<RenderPreset | 'ocr-input', string>> = {}; for (const [preset] of presets) { next[preset] = await processImage(original, corners, preset); setResults({ ...next }) }; next['ocr-input'] = pipelineStages['OCR input']; setResults({ ...next }); setMessage('Run OCR diagnostics to verify worker, WASM, language models, and actual text.') }
    catch (error) { console.error(error); setMessage(`Processing failed: ${error instanceof Error ? error.message : String(error)}`) } finally { setProcessing(false) }
  }
  const diagnose = async () => { const source = results['ocr-input']; if (!source) return; setProcessing(true); setMessage('Running bundled English + Hindi OCR…'); const report = await runOCRDiagnostics(source); setDiagnostics(report); setMessage(report.error ? `OCR failed: ${report.error}` : `OCR completed in ${report.processingMs} ms.`); setProcessing(false) }
  const download = (name: string, url: string) => { const anchor = document.createElement('a'); anchor.href = url; anchor.download = `LOCAL-${name}.jpg`; anchor.click() }
  const label = (preset: RenderPreset | 'ocr-input') => preset === 'ocr-input' ? 'OCR Input' : presets.find(item => item[0] === preset)?.[1] ?? preset

  return <div className="scanner-lab-screen"><header className="top-bar"><button onClick={onBack} aria-label="Back to settings"><ArrowLeft /></button><div><strong>Scanner Lab</strong><span>Pipeline and OCR diagnostics</span></div><div className="lab-private"><Check /> Offline</div></header>
    {!original ? <main className="lab-empty"><div><FlaskConical /></div><h1>Test a real document</h1><p>Use a photo with shadows, an angle, a stamp, signature, faint text, or Hindi content.</p><button className="primary-button" onClick={() => inputRef.current?.click()}><Upload /> Choose test photo</button></main> : <main className="lab-workspace"><section className="lab-source"><div className="lab-heading"><div><strong>1. Confirm the page</strong><span>{Math.round(confidence * 100)}% confidence · {detectionDetails}</span></div><button onClick={() => inputRef.current?.click()}>Replace</button></div>{corners ? <CornerEditor imageUrl={original} corners={corners} onChange={setCorners} /> : null}<button className="process-page-button" onClick={() => void compare()} disabled={processing}>{processing ? <span className="button-spinner" /> : <FlaskConical />} {processing ? 'Processing…' : 'Compare pipeline'}</button></section>
    {Object.keys(results).length ? <section className="lab-results"><div className="lab-heading"><div><strong>2. Inspect stages</strong><span>Find the exact stage that improves or damages the page</span></div></div>{Object.entries(stages).map(([stage, url]) => <article key={stage}><div><strong>{stage}</strong><button onClick={() => download(stage, url)} aria-label={`Download ${stage}`}><Download /></button></div><a href={url} target="_blank" rel="noreferrer"><img src={url} alt={`${stage} result`} /></a></article>)}<div className="lab-heading lab-output-heading"><div><strong>3. Compare presets</strong><span>Inspect neutrality, shadows, faint text, stamps, and signatures</span></div></div>{Object.entries(results).map(([preset, url]) => <article key={preset}><div><strong>{label(preset as RenderPreset | 'ocr-input')}</strong><button onClick={() => download(preset, url)} aria-label={`Download ${label(preset as RenderPreset | 'ocr-input')}`}><Download /></button></div><a href={url} target="_blank" rel="noreferrer"><img src={url} alt={`${label(preset as RenderPreset | 'ocr-input')} result`} /></a></article>)}<button className="process-page-button" onClick={() => void diagnose()} disabled={processing}>Run OCR diagnostics</button>{diagnostics ? <div className="ocr-diagnostics"><strong>OCR diagnostic report</strong><dl><div><dt>Worker</dt><dd>{diagnostics.worker}</dd></div><div><dt>WASM</dt><dd>{diagnostics.wasm}</dd></div><div><dt>English model</dt><dd>{diagnostics.english}</dd></div><div><dt>Hindi model</dt><dd>{diagnostics.hindi}</dd></div><div><dt>Input</dt><dd>{diagnostics.inputSize}</dd></div><div><dt>Time</dt><dd>{diagnostics.processingMs} ms</dd></div><div><dt>Confidence</dt><dd>{diagnostics.confidence?.toFixed(1) ?? '—'}</dd></div></dl><pre>{diagnostics.error ?? diagnostics.text ?? 'No text detected'}</pre></div> : null}</section> : null}</main>}
    <div className="lab-status" aria-live="polite">{processing ? <span className="button-spinner" /> : null}{message}</div><input ref={inputRef} className="hidden-input" type="file" accept="image/*" onChange={event => void choose(event.target.files?.[0])} /></div>
}
