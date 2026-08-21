import { useState } from 'react'
import { Check, ChevronLeft, RotateCw, ScanLine } from 'lucide-react'
import type { DocumentPage, PageCorners, RenderPreset } from '../../../domain/types'
import { defaultCorners } from '../processing/edgeDetection'
import { processPageImages } from '../services/scannerProcessingService'
import { CornerEditor } from './CornerEditor'

const presets: { value: RenderPreset; label: string; description: string }[] = [
  { value: 'clean-colour', label: 'Clean Colour', description: 'Best for stamps and signatures' },
  { value: 'grayscale', label: 'Grayscale', description: 'Clear office documents' },
  { value: 'black-white', label: 'B&W', description: 'Crisp typed pages' },
]

export function ScanPageEditor({ page, pageNumber, onCancel, onSave }: { page: DocumentPage; pageNumber: number; onCancel: () => void; onSave: (page: DocumentPage) => void }) {
  const original = page.originalImageUrl ?? page.imageUrl
  const [corners, setCorners] = useState<PageCorners>(page.corners ?? defaultCorners)
  const [preset, setPreset] = useState<RenderPreset>(page.renderPreset ?? 'clean-colour')
  const [preview, setPreview] = useState(page.imageUrl)
  const [thumbnailUrl, setThumbnailUrl] = useState(page.thumbnailUrl)
  const [ocrImageUrl, setOcrImageUrl] = useState(page.ocrImageUrl)
  const [mode, setMode] = useState<'crop' | 'preview'>('crop')
  const [processing, setProcessing] = useState(false)
  const [error, setError] = useState('')

  const render = async (nextPreset = preset) => {
    setProcessing(true); setError('')
    try {
      const result = await processPageImages(original, corners, nextPreset)
      setPreview(result.imageUrl); setThumbnailUrl(result.thumbnailUrl); setOcrImageUrl(result.ocrImageUrl); setPreset(nextPreset); setMode('preview')
    }
    catch { setError('This page could not be processed. The original is still safe.') }
    finally { setProcessing(false) }
  }
  const save = () => onSave({ ...page, originalImageUrl: original, imageUrl: preview, thumbnailUrl, ocrImageUrl, corners, renderPreset: preset, processingState: 'processed' })

  return <div className="scan-editor-screen">
    <header className="scan-editor-header"><button onClick={onCancel} aria-label="Back to page review"><ChevronLeft /></button><div><strong>Page {pageNumber}</strong><span>{mode === 'crop' ? 'Adjust document edges' : 'Choose the best finish'}</span></div><button className="editor-done" onClick={save} disabled={processing}><Check /> Done</button></header>
    <div className="editor-stepper"><button className={mode === 'crop' ? 'active' : ''} onClick={() => setMode('crop')}><i>1</i> Crop</button><span /><button className={mode === 'preview' ? 'active' : ''} onClick={() => void render()}><i>2</i> Enhance</button></div>
    {mode === 'crop' ? <main className="crop-stage"><div className="editor-guidance"><ScanLine /><span>Drag the four corners to the page edges</span></div><CornerEditor imageUrl={original} corners={corners} onChange={setCorners} /><button className="process-page-button" onClick={() => void render()} disabled={processing}>{processing ? <span className="button-spinner" /> : <ScanLine />} {processing ? 'Straightening page…' : 'Apply crop'}</button></main> : <main className="preview-stage"><div className="processed-preview">{processing && <div className="preview-loading"><span className="button-spinner" /> Processing on this device</div>}<img src={preview} alt={`Processed page ${pageNumber}`} style={{ opacity: processing ? .35 : 1 }} /></div><div className="preset-selector" role="radiogroup" aria-label="Document appearance">{presets.map(item => <button key={item.value} role="radio" aria-checked={preset === item.value} className={preset === item.value ? 'active' : ''} onClick={() => void render(item.value)} disabled={processing}><span>{item.label}</span><small>{item.description}</small>{preset === item.value && <Check />}</button>)}</div><button className="adjust-crop-button" onClick={() => setMode('crop')}><RotateCw /> Adjust crop again</button></main>}
    {error && <div className="scanner-error" role="alert">{error}</div>}
  </div>
}
