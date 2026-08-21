import { useState } from 'react'
import { Check, ChevronLeft, RotateCw, ScanLine, SlidersHorizontal, WandSparkles } from 'lucide-react'
import type { DocumentPage, PageCorners, ProcessingAdjustments, RenderPreset } from '../../../domain/types'
import { defaultCorners, detectDocument } from '../processing/edgeDetection'
import { defaultAdjustments } from '../processing/renderPresets'
import { processPageImages } from '../services/scannerProcessingService'
import { CornerEditor } from './CornerEditor'

const presets: { value: RenderPreset; label: string; description: string }[] = [
  { value: 'original', label: 'Original', description: 'Crop only' }, { value: 'auto', label: 'Auto', description: 'Balanced automatically' },
  { value: 'clean-colour', label: 'Clean Colour', description: 'Stamps and signatures' }, { value: 'document', label: 'Document', description: 'Office pages' },
  { value: 'grayscale', label: 'Grayscale', description: 'Tonal detail' }, { value: 'black-white', label: 'B&W', description: 'Crisp typed pages' },
  { value: 'photocopy', label: 'Photocopy', description: 'Faded originals' },
]
const controls: { key: keyof ProcessingAdjustments; label: string }[] = [
  { key: 'brightness', label: 'Brightness' }, { key: 'contrast', label: 'Contrast' }, { key: 'whites', label: 'Whites' },
  { key: 'shadows', label: 'Shadows' }, { key: 'warmth', label: 'Warmth' }, { key: 'sharpness', label: 'Sharpness' }, { key: 'noiseReduction', label: 'Noise reduction' },
]

export function ScanPageEditor({ page, pageNumber, onCancel, onSave }: { page: DocumentPage; pageNumber: number; onCancel: () => void; onSave: (page: DocumentPage) => void }) {
  const original = page.originalImageUrl ?? page.imageUrl
  const [corners, setCorners] = useState<PageCorners>(page.corners ?? defaultCorners), [preset, setPreset] = useState<RenderPreset>(page.renderPreset ?? 'document')
  const [adjustments, setAdjustments] = useState<ProcessingAdjustments>(page.adjustments ?? defaultAdjustments), [preview, setPreview] = useState(page.imageUrl)
  const [thumbnailUrl, setThumbnailUrl] = useState(page.thumbnailUrl), [ocrImageUrl, setOcrImageUrl] = useState(page.ocrImageUrl)
  const [mode, setMode] = useState<'crop' | 'preview'>('crop'), [processing, setProcessing] = useState(false), [adjustOpen, setAdjustOpen] = useState(false), [error, setError] = useState('')

  const render = async (nextPreset = preset, nextAdjustments = adjustments) => {
    setProcessing(true); setError('')
    try { const result = await processPageImages(original, corners, nextPreset, nextAdjustments); setPreview(result.imageUrl); setThumbnailUrl(result.thumbnailUrl); setOcrImageUrl(result.ocrImageUrl); setPreset(nextPreset); setMode('preview') }
    catch (renderError) { console.error('LOCAL page processing failed', renderError); setError('This page could not be processed. The original is still safe.') }
    finally { setProcessing(false) }
  }
  const redetect = async () => { setProcessing(true); try { const detection = await detectDocument(original); setCorners(detection.corners) } catch (detectionError) { console.error(detectionError); setError('Automatic detection failed. You can still adjust the corners manually.') } finally { setProcessing(false) } }
  const save = () => onSave({ ...page, originalImageUrl: original, imageUrl: preview, thumbnailUrl, ocrImageUrl, corners, renderPreset: preset, adjustments, processingState: 'processed', ocrState: 'pending', ocrText: '' })

  return <div className="scan-editor-screen">
    <header className="scan-editor-header"><button onClick={onCancel} aria-label="Back to page review"><ChevronLeft /></button><div><strong>Page {pageNumber}</strong><span>{mode === 'crop' ? 'Confirm detected edges' : 'Choose the best finish'}</span></div><button className="editor-done" onClick={save} disabled={processing}><Check /> Done</button></header>
    <div className="editor-stepper"><button className={mode === 'crop' ? 'active' : ''} onClick={() => setMode('crop')}><i>1</i> Crop</button><span /><button className={mode === 'preview' ? 'active' : ''} onClick={() => void render()}><i>2</i> Enhance</button></div>
    {mode === 'crop' ? <main className="crop-stage"><div className="editor-guidance"><ScanLine /><span>{(page.detectionConfidence ?? 0) >= .65 ? 'Document detected — adjust only if needed' : 'Check the crop; detection confidence was low'}</span></div><CornerEditor imageUrl={original} corners={corners} onChange={setCorners} /><div className="crop-actions"><button onClick={() => void redetect()} disabled={processing}><WandSparkles /> Re-detect</button><button onClick={() => setCorners(defaultCorners)} disabled={processing}>Reset</button></div><button className="process-page-button" onClick={() => void render()} disabled={processing}>{processing ? <span className="button-spinner" /> : <ScanLine />} {processing ? 'Straightening page…' : 'Continue'}</button></main> : <main className="preview-stage"><div className="processed-preview">{processing && <div className="preview-loading"><span className="button-spinner" /> Processing on this device</div>}<img src={preview} alt={`Processed page ${pageNumber}`} style={{ opacity: processing ? .35 : 1 }} /></div><div className="preset-selector" role="radiogroup" aria-label="Document appearance">{presets.map(item => <button key={item.value} role="radio" aria-checked={preset === item.value} className={preset === item.value ? 'active' : ''} onClick={() => void render(item.value)} disabled={processing}><span>{item.label}</span><small>{item.description}</small>{preset === item.value ? <Check /> : null}</button>)}</div><button className="adjust-toggle" onClick={() => setAdjustOpen(value => !value)}><SlidersHorizontal /> Adjust</button>{adjustOpen ? <div className="adjust-panel">{controls.map(control => <label key={control.key}><span>{control.label}<output>{adjustments[control.key]}</output></span><input type="range" min="-50" max="50" value={adjustments[control.key]} onChange={event => setAdjustments(current => ({ ...current, [control.key]: Number(event.target.value) }))} onPointerUp={() => void render(preset, adjustments)} /></label>)}<button onClick={() => { setAdjustments(defaultAdjustments); void render(preset, defaultAdjustments) }}>Reset adjustments</button></div> : null}<button className="adjust-crop-button" onClick={() => setMode('crop')}><RotateCw /> Adjust crop again</button></main>}
    {error ? <div className="scanner-error" role="alert">{error}</div> : null}
  </div>
}
